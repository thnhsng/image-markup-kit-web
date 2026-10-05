import { MarkupError } from '../model/errors';

// Decoding photos for drawing, at the size they are needed (never above the original). Decodes are queued: at most
// two at a time, and one at a time for very large photos, which matters on phones (a 48 MP photo needs ~190 MB).

/** A decoded image ready for `drawImage`. `close()` frees its memory. */
export interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

// A 2×1 JPEG whose EXIF orientation (6) turns it into 1×2: browsers that honor orientation decode it as 1×2.
const ORIENTATION_PROBE =
  '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAGBgYGBgYKBgYKDgoKCg4SDg4ODhIXEhISEhIXHBcXFxcXFxwcHBwcHBwcIiIiIiIiJycnJycsLCwsLCwsLCws/9sAQwEHBwcLCgsTCgoTLh8aHy4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4u/90ABAAB/9oADAMBAAIRAxEAPwDyu5/4+Jf99v51BU9z/wAfEv8Avt/OoK98+pP/2Q==';

type Bitmap = ImageBitmap & { close(): void };

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MarkupError('aborted', 'The operation was cancelled.');
}

/** Decodes with an <img> (EXIF orientation applied by CSS `image-orientation: from-image`, the default). */
async function decodeWithImageElement(blob: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('decode failed'));
      });
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { image, release: () => URL.revokeObjectURL(url) };
}

async function decodeFull(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = (await createImageBitmap(blob, { imageOrientation: 'from-image' })) as Bitmap;
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older engines reject the options or the format; the <img> path below may still decode it.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') throw new Error('no image decoder');
  const { image, release } = await decodeWithImageElement(blob);
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release };
}

let orientationProbe: Promise<boolean> | undefined;

/** Whether this browser applies EXIF orientation when decoding (current browsers do). */
export function decoderAppliesOrientation(): Promise<boolean> {
  orientationProbe ??= (async () => {
    try {
      const decoded = await decodeFull(
        new Blob([base64ToBytes(ORIENTATION_PROBE).buffer as ArrayBuffer], { type: 'image/jpeg' }),
      );
      decoded.release();
      return decoded.width === 1 && decoded.height === 2;
    } catch {
      return true;
    }
  })();
  return orientationProbe;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  } catch {
    return null;
  }
  return null;
}

/** Draws `source` (raw pixels, `orientation` not yet applied) upright into a canvas of the oriented size. */
function orient(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  orientation: number,
  width: number,
  height: number,
): void {
  // width × height is the upright size; transforms map raw pixels into it (EXIF orientations 2–8).
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, width, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, width, height);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, height);
      break;
    default:
      break;
  }
}

class Queue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(heavy: boolean, task: () => Promise<T>): Promise<T> {
    const limit = heavy ? 1 : 2;
    while (this.active >= limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const queue = new Queue();
const HEAVY_PIXELS = 24_000_000;

/**
 * Decodes `blob` upright, scaled down so its longest side is at most `maxPixelSize` (never up). `orientation` and
 * `pixelCount` come from the file's metadata when known; the orientation is applied by hand only when the browser
 * does not. Throws `MarkupError` (`unreadableImage`) when this browser cannot decode the format (e.g. HEIC outside
 * Safari).
 */
export async function decodeImage(
  blob: Blob,
  options: { maxPixelSize?: number; orientation?: number; pixelCount?: number; signal?: AbortSignal } = {},
): Promise<DecodedImage> {
  throwIfAborted(options.signal);
  const heavy = (options.pixelCount ?? 0) > HEAVY_PIXELS;
  return queue.run(heavy, async () => {
    throwIfAborted(options.signal);
    let full: Awaited<ReturnType<typeof decodeFull>>;
    try {
      full = await decodeFull(blob);
    } catch (error) {
      throw new MarkupError('unreadableImage', 'This browser cannot decode the image.', { detail: error });
    }
    const manualOrientation =
      (options.orientation ?? 1) !== 1 && !(await decoderAppliesOrientation()) ? (options.orientation ?? 1) : 1;
    const swapped = manualOrientation >= 5;
    const uprightWidth = swapped ? full.height : full.width;
    const uprightHeight = swapped ? full.width : full.height;
    const longest = Math.max(uprightWidth, uprightHeight);
    const scale = options.maxPixelSize && longest > options.maxPixelSize ? options.maxPixelSize / longest : 1;
    if (scale === 1 && manualOrientation === 1) {
      return { source: full.source, width: full.width, height: full.height, close: full.release };
    }
    const width = Math.max(Math.round(uprightWidth * scale), 1);
    const height = Math.max(Math.round(uprightHeight * scale), 1);
    const canvas = createCanvas(width, height);
    const context = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!canvas || !context) {
      return { source: full.source, width: full.width, height: full.height, close: full.release };
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    orient(context, manualOrientation, width, height);
    const [drawWidth, drawHeight] = swapped ? [height, width] : [width, height];
    context.drawImage(full.source, 0, 0, drawWidth, drawHeight);
    full.release();
    return {
      source: canvas as CanvasImageSource,
      width,
      height,
      close: () => {
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  });
}
