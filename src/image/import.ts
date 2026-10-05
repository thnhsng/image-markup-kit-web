import { MarkupError } from '../model/errors';
import type { ImageSource } from '../model/types';
import { createUUID } from '../model/uuid';
import { createCanvas, decodeImage } from './decode';
import { extensionForMimeType, parseImageMetadata, type ImageMetadata } from './metadata';

/** An image to place in the editor: a file or blob, a decoded image, or a URL the browser may fetch. */
export type MarkupImageInput = Blob | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | string;

/** Original image bytes by asset ID, as referenced by `ImageContent.assetID`. */
export type MarkupAssets = Readonly<Record<string, Blob>>;

const HEADER_BYTES = 512 * 1024;

/**
 * Size and orientation of an image file. Reads the header when the format is known (JPEG, PNG, GIF, WebP), and
 * decodes the image otherwise (formats like AVIF or, in Safari, HEIC). Throws `MarkupError` (`unreadableImage`).
 */
export async function readImageMetadata(blob: Blob): Promise<ImageMetadata> {
  const header = await blob.slice(0, HEADER_BYTES).arrayBuffer();
  const parsed = parseImageMetadata(header);
  if (parsed) return parsed;
  const decoded = await decodeImage(blob);
  decoded.close();
  return { pixelSize: { width: decoded.width, height: decoded.height }, orientation: 1, mimeType: blob.type || null };
}

export function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality?: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new MarkupError('encodingFailed', 'The browser could not encode the image.')),
        type,
        quality,
      );
    } catch (error) {
      reject(
        error instanceof DOMException && error.name === 'SecurityError'
          ? new MarkupError('taintedImage', 'A cross-origin image without CORS made the canvas unreadable.', {
              detail: error,
            })
          : new MarkupError('encodingFailed', 'The browser could not encode the image.', { detail: error }),
      );
    }
  });
}

/** Encodes an in-memory image as JPEG 0.9, like the Swift package does for camera images. */
async function encodeDrawable(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = createCanvas(width, height);
  const context = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!canvas || !context) throw new MarkupError('unreadableImage', 'No canvas is available to read the image.');
  context.drawImage(source, 0, 0, width, height);
  try {
    return await encodeCanvas(canvas, 'image/jpeg', 0.9);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function toBlob(input: MarkupImageInput, signal?: AbortSignal): Promise<{ blob: Blob; name: string | null }> {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return { blob: input, name: typeof File !== 'undefined' && input instanceof File ? input.name : null };
  }
  if (typeof input === 'string') {
    // Plain fetch: no credentials or headers are added. Pass a Blob for images that need authentication.
    let response: Response;
    try {
      response = await fetch(input, { signal });
    } catch (error) {
      throw new MarkupError('unreadableImage', 'The image could not be loaded.', { detail: error });
    }
    if (!response.ok)
      throw new MarkupError('unreadableImage', `The image could not be loaded (HTTP ${response.status}).`);
    return { blob: await response.blob(), name: input.split(/[?#]/)[0]?.split('/').pop() ?? null };
  }
  if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
    const src = input.currentSrc || input.src;
    if (/^(blob|data):/.test(src)) return toBlob(src, signal);
    if (!input.complete) await input.decode();
    return { blob: await encodeDrawable(input, input.naturalWidth, input.naturalHeight), name: null };
  }
  if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
    return { blob: await encodeDrawable(input, input.width, input.height), name: null };
  }
  const canvas = input as HTMLCanvasElement | OffscreenCanvas;
  if (typeof canvas.width === 'number' && typeof canvas.getContext === 'function') {
    return { blob: await encodeDrawable(canvas as CanvasImageSource, canvas.width, canvas.height), name: null };
  }
  throw new MarkupError('invalidInput', 'Unsupported image input.');
}

/**
 * Turns images into the editor's photos: each gets an asset ID (`"<UUID>.<ext>"`) and keeps its original bytes
 * (decoded images are encoded as JPEG 0.9). Sources come back in the order given.
 */
export async function importImages(
  inputs: readonly MarkupImageInput[],
  options: { signal?: AbortSignal } = {},
): Promise<{ sources: ImageSource[]; assets: Record<string, Blob> }> {
  const sources: ImageSource[] = [];
  const assets: Record<string, Blob> = {};
  for (const input of inputs) {
    if (options.signal?.aborted) throw new MarkupError('aborted', 'The operation was cancelled.');
    const { blob, name } = await toBlob(input, options.signal);
    const metadata = await readImageMetadata(blob);
    const nameExtension = name && /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
    const extension = nameExtension || extensionForMimeType(blob.type || metadata.mimeType);
    const assetID = `${createUUID()}.${extension}`;
    assets[assetID] = blob;
    sources.push({ assetID, pixelSize: metadata.pixelSize });
  }
  return { sources, assets };
}
