import { describe, expect, it } from 'vitest';
import { decodeImage, decoderAppliesOrientation } from '../../src/image/decode';
import { exportRect } from '../../src/render/export-planner';
import {
  MarkupColors,
  createBoardDocument,
  createCurveItem,
  createImageDocument,
  createMarkupPackage,
  createPolylineItem,
  createShapeItem,
  createTextItem,
  importImages,
  itemStyle,
  planExport,
  readImageMetadata,
  readMarkupPackage,
  renderMarkup,
  type MarkupDocument,
  type Point,
} from '../../src';
import {
  QUADRANT_COLORS,
  canvasOf,
  encode,
  hex,
  isClose,
  pixelsOf,
  quadrantJPEG,
  readExport,
  solidJPEG,
  type RGBA,
} from './support';

const png = { format: { type: 'png' } } as const;

function probe(document: MarkupDocument, pixel: (x: number, y: number) => RGBA, options = {}) {
  const plan = planExport(document, options);
  const scaleX = plan.pixelSize.width / plan.rect.width;
  const scaleY = plan.pixelSize.height / plan.rect.height;
  return (p: Point) => pixel((p.x - plan.rect.x) * scaleX, (p.y - plan.rect.y) * scaleY);
}

describe('export (ExportTests)', () => {
  it('keeps the original pixel size in image mode', async () => {
    const { sources, assets } = await importImages([await solidJPEG(1200, 900)]);
    const base = createImageDocument(sources[0]!);
    const document = {
      ...base,
      items: [...base.items, createShapeItem('rectangle', { x: 10, y: 10, width: 100, height: 100 }, itemStyle())],
    };
    const rendering = await renderMarkup(document, assets);
    expect(rendering.pixelSize).toEqual({ width: 1200, height: 900 });
    expect(rendering.blob.type).toBe('image/jpeg');
    const decoded = await readExport(rendering.blob);
    expect([decoded.width, decoded.height]).toEqual([1200, 900]);
  });

  it('swaps the pixel size of EXIF orientation 6', async () => {
    const jpeg = await solidJPEG(400, 300, '#808080', 6);
    const metadata = await readImageMetadata(jpeg);
    expect(metadata.orientation).toBe(6);
    expect(metadata.pixelSize).toEqual({ width: 300, height: 400 });
    const image = await decodeImage(jpeg, { maxPixelSize: 1000, orientation: 6 });
    expect([image.width, image.height]).toEqual([300, 400]);
    image.close();
  });

  it('draws pixels where expected', async () => {
    const board = createBoardDocument();
    const document = {
      ...board,
      items: [
        createShapeItem(
          'rectangle',
          { x: 0, y: 0, width: 100, height: 100 },
          itemStyle({ strokeColor: null, fillColor: MarkupColors.red, lineWidth: 0 }),
        ),
        // A square rotated 45° around (300, 50): its center is filled, its original corner is not.
        createShapeItem(
          'rectangle',
          { x: 250, y: 0, width: 100, height: 100 },
          itemStyle({ strokeColor: null, fillColor: MarkupColors.blue, lineWidth: 0 }),
          {
            rotation: Math.PI / 4,
          },
        ),
      ],
    };
    const rendering = await renderMarkup(document, {}, png);
    const at = probe(document, (await readExport(rendering.blob)).pixel, png);
    expect(isClose(at({ x: 50, y: 50 }), hex('#FF3B30'))).toBe(true);
    expect(isClose(at({ x: 300, y: 50 }), hex('#007AFF'))).toBe(true);
    expect(isClose(at({ x: 253, y: 3 }), hex('#FFFFFF'))).toBe(true);
    expect(isClose(at({ x: 180, y: 50 }), hex('#FFFFFF'))).toBe(true);
  });

  it('draws photos from their assets', async () => {
    const { sources, assets } = await importImages([await solidJPEG(200, 100, '#00FF00')]);
    const board = createBoardDocument(sources);
    const rendering = await renderMarkup(board, assets, png);
    const photo = board.items[0]!;
    const frame = photo.type === 'image' ? photo.content.box.frame : { x: 0, y: 0, width: 0, height: 0 };
    const color = probe(
      board,
      (await readExport(rendering.blob)).pixel,
      png,
    )({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
    expect(color.r).toBeLessThan(60);
    expect(color.g).toBeGreaterThan(200);
  });

  it('draws curves and filled polygons (LinePathTests)', async () => {
    const board = createBoardDocument();
    const document = {
      ...board,
      items: [
        createPolylineItem(
          [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
          itemStyle({ strokeColor: MarkupColors.red, fillColor: MarkupColors.blue, lineWidth: 4 }),
          { closed: true },
        ),
        createCurveItem(
          [
            { x: 300, y: 0 },
            { x: 400, y: 200 },
            { x: 500, y: 0 },
          ],
          itemStyle({ strokeColor: MarkupColors.red, lineWidth: 10 }),
        ),
      ],
    };
    const rendering = await renderMarkup(document, {}, png);
    const at = probe(document, (await readExport(rendering.blob)).pixel, png);
    expect(isClose(at({ x: 100, y: 100 }), hex('#007AFF'))).toBe(true);
    expect(isClose(at({ x: 200, y: 100 }), hex('#FF3B30'))).toBe(true);
    expect(isClose(at({ x: 400, y: 199 }), hex('#FF3B30'))).toBe(true);
    expect(isClose(at({ x: 400, y: 20 }), hex('#FFFFFF'))).toBe(true);
  });
});

describe('export details', () => {
  it('composites an item with group opacity as one layer', async () => {
    const board = createBoardDocument();
    const document = {
      ...board,
      items: [
        createShapeItem(
          'rectangle',
          { x: 0, y: 0, width: 200, height: 200 },
          itemStyle({ strokeColor: MarkupColors.blue, fillColor: MarkupColors.red, lineWidth: 40, opacity: 0.5 }),
        ),
      ],
    };
    const rendering = await renderMarkup(document, {}, png);
    const at = probe(document, (await readExport(rendering.blob)).pixel, png);
    // Where the stroke covers the fill, only the stroke shows (at 50% over white), not stroke over half-red.
    expect(isClose(at({ x: 5, y: 100 }), { r: 128, g: 189, b: 255, a: 255 }, 6)).toBe(true);
    expect(isClose(at({ x: 100, y: 100 }), { r: 255, g: 157, b: 152, a: 255 }, 6)).toBe(true);
  });

  it('draws a shadow below items that have one', async () => {
    const board = createBoardDocument();
    const document = {
      ...board,
      items: [
        createShapeItem(
          'rectangle',
          { x: 0, y: 0, width: 200, height: 100 },
          itemStyle({ strokeColor: null, fillColor: MarkupColors.white, lineWidth: 0, shadow: true }),
        ),
      ],
    };
    const rendering = await renderMarkup(document, {}, png);
    const at = probe(document, (await readExport(rendering.blob)).pixel, png);
    const below = at({ x: 100, y: 102 });
    expect(below.r).toBeLessThan(250);
    expect(isClose(at({ x: 100, y: 50 }), hex('#FFFFFF'))).toBe(true);
  });

  it('draws text', async () => {
    const board = createBoardDocument();
    const text = createTextItem(
      'IIII',
      { x: 0, y: 0 },
      { font: { family: 'system', size: 60, bold: true, italic: false }, color: MarkupColors.black },
    );
    const document = { ...board, items: [text] };
    const rendering = await renderMarkup(document, {}, png);
    const decoded = await readExport(rendering.blob);
    let dark = 0;
    for (let y = 0; y < decoded.height; y += 2)
      for (let x = 0; x < decoded.width; x += 2) if (decoded.pixel(x, y).r < 100) dark += 1;
    expect(dark).toBeGreaterThan(20);
  });

  it('exports the one-photo board of a typical host at the photo resolution', async () => {
    const { sources, assets } = await importImages([await solidJPEG(4032, 3024, '#3366CC')]);
    const rendering = await renderMarkup(createBoardDocument(sources), assets, {
      format: { type: 'jpeg', quality: 0.85 },
      maxPixelDimension: 4096,
      maxPixelCount: 16_000_000,
      boardPadding: 0,
    });
    expect(rendering.pixelSize).toEqual({ width: 4032, height: 3024 });
    expect(rendering.isClamped).toBe(false);
  });

  it('re-encodes at lower qualities to fit maxBytes, and reports when it cannot', async () => {
    const noise = canvasOf(600, 400, (context) => {
      const image = context.createImageData(600, 400);
      for (let i = 0; i < image.data.length; i += 1) image.data[i] = (i * 2654435761) % 251;
      context.putImageData(image, 0, 0);
    });
    const { sources, assets } = await importImages([await encode(noise, 'image/png')]);
    const document = createImageDocument(sources[0]!);
    const unlimited = await renderMarkup(document, assets, { format: { type: 'jpeg', quality: 0.95, maxBytes: 1e9 } });
    expect(unlimited.exceedsMaxBytes).toBe(false);
    const impossible = await renderMarkup(document, assets, { format: { type: 'jpeg', quality: 0.95, maxBytes: 1 } });
    expect(impossible.exceedsMaxBytes).toBe(true);
    expect(impossible.blob.size).toBeLessThan(unlimited.blob.size);
  });

  it('draws a placeholder and warns when a photo is missing', async () => {
    const board = createBoardDocument([{ assetID: 'gone.jpg', pixelSize: { width: 400, height: 300 } }]);
    const rendering = await renderMarkup(board, {}, png);
    expect(rendering.warnings).toEqual([{ code: 'missingAsset', assetID: 'gone.jpg' }]);
    const center = probe(board, (await readExport(rendering.blob)).pixel, png)({ x: 400, y: 300 });
    expect(isClose(center, hex('#E5E5EA'))).toBe(true);
  });

  it('clamps a large photo to the default 16 MP budget', async () => {
    const { sources, assets } = await importImages([await solidJPEG(6000, 4000)]);
    const rendering = await renderMarkup(createImageDocument(sources[0]!), assets);
    expect(rendering.isClamped).toBe(true);
    expect(rendering.pixelSize.width * rendering.pixelSize.height).toBeLessThanOrEqual(16_020_000);
  });

  it('exports repeatedly without running out of canvases', async () => {
    const { sources, assets } = await importImages([await solidJPEG(800, 600)]);
    const document = createImageDocument(sources[0]!);
    for (let i = 0; i < 12; i += 1) {
      const rendering = await renderMarkup(document, assets);
      expect(rendering.blob.size).toBeGreaterThan(0);
    }
  });

  it('plans an empty board', () => {
    expect(exportRect(createBoardDocument())).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

describe('EXIF orientation', () => {
  // Where the stored image's top-left corner ends up once displayed, for each EXIF orientation.
  const cornerOfStoredTopLeft: Record<number, 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'> = {
    1: 'topLeft',
    2: 'topRight',
    3: 'bottomRight',
    4: 'bottomLeft',
    5: 'topLeft',
    6: 'topRight',
    7: 'bottomRight',
    8: 'bottomLeft',
  };

  it('is applied by this browser', async () => {
    expect(await decoderAppliesOrientation()).toBe(true);
  });

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`decodes orientation ${orientation} upright`, async () => {
      const jpeg = await quadrantJPEG(80, 40, orientation);
      const metadata = await readImageMetadata(jpeg);
      const swapped = orientation >= 5;
      expect(metadata.pixelSize).toEqual(swapped ? { width: 40, height: 80 } : { width: 80, height: 40 });
      const image = await decodeImage(jpeg, { orientation });
      expect([image.width, image.height]).toEqual([metadata.pixelSize.width, metadata.pixelSize.height]);
      const pixel = pixelsOf(image.source, image.width, image.height);
      const corner = cornerOfStoredTopLeft[orientation];
      const point = {
        topLeft: [2, 2],
        topRight: [image.width - 3, 2],
        bottomLeft: [2, image.height - 3],
        bottomRight: [image.width - 3, image.height - 3],
      }[corner!] as [number, number];
      expect(isClose(pixel(...point), hex(QUADRANT_COLORS.topLeft), 40)).toBe(true);
      image.close();
    });
  }
});

describe('import and packages', () => {
  it('imports files, blobs, URLs, canvases and bitmaps in order', async () => {
    const jpeg = await solidJPEG(30, 20);
    const file = new File([jpeg], 'Photo.JPEG', { type: 'image/jpeg' });
    const url = URL.createObjectURL(await solidJPEG(10, 40));
    const canvas = canvasOf(50, 60, (context) => context.fillRect(0, 0, 50, 60));
    const bitmap = await createImageBitmap(canvas);
    const { sources, assets } = await importImages([file, jpeg, url, canvas, bitmap]);
    URL.revokeObjectURL(url);
    expect(sources.map((source) => [source.pixelSize.width, source.pixelSize.height])).toEqual([
      [30, 20],
      [30, 20],
      [10, 40],
      [50, 60],
      [50, 60],
    ]);
    expect(sources[0]?.assetID).toMatch(/^[0-9A-F-]{36}\.jpeg$/);
    expect(sources[1]?.assetID).toMatch(/\.jpg$/);
    expect(Object.keys(assets)).toHaveLength(5);
    expect(assets[sources[0]!.assetID]).toBe(file);
  });

  it('round-trips a package with an export and a thumbnail', async () => {
    const { sources, assets } = await importImages([await solidJPEG(1600, 1200)]);
    const document = createImageDocument(sources[0]!);
    const rendering = await renderMarkup(document, assets);
    const files = await createMarkupPackage(document, assets, rendering.blob);
    expect(Object.keys(files).sort()).toEqual(
      ['assets/' + sources[0]!.assetID, 'document.json', 'export.jpg', 'thumbnail.jpg'].sort(),
    );
    const thumbnail = await readExport(files['thumbnail.jpg']!);
    expect(Math.max(thumbnail.width, thumbnail.height)).toBe(512);
    const read = await readMarkupPackage(files);
    expect(read.document).toEqual(document);
    expect(read.assets[sources[0]!.assetID]).toBe(assets[sources[0]!.assetID]);
  });
});
