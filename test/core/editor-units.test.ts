import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApplePlatform, keyCommand, type KeyInput } from '../../src/editor/keyboard';
import {
  ACTION_BUTTON_SIZE,
  actionBarOrigin,
  actionBarSize,
  actionsFor,
  handleAt,
  selectionOverlay,
  type SelectionOverlay,
} from '../../src/editor/overlay';
import {
  isLineTool,
  isShapeTool,
  LINE_TOOLS,
  SHAPE_TOOLS,
  staysActiveAfterUse,
  toolOfShape,
} from '../../src/editor/tools';
import { Viewport } from '../../src/editor/viewport';
import {
  DEFAULT_FONT,
  MarkupColors,
  MarkupFeatures,
  createApproximateTextMeasurer,
  createBoardDocument,
  createCurveItem,
  createImageDocument,
  createLineItem,
  createPolylineItem,
  createShapeItem,
  createTextItem,
  itemStyle,
  shapeOfTool,
  type MarkupDocument,
  type MarkupItem,
  type Point,
} from '../../src';
import { boardWith } from './helpers';

const measurer = createApproximateTextMeasurer();
const P = (x: number, y: number): Point => ({ x, y });
const identity = (point: Point) => point;
const noActions = { actions: [], activeVertex: null, isDrawing: false } as const;

const key = (value: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe('keyCommand', () => {
  const all = MarkupFeatures.all;

  it('uses ⌘ on Apple platforms and Ctrl elsewhere', () => {
    expect(keyCommand(key('z', { metaKey: true }), all, true)).toEqual({ type: 'undo' });
    expect(keyCommand(key('Z', { metaKey: true, shiftKey: true }), all, true)).toEqual({ type: 'redo' });
    expect(keyCommand(key('z', { ctrlKey: true }), all, true)).toBeNull();
    expect(keyCommand(key('z', { ctrlKey: true }), all, false)).toEqual({ type: 'undo' });
    expect(keyCommand(key('z', { metaKey: true }), all, false)).toBeNull();
    expect(keyCommand(key('y', { ctrlKey: true }), all, false)).toEqual({ type: 'redo' });
    expect(keyCommand(key('y', { metaKey: true }), all, true)).toBeNull();
    expect(keyCommand(key('0', { metaKey: true }), all, true)).toEqual({ type: 'zoomToFit' });
    expect(keyCommand(key('d', { metaKey: true }), all, true)).toEqual({ type: 'duplicate' });
    expect(keyCommand(key('z', { metaKey: true, altKey: true }), all, true)).toBeNull();
    expect(keyCommand(key('s', { metaKey: true }), all, true)).toBeNull();
  });

  it('maps plain keys to Escape, Delete and the tools', () => {
    expect(keyCommand(key('Escape'), all, true)).toEqual({ type: 'escape' });
    expect(keyCommand(key('Delete'), all, true)).toEqual({ type: 'delete' });
    expect(keyCommand(key('Backspace'), all, false)).toEqual({ type: 'delete' });
    expect(keyCommand(key('L'), all, true)).toEqual({ type: 'tool', tool: 'polyline' });
    expect(keyCommand(key('l', { shiftKey: true }), all, true)).toBeNull();
    expect(keyCommand(key('e', { altKey: true }), all, true)).toBeNull();
    expect(keyCommand(key('q'), all, true)).toBeNull();
    const keys = 'vphalctne'.split('').map((value) => keyCommand(key(value), all, true));
    expect(keys.map((command) => command?.type === 'tool' && command.tool)).toEqual([
      'select',
      'pen',
      'highlighter',
      'arrow',
      'polyline',
      'curve',
      'text',
      'note',
      'eraser',
    ]);
  });

  it('never fires during IME composition', () => {
    expect(keyCommand(key('Escape', { isComposing: true }), all, true)).toBeNull();
    expect(keyCommand(key('Process', { keyCode: 229 }), all, true)).toBeNull();
    expect(keyCommand(key('z', { metaKey: true, keyCode: 229 }), all, true)).toBeNull();
  });

  it('drops the shortcuts of features turned off', () => {
    const features = MarkupFeatures.all.with('duplicate', false).with('delete', false).with('eraser', false);
    expect(keyCommand(key('d', { metaKey: true }), features, true)).toBeNull();
    expect(keyCommand(key('Backspace'), features, true)).toBeNull();
    expect(keyCommand(key('e'), features, true)).toBeNull();
    expect(keyCommand(key('v'), features, true)).toEqual({ type: 'tool', tool: 'select' });
  });
});

describe('isApplePlatform', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the platform from the browser', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    expect(isApplePlatform()).toBe(true);
    vi.stubGlobal('navigator', { platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' });
    expect(isApplePlatform()).toBe(true);
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' }, platform: 'Win32', userAgent: '' });
    expect(isApplePlatform()).toBe(false);
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: '', userAgent: '' });
    expect(isApplePlatform()).toBe(true);
    vi.stubGlobal('navigator', undefined);
    expect(isApplePlatform()).toBe(false);
  });
});

describe('tools', () => {
  it('classifies tools', () => {
    expect(SHAPE_TOOLS.every(isShapeTool)).toBe(true);
    expect(LINE_TOOLS.every(isLineTool)).toBe(true);
    expect(isShapeTool('arrow')).toBe(false);
    expect(isLineTool('rectangle')).toBe(false);
    for (const tool of SHAPE_TOOLS) {
      const { kind, lockAspect } = shapeOfTool(tool);
      expect(toolOfShape(kind, lockAspect)).toBe(tool);
    }
    expect(['select', 'pen', 'highlighter', 'eraser'].every((tool) => staysActiveAfterUse(tool as 'pen'))).toBe(true);
    expect(staysActiveAfterUse('rectangle')).toBe(false);
    expect(staysActiveAfterUse('text')).toBe(false);
  });
});

describe('selectionOverlay', () => {
  const overlayOf = (item: MarkupItem, document: MarkupDocument = boardWith([item]), zoom = 1) =>
    selectionOverlay(item, document, (p) => P(p.x * zoom, p.y * zoom), zoom, noActions);

  it('gives boxes eight resize handles and a rotation knob', () => {
    const rect = createShapeItem('rectangle', { x: 0, y: 100, width: 200, height: 100 }, itemStyle());
    const overlay = overlayOf(rect);
    expect(overlay.handles).toHaveLength(9);
    expect(overlay.outline).toEqual([P(0, 100), P(200, 100), P(200, 200), P(0, 200)]);
    expect(overlay.rotationLine).toEqual([P(100, 100), P(100, 72)]);
    expect(overlay.bounds).toEqual({ x: 0, y: 72, width: 200, height: 128 });
    expect(handleAt(overlay, P(103, 75))).toEqual({ kind: 'rotate' });
    expect(handleAt(overlay, P(200, 200))).toEqual({ kind: 'resize', u: 1, v: 1 });
    expect(handleAt(overlay, P(100, 150))).toBeNull();
    expect(handleAt(null, P(0, 0))).toBeNull();
  });

  it('gives small boxes fewer handles', () => {
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 200, height: 100 }, itemStyle());
    // 50 points on screen: the four corners.
    expect(overlayOf(rect, undefined, 0.5).handles).toHaveLength(5);
    // 30 points: one corner.
    const tiny = overlayOf(rect, undefined, 0.3);
    expect(tiny.handles.map((handle) => handle.kind)).toEqual([{ kind: 'resize', u: 1, v: 1 }, { kind: 'rotate' }]);
  });

  it('gives text side handles only and locked items none', () => {
    const text = createTextItem('Hello', P(0, 0), { font: DEFAULT_FONT, color: MarkupColors.red, measurer });
    expect(overlayOf(text).handles.map((handle) => handle.kind)).toEqual([
      { kind: 'resize', u: 0, v: 0.5 },
      { kind: 'resize', u: 1, v: 0.5 },
      { kind: 'rotate' },
    ]);
    const locked = overlayOf({ ...text, isLocked: true });
    expect(locked.handles).toEqual([]);
    expect(locked.locked).toBe(true);
    expect(locked.rotationLine).toBeNull();
    expect(locked.outline).toHaveLength(4);
  });

  it('marks bound ends and the active point of lines', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 400, height: 300 } }]);
    const photo = board.items[0]!;
    const line = createLineItem(P(200, 150), P(900, 900), itemStyle());
    const connector: MarkupItem = {
      ...line,
      content: {
        ...line.content,
        start: { ...line.content.start, binding: { itemID: photo.id, anchor: P(0.5, 0.5) } },
      },
    };
    const document = { ...board, items: [...board.items, connector] };
    const overlay = overlayOf(connector, document);
    expect(overlay.dots.map((dot) => dot.style)).toEqual(['bound', 'normal']);
    expect(overlay.outline).toBeNull();
    expect(overlay.insertHandles).toEqual([]);

    const curve = createCurveItem([P(0, 0), P(100, 50), P(200, 0)], itemStyle());
    const active = selectionOverlay(curve, boardWith([curve]), identity, 1, { ...noActions, activeVertex: 1 });
    expect(active.dots.map((dot) => dot.style)).toEqual(['normal', 'active', 'normal']);
    expect(active.insertHandles).toHaveLength(2);
    // Curves can swing outside their points.
    expect(active.bounds!.height).toBeGreaterThanOrEqual(50);
  });

  it('skips "+" handles on short segments and while drawing', () => {
    const polyline = createPolylineItem([P(0, 0), P(40, 0), P(200, 0)], itemStyle());
    const overlay = overlayOf(polyline);
    expect(overlay.insertHandles).toEqual([P(120, 0)]);
    const drawing = selectionOverlay(polyline, boardWith([polyline]), identity, 1, { ...noActions, isDrawing: true });
    expect(drawing.insertHandles).toEqual([]);
    expect(drawing.pinsActionBarToBottom).toBe(true);
    expect(overlayOf({ ...polyline, isLocked: true }).handles).toEqual([]);
  });
});

describe('actionsFor', () => {
  const all = MarkupFeatures.all;
  const options = { isDrawingPolyline: false, activeVertex: null };

  it('offers point actions on polylines and curves', () => {
    const open = createPolylineItem([P(0, 0), P(50, 50), P(100, 0)], itemStyle());
    expect(actionsFor(open, all, options)).toEqual([
      'closePath',
      'duplicate',
      'bringToFront',
      'sendToBack',
      'lock',
      'delete',
    ]);
    expect(actionsFor(open, all, { ...options, activeVertex: 1 }).slice(0, 2)).toEqual(['deletePoint', 'closePath']);
    const closed = createPolylineItem([P(0, 0), P(50, 50), P(100, 0)], itemStyle(), { closed: true });
    expect(actionsFor(closed, all, options)[0]).toBe('openPath');
    const two = createCurveItem([P(0, 0), P(100, 0)], itemStyle());
    expect(actionsFor(two, all, { ...options, activeVertex: 0 })[0]).toBe('duplicate');
    expect(actionsFor(two, all, { ...options, isDrawingPolyline: true })).toEqual(['finishPath']);
    expect(actionsFor(open, all, { ...options, isDrawingPolyline: true })).toEqual(['finishPath', 'closePath']);
    const straight = createLineItem(P(0, 0), P(100, 0), itemStyle());
    expect(actionsFor(straight, all, options)[0]).toBe('duplicate');
  });

  it('drops actions turned off, but never Unlock', () => {
    const features = MarkupFeatures.all
      .with('bringToFront', false)
      .with('sendToBack', false)
      .with('delete', false)
      .with('lock', false);
    const rect = createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle());
    expect(actionsFor(rect, features, options)).toEqual(['duplicate']);
    expect(actionsFor({ ...rect, isLocked: true }, features, options)).toEqual(['unlock']);
  });
});

describe('action bar', () => {
  const overlay = (bounds: SelectionOverlay['bounds'], count = 3, pinned = false): SelectionOverlay => ({
    itemID: 'X',
    locked: false,
    outline: null,
    rotationLine: null,
    handles: [],
    dots: [],
    insertHandles: [],
    bounds,
    actions: Array.from({ length: count }, () => 'delete' as const),
    pinsActionBarToBottom: pinned,
  });
  const view = { width: 800, height: 600 };

  it('measures its buttons', () => {
    expect(actionBarSize(3)).toEqual({ width: 3 * ACTION_BUTTON_SIZE + 4 + 12, height: ACTION_BUTTON_SIZE + 4 });
    expect(actionBarSize(0)).toEqual({ width: 12, height: ACTION_BUTTON_SIZE + 4 });
  });

  it('sits above the selection, below it when there is no room, and on screen', () => {
    const size = actionBarSize(3);
    expect(actionBarOrigin(overlay({ x: 300, y: 300, width: 200, height: 100 }), view)).toEqual({
      x: 400 - size.width / 2,
      y: 300 - size.height - 14,
    });
    expect(actionBarOrigin(overlay({ x: 300, y: 20, width: 200, height: 100 }), view)?.y).toBe(134);
    expect(actionBarOrigin(overlay({ x: -50, y: 300, width: 60, height: 100 }), view)?.x).toBe(8);
    expect(actionBarOrigin(overlay({ x: 0, y: 0, width: 800, height: 600 }), view, { top: 50, bottom: 40 })?.y).toBe(
      600 - 40 - size.height - 8,
    );
  });

  it('pins to the bottom while drawing and hides off screen or without actions', () => {
    const size = actionBarSize(2);
    expect(
      actionBarOrigin(overlay({ x: 0, y: 0, width: 10, height: 10 }, 2, true), view, { top: 0, bottom: 30 }),
    ).toEqual({ x: (800 - size.width) / 2, y: 600 - 30 - size.height - 12 });
    expect(actionBarOrigin(overlay({ x: 900, y: 300, width: 10, height: 10 }), view)).toBeNull();
    expect(actionBarOrigin(overlay({ x: 300, y: -200, width: 10, height: 10 }), view)).toBeNull();
    expect(actionBarOrigin(overlay({ x: 300, y: 300, width: 10, height: 10 }, 0), view)).toBeNull();
    expect(actionBarOrigin(overlay(null), view)).toBeNull();
  });
});

describe('Viewport', () => {
  const photo = createImageDocument({ assetID: 'a', pixelSize: { width: 1024, height: 768 } });

  it('scrolls the photo in image mode and a large square on boards', () => {
    const viewport = new Viewport();
    viewport.configure(photo);
    expect(viewport.clipsToContent).toBe(true);
    expect(viewport.contentBounds).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    expect(viewport.fitRect(photo)).toEqual(viewport.contentBounds);
    viewport.configure(createBoardDocument());
    expect(viewport.clipsToContent).toBe(false);
    expect(viewport.contentBounds).toEqual({ x: -10000, y: -10000, width: 20000, height: 20000 });
    // An empty board shows an 800×600 area around the origin.
    expect(viewport.fitRect(createBoardDocument())).toEqual({ x: -400, y: -300, width: 800, height: 600 });
  });

  it('fits with 16-point insets and limits the zoom around the fit', () => {
    const viewport = new Viewport();
    viewport.configure(photo);
    expect(viewport.fitZoom({ x: 0, y: 0, width: 100, height: 100 })).toBe(1);
    viewport.size = { width: 1056, height: 900 };
    const fit = viewport.fitZoom(viewport.fitRect(photo));
    expect(fit).toBe(1);
    viewport.updateLimits(photo);
    expect([viewport.minimumZoom, viewport.maximumZoom]).toEqual([0.5, 8]);
    viewport.zoomToFit(photo);
    expect(viewport.zoom).toBe(1);
    // Smaller than the view: centered.
    expect([viewport.offsetX, viewport.offsetY]).toEqual([16, 66]);
    viewport.zoomAround(P(16, 66), 100);
    expect(viewport.zoom).toBe(8);
    // Larger than the view: never scrolled past its edges.
    expect(viewport.offsetX).toBeCloseTo(0, 9);
    expect(viewport.offsetY).toBeCloseTo(0, 9);
    viewport.panBy(-100000, -100000);
    expect([viewport.offsetX, viewport.offsetY]).toEqual([1056 - 1024 * 8, 900 - 768 * 8]);
    expect(viewport.screenToCanvas(viewport.canvasToScreen(P(12, 34)))).toEqual(P(12, 34));
  });

  it('keeps the visible area above the keyboard', () => {
    const viewport = new Viewport();
    const board = boardWith([createShapeItem('rectangle', { x: 0, y: 0, width: 100, height: 100 }, itemStyle())]);
    viewport.configure(board);
    viewport.size = { width: 800, height: 600 };
    viewport.updateLimits(board);
    expect(viewport.minimumZoom).toBe(0.05);
    expect(viewport.maximumZoom).toBe(4);
    viewport.zoom = 1;
    viewport.keyboardInset = 300;
    viewport.centerOn(P(0, 0));
    expect([viewport.offsetX, viewport.offsetY]).toEqual([400, 150]);
    viewport.zoomToRect({ x: 0, y: 0, width: 0, height: 0 });
    expect(viewport.zoom).toBe(1);
  });
});
