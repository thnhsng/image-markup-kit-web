import { describe, expect, it, vi } from 'vitest';
import { EditorStore, styleForTool } from '../../src/editor/store';
import { SHAPE_TOOLS, type MarkupTool } from '../../src/editor/tools';
import { resolveEndpoint } from '../../src/geometry/bindings';
import { boxOffset } from '../../src/geometry/box';
import { maxY } from '../../src/geometry/rect';
import {
  DEFAULT_FONT,
  MarkupColors,
  STANDARD_STYLE_DEFAULTS,
  createApproximateTextMeasurer,
  createBoardDocument,
  createConnectorItem,
  createImageDocument,
  createPolylineItem,
  createShapeItem,
  createTextItem,
  findItem,
  imageItems,
  itemBox,
  itemStyle,
  modelEquals,
  updateItem,
  withItemBox,
  type ImageSource,
  type LineContent,
  type LineItem,
  type MarkupDocument,
  type MarkupItem,
  type TextItem,
} from '../../src';
import { boardWith } from './helpers';

const measurer = createApproximateTextMeasurer();
const P = (x: number, y: number) => ({ x, y });
const source = (assetID: string): ImageSource => ({ assetID, pixelSize: { width: 400, height: 300 } });
const sources = (count: number): ImageSource[] =>
  Array.from({ length: count }, (_, i) => ({
    assetID: String(i),
    pixelSize: i % 2 === 0 ? { width: 400, height: 300 } : { width: 300, height: 400 },
  }));
const frames = (document: MarkupDocument) => imageItems(document).map((item) => item.content.box.frame);
const adding =
  (...items: MarkupItem[]) =>
  (document: MarkupDocument): MarkupDocument => ({ ...document, items: [...document.items, ...items] });

function makeStore(document?: MarkupDocument, now?: () => number): EditorStore {
  return new EditorStore(document ?? createBoardDocument([source('a')]), { measurer, now });
}

function lineOf(item: MarkupItem | null | undefined): LineContent {
  if (item?.type !== 'line') throw new Error('not a line');
  return item.content;
}

const linePoints = (line: LineContent) => [line.start.point, ...line.waypoints, line.end.point];

// Port of EditorStoreTests.
describe('EditorStore', () => {
  it('commits, undoes and redoes', () => {
    const store = makeStore();
    const original = store.document;
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    store.perform('add', adding(rect));
    expect(findItem(store.document, rect.id)).toBeDefined();
    expect(store.canUndo).toBe(true);

    store.perform('move', (document) =>
      updateItem(document, rect.id, (item) => withItemBox(item, boxOffset(itemBox(item)!, P(5, 0)))),
    );
    store.undo();
    expect(itemBox(findItem(store.document, rect.id)!)?.frame.x).toBe(0);
    store.undo();
    expect(store.document).toEqual(original);
    expect(store.canUndo).toBe(false);
    store.redo();
    store.redo();
    expect(itemBox(findItem(store.document, rect.id)!)?.frame.x).toBe(5);
  });

  it('coalesces commits into one undo step', () => {
    let time = 0;
    const store = makeStore(undefined, () => (time += 10));
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle({ lineWidth: 2 }));
    store.perform('add', adding(rect), { select: [rect.id] });
    for (let width = 3; width <= 20; width += 1) {
      store.updateStyle((style) => ({ ...style, lineWidth: width }), 'lineWidth');
    }
    expect(findItem(store.document, rect.id)?.style.lineWidth).toBe(20);
    store.undo();
    // A whole slider drag undoes in one step.
    expect(findItem(store.document, rect.id)?.style.lineWidth).toBe(2);
  });

  it('makes a style change the default', () => {
    const store = makeStore();
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    store.perform('add', adding(rect), { select: [rect.id] });
    store.updateStyle((style) => ({ ...style, strokeColor: MarkupColors.blue }));
    expect(store.defaults.shape.strokeColor).toBe(MarkupColors.blue);

    store.clearSelection();
    store.tool = 'pen';
    store.updateStyle((style) => ({ ...style, lineWidth: 12 }));
    // Without a selection only the tool default changes.
    expect(store.defaults.pen.lineWidth).toBe(12);
    expect(store.canRedo).toBe(false);
  });

  it('freezes connectors and detaches children on delete', () => {
    let board = createBoardDocument([source('a'), source('b')]);
    const [a, b] = board.items as [MarkupItem, MarkupItem];
    const connector = createConnectorItem(
      { itemID: a.id, anchor: P(0.5, 0.5) },
      { itemID: b.id, anchor: P(0.5, 0.5) },
      board,
      itemStyle(),
    );
    const note: TextItem = {
      ...createTextItem('x', P(900, 100), { font: DEFAULT_FONT, color: MarkupColors.red, measurer }),
      parentID: b.id,
    };
    board = { ...board, items: [...board.items, connector, note] };
    const store = makeStore(board);
    const endBefore = resolveEndpoint(connector.content.end, store.document);

    store.select([b.id]);
    store.deleteSelection();

    const line = lineOf(findItem(store.document, connector.id));
    expect(line.end.binding).toBeNull();
    expect(line.start.binding).not.toBeNull();
    // The freed end stays where it was.
    expect(line.end.point).toEqual(endBefore);
    expect(findItem(store.document, note.id)?.parentID).toBeNull();
  });

  it('drops bindings when duplicating', () => {
    let board = createBoardDocument([source('a')]);
    const photo = board.items[0] as MarkupItem;
    const connector = createConnectorItem(
      { itemID: photo.id, anchor: P(0, 0) },
      { itemID: photo.id, anchor: P(1, 1) },
      board,
      itemStyle(),
    );
    board = { ...board, items: [...board.items, connector] };
    const store = makeStore(board);
    store.select([connector.id]);
    store.duplicateSelection();
    const copy = lineOf(store.selectedItem);
    expect(copy.start.binding).toBeNull();
    expect(copy.end.binding).toBeNull();
    expect(store.selection).not.toEqual([connector.id]);
  });

  it('keeps z-order within bands', () => {
    let board = createBoardDocument([source('a'), source('b')]);
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 5, height: 5 }, itemStyle());
    board = { ...board, items: [...board.items, rect] };
    const store = makeStore(board);
    store.select([rect.id]);
    store.moveSelection('back');
    // Annotations never go below photos.
    expect(store.document.items.map((item) => item.type === 'image')).toEqual([true, true, false]);
    const firstImage = (store.document.items[0] as MarkupItem).id;
    store.select([firstImage]);
    store.moveSelection('front');
    // A photo moves to the top of the photo band.
    expect(store.document.items[1]?.id).toBe(firstImage);
    expect(store.document.items[2]?.type).not.toBe('image');
  });

  it('does not delete locked items', () => {
    const store = makeStore();
    const rect = { ...createShapeItem('rectangle', { x: 0, y: 0, width: 5, height: 5 }, itemStyle()), isLocked: true };
    store.perform('add', adding(rect), { select: [rect.id] });
    store.deleteSelection();
    expect(findItem(store.document, rect.id)).toBeDefined();
  });
});

// Port of the store tests of LinePathTests.
describe('EditorStore line points', () => {
  it('offsets waypoints when duplicating', () => {
    const polyline = createPolylineItem([P(0, 0), P(50, 50), P(100, 0)], itemStyle());
    const store = makeStore(boardWith([polyline]));
    store.select([polyline.id]);
    store.duplicateSelection();
    expect(lineOf(store.selectedItem).waypoints).toEqual([P(74, 74)]);
  });

  it('removes points and closes', () => {
    const points = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
    const polyline = createPolylineItem(points, itemStyle());
    const store = makeStore(boardWith([polyline]));

    store.setLineClosed(true, polyline.id);
    expect(lineOf(findItem(store.document, polyline.id)).isClosed).toBe(true);

    store.removeLinePoint(0, polyline.id);
    let content = lineOf(findItem(store.document, polyline.id));
    // The next point becomes the start.
    expect(linePoints(content)).toEqual(points.slice(1));
    expect(content.isClosed).toBe(true);

    store.removeLinePoint(1, polyline.id);
    content = lineOf(findItem(store.document, polyline.id));
    expect(linePoints(content)).toEqual([points[1], points[3]]);
    // Two points cannot stay closed.
    expect(content.isClosed).toBe(false);

    store.removeLinePoint(0, polyline.id);
    // A line keeps two points.
    expect(linePoints(lineOf(findItem(store.document, polyline.id)))).toHaveLength(2);
  });

  it('drops endpoint bindings when closing', () => {
    let board = createBoardDocument([source('a')]);
    const photo = board.items[0] as MarkupItem;
    const base = createPolylineItem([P(0, 0), P(100, 0), P(100, 100)], itemStyle());
    const polyline: LineItem = {
      ...base,
      content: {
        ...base.content,
        start: { ...base.content.start, binding: { itemID: photo.id, anchor: P(0.5, 0.5) } },
      },
    };
    board = { ...board, items: [...board.items, polyline] };
    const store = makeStore(board);
    store.setLineClosed(true, polyline.id);
    expect(lineOf(findItem(store.document, polyline.id)).start.binding).toBeNull();
  });

  it('removes the end point and opens or ignores what it cannot change', () => {
    const points = [P(0, 0), P(100, 0), P(100, 100)];
    const polyline = createPolylineItem(points, itemStyle(), { closed: true });
    const straight = createShapeItem('rectangle', { x: 0, y: 0, width: 5, height: 5 }, itemStyle());
    const store = makeStore(boardWith([polyline, straight]));
    store.removeLinePoint(2, polyline.id);
    const content = lineOf(findItem(store.document, polyline.id));
    expect(linePoints(content)).toEqual(points.slice(0, 2));
    expect(content.isClosed).toBe(false);
    expect(store.undoActionName).toBe('deletePoint');

    const version = store.version;
    store.removeLinePoint(5, polyline.id);
    store.removeLinePoint(0, straight.id);
    store.setLineClosed(true, straight.id);
    // Two points cannot close.
    store.setLineClosed(true, polyline.id);
    store.setLineClosed(false, polyline.id);
    expect(store.version).toBe(version);
  });
});

// The undo step of BoardLayoutTests.testArrangeColumnAndGrid.
describe('EditorStore board', () => {
  it('arranges in one undo step', () => {
    const store = makeStore(createBoardDocument(sources(4)));
    store.arrange('column');
    const column = frames(store.document);
    expect(column.every((frame) => Math.abs(frame.width - 800) < 1e-9)).toBe(true);
    for (let i = 1; i < column.length; i += 1) {
      expect(column[i]?.y ?? 0).toBeGreaterThan(maxY(column[i - 1] ?? column[0]!));
    }

    store.arrange('grid');
    const grid = frames(store.document);
    expect(grid[0]?.y).toBe(grid[1]?.y);
    // 2 per row for 4 photos.
    expect(grid[2]?.y ?? 0).toBeGreaterThan(maxY(grid[0]!));
    store.undo();
    // Arrange is one undo step.
    expect(frames(store.document)).toEqual(column);
    expect(store.redoActionName).toBe('arrange');
  });

  it('arranges only boards with photos', () => {
    const image = makeStore(createImageDocument(source('a')));
    image.arrange('grid');
    expect(image.canUndo).toBe(false);
    const empty = makeStore(createBoardDocument());
    empty.arrange('grid');
    expect(empty.canUndo).toBe(false);
  });

  it('adds photos to boards and selects a single new one', () => {
    const store = makeStore(createBoardDocument(sources(1)));
    store.addImages([source('x')]);
    expect(imageItems(store.document)).toHaveLength(2);
    expect(store.selection).toEqual([imageItems(store.document)[1]?.id]);
    store.addImages(sources(2));
    expect(imageItems(store.document)).toHaveLength(4);
    expect(store.selection).toEqual([]);
    store.addImages([]);
    expect(store.undoActionName).toBe('addImages');

    const image = makeStore(createImageDocument(source('a')));
    image.addImages([source('x')]);
    expect(image.canUndo).toBe(false);
  });
});

describe('EditorStore state', () => {
  it('notifies subscribers with what changed', () => {
    const store = makeStore();
    const changes: string[][] = [];
    const unsubscribe = store.subscribe((set) => changes.push([...set].sort()));
    const version = store.version;
    store.tool = 'pen';
    store.tool = 'pen';
    store.setPreview(null);
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    store.perform('add', adding(rect), { select: [rect.id] });
    unsubscribe();
    store.tool = 'select';
    expect(changes).toEqual([['tool'], ['document'], ['document', 'selection', 'undoState']]);
    expect(store.version).toBe(version + 4);
  });

  it('shows the preview until the next commit', () => {
    const store = makeStore();
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    store.setPreview(adding(rect)(store.document));
    expect(findItem(store.displayed, rect.id)).toBeDefined();
    expect(findItem(store.document, rect.id)).toBeUndefined();
    store.commit(store.document, 'add');
    expect(store.preview).toBeNull();
    expect(store.canUndo).toBe(false);
  });

  it('only updates the selection when a commit changes nothing', () => {
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    const store = makeStore(boardWith([rect]));
    const changes: string[][] = [];
    store.subscribe((set) => changes.push([...set].sort()));
    store.commit(store.document, 'move', { select: [rect.id, 'missing'] });
    expect(store.selection).toEqual([rect.id]);
    store.commit(store.document, 'move');
    expect(changes).toEqual([['document', 'selection'], ['document']]);
    expect(store.canUndo).toBe(false);
  });

  it('starts a new undo step after the coalescing window or endCoalescing', () => {
    let time = 0;
    const store = makeStore(undefined, () => time);
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle({ lineWidth: 2 }));
    store.perform('add', adding(rect), { select: [rect.id] });
    const width = (value: number) => store.updateStyle((style) => ({ ...style, lineWidth: value }), 'lineWidth');
    width(3);
    time += 1499;
    width(4);
    time += 1500;
    width(5);
    store.endCoalescing();
    width(6);
    store.undo();
    expect(findItem(store.document, rect.id)?.style.lineWidth).toBe(5);
    store.undo();
    expect(findItem(store.document, rect.id)?.style.lineWidth).toBe(4);
    store.undo();
    expect(findItem(store.document, rect.id)?.style.lineWidth).toBe(2);
  });

  it('keeps 100 undo steps', () => {
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    const store = makeStore(boardWith([rect]));
    for (let step = 1; step <= 105; step += 1) {
      store.perform('move', (document) =>
        updateItem(document, rect.id, (item) => withItemBox(item, boxOffset(itemBox(item)!, P(1, 0)))),
      );
    }
    let undone = 0;
    while (store.canUndo) {
      store.undo();
      undone += 1;
    }
    expect(undone).toBe(100);
    expect(itemBox(findItem(store.document, rect.id)!)?.frame.x).toBe(5);
    expect(store.hasChanges).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it('never selects the background photo or missing items', () => {
    const store = makeStore(createImageDocument(source('a')));
    store.select([store.document.backgroundItemID!, 'missing']);
    expect(store.selection).toEqual([]);
    expect(store.selectedItem).toBeNull();
    store.duplicateSelection();
    store.moveSelection('front');
    store.toggleLockOnSelection();
    store.deleteSelection();
    expect(store.canUndo).toBe(false);
  });

  it('locks and unlocks the selection', () => {
    const a = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    const b = { ...createShapeItem('ellipse', { x: 20, y: 0, width: 10, height: 10 }, itemStyle()), isLocked: true };
    const store = makeStore(boardWith([a, b]));
    store.select([a.id, b.id]);
    store.toggleLockOnSelection();
    expect(store.document.items.every((item) => item.isLocked)).toBe(true);
    expect(store.undoActionName).toBe('lock');
    store.toggleLockOnSelection();
    expect(store.document.items.some((item) => item.isLocked)).toBe(false);
    expect(store.undoActionName).toBe('unlock');
    // Copies are unlocked.
    store.toggleLockOnSelection();
    store.duplicateSelection();
    expect(store.selectedItems.map((item) => item.isLocked)).toEqual([false, false]);
  });

  it('edits text attributes and refits the box', () => {
    const text = createTextItem('Hello', P(0, 0), { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
    const store = makeStore(boardWith([text]));
    store.select([text.id]);
    store.updateText((content) => ({ ...content, font: { ...content.font, size: content.font.size * 2 } }));
    const edited = findItem(store.document, text.id);
    expect(edited?.type === 'text' && edited.content.box.frame.height).toBeGreaterThan(text.content.box.frame.height);
    expect(store.defaults.textFont.size).toBe(DEFAULT_FONT.size * 2);
    expect(store.currentTextContent.font.size).toBe(DEFAULT_FONT.size * 2);

    // A text with a fill is a note: it sets the note defaults.
    store.updateStyle((style) => ({ ...style, fillColor: MarkupColors.yellow }));
    expect(store.defaults.note.fillColor).toBe(MarkupColors.yellow);
    expect(store.defaults.noteFont.size).toBe(DEFAULT_FONT.size * 2);
  });

  it('edits the text defaults without a text selection', () => {
    const store = makeStore();
    store.tool = 'note';
    expect(store.currentTextContent.padding).toBe(16);
    store.updateText((content) => ({ ...content, color: MarkupColors.blue, alignment: 'center' }));
    expect(store.defaults.noteTextColor).toBe(MarkupColors.blue);
    expect(store.defaults.textAlignment).toBe('center');
    store.tool = 'text';
    expect(store.currentTextContent.padding).toBe(8);
    store.updateText((content) => ({ ...content, font: { ...content.font, bold: true } }));
    expect(store.defaults.textFont.bold).toBe(true);
    expect(store.canUndo).toBe(false);
  });

  it('sets arrowheads and their defaults per kind', () => {
    const polyline = createPolylineItem([P(0, 0), P(50, 50), P(100, 0)], itemStyle());
    const store = makeStore(boardWith([polyline]));
    store.tool = 'arrow';
    expect(store.currentArrowHeads).toEqual({
      start: STANDARD_STYLE_DEFAULTS.lineStartHead,
      end: STANDARD_STYLE_DEFAULTS.lineEndHead,
    });
    store.updateArrowHeads('arrow', 'arrow');
    expect(store.defaults.lineStartHead).toBe('arrow');
    expect(store.canUndo).toBe(false);
    store.tool = 'curve';
    expect(store.currentArrowHeads).toEqual({
      start: STANDARD_STYLE_DEFAULTS.pathStartHead,
      end: STANDARD_STYLE_DEFAULTS.pathEndHead,
    });

    store.tool = 'select';
    store.select([polyline.id]);
    store.updateArrowHeads('none', 'arrow');
    expect(store.currentArrowHeads).toEqual({ start: 'none', end: 'arrow' });
    expect(store.defaults.pathEndHead).toBe('arrow');
    expect(store.undoActionName).toBe('style');
    // Polylines and curves keep their defaults apart from arrows.
    expect(store.defaults.lineEndHead).toBe('arrow');
    expect(store.defaults.lineStartHead).toBe('arrow');
  });

  it('adopts the style of the last styled item per kind', () => {
    const highlight = createShapeItem('highlightBox', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    const line = createPolylineItem([P(0, 0), P(10, 10)], itemStyle());
    const store = makeStore(boardWith([highlight, line]));
    store.select([highlight.id]);
    store.updateStyle((style) => ({ ...style, opacity: 0.5 }));
    expect(store.defaults.highlightBox.opacity).toBe(0.5);
    store.select([line.id]);
    store.updateStyle((style) => ({ ...style, lineWidth: 9 }));
    expect(store.defaults.line.lineWidth).toBe(9);
    // Photos keep no style default.
    const photos = makeStore(createBoardDocument([source('a')]));
    const defaults = photos.defaults;
    photos.select([(photos.document.items[0] as MarkupItem).id]);
    photos.updateStyle((style) => ({ ...style, opacity: 0.5 }));
    expect(photos.defaults).toBe(defaults);
  });

  it('picks the style of each tool', () => {
    const defaults = STANDARD_STYLE_DEFAULTS;
    const expected: Record<string, unknown> = {
      select: defaults.shape,
      pen: defaults.pen,
      highlighter: defaults.highlighter,
      arrow: defaults.line,
      polyline: defaults.line,
      curve: defaults.line,
      text: defaults.text,
      note: defaults.note,
      eraser: defaults.shape,
    };
    for (const tool of SHAPE_TOOLS) expected[tool] = tool === 'highlightBox' ? defaults.highlightBox : defaults.shape;
    for (const [tool, style] of Object.entries(expected))
      expect(styleForTool(defaults, tool as MarkupTool)).toBe(style);

    // Without a selection, the style panels edit the active tool's default.
    const store = makeStore();
    for (const tool of Object.keys(expected) as MarkupTool[]) {
      store.tool = tool;
      store.updateStyle((style) => ({ ...style, lineWidth: 33 }));
      expect(styleForTool(store.defaults, tool).lineWidth).toBe(33);
    }
    expect(modelEquals(store.defaults.pen, defaults.pen)).toBe(false);
  });

  it('uses the clock when none is given', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const store = new EditorStore(createBoardDocument([source('a')]));
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    store.perform('add', adding(rect));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
