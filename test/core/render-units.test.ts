import { describe, expect, it } from 'vitest';
import { extensionForMimeType, parseImageMetadata } from '../../src/image/metadata';
import { displayItem, needsLayer, type DisplayNode } from '../../src/render/display-list';
import {
  MarkupColors,
  STANDARD_STYLE_DEFAULTS,
  createApproximateTextMeasurer,
  createBoardDocument,
  createImageDocument,
  createLineItem,
  createMarkupPackage,
  createPolylineItem,
  createShapeItem,
  createStrokeItem,
  createTextItem,
  isMarkupError,
  itemStyle,
  markupPackageName,
  readMarkupPackage,
} from '../../src';

const env = { measurer: createApproximateTextMeasurer() };

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('image metadata', () => {
  it('reads JPEG sizes and the EXIF orientation', () => {
    const exif = [
      0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0,
      0, 0, 0,
    ];
    const jpeg = bytes(
      0xff,
      0xd8,
      0xff,
      0xe1,
      0,
      exif.length + 2,
      ...exif,
      0xff,
      0xc0,
      0,
      17,
      8,
      0x01,
      0x2c,
      0x01,
      0x90,
      3,
    );
    expect(parseImageMetadata(jpeg)).toEqual({
      pixelSize: { width: 300, height: 400 },
      orientation: 6,
      mimeType: 'image/jpeg',
    });
    const plain = bytes(0xff, 0xd8, 0xff, 0xc2, 0, 17, 8, 0x00, 0x10, 0x00, 0x20, 3);
    expect(parseImageMetadata(plain)?.pixelSize).toEqual({ width: 32, height: 16 });
  });

  it('reads PNG, GIF and WebP sizes', () => {
    const png = new Uint8Array(24);
    png.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 200,
    ]);
    expect(parseImageMetadata(png)?.pixelSize).toEqual({ width: 256, height: 200 });
    const gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0);
    expect(parseImageMetadata(gif)?.pixelSize).toEqual({ width: 10, height: 20 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([99, 0, 0, 49, 0, 0], 24);
    expect(parseImageMetadata(webp)?.pixelSize).toEqual({ width: 100, height: 50 });
    expect(parseImageMetadata(bytes(1, 2, 3))).toBeNull();
    expect(extensionForMimeType('image/png')).toBe('png');
    expect(extensionForMimeType(undefined)).toBe('jpg');
  });
});

function kinds(node: DisplayNode): string[] {
  return node.kind === 'group' ? ['group', ...node.children.flatMap(kinds)] : [node.kind];
}

describe('display list', () => {
  it('describes every kind of item', () => {
    const base = createImageDocument({ assetID: 'a.jpg', pixelSize: { width: 400, height: 300 } });
    const shape = createShapeItem(
      'star',
      { x: 0, y: 0, width: 50, height: 50 },
      itemStyle({ fillColor: MarkupColors.yellow, dash: 'dotted' }),
    );
    const note = createTextItem(
      'Best view!',
      { x: 0, y: 0 },
      {
        font: STANDARD_STYLE_DEFAULTS.noteFont,
        color: STANDARD_STYLE_DEFAULTS.noteTextColor,
        style: STANDARD_STYLE_DEFAULTS.note,
        measurer: env.measurer,
      },
    );
    const stroke = createStrokeItem(
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      STANDARD_STYLE_DEFAULTS.highlighter,
      true,
    );
    const arrow = createLineItem({ x: 0, y: 0 }, { x: 50, y: 0 }, itemStyle());
    const polygon = createPolylineItem(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 0, y: 50 },
      ],
      itemStyle({ fillColor: MarkupColors.blue }),
      { closed: true },
    );
    const document = { ...base, items: [...base.items, shape, note, stroke, arrow, polygon] };
    const [photo, star, text, highlight, line, closed] = document.items.map((item) => displayItem(item, document, env));
    expect(kinds(photo!.content)).toEqual(['group', 'image']);
    expect(kinds(star!.content)).toEqual(['group', 'path']);
    expect(
      star!.content.kind === 'group' &&
        star!.content.children[0]?.kind === 'path' &&
        star!.content.children[0].stroke?.cap,
    ).toBe('round');
    expect(kinds(text!.content)).toEqual(['group', 'path', 'text']);
    expect(needsLayer(text!)).toBe(true);
    expect(needsLayer(highlight!)).toBe(true);
    expect(kinds(line!.content)).toEqual(['group', 'path', 'path']);
    expect(kinds(closed!.content)).toEqual(['group', 'path', 'path']);
    expect(needsLayer(star!)).toBe(false);
  });

  it('draws borders on photos that have one and nothing for strokes without a color', () => {
    const board = createBoardDocument([{ assetID: 'a.jpg', pixelSize: { width: 4, height: 3 } }]);
    const photo = { ...board.items[0]!, style: itemStyle({ strokeColor: MarkupColors.black, lineWidth: 4 }) };
    expect(kinds(displayItem(photo, board, env).content)).toEqual(['group', 'image', 'path']);
    const invisible = createStrokeItem([{ x: 0, y: 0 }], itemStyle({ strokeColor: null }));
    expect(kinds(displayItem(invisible, board, env).content)).toEqual(['group']);
  });
});

describe('packages without a canvas', () => {
  it('round-trips the document and the photos', async () => {
    const document = createBoardDocument([{ assetID: 'folder/a.jpg', pixelSize: { width: 4, height: 3 } }]);
    const photo = new Blob(['photo bytes'], { type: 'image/jpeg' });
    const files = await createMarkupPackage(document, { 'folder/a.jpg': photo });
    expect(Object.keys(files).sort()).toEqual(['assets/a.jpg', 'document.json']);
    const read = await readMarkupPackage(files);
    expect(read.document).toEqual(document);
    expect(await read.assets['folder/a.jpg']?.text()).toBe('photo bytes');
    expect(read.exported).toBeNull();
    expect(markupPackageName('abc')).toBe('ABC.markup');
  });

  it('reports missing photos and documents', async () => {
    const document = createBoardDocument([{ assetID: 'a.jpg', pixelSize: { width: 4, height: 3 } }]);
    await expect(createMarkupPackage(document, {})).rejects.toSatisfy(
      (error: unknown) => isMarkupError(error) && error.code === 'missingAsset',
    );
    const files = await createMarkupPackage(document, { 'a.jpg': new Blob(['x']) });
    await expect(readMarkupPackage({ 'document.json': files['document.json']! })).rejects.toSatisfy(
      (error: unknown) => isMarkupError(error) && error.code === 'missingAsset',
    );
    await expect(readMarkupPackage({})).rejects.toSatisfy(
      (error: unknown) => isMarkupError(error) && error.code === 'invalidDocument',
    );
  });
});
