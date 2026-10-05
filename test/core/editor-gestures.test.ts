import { describe, expect, it } from 'vitest';
import { EditorController } from '../../src/editor/controller';
import { createDebugDriver } from '../../src/editor/debug';
import { keyCommand } from '../../src/editor/keyboard';
import { handleAt, INSERT_TOUCH_RADIUS } from '../../src/editor/overlay';
import { boxCenter } from '../../src/geometry/box';
import { add } from '../../src/geometry/vec';
import {
  DEFAULT_FONT,
  MarkupColors,
  MarkupFeatures,
  createApproximateTextMeasurer,
  createBoardDocument,
  createImageDocument,
  createLineItem,
  createPolylineItem,
  createShapeItem,
  createTextItem,
  findItem,
  itemBox,
  itemStyle,
  type LineContent,
  type MarkupDocument,
  type MarkupItem,
} from '../../src';
import { degrees, expectPoint } from './helpers';

const measurer = createApproximateTextMeasurer();
const P = (x: number, y: number) => ({ x, y });
const adding =
  (...items: MarkupItem[]) =>
  (document: MarkupDocument): MarkupDocument => ({ ...document, items: [...document.items, ...items] });

/** The editor of the Swift gesture tests: one 1024×768 photo in a 1024×850 canvas. */
function makeEditor(features: MarkupFeatures = MarkupFeatures.all): EditorController {
  const document = createImageDocument({ assetID: 'photo', pixelSize: { width: 1024, height: 768 } });
  const editor = new EditorController(document, { features, measurer });
  editor.setViewportSize(1024, 850);
  return editor;
}

function lineOf(item: MarkupItem | null | undefined): LineContent {
  if (item?.type !== 'line') throw new Error('not a line');
  return item.content;
}

const linePoints = (line: LineContent) => [line.start.point, ...line.waypoints, line.end.point];
const lastItem = (editor: EditorController) => editor.store.document.items[editor.store.document.items.length - 1];

// Port of the gesture tests of LinePathTests.
describe('line gestures', () => {
  it('adds one undo step per polyline point', () => {
    const editor = makeEditor();
    const debug = createDebugDriver(editor);
    const points = [P(100, 100), P(500, 150), P(800, 600), P(300, 650)];
    // The last tap lands on the last point again: that finishes the polyline.
    debug.perform({ type: 'taps', tool: 'polyline', points: [...points, points[3]!] });

    const item = lastItem(editor)!;
    const content = lineOf(item);
    expect(content.kind).toBe('polyline');
    expect(linePoints(content)).toEqual(points);
    expect(content.isClosed).toBe(false);
    // Polylines have no arrowheads by default.
    expect(content.endHead).toBe('none');
    expect(editor.store.tool).toBe('select');
    expect(editor.store.selection).toEqual([item.id]);

    editor.undo();
    // Undo removes the last point.
    expect(linePoints(lineOf(findItem(editor.store.document, item.id)))).toEqual(points.slice(0, 3));
    editor.undo();
    editor.undo();
    expect(findItem(editor.store.document, item.id)).toBeUndefined();
  });

  it('closes the polyline when the first point is tapped', () => {
    const editor = makeEditor();
    const points = [P(100, 100), P(500, 150), P(800, 600)];
    createDebugDriver(editor).perform({ type: 'taps', tool: 'polyline', points: [...points, points[0]!] });
    const content = lineOf(lastItem(editor));
    expect(linePoints(content)).toEqual(points);
    expect(content.isClosed).toBe(true);
    expect(editor.store.tool).toBe('select');
  });

  it('ends the draft when undo goes past its creation', () => {
    const editor = makeEditor();
    const debug = createDebugDriver(editor);
    debug.perform({ type: 'taps', tool: 'polyline', points: [P(100, 100), P(500, 150)] });
    expect(editor.polylineDraft.isActive).toBe(true);
    editor.undo();
    expect(editor.polylineDraft.isActive).toBe(false);
    // The next tap starts a new polyline instead of extending the removed one.
    debug.perform({ type: 'taps', tool: 'polyline', points: [P(300, 300), P(600, 300)] });
    expect(linePoints(lineOf(lastItem(editor)))).toEqual([P(300, 300), P(600, 300)]);
  });

  it('offers point and insert handles', () => {
    const editor = makeEditor();
    const points = [P(100, 300), P(500, 300), P(900, 300)];
    const polyline = createPolylineItem(points, itemStyle());
    editor.store.perform('add', adding(polyline), { select: [polyline.id] });
    const screen = (point: { x: number; y: number }) => editor.viewport.canvasToScreen(point);

    expect(handleAt(editor.overlay, screen(points[1]!))).toEqual({ kind: 'lineVertex', index: 1 });
    expect(handleAt(editor.overlay, screen(P(300, 300)))).toEqual({ kind: 'lineInsert', index: 0 });
    // "+" handles grab less than point handles, so the line around them can still be dragged.
    const beside = add(screen(P(300, 300)), P(INSERT_TOUCH_RADIUS + 2, 0));
    expect(handleAt(editor.overlay, beside)).toBeNull();

    // Straight arrows keep just their two end handles.
    const arrow = createLineItem(P(100, 600), P(900, 600), itemStyle());
    editor.store.perform('add', adding(arrow), { select: [arrow.id] });
    expect(editor.overlay?.handles.map((handle) => handle.kind)).toEqual([
      { kind: 'lineVertex', index: 0 },
      { kind: 'lineVertex', index: 1 },
    ]);
  });

  it('draws a curve straight, then bends it', () => {
    const editor = makeEditor();
    const debug = createDebugDriver(editor);
    debug.perform({ type: 'draw', tool: 'curve', points: [P(100, 400), P(500, 400), P(900, 400)] });
    const index = editor.store.document.items.length - 1;
    let content = lineOf(lastItem(editor));
    expect(content.kind).toBe('curve');
    // One bend point in the middle.
    expect(content.waypoints).toEqual([P(500, 400)]);
    expect(editor.store.tool).toBe('select');

    debug.perform({ type: 'dragLineVertex', itemIndex: index, vertex: 1, by: P(0, -200) });
    content = lineOf(lastItem(editor));
    expect(content.waypoints).toEqual([P(500, 200)]);

    debug.perform({ type: 'insertLineVertex', itemIndex: index, segment: 1, by: P(0, 250) });
    content = lineOf(lastItem(editor));
    // A second bend point for an S-curve.
    expect(content.waypoints).toHaveLength(2);
    expect(content.waypoints[0]).toEqual(P(500, 200));
    expect(content.waypoints[1]!.y).toBeGreaterThan(400);
  });
});

// Port of the editor tests of MarkupFeaturesTests (the toolbar test comes with the UI).
describe('features in the editor', () => {
  const key = (value: string) => ({ key: value, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });

  it('cannot select disabled tools', () => {
    const features = MarkupFeatures.all.with('highlighter', false);
    const editor = makeEditor(features);
    editor.selectTool('highlighter');
    expect(editor.store.tool).toBe('select');
    editor.selectTool('pen');
    expect(editor.store.tool).toBe('pen');
    // No shortcut for a disabled tool.
    expect(keyCommand(key('h'), features, true)).toBeNull();
    expect(keyCommand(key('p'), features, true)).toEqual({ type: 'tool', tool: 'pen' });
    expect(editor.handleKey(key('h'), true)).toBe(false);
  });

  it('follows the features in the action bar and text editing', () => {
    const features = MarkupFeatures.all.with('lock', false).with('editText', false);
    const editor = makeEditor(features);
    const text = createTextItem('Hello', P(100, 100), { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
    editor.store.perform('add', adding(text), { select: [text.id] });
    const actions = editor.overlay?.actions ?? [];
    expect(actions).not.toContain('lock');
    expect(actions).not.toContain('editText');
    expect(actions).toContain('delete');

    editor.beginTextEditing(text.id, false);
    // Existing text cannot be edited.
    expect(editor.isEditingText()).toBe(false);
  });
});

describe('debug driver', () => {
  it('drags, resizes and rotates items', () => {
    const editor = new EditorController(createBoardDocument(), { measurer });
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 100, height: 80 }, itemStyle());
    const line = createLineItem(P(0, 200), P(100, 200), itemStyle());
    editor.store.perform('add', adding(rect, line));
    const debug = createDebugDriver(editor);

    debug.perform({ type: 'drag', itemIndex: 0, by: P(30, 40) });
    expect(itemBox(findItem(editor.store.document, rect.id)!)?.frame).toEqual({ x: 30, y: 40, width: 100, height: 80 });
    expect(editor.store.selection).toEqual([rect.id]);

    debug.perform({ type: 'resize', itemIndex: 0, u: 1, v: 1, by: P(20, 20) });
    expect(itemBox(findItem(editor.store.document, rect.id)!)?.frame).toEqual({
      x: 30,
      y: 40,
      width: 120,
      height: 100,
    });

    debug.perform({ type: 'rotate', itemIndex: 0, degrees: 90 });
    const box = itemBox(findItem(editor.store.document, rect.id)!)!;
    expect(box.rotation).toBeCloseTo(degrees(90), 9);
    expectPoint(boxCenter(box), P(90, 90));

    debug.perform({ type: 'drag', itemIndex: 1, by: P(0, 10) });
    expect(linePoints(lineOf(findItem(editor.store.document, line.id)))).toEqual([P(0, 210), P(100, 210)]);
    expect(editor.store.undoActionName).toBe('move');
  });

  it('ignores gestures on missing items and points', () => {
    const editor = new EditorController(createBoardDocument(), { measurer });
    const line = createLineItem(P(0, 200), P(100, 200), itemStyle());
    editor.store.perform('add', adding(line));
    const debug = createDebugDriver(editor);
    debug.perform({ type: 'drag', itemIndex: 5, by: P(1, 1) });
    debug.perform({ type: 'resize', itemIndex: 0, u: 1, v: 1, by: P(1, 1) });
    debug.perform({ type: 'rotate', itemIndex: 0, degrees: 10 });
    debug.perform({ type: 'dragLineVertex', itemIndex: 0, vertex: 4, by: P(1, 1) });
    debug.perform({ type: 'dragLineVertex', itemIndex: 3, vertex: 0, by: P(1, 1) });
    debug.perform({ type: 'insertLineVertex', itemIndex: 0, segment: 0, by: P(1, 1) });
    debug.perform({ type: 'insertLineVertex', itemIndex: 3, segment: 0, by: P(1, 1) });
    debug.perform({ type: 'draw', tool: 'pen', points: [] });
    debug.perform({ type: 'taps', tool: 'select', points: [P(0, 0)] });
    debug.beginEditingText(0);
    debug.typeText('ignored');
    expect(editor.store.undoActionName).toBe('add');
    expect(editor.isEditingText()).toBe(false);
  });

  it('types text, opens panels, fills and arranges', () => {
    const editor = new EditorController(
      createBoardDocument([
        { assetID: 'a', pixelSize: { width: 400, height: 300 } },
        { assetID: 'b', pixelSize: { width: 400, height: 300 } },
      ]),
      { measurer },
    );
    editor.setViewportSize(800, 600);
    const text = createTextItem('Hi', P(0, 0), { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
    editor.store.perform('add', adding(text));
    const debug = createDebugDriver(editor);

    debug.beginEditingText(2);
    debug.typeText(' there');
    expect(editor.textEditing?.text).toBe('Hi there');
    debug.presentPanel('fillColor');
    expect(editor.openPanel).toBe('fillColor');
    debug.presentPanel('fillColor');
    expect(editor.openPanel).toBe('fillColor');
    // Opening a panel ends text editing.
    expect(editor.isEditingText()).toBe(false);
    const edited = findItem(editor.store.document, text.id);
    expect(edited?.type === 'text' && edited.content.text).toBe('Hi there');

    debug.setFill(MarkupColors.yellow);
    expect(findItem(editor.store.document, text.id)?.style.fillColor).toBe(MarkupColors.yellow);

    debug.arrange('column');
    expect(editor.store.undoActionName).toBe('arrange');
    const zoom = editor.viewport.zoom;
    editor.viewport.zoomAround(P(400, 300), zoom * 2);
    debug.zoomToFit();
    expect(editor.viewport.zoom).toBeCloseTo(zoom, 9);
  });
});
