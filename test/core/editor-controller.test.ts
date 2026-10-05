import { describe, expect, it } from 'vitest';
import { EditorController, type PointerInput } from '../../src/editor/controller';
import type { KeyInput } from '../../src/editor/keyboard';
import { ROTATION_KNOB_OFFSET } from '../../src/editor/overlay';
import { boxCenter } from '../../src/geometry/box';
import {
  DEFAULT_FONT,
  MarkupColors,
  MarkupFeatures,
  createApproximateTextMeasurer,
  createCurveItem,
  createImageDocument,
  createPolylineItem,
  createShapeItem,
  createTextItem,
  findItem,
  itemBox,
  itemStyle,
  type LineContent,
  type MarkupItem,
  type Point,
  type TextItem,
} from '../../src';
import { boardWith } from './helpers';

const measurer = createApproximateTextMeasurer();
const P = (x: number, y: number): Point => ({ x, y });

/** A board editor at zoom 1 with no scrolling, so screen points are canvas points. */
function makeBoard(items: readonly MarkupItem[] = [], features?: MarkupFeatures): EditorController {
  const editor = new EditorController(boardWith(items), { measurer, features });
  editor.setViewportSize(800, 600);
  editor.viewport.zoom = 1;
  editor.viewport.offsetX = 0;
  editor.viewport.offsetY = 0;
  return editor;
}

/** Pointer events with a clock; gestures start a second apart so they never count as double taps. */
class Pointers {
  time = 0;

  constructor(private readonly editor: EditorController) {}

  private input(id: number, point: Point, extra: Partial<PointerInput>): PointerInput {
    return { id, x: point.x, y: point.y, pointerType: 'touch', timeStamp: this.time, ...extra };
  }

  down(id: number, point: Point, extra: Partial<PointerInput> = {}): void {
    this.editor.pointerDown(this.input(id, point, extra));
  }

  move(id: number, point: Point, extra: Partial<PointerInput> = {}): void {
    this.editor.pointerMove(this.input(id, point, extra));
  }

  up(id: number, point: Point): void {
    this.editor.pointerUp(this.input(id, point, {}));
  }

  tap(point: Point, gap = 1000): void {
    this.time += gap;
    this.down(1, point);
    this.time += 50;
    this.up(1, point);
  }

  drag(from: Point, to: Point, extra: Partial<PointerInput> = {}): void {
    this.time += 1000;
    this.down(1, from, extra);
    for (let step = 1; step <= 4; step += 1) {
      this.time += 16;
      this.move(1, P(from.x + ((to.x - from.x) * step) / 4, from.y + ((to.y - from.y) * step) / 4), extra);
    }
    this.time += 16;
    this.up(1, to);
  }
}

const key = (value: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

const rectItem = () => createShapeItem('rectangle', { x: 100, y: 100, width: 100, height: 80 }, itemStyle());
const textItem = (text = 'Hello', origin = P(400, 100)): TextItem =>
  createTextItem(text, origin, { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
const frameOf = (editor: EditorController, id: string) => itemBox(findItem(editor.store.document, id)!)?.frame;

function lineOf(item: MarkupItem | null | undefined): LineContent {
  if (item?.type !== 'line') throw new Error('not a line');
  return item.content;
}

const linePoints = (line: LineContent) => [line.start.point, ...line.waypoints, line.end.point];

describe('pointers in Select mode', () => {
  it('selects with a tap and moves with a drag', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const pointers = new Pointers(editor);

    pointers.tap(P(150, 140));
    expect(editor.store.selection).toEqual([rect.id]);
    expect(editor.store.canUndo).toBe(false);

    pointers.drag(P(150, 140), P(200, 180));
    expect(frameOf(editor, rect.id)).toEqual({ x: 150, y: 140, width: 100, height: 80 });
    expect(editor.store.undoActionName).toBe('move');
    expect(editor.isInteracting).toBe(false);

    // A small slip is still a tap: the item does not move.
    pointers.time += 1000;
    pointers.down(1, P(200, 180));
    pointers.move(1, P(201, 181));
    pointers.up(1, P(201, 181));
    expect(frameOf(editor, rect.id)).toEqual({ x: 150, y: 140, width: 100, height: 80 });
  });

  it('clears the selection with a tap on empty canvas and pans with a drag there', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const pointers = new Pointers(editor);
    editor.store.select([rect.id]);

    pointers.drag(P(600, 500), P(550, 450));
    expect(editor.viewport.offsetX).toBe(-50);
    expect(editor.viewport.offsetY).toBe(-50);
    expect(editor.store.selection).toEqual([rect.id]);

    pointers.tap(P(600, 500));
    expect(editor.store.selection).toEqual([]);
  });

  it('treats the photo of an image document as empty canvas', () => {
    const document = createImageDocument({ assetID: 'photo', pixelSize: { width: 1024, height: 768 } });
    const editor = new EditorController(document, { measurer });
    editor.setViewportSize(1024, 850);
    const rect = rectItem();
    editor.store.perform('add', (doc) => ({ ...doc, items: [...doc.items, rect] }), { select: [rect.id] });
    const pointers = new Pointers(editor);
    const screen = (point: Point) => editor.viewport.canvasToScreen(point);
    const offset = { x: editor.viewport.offsetX, y: editor.viewport.offsetY };

    // At fit zoom the photo is centered: dragging it neither moves it nor scrolls.
    pointers.drag(screen(P(600, 500)), screen(P(500, 400)));
    expect({ x: editor.viewport.offsetX, y: editor.viewport.offsetY }).toEqual(offset);
    expect(editor.store.undoActionName).toBe('add');
    expect(itemBox(editor.store.document.items[0]!)?.frame).toEqual({ x: 0, y: 0, width: 1024, height: 768 });

    pointers.tap(screen(P(600, 500)));
    expect(editor.store.selection).toEqual([]);
  });

  it('edits text with a tap once it is selected, or with a double tap', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    const pointers = new Pointers(editor);
    const center = boxCenter(text.content.box);

    pointers.tap(center);
    expect(editor.store.selection).toEqual([text.id]);
    expect(editor.isEditingText()).toBe(false);
    pointers.tap(center);
    expect(editor.textEditing).toEqual({ itemID: text.id, isNew: false, text: 'Hello' });
    expect(editor.hiddenItemIDs).toEqual([text.id]);
    expect(editor.overlay).toBeNull();

    editor.endTextEditing();
    editor.store.clearSelection();
    pointers.tap(center);
    pointers.tap(P(center.x + 3, center.y), 200);
    expect(editor.isEditingText()).toBe(true);
  });

  it('does not edit locked text', () => {
    const text = { ...textItem(), isLocked: true };
    const editor = makeBoard([text]);
    const pointers = new Pointers(editor);
    const center = boxCenter(text.content.box);
    pointers.tap(center);
    pointers.tap(center, 200);
    expect(editor.store.selection).toEqual([text.id]);
    expect(editor.isEditingText()).toBe(false);
    expect(editor.selectionActions).toEqual(['unlock']);
  });

  it('resizes and rotates from the handles', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const pointers = new Pointers(editor);
    editor.store.select([rect.id]);

    pointers.drag(P(200, 180), P(220, 200));
    expect(frameOf(editor, rect.id)).toEqual({ x: 100, y: 100, width: 120, height: 100 });
    expect(editor.store.undoActionName).toBe('resize');

    // The knob sits above the top edge; dragging it to the right side turns the box a quarter clockwise.
    const knob = P(160, 100 - ROTATION_KNOB_OFFSET);
    pointers.drag(knob, P(300, 150));
    expect(itemBox(findItem(editor.store.document, rect.id)!)?.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(editor.store.undoActionName).toBe('rotate');
  });

  it('marks a line point with a tap and deletes it', () => {
    const polyline = createPolylineItem([P(100, 100), P(200, 200), P(300, 100)], itemStyle());
    const editor = makeBoard([polyline]);
    const pointers = new Pointers(editor);
    editor.store.select([polyline.id]);

    pointers.tap(P(200, 200));
    expect(editor.activeLineVertex).toEqual({ itemID: polyline.id, index: 1 });
    expect(editor.selectionActions).toContain('deletePoint');
    expect(editor.overlay?.dots[1]?.style).toBe('active');
    // Tapping it again unmarks it.
    pointers.tap(P(200, 200));
    expect(editor.activeLineVertex).toBeNull();

    pointers.tap(P(200, 200));
    editor.performAction('deletePoint');
    expect(linePoints(lineOf(findItem(editor.store.document, polyline.id)))).toEqual([P(100, 100), P(300, 100)]);
    expect(editor.activeLineVertex).toBeNull();
    expect(editor.store.undoActionName).toBe('deletePoint');

    // Straight lines have no points to mark.
    editor.store.clearSelection();
    expect(editor.selectionActions).toEqual([]);
  });

  it('forgets the marked point when the selection changes', () => {
    const polyline = createPolylineItem([P(100, 100), P(200, 200), P(300, 100)], itemStyle());
    const rect = createShapeItem('rectangle', { x: 500, y: 100, width: 100, height: 80 }, itemStyle());
    const editor = makeBoard([polyline, rect]);
    const pointers = new Pointers(editor);
    editor.store.select([polyline.id]);
    pointers.tap(P(200, 200));
    expect(editor.activeLineVertex).not.toBeNull();
    editor.store.select([rect.id]);
    expect(editor.activeLineVertex).toBeNull();
  });

  it('drags a new point out of a "+" handle', () => {
    const curve = createCurveItem([P(100, 300), P(300, 300), P(500, 300)], itemStyle());
    const editor = makeBoard([curve]);
    const pointers = new Pointers(editor);
    editor.store.select([curve.id]);
    const plus = editor.overlay?.insertHandles[0];
    expect(plus).toBeDefined();
    pointers.drag(plus!, P(plus!.x, plus!.y + 60));
    const content = lineOf(findItem(editor.store.document, curve.id));
    expect(content.waypoints).toHaveLength(2);
    expect(content.waypoints[0]!.y).toBeGreaterThan(300);
    expect(editor.store.undoActionName).toBe('addPoint');
  });

  it('pans with the middle mouse button, even over items', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const pointers = new Pointers(editor);
    pointers.drag(P(150, 140), P(170, 150), { button: 1, pointerType: 'mouse' });
    expect(editor.viewport.offsetX).toBe(20);
    expect(frameOf(editor, rect.id)).toEqual(rect.content.box.frame);
  });

  it('scrolls and zooms with the wheel', () => {
    const editor = makeBoard();
    editor.wheel({ x: 400, y: 300, deltaX: 10, deltaY: 30, zoom: false });
    expect([editor.viewport.offsetX, editor.viewport.offsetY]).toEqual([-10, -30]);
    editor.wheel({ x: 400, y: 300, deltaX: 0, deltaY: -100, zoom: true });
    expect(editor.viewport.zoom).toBeCloseTo(Math.exp(0.5), 9);
    // The point under the pointer stays put.
    const anchor = editor.viewport.screenToCanvas(P(400, 300));
    expect(anchor.x).toBeCloseTo(410, 9);
    expect(anchor.y).toBeCloseTo(330, 9);
  });
});

describe('two fingers', () => {
  it('drops the stroke when a second finger comes early, then pinches', () => {
    const editor = makeBoard();
    editor.selectTool('pen');
    const pointers = new Pointers(editor);
    pointers.down(1, P(100, 100));
    pointers.time = 50;
    pointers.move(1, P(110, 100));
    expect(editor.penPreview).not.toBeNull();
    pointers.time = 100;
    pointers.down(2, P(300, 100));
    expect(editor.penPreview).toBeNull();
    expect(editor.isInteracting).toBe(false);

    // The fingers are 190 apart; spreading them to 380 doubles the zoom.
    const zoom = editor.viewport.zoom;
    pointers.move(2, P(490, 100));
    expect(editor.viewport.zoom).toBeCloseTo(zoom * 2, 9);
    pointers.up(1, P(110, 100));
    // The finger left on the canvas does not start drawing.
    pointers.move(2, P(600, 200));
    pointers.up(2, P(600, 200));
    expect(editor.store.canUndo).toBe(false);
    expect(editor.store.document.items).toHaveLength(0);
  });

  it('ends the stroke when the second finger comes late or after a long stroke', () => {
    const editor = makeBoard();
    editor.selectTool('pen');
    const pointers = new Pointers(editor);
    pointers.down(1, P(100, 100));
    pointers.time = 100;
    pointers.move(1, P(105, 100));
    pointers.time = 400;
    pointers.down(2, P(300, 300));
    expect(editor.store.undoActionName).toBe('draw');
    pointers.up(1, P(105, 100));
    pointers.up(2, P(300, 300));

    pointers.time = 2000;
    pointers.down(1, P(100, 400));
    pointers.time = 2050;
    pointers.move(1, P(150, 400));
    pointers.time = 2100;
    pointers.down(2, P(300, 300));
    expect(editor.store.document.items).toHaveLength(2);
  });

  it('acts on a still finger released by a late second finger like a tap', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    editor.store.select([text.id]);
    const pointers = new Pointers(editor);
    pointers.down(1, boxCenter(text.content.box));
    pointers.time = 400;
    pointers.down(2, P(700, 500));
    expect(editor.isEditingText()).toBe(true);
  });
});

describe('drawing tools', () => {
  it('erases everything one stroke passes over in one undo step', () => {
    const a = rectItem();
    const b = createShapeItem('rectangle', { x: 300, y: 100, width: 100, height: 80 }, itemStyle());
    const editor = makeBoard([a, b]);
    editor.selectTool('eraser');
    const pointers = new Pointers(editor);
    pointers.down(1, P(50, 100));
    pointers.move(1, P(250, 100), { coalesced: [P(150, 100), P(250, 100)] });
    expect(editor.hiddenItemIDs).toEqual([a.id]);
    expect(editor.eraserCursor?.center).toEqual(P(250, 100));
    pointers.move(1, P(450, 100));
    pointers.up(1, P(450, 100));
    expect(editor.store.document.items).toHaveLength(0);
    expect(editor.store.undoActionName).toBe('erase');
    expect(editor.hiddenItemIDs).toEqual([]);
    expect(editor.eraserCursor).toBeNull();
    // The eraser stays active.
    expect(editor.store.tool).toBe('eraser');
    editor.undo();
    expect(editor.store.document.items).toHaveLength(2);
  });

  it('draws shapes and returns to Select', () => {
    const editor = makeBoard();
    editor.selectTool('oval');
    const pointers = new Pointers(editor);
    pointers.drag(P(100, 100), P(300, 200));
    const item = editor.store.document.items[0]!;
    expect(item.type === 'shape' && item.content.kind).toBe('ellipse');
    expect(itemBox(item)?.frame).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    expect(editor.store.selection).toEqual([item.id]);
    expect(editor.store.tool).toBe('select');
  });

  it('draws pen strokes and keeps the pen', () => {
    const editor = makeBoard();
    editor.selectTool('pen');
    const pointers = new Pointers(editor);
    pointers.drag(P(100, 100), P(300, 200), { predicted: [P(320, 210)] });
    expect(editor.store.document.items[0]?.type).toBe('stroke');
    expect(editor.penPreview).toBeNull();
    expect(editor.store.tool).toBe('pen');
  });

  it('draws polylines with taps and moves their middle points while drawing', () => {
    const editor = makeBoard();
    editor.selectTool('polyline');
    const pointers = new Pointers(editor);
    pointers.tap(P(100, 100));
    expect(editor.polylineDraft.pendingStart?.point).toEqual(P(100, 100));
    pointers.tap(P(300, 100));
    pointers.tap(P(300, 300));
    const id = editor.polylineDraft.itemID!;
    expect(editor.overlay?.pinsActionBarToBottom).toBe(true);
    expect(editor.selectionActions).toEqual(['finishPath', 'closePath']);
    expect(editor.toolbarState.fillEnabled).toBe(true);

    pointers.drag(P(300, 100), P(350, 120));
    expect(linePoints(lineOf(findItem(editor.store.document, id)))).toEqual([P(100, 100), P(350, 120), P(300, 300)]);
    expect(editor.store.undoActionName).toBe('movePoint');

    editor.performAction('closePath');
    expect(lineOf(findItem(editor.store.document, id)).isClosed).toBe(true);
    expect(editor.store.tool).toBe('select');
    expect(editor.polylineDraft.isActive).toBe(false);
    expect(editor.selectionActions).toContain('openPath');
    editor.performAction('openPath');
    expect(lineOf(findItem(editor.store.document, id)).isClosed).toBe(false);
    editor.performAction('closePath');
    expect(lineOf(findItem(editor.store.document, id)).isClosed).toBe(true);
  });

  it('finishes the polyline from the action bar, Escape or another tool', () => {
    const editor = makeBoard();
    const pointers = new Pointers(editor);
    editor.selectTool('polyline');
    pointers.tap(P(100, 100));
    pointers.tap(P(300, 100));
    expect(editor.selectionActions).toEqual(['finishPath']);
    editor.performAction('finishPath');
    expect(editor.store.tool).toBe('select');
    expect(editor.store.selection).toHaveLength(1);

    editor.selectTool('polyline');
    pointers.tap(P(100, 300));
    pointers.tap(P(300, 300));
    expect(editor.handleKey(key('Escape'), true)).toBe(true);
    expect(editor.store.tool).toBe('select');
    expect(editor.polylineDraft.isActive).toBe(false);

    editor.selectTool('polyline');
    pointers.tap(P(100, 500));
    pointers.tap(P(300, 500));
    // Picking any tool, even Polyline again, ends the polyline.
    editor.selectTool('polyline');
    expect(editor.polylineDraft.isActive).toBe(false);
    pointers.tap(P(500, 500));
    expect(editor.polylineDraft.pendingStart).not.toBeNull();
    // Leaving the tool ends a polyline that has only its first point.
    editor.store.tool = 'pen';
    expect(editor.polylineDraft.isActive).toBe(false);
    expect(editor.store.document.items).toHaveLength(3);
  });
});

describe('text editing', () => {
  it('leaves no trace of an abandoned new box', () => {
    const editor = makeBoard();
    editor.selectTool('text');
    const pointers = new Pointers(editor);
    pointers.tap(P(300, 300));
    const session = editor.textEditing!;
    expect(session.isNew).toBe(true);
    expect(findItem(editor.store.displayed, session.itemID)).toBeDefined();
    expect(findItem(editor.store.document, session.itemID)).toBeUndefined();

    // A pointer outside finishes the edit and does nothing else.
    pointers.tap(P(600, 500));
    expect(editor.isEditingText()).toBe(false);
    expect(editor.store.displayed.items).toHaveLength(0);
    expect(editor.store.hasChanges).toBe(false);
    expect(editor.store.selection).toEqual([]);
    expect(editor.store.tool).toBe('text');
  });

  it('adds a new box with text in one undo step and returns to Select', () => {
    const editor = makeBoard();
    editor.selectTool('note');
    const pointers = new Pointers(editor);
    pointers.tap(P(300, 300));
    const id = editor.textEditing!.itemID;
    editor.setEditingText('Gamla Stan');
    expect(editor.editingContent?.text).toBe('Gamla Stan');
    expect(editor.editingStyle?.fillColor).not.toBeNull();
    editor.endTextEditing();
    expect(editor.store.undoActionName).toBe('addText');
    expect(editor.store.tool).toBe('select');
    expect(editor.store.selection).toEqual([id]);
    editor.undo();
    expect(editor.store.document.items).toHaveLength(0);
  });

  it('commits an edit of existing text once, deletes emptied text and skips unchanged text', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    editor.beginTextEditing(text.id, false);
    editor.setEditingText('Hello');
    editor.endTextEditing();
    expect(editor.store.canUndo).toBe(false);
    expect(editor.store.preview).toBeNull();

    editor.beginTextEditing(text.id, false);
    editor.setEditingText('Hello!');
    editor.adjustEditingFontSize(true);
    editor.toggleEditingBold();
    editor.applyStyleChange((style) => ({ ...style, fillColor: MarkupColors.yellow }));
    editor.endTextEditing();
    const edited = findItem(editor.store.document, text.id) as TextItem;
    expect(edited.content.text).toBe('Hello!');
    expect(edited.content.font.size).toBe(Math.round(DEFAULT_FONT.size * 1.15));
    expect(edited.content.font.bold).toBe(!DEFAULT_FONT.bold);
    expect(edited.style.fillColor).toBe(MarkupColors.yellow);
    expect(editor.store.undoActionName).toBe('editText');
    editor.undo();
    expect(findItem(editor.store.document, text.id)).toEqual(text);

    editor.beginTextEditing(text.id, false);
    editor.setEditingText('  \n');
    editor.endTextEditing();
    expect(findItem(editor.store.document, text.id)).toBeUndefined();
    expect(editor.store.undoActionName).toBe('delete');
  });

  it('keeps the font size within 8 and 400', () => {
    const small = { ...textItem(), content: { ...textItem().content, font: { ...DEFAULT_FONT, size: 8 } } };
    const editor = makeBoard([small]);
    editor.beginTextEditing(small.id, false);
    editor.adjustEditingFontSize(false);
    expect(editor.editingContent?.font.size).toBe(8);
    editor.applyTextChange((content) => ({ ...content, font: { ...content.font, size: 390 } }));
    editor.adjustEditingFontSize(true);
    expect(editor.editingContent?.font.size).toBe(400);
  });

  it('ends editing before undo, tools and panels', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    editor.beginTextEditing(text.id, false);
    editor.setEditingText('Changed');
    editor.undo();
    // The edit was committed, then undone.
    expect(editor.isEditingText()).toBe(false);
    expect((findItem(editor.store.document, text.id) as TextItem).content.text).toBe('Hello');
    editor.redo();
    expect((findItem(editor.store.document, text.id) as TextItem).content.text).toBe('Changed');

    editor.beginTextEditing(text.id, false);
    editor.togglePanel('textStyle');
    expect(editor.isEditingText()).toBe(false);
    expect(editor.openPanel).toBe('textStyle');
    editor.togglePanel('textStyle');
    expect(editor.openPanel).toBeNull();

    editor.beginTextEditing(text.id, false);
    editor.selectTool('pen');
    expect(editor.isEditingText()).toBe(false);
  });

  it('switches to another box and ignores what is not text', () => {
    const a = textItem('A', P(100, 100));
    const b = textItem('B', P(100, 300));
    const rect = rectItem();
    const editor = makeBoard([a, b, rect]);
    editor.beginTextEditing(a.id, false);
    editor.setEditingText('AA');
    editor.beginTextEditing(b.id, false);
    expect(editor.textEditing?.itemID).toBe(b.id);
    expect((findItem(editor.store.document, a.id) as TextItem).content.text).toBe('AA');
    editor.endTextEditing();
    editor.beginTextEditing(rect.id, false);
    expect(editor.isEditingText()).toBe(false);
    editor.setEditingText('x');
    editor.applyTextChange((content) => content);
    editor.applyStyleChange((style) => style);
    expect(editor.editingContent).toBeNull();
    expect(editor.editingStyle).toBeNull();
    expect(editor.textEditing).toBeNull();
  });

  it('tracks the keyboard only while editing', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    editor.setKeyboardInset(300);
    expect(editor.viewport.keyboardInset).toBe(0);
    editor.beginTextEditing(text.id, false);
    editor.setKeyboardInset(300);
    expect(editor.viewport.keyboardInset).toBe(300);
    const version = editor.version;
    editor.setKeyboardInset(300.2);
    expect(editor.version).toBe(version);
    editor.endTextEditing();
    expect(editor.viewport.keyboardInset).toBe(0);
  });

  it('clears the selection after a tap outside in Select mode', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    const pointers = new Pointers(editor);
    editor.beginTextEditing(text.id, false);
    editor.setEditingText('Hello there');
    pointers.tap(P(700, 500));
    expect(editor.isEditingText()).toBe(false);
    expect(editor.store.undoActionName).toBe('editText');
    expect(editor.store.selection).toEqual([]);
  });

  it('does not edit existing text when editing is turned off, but types new text', () => {
    const editor = makeBoard([], MarkupFeatures.all.with('editText', false));
    editor.selectTool('text');
    const pointers = new Pointers(editor);
    pointers.tap(P(300, 300));
    expect(editor.isEditingText()).toBe(true);
    editor.setEditingText('New');
    editor.endTextEditing();
    const id = editor.store.selection[0]!;
    editor.beginTextEditing(id, false);
    expect(editor.isEditingText()).toBe(false);
    editor.performAction('editText');
    expect(editor.isEditingText()).toBe(false);
  });
});

describe('keyboard', () => {
  it('runs the shortcuts', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    editor.store.select([rect.id]);
    expect(editor.handleKey(key('d', { metaKey: true }), true)).toBe(true);
    expect(editor.store.document.items).toHaveLength(2);
    expect(editor.handleKey(key('Backspace'), true)).toBe(true);
    expect(editor.store.document.items).toHaveLength(1);
    expect(editor.handleKey(key('z', { metaKey: true }), true)).toBe(true);
    expect(editor.store.document.items).toHaveLength(2);
    expect(editor.handleKey(key('z', { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(editor.store.document.items).toHaveLength(1);
    editor.handleKey(key('z', { ctrlKey: true }), false);
    expect(editor.handleKey(key('y', { ctrlKey: true }), false)).toBe(true);
    expect(editor.store.document.items).toHaveLength(1);

    // Zoom to fit shows the small rectangle large.
    expect(editor.handleKey(key('0', { metaKey: true }), true)).toBe(true);
    expect(editor.viewport.zoom).toBeGreaterThan(2);
    expect(editor.handleKey(key('x'), true)).toBe(false);
    expect(editor.handleKey(key('t'), true)).toBe(true);
    expect(editor.store.tool).toBe('text');
  });

  it('steps back with Escape: panel, tool, selection', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    editor.selectTool('pen');
    editor.togglePanel('shapeStyle');
    editor.handleKey(key('Escape'), true);
    expect(editor.openPanel).toBeNull();
    expect(editor.store.tool).toBe('select');
    editor.store.select([rect.id]);
    editor.handleKey(key('Escape'), true);
    expect(editor.store.selection).toEqual([]);
  });

  it('leaves keys to the text box and swallows them while exporting', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    editor.beginTextEditing(text.id, false);
    expect(editor.handleKey(key('Backspace'), true)).toBe(false);
    expect(editor.handleKey(key('z', { metaKey: true }), true)).toBe(false);
    editor.endTextEditing();

    editor.store.select([text.id]);
    editor.prepareForExport();
    editor.isExporting = true;
    editor.store.select([text.id]);
    expect(editor.handleKey(key('Backspace'), true)).toBe(true);
    expect(editor.handleKey(key('Escape'), true)).toBe(true);
    expect(editor.store.document.items).toHaveLength(1);
    expect(editor.store.selection).toEqual([text.id]);
  });
});

describe('editor state', () => {
  it('runs the selection actions', () => {
    const a = rectItem();
    const b = createShapeItem('rectangle', { x: 300, y: 100, width: 100, height: 80 }, itemStyle());
    const text = textItem();
    const editor = makeBoard([a, b, text]);
    editor.store.select([a.id]);
    expect(editor.selectionActions).toEqual(['duplicate', 'bringToFront', 'sendToBack', 'lock', 'delete']);
    editor.performAction('bringToFront');
    expect(editor.store.document.items[2]?.id).toBe(a.id);
    editor.performAction('sendToBack');
    expect(editor.store.document.items[0]?.id).toBe(a.id);
    editor.performAction('lock');
    expect(findItem(editor.store.document, a.id)?.isLocked).toBe(true);
    expect(editor.selectionActions).toEqual(['unlock']);
    expect(editor.overlay?.handles).toEqual([]);
    editor.performAction('unlock');
    expect(findItem(editor.store.document, a.id)?.isLocked).toBe(false);
    editor.performAction('duplicate');
    expect(editor.store.document.items).toHaveLength(4);
    editor.performAction('delete');
    expect(editor.store.document.items).toHaveLength(3);

    editor.store.select([text.id]);
    expect(editor.selectionActions[0]).toBe('editText');
    editor.performAction('editText');
    expect(editor.isEditingText()).toBe(true);
    editor.endTextEditing();

    // Nothing selected: the actions do nothing.
    editor.store.clearSelection();
    const version = editor.store.version;
    for (const action of ['editText', 'closePath', 'deletePoint'] as const) editor.performAction(action);
    expect(editor.store.version).toBe(version);
  });

  it('reports the toolbar state', () => {
    const text = textItem();
    const rect = createShapeItem(
      'rectangle',
      { x: 100, y: 300, width: 100, height: 80 },
      itemStyle({ strokeColor: MarkupColors.blue, fillColor: MarkupColors.yellow }),
    );
    const editor = makeBoard([text, rect]);
    expect(editor.toolbarState).toMatchObject({ tool: 'select', fillEnabled: true, textEnabled: true });
    editor.selectTool('pen');
    expect(editor.toolbarState).toMatchObject({ strokeEnabled: true, fillEnabled: false, textEnabled: false });
    editor.selectTool('eraser');
    expect(editor.toolbarState).toMatchObject({ strokeEnabled: false, fillEnabled: false });
    editor.selectTool('select');
    editor.store.select([rect.id]);
    expect(editor.toolbarState).toMatchObject({
      strokeColor: MarkupColors.blue,
      fillColor: MarkupColors.yellow,
      fillEnabled: true,
      textEnabled: false,
    });
    editor.store.select([text.id]);
    expect(editor.toolbarState).toMatchObject({ fillEnabled: true, textEnabled: true });
    editor.beginTextEditing(text.id, false);
    editor.applyStyleChange((style) => ({ ...style, strokeColor: MarkupColors.green }));
    // While editing, the toolbar shows the box being edited.
    expect(editor.toolbarState.strokeColor).toBe(MarkupColors.green);
  });

  it('cancels a gesture in progress when the tool changes or the editor exports', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const pointers = new Pointers(editor);
    pointers.down(1, P(150, 140));
    pointers.move(1, P(200, 200));
    expect(editor.store.preview).not.toBeNull();
    editor.selectTool('pen');
    expect(editor.store.preview).toBeNull();
    pointers.move(1, P(250, 250));
    pointers.up(1, P(250, 250));
    expect(editor.store.canUndo).toBe(false);
    expect(editor.isInteracting).toBe(false);

    pointers.time += 1000;
    pointers.down(1, P(100, 400));
    pointers.move(1, P(200, 400));
    expect(editor.penPreview).not.toBeNull();
    editor.prepareForExport();
    editor.isExporting = true;
    expect(editor.penPreview).toBeNull();
    pointers.up(1, P(200, 400));
    pointers.down(2, P(300, 300));
    pointers.up(2, P(300, 300));
    expect(editor.store.canUndo).toBe(false);
  });

  it('cancels a gesture whose release was lost or cancelled', () => {
    const rect = rectItem();
    const editor = makeBoard([rect]);
    const pointers = new Pointers(editor);
    pointers.down(1, P(150, 140));
    pointers.move(1, P(200, 200));
    // The same pointer goes down again: its release was lost.
    pointers.time += 1000;
    pointers.down(1, P(600, 500));
    pointers.up(1, P(600, 500));
    expect(editor.store.canUndo).toBe(false);
    expect(frameOf(editor, rect.id)).toEqual(rect.content.box.frame);

    pointers.time += 1000;
    pointers.down(1, P(150, 140));
    pointers.move(1, P(200, 200));
    editor.pointerCancel({ id: 1, x: 200, y: 200, pointerType: 'touch', timeStamp: pointers.time });
    expect(editor.store.preview).toBeNull();
    expect(editor.store.canUndo).toBe(false);
    // Events of unknown pointers are ignored.
    pointers.move(7, P(1, 1));
    pointers.up(7, P(1, 1));
  });

  it('reports whether cancelling discards anything', () => {
    const text = textItem();
    const editor = makeBoard([text]);
    editor.togglePanel('fillColor');
    expect(editor.prepareForCancel()).toBe(false);
    expect(editor.openPanel).toBeNull();
    editor.beginTextEditing(text.id, false);
    editor.setEditingText('Changed');
    // Cancel commits the edit first, so there is something to discard.
    expect(editor.prepareForCancel()).toBe(true);
  });

  it('zooms to fit once the canvas has a size, then keeps the zoom on resize', () => {
    const rect = rectItem();
    const editor = new EditorController(boardWith([rect]), { measurer });
    editor.setViewportSize(0, 0);
    expect(editor.viewport.size).toEqual({ width: 0, height: 0 });
    editor.setViewportSize(800, 600);
    const fit = editor.viewport.zoom;
    expect(fit).toBeGreaterThan(1);
    const version = editor.version;
    editor.setViewportSize(800, 600);
    expect(editor.version).toBe(version);
    editor.setViewportSize(1000, 700);
    expect(editor.viewport.zoom).toBe(fit);
  });

  it('notifies subscribers', () => {
    const editor = makeBoard();
    let calls = 0;
    const unsubscribe = editor.subscribe(() => (calls += 1));
    editor.selectTool('pen');
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    const before = calls;
    editor.selectTool('select');
    expect(calls).toBe(before);
  });

  it('lists the resolved points of lines', () => {
    const polyline = createPolylineItem([P(0, 0), P(10, 10), P(20, 0)], itemStyle());
    const rect = rectItem();
    const editor = makeBoard([polyline, rect]);
    expect(editor.linePoints(polyline.id)).toEqual([P(0, 0), P(10, 10), P(20, 0)]);
    expect(editor.linePoints(rect.id)).toEqual([]);
  });
});
