import { describe, expect, it } from 'vitest';
import { carryChildren } from '../../src/geometry/attachments';
import { bindingFor, refreshCachedEndpoints, resolveEndpoint } from '../../src/geometry/bindings';
import { boxCenter, boxOffset, normalizedPoint, worldPoint } from '../../src/geometry/box';
import { BOARD_GAP, flowFrames } from '../../src/geometry/board-layout';
import { bindTargetAt } from '../../src/geometry/hit-testing';
import { maxY, rectAround, rectsIntersect } from '../../src/geometry/rect';
import { add } from '../../src/geometry/vec';
import {
  appendImages,
  arrangeBoard,
  attachAnnotationsToPhotos,
  createBoardDocument,
  createConnectorItem,
  createImageDocument,
  createLineItem,
  createShapeItem,
  imageItems,
  itemStyle,
  updateItem,
  withItemBox,
  type Box,
  type ImageItem,
  type ImageSource,
  type LineItem,
  type MarkupDocument,
  type TextItem,
} from '../../src';
import { expectPoint } from './helpers';

const sources = (count: number): ImageSource[] =>
  Array.from({ length: count }, (_, i) => ({
    assetID: String(i),
    pixelSize: i % 2 === 0 ? { width: 400, height: 300 } : { width: 300, height: 400 },
  }));
const frames = (document: MarkupDocument) => imageItems(document).map((item) => item.content.box.frame);

// Port of BindingTests.
describe('bindings', () => {
  const twoPhotos = () => createBoardDocument(sources(2));

  it('round-trips an anchor on a rotated target', () => {
    let board = twoPhotos();
    const first = board.items[0] as ImageItem;
    board = updateItem(board, first.id, (item) => withItemBox(item, { ...first.content.box, rotation: 0.6 }));
    const target = board.items[0] as ImageItem;
    const point = worldPoint(target.content.box, { x: 0.3, y: 0.8 });
    const binding = bindingFor(point, target, 0);
    expect(binding?.anchor.x).toBeCloseTo(0.3, 9);
    expect(binding?.anchor.y).toBeCloseTo(0.8, 9);
    expectPoint(resolveEndpoint({ point: { x: 0, y: 0 }, binding }, board), point);
  });

  it('snaps to the center and the edge midpoints', () => {
    const board = twoPhotos();
    const target = board.items[0] as ImageItem;
    const near = add(boxCenter(target.content.box), { x: 5, y: -4 });
    expect(bindingFor(near, target, 12)?.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(bindingFor(near, target, 2)?.anchor).not.toEqual({ x: 0.5, y: 0.5 });
  });

  it('keeps a bound end on its target through move, resize and rotate', () => {
    let board = twoPhotos();
    const [a, b] = board.items as ImageItem[];
    if (!a || !b) throw new Error('two photos');
    const anchor = { x: 0.75, y: 0.25 };
    const line = createConnectorItem(
      { itemID: a.id, anchor },
      { itemID: b.id, anchor: { x: 0.5, y: 0.5 } },
      board,
      itemStyle(),
    );
    board = { ...board, items: [...board.items, line] };
    const mutations: Array<(box: Box) => Box> = [
      (box) => boxOffset(box, { x: 120, y: -40 }),
      (box) => ({ ...box, frame: { ...box.frame, width: box.frame.width * 1.5, height: box.frame.height * 1.5 } }),
      (box) => ({ ...box, rotation: Math.PI / 3 }),
    ];
    for (const mutate of mutations) {
      board = updateItem(board, a.id, (item) => withItemBox(item, mutate((item as ImageItem).content.box)));
      const expected = worldPoint((board.items[0] as ImageItem).content.box, anchor);
      expectPoint(resolveEndpoint(line.content.start, board), expected);
    }
  });

  it('refreshes cached end points after the target moves', () => {
    let board = twoPhotos();
    const [a, b] = board.items as ImageItem[];
    if (!a || !b) throw new Error('two photos');
    const line = createConnectorItem(
      { itemID: a.id, anchor: { x: 0.5, y: 0.5 } },
      { itemID: b.id, anchor: { x: 0.5, y: 0.5 } },
      board,
      itemStyle(),
    );
    board = { ...board, items: [...board.items, line] };
    board = updateItem(board, a.id, (item) =>
      withItemBox(item, boxOffset((item as ImageItem).content.box, { x: 0, y: 500 })),
    );
    board = refreshCachedEndpoints(board);
    const cached = (board.items.find((item) => item.id === line.id) as LineItem).content.start.point;
    expect(cached).toEqual(boxCenter((board.items[0] as ImageItem).content.box));
  });

  it('never binds to lines or the background', () => {
    const base = createImageDocument({ assetID: 'a', pixelSize: { width: 1000, height: 800 } });
    expect(bindTargetAt({ x: 500, y: 400 }, base, 5)).toBeNull();
    const rect = createShapeItem('rectangle', { x: 100, y: 100, width: 100, height: 100 }, itemStyle());
    const line = createLineItem({ x: 0, y: 150 }, { x: 400, y: 150 }, itemStyle());
    const document = { ...base, items: [...base.items, rect, line] };
    expect(bindTargetAt({ x: 150, y: 150 }, document, 5)?.id).toBe(rect.id);
    expect(bindTargetAt({ x: 350, y: 150 }, document, 5)).toBeNull();
  });
});

// Port of BoardLayoutTests (the arrange undo step is tested with the editor store).
describe('boards', () => {
  it('places photos side by side, three per row', () => {
    const f = frames(createBoardDocument(sources(4)));
    expect(f.map((frame) => frame.height)).toEqual([600, 600, 600, 600]);
    expect(f[1]?.x).toBeCloseTo((f[0]?.x ?? 0) + (f[0]?.width ?? 0) + BOARD_GAP, 9);
    expect(f[2]?.y).toBe(f[0]?.y);
    expect(f[3]?.y).toBeCloseTo((f[0]?.y ?? 0) + 600 + BOARD_GAP, 9);
  });

  it('continues the reading order when appending', () => {
    const board = createBoardDocument(sources(2));
    const before = frames(board);
    const f = frames(appendImages(board, sources(2)).document);
    expect(f.slice(0, 2)).toEqual(before);
    expect(f[2]?.y).toBe(f[0]?.y);
    expect(f[3]?.y ?? 0).toBeGreaterThan(maxY(f[0] ?? { x: 0, y: 0, width: 0, height: 0 }));
  });

  it('avoids overlapping photos moved by hand', () => {
    let board = createBoardDocument(sources(2));
    const third = flowFrames(sources(3).map((s) => s.pixelSize))[2];
    if (!third) throw new Error('third frame');
    board = updateItem(board, (board.items[1] as ImageItem).id, (item) =>
      withItemBox(item, { frame: third, rotation: 0 }),
    );
    const f = frames(appendImages(board, sources(1)).document);
    expect(rectsIntersect(f[2] ?? third, f[1] ?? third)).toBe(false);
    expect(rectsIntersect(f[2] ?? third, f[0] ?? third)).toBe(false);
  });

  it('arranges as a column and a grid', () => {
    const column = arrangeBoard(createBoardDocument(sources(4)), 'column');
    const c = frames(column);
    expect(c.every((frame) => Math.abs(frame.width - 800) < 1e-9)).toBe(true);
    for (let i = 1; i < c.length; i += 1) expect(c[i]?.y ?? 0).toBeGreaterThan(maxY(c[i - 1] ?? c[0]!));
    const g = frames(arrangeBoard(column, 'grid'));
    expect(g[0]?.y).toBe(g[1]?.y);
    expect(g[2]?.y ?? 0).toBeGreaterThan(maxY(g[0] ?? g[1]!));
  });

  it('carries attached annotations with their photo', () => {
    let board = createBoardDocument(sources(1));
    const photo = board.items[0] as ImageItem;
    const photoBox = photo.content.box;
    const circle = createShapeItem('ellipse', { x: 100, y: 100, width: 80, height: 80 }, itemStyle());
    const label: TextItem = {
      id: 'C0FFEE00-0000-4000-8000-000000000042',
      type: 'text',
      content: {
        text: 'Summit',
        font: { family: 'system', size: 30, bold: false, italic: false },
        color: '#FF3B30FF',
        alignment: 'left',
        fixedWidth: null,
        padding: 8,
        box: { frame: { x: 300, y: 200, width: 120, height: 52 }, rotation: 0 },
      },
      style: itemStyle({ strokeColor: null }),
      isLocked: false,
      parentID: null,
    };
    board = attachAnnotationsToPhotos({ ...board, items: [...board.items, circle, label] });
    expect(board.items.find((item) => item.id === circle.id)?.parentID).toBe(photo.id);
    expect(board.items.find((item) => item.id === label.id)?.parentID).toBe(photo.id);

    const moved: ImageItem = {
      ...photo,
      content: {
        ...photo.content,
        box: {
          frame: rectAround(add(boxCenter(photoBox), { x: 1000, y: 0 }), {
            width: photoBox.frame.width * 2,
            height: photoBox.frame.height * 2,
          }),
          rotation: Math.PI / 2,
        },
      },
    };
    const result = carryChildren(
      photo,
      moved,
      board,
      updateItem(board, photo.id, () => moved),
    );
    const circleBox = (result.items.find((item) => item.id === circle.id) as typeof circle).content.box;
    expect(circleBox.frame.width).toBeCloseTo(160, 9);
    expect(circleBox.rotation).toBeCloseTo(Math.PI / 2, 9);
    expectPoint(
      normalizedPoint(moved.content.box, boxCenter(circleBox)),
      normalizedPoint(photoBox, boxCenter(circle.content.box)),
    );
    const labelBox = (result.items.find((item) => item.id === label.id) as TextItem).content.box;
    expect([labelBox.frame.width, labelBox.frame.height]).toEqual([
      label.content.box.frame.width,
      label.content.box.frame.height,
    ]);
    expect(labelBox.rotation).toBe(0);
  });

  it('attaches to the topmost photo under the center', () => {
    let board = createBoardDocument(sources(2));
    const second = imageItems(board)[1] as ImageItem;
    const mark = createShapeItem(
      'rectangle',
      rectAround(boxCenter(second.content.box), { width: 20, height: 20 }),
      itemStyle(),
    );
    const outside = createShapeItem('rectangle', { x: -500, y: -500, width: 20, height: 20 }, itemStyle());
    board = attachAnnotationsToPhotos({ ...board, items: [...board.items, mark, outside] });
    expect(board.items.find((item) => item.id === mark.id)?.parentID).toBe(second.id);
    expect(board.items.find((item) => item.id === outside.id)?.parentID).toBeNull();
  });
});
