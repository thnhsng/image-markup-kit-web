import { describe, expect, it } from 'vitest';
import { EditorController } from '../../src/editor/controller';
import { createDebugDriver } from '../../src/editor/debug';
import {
  ArrowCreateInteraction,
  EraserInteraction,
  LineInsertInteraction,
  LineVertexInteraction,
  makeToolInteraction,
  MoveInteraction,
  PenInteraction,
  PolylineCreateInteraction,
  PolylineDraft,
  ResizeInteraction,
  RotateInteraction,
  ShapeCreateInteraction,
  TextCreateInteraction,
  type CanvasInteraction,
} from '../../src/editor/interactions';
import { EditorStore } from '../../src/editor/store';
import { SHAPE_TOOLS, type MarkupTool } from '../../src/editor/tools';
import { worldPoint } from '../../src/geometry/box';
import { insertionPoints } from '../../src/geometry/line-path';
import { maxY, minY } from '../../src/geometry/rect';
import {
  DEFAULT_FONT,
  MarkupColors,
  STANDARD_STYLE_DEFAULTS,
  createApproximateTextMeasurer,
  createBoardDocument,
  createCurveItem,
  createImageItem,
  createLineItem,
  createPolylineItem,
  createShapeItem,
  createTextItem,
  findItem,
  itemBox,
  itemStyle,
  type LineContent,
  type MarkupItem,
  type Point,
} from '../../src';
import { boardWith } from './helpers';

const measurer = createApproximateTextMeasurer();
const P = (x: number, y: number): Point => ({ x, y });

/** A board editor at zoom 1, the environment of the interactions. */
function makeBoard(items: readonly MarkupItem[] = []): EditorController {
  const editor = new EditorController(boardWith(items), { measurer });
  editor.setViewportSize(800, 600);
  editor.viewport.zoom = 1;
  editor.viewport.offsetX = 0;
  editor.viewport.offsetY = 0;
  return editor;
}

function run(interaction: CanvasInteraction, points: readonly Point[]): void {
  interaction.begin(points[0]!);
  for (const point of points.slice(1)) interaction.move(point, [point], []);
  interaction.end(points[points.length - 1]!);
}

function lineOf(item: MarkupItem | null | undefined): LineContent {
  if (item?.type !== 'line') throw new Error('not a line');
  return item.content;
}

const linePoints = (line: LineContent) => [line.start.point, ...line.waypoints, line.end.point];
const rectItem = () => createShapeItem('rectangle', { x: 100, y: 100, width: 100, height: 80 }, itemStyle());

describe('interactions', () => {
  it('leave locked items alone', () => {
    const locked = { ...rectItem(), isLocked: true };
    const line = { ...createPolylineItem([P(300, 100), P(350, 150), P(400, 100)], itemStyle()), isLocked: true };
    const editor = makeBoard([locked, line]);
    const interactions = [
      new MoveInteraction(editor, locked.id),
      new ResizeInteraction(editor, locked.id, 1, 1),
      new RotateInteraction(editor, locked.id),
      new LineVertexInteraction(editor, line.id, 1),
      new LineInsertInteraction(editor, line.id, 0),
    ];
    for (const interaction of interactions) run(interaction, [P(150, 140), P(200, 200), P(250, 250)]);
    expect(editor.store.canUndo).toBe(false);
    expect(editor.store.preview).toBeNull();
  });

  it('leave nothing behind when cancelled', () => {
    const rect = rectItem();
    const line = createLineItem(P(300, 100), P(400, 100), itemStyle());
    const curve = createCurveItem([P(100, 300), P(300, 300), P(500, 300)], itemStyle());
    const editor = makeBoard([rect, line, curve]);
    const makers: (() => CanvasInteraction)[] = [
      () => new MoveInteraction(editor, rect.id),
      () => new ResizeInteraction(editor, rect.id, 1, 1),
      () => new RotateInteraction(editor, rect.id),
      () => new LineVertexInteraction(editor, line.id, 1),
      () => new LineInsertInteraction(editor, curve.id, 0),
      () => new PenInteraction(editor, true),
      () => new ShapeCreateInteraction(editor, 'star', false),
      () => new ArrowCreateInteraction(editor),
      () => new PolylineCreateInteraction(editor),
      () => new TextCreateInteraction(editor, false),
      () => new EraserInteraction(editor),
    ];
    for (const make of makers) {
      const interaction = make();
      interaction.begin(P(150, 140));
      interaction.move(P(450, 120), [P(300, 100), P(450, 120)], []);
      interaction.cancel();
      expect(editor.store.preview).toBeNull();
      expect(editor.penPreview).toBeNull();
      expect(editor.eraserCursor).toBeNull();
      expect(editor.hiddenItemIDs).toEqual([]);
      expect(editor.bindTargetID).toBeNull();
    }
    expect(editor.store.canUndo).toBe(false);
  });

  it('make the interaction of every drawing tool', () => {
    const editor = makeBoard();
    const tools: MarkupTool[] = ['pen', 'highlighter', 'arrow', 'polyline', 'curve', 'text', 'note', 'eraser'];
    const kinds = [...tools, ...SHAPE_TOOLS].map((tool) => makeToolInteraction(tool, editor)?.constructor.name);
    expect(kinds.slice(0, tools.length)).toEqual([
      'PenInteraction',
      'PenInteraction',
      'ArrowCreateInteraction',
      'PolylineCreateInteraction',
      'ArrowCreateInteraction',
      'TextCreateInteraction',
      'TextCreateInteraction',
      'EraserInteraction',
    ]);
    expect(kinds.slice(tools.length).every((name) => name === 'ShapeCreateInteraction')).toBe(true);
    expect(makeToolInteraction('select', editor)).toBeNull();
  });
});

describe('resizing', () => {
  it('keeps the top of text and measures its new height', () => {
    const text = createTextItem('A few words to wrap', P(100, 100), {
      font: DEFAULT_FONT,
      color: MarkupColors.red,
      measurer,
    });
    const editor = makeBoard([text]);
    const frame = text.content.box.frame;
    const right = P(frame.x + frame.width, frame.y + frame.height / 2);
    run(new ResizeInteraction(editor, text.id, 1, 0.5), [right, P(right.x - frame.width / 2, right.y)]);
    const resized = findItem(editor.store.document, text.id);
    if (resized?.type !== 'text') throw new Error('not text');
    expect(resized.content.fixedWidth).not.toBeNull();
    expect(minY(resized.content.box.frame)).toBeCloseTo(minY(frame), 9);
    expect(maxY(resized.content.box.frame)).toBeGreaterThan(maxY(frame));
    expect(editor.store.undoActionName).toBe('resize');
  });

  it('commits nothing for a press without a drag', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    run(new ResizeInteraction(editor, rect.id, 1, 1), [P(200, 180)]);
    run(new RotateInteraction(editor, rect.id), [P(150, 72)]);
    expect(editor.store.canUndo).toBe(false);
  });
});

describe('line points', () => {
  it('attach a dragged end to the item it is released over', () => {
    const target = createShapeItem(
      'rectangle',
      { x: 500, y: 50, width: 100, height: 100 },
      itemStyle({ fillColor: MarkupColors.yellow }),
    );
    const line = createLineItem(P(300, 100), P(400, 100), itemStyle());
    const editor = makeBoard([target, line]);
    const interaction: CanvasInteraction = new LineVertexInteraction(editor, line.id, 1);
    interaction.begin(P(400, 100));
    interaction.move(P(550, 100), [P(550, 100)], []);
    expect(editor.bindTargetID).toBe(target.id);
    interaction.end(P(550, 100));
    expect(editor.bindTargetID).toBeNull();
    const content = lineOf(findItem(editor.store.document, line.id));
    expect(content.end.binding?.itemID).toBe(target.id);
    expect(editor.store.undoActionName).toBe('moveEndpoint');
  });

  it('never attach the ends of closed lines', () => {
    const target = createShapeItem(
      'rectangle',
      { x: 500, y: 50, width: 100, height: 100 },
      itemStyle({ fillColor: MarkupColors.yellow }),
    );
    const polygon = createPolylineItem([P(300, 100), P(400, 100), P(350, 200)], itemStyle(), { closed: true });
    const editor = makeBoard([target, polygon]);
    run(new LineVertexInteraction(editor, polygon.id, 0), [P(300, 100), P(425, 100), P(550, 100)]);
    const content = lineOf(findItem(editor.store.document, polygon.id));
    expect(content.start).toEqual({ point: P(550, 100), binding: null });
    expect(editor.store.undoActionName).toBe('moveEndpoint');
  });

  it('treat a nearly still press as a tap', () => {
    const polyline = createPolylineItem([P(100, 100), P(200, 200), P(300, 100)], itemStyle());
    const editor = makeBoard([polyline]);
    const interaction = new LineVertexInteraction(editor, polyline.id, 2);
    let taps = 0;
    interaction.onTap = () => (taps += 1);
    run(interaction, [P(300, 100), P(302, 101)]);
    expect(taps).toBe(1);
    expect(editor.store.canUndo).toBe(false);
    // A point that does not exist.
    run(new LineVertexInteraction(editor, polyline.id, 7), [P(300, 100), P(400, 100)]);
    expect(editor.store.canUndo).toBe(false);
  });

  it('insert a point on the closing segment', () => {
    const points = [P(100, 100), P(300, 100), P(200, 300)];
    const polygon = createPolylineItem(points, itemStyle(), { closed: true });
    const editor = makeBoard([polygon]);
    const handles = insertionPoints(points, 'polyline', true);
    expect(handles).toHaveLength(3);
    run(new LineInsertInteraction(editor, polygon.id, 2), [handles[2]!, P(100, 250)]);
    const content = lineOf(findItem(editor.store.document, polygon.id));
    expect(linePoints(content)).toEqual([...points, P(100, 250)]);
    expect(content.isClosed).toBe(true);
  });

  it('insert nothing on straight lines or missing segments', () => {
    const line = createLineItem(P(300, 100), P(400, 100), itemStyle());
    const curve = createCurveItem([P(100, 300), P(300, 300)], itemStyle());
    const editor = makeBoard([line, curve]);
    run(new LineInsertInteraction(editor, line.id, 0), [P(350, 100), P(350, 200)]);
    run(new LineInsertInteraction(editor, curve.id, 4), [P(200, 300), P(200, 400)]);
    expect(editor.store.canUndo).toBe(false);
  });
});

describe('drawing', () => {
  it('draws strokes through the samples and the release point', () => {
    const editor = makeBoard();
    const pen = new PenInteraction(editor, false);
    pen.begin(P(0, 0));
    pen.move(P(40, 0), [P(0.5, 0), P(20, 0), P(40, 0)], [P(60, 0)]);
    expect(editor.penPreview?.points).toEqual([P(0, 0), P(20, 0), P(40, 0), P(60, 0)]);
    pen.end(P(80, 0));
    const stroke = editor.store.document.items[0];
    if (stroke?.type !== 'stroke') throw new Error('not a stroke');
    // Stroke points are stored normalized to the stroke's box.
    const last = stroke.content.points[stroke.content.points.length - 1]!;
    const world = worldPoint(stroke.content.box, last);
    expect(world.x).toBeCloseTo(80, 9);
    expect(world.y).toBeCloseTo(0, 9);
    expect(editor.store.undoActionName).toBe('draw');

    run(new PenInteraction(editor, true), [P(0, 100), P(50, 120), P(100, 100)]);
    const highlight = editor.store.document.items[1];
    expect(highlight?.type === 'stroke' && highlight.content.isHighlighter).toBe(true);
    expect(highlight?.style).toEqual(STANDARD_STYLE_DEFAULTS.highlighter);
    expect(editor.store.undoActionName).toBe('highlight');
  });

  it('inserts default-size shapes with a tap', () => {
    const editor = makeBoard();
    const tap: CanvasInteraction = new ShapeCreateInteraction(editor, 'rectangle', false);
    tap.begin(P(300, 300));
    tap.move(P(302, 301), [P(302, 301)], []);
    expect(editor.store.preview).toBeNull();
    tap.end(P(302, 301));
    expect(itemBox(editor.store.document.items[0]!)?.frame).toEqual({ x: 220, y: 240, width: 160, height: 120 });
    run(new ShapeCreateInteraction(editor, 'ellipse', true), [P(500, 500)]);
    expect(itemBox(editor.store.document.items[1]!)?.frame).toEqual({ x: 430, y: 430, width: 140, height: 140 });
    run(new ShapeCreateInteraction(editor, 'highlightBox', false), [P(100, 100), P(200, 150)]);
    expect(editor.store.document.items[2]?.style).toEqual(STANDARD_STYLE_DEFAULTS.highlightBox);
    expect(editor.store.undoActionName).toBe('addShape');
  });

  it('draws arrows between items and drops very short ones', () => {
    const a = createShapeItem('rectangle', { x: 0, y: 0, width: 100, height: 100 }, itemStyle());
    const b = createShapeItem('rectangle', { x: 400, y: 0, width: 100, height: 100 }, itemStyle());
    const editor = makeBoard([a, b]);
    run(new ArrowCreateInteraction(editor), [P(300, 300), P(303, 302)]);
    expect(editor.store.canUndo).toBe(false);
    expect(editor.store.preview).toBeNull();

    editor.store.tool = 'arrow';
    run(new ArrowCreateInteraction(editor), [P(50, 50), P(250, 50), P(450, 50)]);
    const arrow = lineOf(editor.store.document.items[2]);
    expect(arrow.start.binding?.itemID).toBe(a.id);
    expect(arrow.end.binding?.itemID).toBe(b.id);
    expect(arrow.endHead).toBe(STANDARD_STYLE_DEFAULTS.lineEndHead);
    expect(editor.store.undoActionName).toBe('addArrow');
    expect(editor.store.tool).toBe('select');
  });

  it('starts a polyline with a drag, or with two taps', () => {
    const editor = makeBoard();
    editor.store.tool = 'polyline';
    run(new PolylineCreateInteraction(editor), [P(100, 100), P(200, 100), P(300, 100)]);
    expect(linePoints(lineOf(editor.store.document.items[0]))).toEqual([P(100, 100), P(300, 100)]);
    expect(editor.store.undoActionName).toBe('addPolyline');
    editor.finishPolyline();

    editor.store.tool = 'polyline';
    run(new PolylineCreateInteraction(editor), [P(100, 300)]);
    expect(editor.polylineDraft.pendingStart?.point).toEqual(P(100, 300));
    // Tapping the only point again takes it back.
    run(new PolylineCreateInteraction(editor), [P(105, 300)]);
    expect(editor.polylineDraft.isActive).toBe(false);

    run(new PolylineCreateInteraction(editor), [P(100, 300)]);
    // While the pointer is down, a segment follows it from the first point (but not on top of it).
    const next: CanvasInteraction = new PolylineCreateInteraction(editor);
    next.begin(P(300, 300));
    expect(lineOf(editor.store.preview?.items[1])).toMatchObject({ start: { point: P(100, 300) } });
    next.move(P(100.5, 300), [P(100.5, 300)], []);
    expect(editor.store.preview).toBeNull();
    next.end(P(300, 300));
    expect(linePoints(lineOf(editor.store.document.items[1]))).toEqual([P(100, 300), P(300, 300)]);
    expect(editor.polylineDraft.itemID).toBe(editor.store.document.items[1]?.id);
  });

  it('erases neither photos nor locked items', () => {
    const photo = createImageItem(
      { assetID: 'a', pixelSize: { width: 400, height: 300 } },
      { x: 0, y: 0, width: 400, height: 300 },
    );
    const locked = { ...rectItem(), isLocked: true };
    const editor = makeBoard([photo, locked]);
    run(new EraserInteraction(editor), [P(0, 140), P(400, 140)]);
    expect(editor.store.document.items).toHaveLength(2);
    expect(editor.store.canUndo).toBe(false);
  });

  it('creates text where the pointer went down', () => {
    const editor = makeBoard();
    const text: CanvasInteraction = new TextCreateInteraction(editor, true);
    text.begin(P(300, 300));
    text.move(P(500, 500), [P(500, 500)], []);
    text.end(P(500, 500));
    const content = editor.editingContent!;
    expect(content.fixedWidth).toBe(280);
    expect(content.padding).toBe(16);
    expect(content.box.frame.x).toBe(300 - 16);
  });
});

describe('PolylineDraft', () => {
  it('tracks the polyline being drawn', () => {
    const draft = new PolylineDraft();
    draft.setPendingStart(P(1, 2), itemStyle());
    expect(draft.isActive).toBe(true);
    draft.clearPendingStart();
    draft.clearPendingStart();
    expect(draft.isActive).toBe(false);
    draft.reset();
    const polyline = createPolylineItem([P(0, 0), P(10, 0)], itemStyle());
    draft.begin(polyline.id);
    draft.validate(boardWith([polyline]));
    expect(draft.itemID).toBe(polyline.id);
    draft.validate(boardWith([{ ...polyline, content: { ...polyline.content, isClosed: true } }]));
    expect(draft.itemID).toBeNull();
    draft.validate(boardWith([]));
  });
});

describe('store edge cases', () => {
  it('names no action and does nothing without undo history', () => {
    const store = new EditorStore(createBoardDocument(), { measurer });
    expect(store.undoActionName).toBeNull();
    expect(store.redoActionName).toBeNull();
    const version = store.version;
    store.undo();
    store.redo();
    expect(store.version).toBe(version);
  });

  it('lists only selected items that are displayed', () => {
    const rect = rectItem();
    const store = new EditorStore(boardWith([rect]), { measurer });
    store.select([rect.id]);
    store.setPreview(boardWith([]));
    expect(store.selectedItems).toEqual([]);
    expect(store.selectedItem).toBeNull();
  });

  it('keeps the document order of photos at the same place when arranging', () => {
    const source = { assetID: 'a', pixelSize: { width: 400, height: 300 } };
    const first = createImageItem(source, { x: 0, y: 0, width: 400, height: 300 });
    const second = createImageItem(source, { x: 0, y: 0, width: 400, height: 300 });
    const store = new EditorStore({ ...createBoardDocument(), items: [first, second] }, { measurer });
    store.arrange('row');
    const [a, b] = store.document.items.map((item) => itemBox(item)!.frame.x);
    expect(a).toBeLessThan(b!);
    expect(store.document.items[0]?.id).toBe(first.id);
  });

  it('adopts no defaults when several items are styled', () => {
    const a = rectItem();
    const b = createTextItem('B', P(0, 0), { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
    const c = createTextItem('C', P(0, 100), { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
    const store = new EditorStore(boardWith([a, b, c]), { measurer });
    store.select([a.id, b.id]);
    store.updateStyle((style) => ({ ...style, lineWidth: 17 }));
    expect(store.defaults.shape.lineWidth).not.toBe(17);
    store.select([b.id, c.id]);
    store.updateText((content) => ({ ...content, color: MarkupColors.blue }));
    expect(store.defaults.textColor).not.toBe(MarkupColors.blue);
  });

  it('sets the defaults of straight lines and strokes', () => {
    const line = createLineItem(P(0, 0), P(100, 0), itemStyle());
    const editor = makeBoard([line]);
    run(new PenInteraction(editor, false), [P(0, 100), P(50, 120)]);
    run(new PenInteraction(editor, true), [P(0, 200), P(50, 220)]);
    const store = editor.store;
    store.select([line.id]);
    store.updateArrowHeads('arrow', 'none');
    expect([store.defaults.lineStartHead, store.defaults.lineEndHead]).toEqual(['arrow', 'none']);
    store.select([store.document.items[1]!.id]);
    store.updateStyle((style) => ({ ...style, lineWidth: 21 }));
    expect(store.defaults.pen.lineWidth).toBe(21);
    store.select([store.document.items[2]!.id]);
    store.updateStyle((style) => ({ ...style, lineWidth: 31 }));
    expect(store.defaults.highlighter.lineWidth).toBe(31);
  });
});

describe('controller edge cases', () => {
  it('ignores finishing a polyline that is not being drawn', () => {
    const editor = makeBoard();
    editor.finishPolyline();
    editor.performAction('finishPath');
    expect(editor.store.tool).toBe('select');
    expect(editor.store.canUndo).toBe(false);
  });

  it('forgets a marked point beyond the line', () => {
    const polyline = createPolylineItem([P(0, 0), P(50, 50), P(100, 0)], itemStyle());
    const editor = makeBoard([polyline]);
    editor.store.select([polyline.id]);
    editor.activeLineVertex = { itemID: polyline.id, index: 5 };
    expect(editor.activeVertexOf(polyline)).toBeNull();
    expect(editor.activeVertexOf(rectItem())).toBeNull();
  });

  it('pinches with two of three fingers and keeps pinching when one lifts', () => {
    const editor = makeBoard();
    const at = (id: number, x: number, y: number, timeStamp = 0) => ({ id, x, y, pointerType: 'touch', timeStamp });
    editor.selectTool('pen');
    editor.pointerDown(at(1, 100, 100));
    editor.pointerDown(at(2, 300, 100, 10));
    editor.pointerDown(at(3, 500, 100, 20));
    editor.pointerUp(at(1, 100, 100));
    // Fingers 2 and 3 pinch now: spreading them from 200 to 400 doubles the zoom.
    const zoom = editor.viewport.zoom;
    editor.pointerMove(at(3, 700, 100));
    expect(editor.viewport.zoom).toBeCloseTo(zoom * 2, 9);
    editor.pointerCancel(at(3, 700, 100));
    editor.pointerMove(at(2, 400, 400));
    editor.pointerUp(at(2, 400, 400));
    expect(editor.store.canUndo).toBe(false);
    // Two fingers on the same spot only pan.
    editor.pointerDown(at(4, 100, 100, 1000));
    editor.pointerDown(at(5, 100, 100, 1010));
    editor.pointerMove(at(5, 120, 100));
    expect(editor.store.document.items).toHaveLength(0);
  });

  it('counts a release far from the press as a drag', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    editor.store.select([rect.id]);
    editor.pointerDown({ id: 1, x: 150, y: 140, pointerType: 'mouse', timeStamp: 0 });
    editor.pointerUp({ id: 1, x: 300, y: 300, pointerType: 'mouse', timeStamp: 50 });
    // No move events: nothing moved, and it was no tap.
    expect(editor.store.canUndo).toBe(false);
    editor.pointerDown({ id: 1, x: 150, y: 140, pointerType: 'mouse', timeStamp: 100 });
    editor.pointerUp({ id: 1, x: 150, y: 140, pointerType: 'mouse', timeStamp: 150 });
    expect(editor.store.selection).toEqual([rect.id]);
  });

  it('ignores moves of a pointer that ended a text edit outside Select', () => {
    const editor = makeBoard();
    editor.selectTool('text');
    editor.pointerDown({ id: 1, x: 300, y: 300, pointerType: 'touch', timeStamp: 0 });
    editor.pointerUp({ id: 1, x: 300, y: 300, pointerType: 'touch', timeStamp: 50 });
    expect(editor.isEditingText()).toBe(true);
    editor.pointerDown({ id: 1, x: 600, y: 500, pointerType: 'touch', timeStamp: 1000 });
    editor.pointerMove({ id: 1, x: 650, y: 550, pointerType: 'touch', timeStamp: 1016 });
    editor.pointerUp({ id: 1, x: 650, y: 550, pointerType: 'touch', timeStamp: 1032 });
    expect([editor.viewport.offsetX, editor.viewport.offsetY]).toEqual([0, 0]);
    expect(editor.store.displayed.items).toHaveLength(0);
  });

  it('adds photos to a board and shows them', () => {
    const editor = new EditorController(createBoardDocument(), { measurer });
    editor.setViewportSize(800, 600);
    editor.addImages([{ assetID: 'a', pixelSize: { width: 400, height: 300 } }]);
    expect(editor.store.undoActionName).toBe('addImages');
    const photo = editor.store.document.items[0]!;
    const screen = editor.viewport.canvasToScreen(itemBox(photo)!.frame);
    expect(screen.x).toBeGreaterThan(0);
    expect(screen.x).toBeLessThan(800);
  });

  it('keeps the bind target until it changes', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    editor.setBindTarget(rect);
    const version = editor.version;
    editor.setBindTarget(rect);
    expect(editor.version).toBe(version);
  });
});

describe('debug driver edge cases', () => {
  it('ignores gestures it cannot run', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const debug = createDebugDriver(editor);
    debug.perform({ type: 'resize', itemIndex: 9, u: 1, v: 1, by: P(1, 1) });
    debug.perform({ type: 'rotate', itemIndex: 9, degrees: 10 });
    debug.perform({ type: 'draw', tool: 'select', points: [P(0, 0), P(10, 10)] });
    debug.perform({ type: 'insertLineVertex', itemIndex: 0, segment: 0, by: P(1, 1) });
    debug.perform({ type: 'dragLineVertex', itemIndex: 0, vertex: 0, by: P(1, 1) });
    expect(editor.store.canUndo).toBe(false);
  });
});
