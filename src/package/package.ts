import { parseDocument } from '../codec/decode';
import { serializeDocument } from '../codec/encode';
import { createCanvas, decodeImage } from '../image/decode';
import { encodeCanvas, type MarkupAssets } from '../image/import';
import { MarkupError } from '../model/errors';
import type { MarkupDocument, UUIDString } from '../model/types';

// The Swift package saves an editable markup as a folder:
//
//     <document id>.markup/
//         document.json     objects, styles, bindings (schema 1)
//         assets/<assetID>  original photos, byte for byte
//         export.jpg        the flattened image
//         thumbnail.jpg     512 px preview
//
// On the web the same files are handed over as a map of paths to Blobs, so the host can upload them, zip them or
// store them however it likes.

/** Files of a markup package, by path inside the package folder. */
export type MarkupPackageFiles = Readonly<Record<string, Blob>>;

export const MARKUP_PACKAGE_EXTENSION = 'markup';

/** The package folder name for a document: `"<UUID>.markup"`. */
export function markupPackageName(documentID: UUIDString): string {
  return `${documentID.toUpperCase()}.${MARKUP_PACKAGE_EXTENSION}`;
}

/** Asset IDs are file names; any path components are dropped. */
function assetFileName(assetID: string): string {
  return assetID.split('/').pop() ?? assetID;
}

function referencedAssets(document: MarkupDocument): string[] {
  return [...new Set(document.items.flatMap((item) => (item.type === 'image' ? [item.content.assetID] : [])))];
}

/** A 512 px JPEG (quality 0.8) preview of an exported image; null where no canvas is available. */
export async function createThumbnail(exported: Blob, maxPixelSize = 512): Promise<Blob | null> {
  try {
    const image = await decodeImage(exported, { maxPixelSize });
    const canvas = createCanvas(image.width, image.height);
    const context = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!canvas || !context) {
      image.close();
      return null;
    }
    context.drawImage(image.source, 0, 0, image.width, image.height);
    image.close();
    try {
      return await encodeCanvas(canvas, 'image/jpeg', 0.8);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    return null;
  }
}

/**
 * The files of a package for `document`: `document.json`, the referenced photos (byte for byte), and, when an
 * export is given, `export.jpg` and `thumbnail.jpg`. Throws `MarkupError` (`missingAsset`) when a photo is missing.
 */
export async function createMarkupPackage(
  document: MarkupDocument,
  assets: MarkupAssets,
  exported: Blob | null = null,
): Promise<MarkupPackageFiles> {
  const files: Record<string, Blob> = {
    'document.json': new Blob([serializeDocument(document)], { type: 'application/json' }),
  };
  for (const assetID of referencedAssets(document)) {
    const blob = assets[assetID];
    if (!blob) throw new MarkupError('missingAsset', `The photo ${assetID} is missing.`, { assetID });
    files[`assets/${assetFileName(assetID)}`] = blob;
  }
  if (exported) {
    // Always named .jpg, as in the Swift package, even when the export is a PNG.
    files['export.jpg'] = exported;
    const thumbnail = await createThumbnail(exported);
    if (thumbnail) files['thumbnail.jpg'] = thumbnail;
  }
  return files;
}

/** Reads a package back. Throws `MarkupError` (`missingAsset`, `invalidDocument`, `unsupportedSchemaVersion`). */
export async function readMarkupPackage(files: MarkupPackageFiles): Promise<{
  document: MarkupDocument;
  assets: Record<string, Blob>;
  exported: Blob | null;
  thumbnail: Blob | null;
}> {
  const json = files['document.json'];
  if (!json) throw new MarkupError('invalidDocument', 'The package has no document.json.');
  const document = parseDocument(await json.text());
  const assets: Record<string, Blob> = {};
  for (const assetID of referencedAssets(document)) {
    const blob = files[`assets/${assetFileName(assetID)}`];
    if (!blob) throw new MarkupError('missingAsset', `The photo ${assetID} is missing from the package.`, { assetID });
    assets[assetID] = blob;
  }
  return { document, assets, exported: files['export.jpg'] ?? null, thumbnail: files['thumbnail.jpg'] ?? null };
}
