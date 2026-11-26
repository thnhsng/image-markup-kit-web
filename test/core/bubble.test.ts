import { describe, expect, it } from 'vitest';
import { EditorController, type PointerInput } from '../../src/editor/controller';
import { createDebugDriver } from '../../src/editor/debug';
import { BubbleTailInteraction } from '../../src/editor/interactions';
import { handleAt } from '../../src/editor/overlay';
import { applyAffine } from '../../src/geometry/affine';
import { boxToWorld } from '../../src/geometry/box';
import { resolvedPoints } from '../../src/geometry/bindings';
import {
  bubblePath,
  bubbleTailHandles,
  bubbleWithTail,
  documentWithTail,
  draggedTail,
  MINIMUM_TAIL_WIDTH,
  ORIGINAL_TAIL,
  shapeFrameSpaceBounds,
  tailLayout,
  widthHandlePoint,
} from '../../src/geometry/bubble';
import { erasableItems, itemAt } from '../../src/geometry/hit-testing';
import { inkBounds, visualBounds } from '../../src/geometry/item-geometry';
import { pathBounds, type Path, type PathCommand } from '../../src/geometry/path';
import { shapePathOf } from '../../src/geometry/path-factory';
import {
  createApproximateTextMeasurer,
  createLineItem,
  createShapeItem,
  findItem,
  itemStyle,
  parseDocument,
  serializeDocument,
  type BubbleTail,
  type MarkupItem,
  type Point,
  type Rect,
  type ShapeItem,
} from '../../src';
import { boardWith, expectPoint, expectRect } from './helpers';

const P = (x: number, y: number): Point => ({ x, y });
const measurer = createApproximateTextMeasurer();

function bubble(frame: Rect, options: { rotation?: number; cornerRadius?: number; tail?: BubbleTail | null } = {}) {
  return createShapeItem('speechBubble', frame, itemStyle({ cornerRadius: options.cornerRadius ?? 0 }), {
    rotation: options.rotation ?? 0,
    tail: options.tail ?? null,
  });
}

function shapeOf(item: MarkupItem | null | undefined): ShapeItem {
  if (item?.type !== 'shape') throw new Error('not a shape');
  return item;
}

/** Every point of an item's outline in world space, command by command. */
function worldOutline(item: MarkupItem): Point[] {
  const shape = shapeOf(item);
  const transform = boxToWorld(shape.content.box);
  const path: Path = shapePathOf(shape.content, shape.style.cornerRadius);
  const pointsOf = (command: PathCommand): Point[] => {
    switch (command.type) {
      case 'M':
      case 'L':
        return [P(command.x, command.y)];
      case 'Q':
        return [P(command.x1, command.y1), P(command.x, command.y)];
      case 'C':
        return [P(command.x1, command.y1), P(command.x2, command.y2), P(command.x, command.y)];
      case 'Z':
        return [];
    }
  };
  return path.flatMap((command) => pointsOf(command).map((point) => applyAffine(transform, point)));
}

/** A board editor at zoom 1 with no scrolling, so screen points are canvas points. */
function makeBoard(items: readonly MarkupItem[]): EditorController {
  const editor = new EditorController(boardWith(items), { measurer });
  editor.setViewportSize(800, 600);
  editor.viewport.zoom = 1;
  editor.viewport.offsetX = 0;
  editor.viewport.offsetY = 0;
  return editor;
}

describe('speech bubble tails', () => {
  it('keep the outline when a bubble gets its tail', () => {
    for (const [width, height] of [
      [160, 120],
      [300, 80],
      [60, 200],
    ] as const) {
      for (const cornerRadius of [0, 8, 300]) {
        for (const rotation of [0, 0.7, 2.45]) {
          const original = bubble({ x: 40, y: 70, width, height }, { rotation, cornerRadius });
          const adjusted = shapeOf(bubbleWithTail(original));
          expect(adjusted.content.tail).toEqual(ORIGINAL_TAIL);
          expect(adjusted.content.box.frame.height).toBeCloseTo(height * 0.78, 9);
          const before = worldOutline(original);
          const after = worldOutline(adjusted);
          expect(after.length).toBe(before.length);
          before.forEach((point, index) => expectPoint(after[index]!, point, 9));
        }
      }
    }
  });

  it('leave other items alone', () => {
    expect(bubbleWithTail(createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle()))).toBeNull();
    const adjusted = bubble({ x: 0, y: 0, width: 100, height: 50 }, { tail: { tip: P(2, 0.5), width: 0.3 } });
    expect(bubbleWithTail(adjusted)).toBe(adjusted);
    expect(
      bubbleTailHandles(createShapeItem('ellipse', { x: 0, y: 0, width: 10, height: 10 }, itemStyle())),
    ).toBeNull();
    expect(draggedTail(bubble({ x: 0, y: 0, width: 100, height: 50 }), 'tip', P(0, 0))).toBeNull();
  });

  it('leave the side facing their tip', () => {
    const size = { width: 200, height: 100 };
    const cases: [Point, string][] = [
      [P(0.4, -0.8), 'top'],
      [P(1.6, 0.7), 'right'],
      [P(0.2, 1.5), 'bottom'],
      [P(-0.9, 0.1), 'left'],
    ];
    for (const [tip, side] of cases) {
      const tail = { tip, width: 0.2 };
      expect(tailLayout(size, 0, tail)?.side).toBe(side);
      const bounds = pathBounds(bubblePath(size, 0, tail));
      expect(bounds.x).toBeLessThanOrEqual(tip.x * 200);
      expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(tip.x * 200 - 1e-9);
      expect(bounds.y).toBeLessThanOrEqual(tip.y * 100);
      expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(tip.y * 100 - 1e-9);
    }
    // No tail when the tip is inside the body.
    const inside = { tip: P(0.3, 0.6), width: 0.2 };
    expect(tailLayout(size, 0, inside)).toBeNull();
    expectRect(pathBounds(bubblePath(size, 0, inside)), { x: 0, y: 0, width: 200, height: 100 });
  });

  it('keep the base on the straight part of its side', () => {
    const layout = tailLayout({ width: 200, height: 100 }, 30, { tip: P(-0.6, 3), width: 0.9 });
    expect(layout?.side).toBe('bottom');
    expect(layout?.width).toBeCloseTo(200 - 60, 9);
    expect(layout!.center - layout!.width / 2).toBeCloseTo(30, 9);
  });

  it('follow their handles', () => {
    const tail = { tip: P(0.2, 1.5), width: 0.2 };
    const item = bubble({ x: 100, y: 100, width: 200, height: 100 }, { tail });
    const tip = draggedTail(item, 'tip', P(500, 40));
    expectPoint(tip!.tip, P(2, -0.6));
    expect(tip!.width).toBe(0.2);

    const layout = tailLayout({ width: 200, height: 100 }, 0, tail)!;
    const center = 100 + layout.center;
    expect(draggedTail(item, 'width', P(center + 30, 250))!.width).toBeCloseTo(0.3, 9);
    expect(draggedTail(item, 'width', P(center, 200))!.width).toBe(MINIMUM_TAIL_WIDTH);
    expect(draggedTail(item, 'width', P(center + 900, 200))!.width).toBeCloseTo((200 - 2 * layout.radius) / 200, 9);
    // With the tip inside the body there is no base to widen.
    const inside = { tip: P(0.5, 0.5), width: 0.2 };
    expect(draggedTail(bubble({ x: 0, y: 0, width: 200, height: 100 }, { tail: inside }), 'width', P(0, 0))).toEqual(
      inside,
    );
    expect(bubbleTailHandles(bubble({ x: 0, y: 0, width: 200, height: 100 }, { tail: inside }))?.width).toBeNull();
  });

  it('keep the width handle under the pointer when a corner stops the base', () => {
    // Tip far to the left: the base's middle is stopped by the bottom-left corner (radius 22).
    const size = { width: 200, height: 100 };
    const item = bubble({ x: 0, y: 0, width: 200, height: 100 }, { tail: { tip: P(-0.6, 3), width: 0.4 } });
    expect(tailLayout(size, 0, { tip: P(-0.6, 3), width: 0.4 })!.center).toBeCloseTo(22 + 40, 9);
    for (const along of [130, 102, 80, 60]) {
      const tail = draggedTail(item, 'width', P(along, 100))!;
      expect(widthHandlePoint(tailLayout(size, 0, tail)!).x).toBeCloseTo(along, 9);
    }
    // The near end, when the tip is past the far corner.
    const right = bubble({ x: 0, y: 0, width: 200, height: 100 }, { tail: { tip: P(1.6, 3), width: 0.4 } });
    for (const along of [70, 98, 120, 140]) {
      const tail = draggedTail(right, 'width', P(along, 100))!;
      expect(widthHandlePoint(tailLayout(size, 0, tail)!).x).toBeCloseTo(along, 9);
    }
  });

  it('mirror with a negative size', () => {
    const tail = { tip: P(0.2, 1.5), width: 0.2 };
    const flipped = pathBounds(bubblePath({ width: -200, height: 100 }, 0, tail));
    const plain = pathBounds(bubblePath({ width: 200, height: 100 }, 0, tail));
    expectRect(flipped, { x: -plain.x - plain.width, y: plain.y, width: plain.width, height: plain.height });
  });

  it('are written only when set, and read back', () => {
    const plain = boardWith([bubble({ x: 0, y: 0, width: 100, height: 80 })]);
    expect(serializeDocument(plain)).not.toContain('tail');
    const tailed = boardWith([
      bubble({ x: 10, y: 20, width: 200, height: 100 }, { rotation: 0.3, tail: { tip: P(1.4, -0.25), width: 0.35 } }),
    ]);
    const json = serializeDocument(tailed);
    expect(json).toContain('"tail"');
    expect(parseDocument(json)).toEqual(tailed);
  });

  it('reach past the box for hits, erasing and bounds', () => {
    const style = itemStyle({ strokeColor: null, fillColor: '#FFFFFFFF' });
    const filled = createShapeItem('speechBubble', { x: 100, y: 100, width: 200, height: 100 }, style, {
      tail: { tip: P(0.5, 2.5), width: 0.3 },
    });
    const document = boardWith([filled]);
    expect(itemAt(P(200, 300), document, 1)?.id).toBe(filled.id);
    expect(itemAt(P(120, 300), document, 1)).toBeNull();
    expect(visualBounds(filled, document).y + visualBounds(filled, document).height).toBeCloseTo(350, 9);
    expect(inkBounds(filled, document).y + inkBounds(filled, document).height).toBeCloseTo(350, 9);
    expect(erasableItems(P(195, 330), P(205, 330), 4, document)).toEqual([filled.id]);
    expectRect(shapeFrameSpaceBounds(filled.content), { x: 100, y: 100, width: 200, height: 250 });
  });
});

describe('the tail handles', () => {
  it('come first, on the tail as drawn', () => {
    const item = bubble({ x: 300, y: 200, width: 300, height: 200 });
    const editor = makeBoard([item]);
    editor.store.select([item.id]);
    const overlay = editor.overlay!;
    expect(overlay.handles.slice(0, 2).map((handle) => handle.kind)).toEqual([
      { kind: 'bubbleTail', part: 'tip' },
      { kind: 'bubbleTail', part: 'width' },
    ]);
    // Their dots are drawn last, over the resize handles.
    expect(overlay.dots.slice(-2).map((dot) => dot.style)).toEqual(['adjust', 'adjust']);
    const handles = bubbleTailHandles(item)!;
    expectPoint(handles.tip, P(300 + 0.16 * 300, 400));
    expectPoint(handles.width!, P(300 + 0.42 * 300, 200 + 0.78 * 200));
    expect(handleAt(overlay, handles.tip)).toEqual({ kind: 'bubbleTail', part: 'tip' });
  });

  it('widen the selection bounds and skip the width handle on small bubbles', () => {
    const item = bubble({ x: 300, y: 300, width: 30, height: 30 }, { tail: { tip: P(0.5, -3), width: 0.2 } });
    const editor = makeBoard([item]);
    editor.store.select([item.id]);
    const overlay = editor.overlay!;
    expect(overlay.handles.filter((handle) => handle.kind.kind === 'bubbleTail')).toHaveLength(1);
    expect(overlay.bounds!.y).toBeCloseTo(300 - 90, 9);
  });

  it('are not offered on locked bubbles or other shapes', () => {
    const locked = { ...bubble({ x: 100, y: 100, width: 200, height: 100 }), isLocked: true };
    const rect = createShapeItem('rectangle', { x: 400, y: 100, width: 200, height: 100 }, itemStyle());
    const editor = makeBoard([locked, rect]);
    editor.store.select([locked.id]);
    expect(editor.overlay!.handles).toEqual([]);
    editor.store.select([rect.id]);
    expect(editor.overlay!.handles.some((handle) => handle.kind.kind === 'bubbleTail')).toBe(false);
  });

  it('adjust a bubble in one undo step', () => {
    const item = bubble({ x: 300, y: 200, width: 300, height: 200 });
    const editor = makeBoard([item]);
    const debug = createDebugDriver(editor);
    debug.perform({ type: 'dragBubbleTail', itemIndex: 0, part: 'tip', by: P(400, -300) });

    const adjusted = shapeOf(findItem(editor.store.document, item.id));
    expectRect(adjusted.content.box.frame, { x: 300, y: 200, width: 300, height: 156 });
    // The tip was at (348, 400); it is now at (748, 100).
    expectPoint(adjusted.content.tail!.tip, P(448 / 300, -100 / 156));
    expect(editor.store.undoActionName).toBe('adjustTail');

    // The tail now leaves the top side, and its width handle is the base's left end. Dragged 30 further left, the
    // handle stays under the pointer although the corner stops the base's middle.
    const widthHandle = bubbleTailHandles(adjusted)!.width!;
    debug.perform({ type: 'dragBubbleTail', itemIndex: 0, part: 'width', by: P(-30, 0) });
    const widened = shapeOf(findItem(editor.store.document, item.id));
    expect(widened.content.tail!.width).toBeGreaterThan(0.16);
    expectPoint(bubbleTailHandles(widened)!.width!, P(widthHandle.x - 30, widthHandle.y));

    editor.store.undo();
    editor.store.undo();
    expect(findItem(editor.store.document, item.id)).toEqual(item);
  });

  it('keep the arrows attached to a bubble in place', () => {
    const item = bubble({ x: 300, y: 200, width: 300, height: 200 });
    const line = createLineItem(P(100, 100), P(700, 500), itemStyle());
    // One end in the tail's strip of the box (below the body), one on the body's right edge.
    const arrow = {
      ...line,
      content: {
        ...line.content,
        start: { point: P(450, 380), binding: { itemID: item.id, anchor: P(0.5, 0.9) } },
        end: { point: P(600, 300), binding: { itemID: item.id, anchor: P(1, 0.5) } },
      },
    };
    const editor = makeBoard([item, arrow]);
    const before = resolvedPoints(arrow.content, editor.store.document);
    createDebugDriver(editor).perform({ type: 'dragBubbleTail', itemIndex: 0, part: 'tip', by: P(0, 150) });
    expect(shapeOf(findItem(editor.store.document, item.id)).content.tail).not.toBeNull();
    const moved = findItem(editor.store.document, arrow.id);
    if (moved?.type !== 'line') throw new Error('not a line');
    resolvedPoints(moved.content, editor.store.document).forEach((point, index) => expectPoint(point, before[index]!));
    editor.store.undo();
    expect(findItem(editor.store.document, arrow.id)).toEqual(arrow);
    // Other items are left alone.
    expect(documentWithTail(boardWith([arrow]), arrow.id)).toBeNull();
  });

  it('keep the large corners of the original drawing', () => {
    const item = bubble({ x: 100, y: 100, width: 200, height: 300 }, { cornerRadius: 120 });
    const adjusted = bubbleWithTail(item)!;
    expect(adjusted.style.cornerRadius).toBeCloseTo(52, 9);
  });

  it('leave locked bubbles, taps and cancelled drags alone', () => {
    const locked = { ...bubble({ x: 100, y: 100, width: 200, height: 100 }), isLocked: true };
    const plain = bubble({ x: 400, y: 100, width: 200, height: 100 });
    const editor = makeBoard([locked, plain]);
    const debug = createDebugDriver(editor);
    debug.perform({ type: 'dragBubbleTail', itemIndex: 0, part: 'tip', by: P(50, 50) });
    debug.perform({ type: 'dragBubbleTail', itemIndex: 1, part: 'tip', by: P(0, 0) });
    debug.perform({ type: 'dragBubbleTail', itemIndex: 9, part: 'width', by: P(10, 10) });
    expect(editor.store.canUndo).toBe(false);

    const tip = bubbleTailHandles(plain)!.tip;
    const interaction = new BubbleTailInteraction(editor, plain.id, 'tip');
    interaction.begin(tip);
    interaction.move(P(tip.x + 40, tip.y + 40));
    expect(editor.store.preview).not.toBeNull();
    interaction.cancel();
    expect(editor.store.preview).toBeNull();
    expect(editor.store.canUndo).toBe(false);

    // No width handle when the tip is inside the body.
    const inside = bubble({ x: 100, y: 300, width: 200, height: 100 }, { tail: { tip: P(0.5, 0.5), width: 0.2 } });
    const other = makeBoard([inside]);
    createDebugDriver(other).perform({ type: 'dragBubbleTail', itemIndex: 0, part: 'width', by: P(10, 0) });
    const interaction2 = new BubbleTailInteraction(other, inside.id, 'width');
    interaction2.begin(P(0, 0));
    interaction2.move(P(50, 50));
    interaction2.end(P(50, 50));
    expect(other.store.canUndo).toBe(false);
  });

  it('follow a touch or the mouse', () => {
    for (const pointerType of ['touch', 'mouse'] as const) {
      const item = bubble({ x: 200, y: 100, width: 300, height: 200 });
      const editor = makeBoard([item]);
      editor.store.select([item.id]);
      const tip = bubbleTailHandles(item)!.tip;
      const input = (point: Point, time: number): PointerInput => ({
        id: 1,
        x: point.x,
        y: point.y,
        pointerType,
        timeStamp: time,
      });
      editor.pointerDown(input(tip, 1000));
      for (let step = 1; step <= 4; step += 1)
        editor.pointerMove(input(P(tip.x + 25 * step, tip.y + 25 * step), 1000 + step * 16));
      editor.pointerUp(input(P(tip.x + 100, tip.y + 100), 1100));
      const adjusted = shapeOf(findItem(editor.store.document, item.id));
      expect(adjusted.content.box.frame.x).toBe(200);
      const tipNow = applyAffine(boxToWorld(adjusted.content.box), {
        x: adjusted.content.tail!.tip.x * 300,
        y: adjusted.content.tail!.tip.y * adjusted.content.box.frame.height,
      });
      expectPoint(tipNow, P(tip.x + 100, tip.y + 100));
      expect(editor.store.undoActionName).toBe('adjustTail');
    }
  });
});
