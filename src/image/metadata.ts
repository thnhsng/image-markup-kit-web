import type { Size } from '../model/types';

/** Size and orientation of an image file, read from its header without decoding pixels. */
export interface ImageMetadata {
  /** Pixel size after applying the EXIF orientation (5–8 swap width and height). */
  readonly pixelSize: Size;
  /** EXIF orientation, 1…8. */
  readonly orientation: number;
  readonly mimeType: string | null;
}

function exifOrientation(view: DataView, start: number, length: number): number | null {
  // APP1 "Exif\0\0" followed by a TIFF header.
  if (length < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return null;
  const tiff = start + 6;
  const byteOrder = view.getUint16(tiff);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return null;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > start + length) return null;
  const count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > start + length) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return null;
}

function jpeg(view: DataView): ImageMetadata | null {
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) orientation = exifOrientation(view, offset + 4, length - 2) ?? orientation;
    // Start-of-frame markers (not DHT, JPG or DAC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > view.byteLength) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      const swapped = orientation >= 5;
      return {
        pixelSize: swapped ? { width: height, height: width } : { width, height },
        orientation,
        mimeType: 'image/jpeg',
      };
    }
    offset += 2 + length;
  }
  return null;
}

function png(view: DataView): ImageMetadata | null {
  if (view.byteLength < 24) return null;
  return {
    pixelSize: { width: view.getUint32(16), height: view.getUint32(20) },
    orientation: 1,
    mimeType: 'image/png',
  };
}

function gif(view: DataView): ImageMetadata | null {
  if (view.byteLength < 10) return null;
  return {
    pixelSize: { width: view.getUint16(6, true), height: view.getUint16(8, true) },
    orientation: 1,
    mimeType: 'image/gif',
  };
}

function webp(view: DataView): ImageMetadata | null {
  if (view.byteLength < 30) return null;
  const chunk = view.getUint32(12);
  let size: Size | null = null;
  if (chunk === 0x56503820) {
    // "VP8 ": lossy.
    size = { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  } else if (chunk === 0x5650384c) {
    // "VP8L": lossless, 14-bit width and height minus one.
    const bits = view.getUint32(21, true);
    size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  } else if (chunk === 0x56503858) {
    // "VP8X": extended, 24-bit canvas size minus one.
    const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
    const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
    size = { width, height };
  }
  return size ? { pixelSize: size, orientation: 1, mimeType: 'image/webp' } : null;
}

/** Reads the size and orientation from the first bytes of a JPEG, PNG, GIF or WebP file; null for other formats. */
export function parseImageMetadata(bytes: ArrayBuffer | Uint8Array): ImageMetadata | null {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(array.buffer, array.byteOffset, array.byteLength);
  try {
    if (view.byteLength >= 3 && view.getUint16(0) === 0xffd8) return jpeg(view);
    if (view.byteLength >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return png(view);
    if (view.byteLength >= 6 && view.getUint32(0) === 0x47494638) return gif(view);
    if (view.byteLength >= 12 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250)
      return webp(view);
  } catch {
    return null;
  }
  return null;
}

/** File extension for an image MIME type (`jpg` when unknown, like the Swift package). */
export function extensionForMimeType(mimeType: string | null | undefined): string {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'image/avif':
      return 'avif';
    case 'image/tiff':
      return 'tiff';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'jpg';
  }
}
