// Image helpers for the browser tests: synthetic JPEGs with an EXIF orientation, pixel probes.

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function canvasOf(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D context');
  draw(context);
  return canvas;
}

export function encode(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), type, quality),
  );
}

/** Replaces a JPEG's APPn segments with one EXIF segment holding only the orientation tag. */
export async function withOrientation(jpeg: Blob, orientation: number): Promise<Blob> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const tiff = [
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const out: number[] = [0xff, 0xd8, 0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xda) {
      out.push(...bytes.subarray(offset));
      break;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe))
      out.push(...bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return new Blob([new Uint8Array(out)], { type: 'image/jpeg' });
}

/** A solid JPEG of the given stored size, optionally with an EXIF orientation. */
export async function solidJPEG(width: number, height: number, color = '#808080', orientation = 1): Promise<Blob> {
  const jpeg = await encode(
    canvasOf(width, height, (context) => {
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
    }),
  );
  return orientation === 1 ? jpeg : withOrientation(jpeg, orientation);
}

export const QUADRANT_COLORS = {
  topLeft: '#FF0000',
  topRight: '#00FF00',
  bottomLeft: '#0000FF',
  bottomRight: '#FFFF00',
};

/** A stored image with a colored quadrant in each corner. */
export async function quadrantJPEG(width: number, height: number, orientation: number): Promise<Blob> {
  const jpeg = await encode(
    canvasOf(width, height, (context) => {
      const w = width / 2;
      const h = height / 2;
      context.fillStyle = QUADRANT_COLORS.topLeft;
      context.fillRect(0, 0, w, h);
      context.fillStyle = QUADRANT_COLORS.topRight;
      context.fillRect(w, 0, w, h);
      context.fillStyle = QUADRANT_COLORS.bottomLeft;
      context.fillRect(0, h, w, h);
      context.fillStyle = QUADRANT_COLORS.bottomRight;
      context.fillRect(w, h, w, h);
    }),
    'image/jpeg',
    1,
  );
  return withOrientation(jpeg, orientation);
}

/** Pixels of an image source, top-left origin. */
export function pixelsOf(source: CanvasImageSource, width: number, height: number): (x: number, y: number) => RGBA {
  const canvas = canvasOf(width, height, (context) => context.drawImage(source, 0, 0, width, height));
  const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, width, height).data;
  return (x, y) => {
    const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
    return { r: data[offset] ?? -1, g: data[offset + 1] ?? -1, b: data[offset + 2] ?? -1, a: data[offset + 3] ?? -1 };
  };
}

/** Decodes an exported image (no EXIF) and returns its size and a pixel reader. */
export async function readExport(
  blob: Blob,
): Promise<{ width: number; height: number; pixel: (x: number, y: number) => RGBA }> {
  const bitmap = await createImageBitmap(blob);
  const result = { width: bitmap.width, height: bitmap.height, pixel: pixelsOf(bitmap, bitmap.width, bitmap.height) };
  bitmap.close();
  return result;
}

export function hex(color: string): RGBA {
  const value = parseInt(color.replace('#', '').slice(0, 6), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 255 };
}

export function isClose(actual: RGBA, expected: RGBA, tolerance = 12): boolean {
  return (
    Math.abs(actual.r - expected.r) <= tolerance &&
    Math.abs(actual.g - expected.g) <= tolerance &&
    Math.abs(actual.b - expected.b) <= tolerance &&
    Math.abs(actual.a - expected.a) <= tolerance
  );
}
