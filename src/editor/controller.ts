import { reassignParents } from '../geometry/attachments';
import { resolvedPoints } from '../geometry/bindings';
import { boxCenter } from '../geometry/box';
import { itemAt } from '../geometry/hit-testing';
import type { BoardArrangement } from '../geometry/board-layout';
import { distance, midpoint } from '../geometry/vec';
import { MarkupFeatures } from '../features/features';
import { findItem, modelEquals, updateItem } from '../model/document';
import { swiftRound } from '../model/swift-math';
import type {
  ImageSource,
  ItemStyle,
  MarkupDocument,
  Rect,
  MarkupItem,
  Point,
  StyleDefaults,
  TextContent,
  UUIDString,
} from '../model/types';
import type { TextMeasurer } from '../text/measurer';
import { fitTextContent } from '../text/text-layout';
import {
  LineInsertInteraction,
  LineVertexInteraction,
  makeToolInteraction,
  MoveInteraction,
  PolylineDraft,
  ResizeInteraction,
  RotateInteraction,
  type CanvasInteraction,
  type InteractionEnvironment,
} from './interactions';
import { keyCommand, type KeyInput } from './keyboard';
import { actionsFor, handleAt, selectionOverlay, type SelectionAction, type SelectionOverlay } from './overlay';
import { EditorStore } from './store';
import { staysActiveAfterUse, type MarkupTool } from './tools';
import { Viewport } from './viewport';

// Routes pointers, keys and toolbar actions to the store and the interactions (InteractionController.swift and the
// editor parts of MarkupEditorViewController.swift), and holds the transient UI state the view draws.

/** One pointer event in screen coordinates (relative to the canvas element). */
export interface PointerInput {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** `mouse`, `pen` or `touch`. */
  readonly pointerType: string;
  /** Milliseconds. */
  readonly timeStamp: number;
  /** Mouse button (1 = middle). */
  readonly button?: number;
  /** Coalesced positions since the last event (oldest first). */
  readonly coalesced?: readonly Point[];
  readonly predicted?: readonly Point[];
}

export interface WheelInput {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl or ⌘ held, or a trackpad pinch (which browsers report as a wheel event with ctrlKey). */
  readonly zoom: boolean;
}

/** The style panels of the toolbar. */
export type PanelKind = 'shapeStyle' | 'borderColor' | 'fillColor' | 'textStyle';

/** The text box being edited in place. */
export interface TextEditingSession {
  readonly itemID: UUIDString;
  readonly isNew: boolean;
  readonly text: string;
}

export interface ToolbarState {
  readonly tool: MarkupTool;
  readonly strokeColor: string | null;
  readonly fillColor: string | null;
  readonly strokeEnabled: boolean;
  readonly fillEnabled: boolean;
  readonly textEnabled: boolean;
}

const TAP_SLOP = 6;
const PINCH_WINDOW_MS = 250;
const PINCH_TRAVEL = 20;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE = 12;

interface TrackedPointer {
  readonly id: number;
  readonly start: Point;
  current: Point;
  readonly startTime: number;
  readonly tapCount: number;
  hasMoved: boolean;
  /** `interaction`: the pointer drives an interaction; `pan`: it scrolls the canvas; `none`: it is ignored. */
  readonly mode: 'interaction' | 'pan' | 'none';
}

interface Pinch {
  readonly ids: readonly [number, number];
  lastMid: Point;
  lastDistance: number;
}

interface TextSessionState {
  readonly itemID: UUIDString;
  readonly isNew: boolean;
  baseDocument: MarkupDocument;
  readonly originalContent: TextContent;
  text: string;
}

export class EditorController implements InteractionEnvironment {
  readonly store: EditorStore;
  readonly viewport = new Viewport();
  readonly polylineDraft = new PolylineDraft();
  readonly features: MarkupFeatures;
  activeLineVertex: { readonly itemID: UUIDString; readonly index: number } | null = null;

  // Transient UI state.
  penPreview: { readonly points: readonly Point[]; readonly style: ItemStyle } | null = null;
  eraserCursor: { readonly center: Point; readonly radius: number } | null = null;
  bindTargetID: UUIDString | null = null;
  hiddenItemIDs: readonly UUIDString[] = [];
  openPanel: PanelKind | null = null;
  isExporting = false;
  /** A gesture is in progress (the action bar hides). */
  isInteracting = false;

  private active: CanvasInteraction | null = null;
  private tracked: TrackedPointer | null = null;
  private readonly pointers = new Map<number, Point>();
  private pinch: Pinch | null = null;
  private tapTarget: { readonly id: UUIDString; readonly wasSelected: boolean } | null = null;
  private previousActiveVertex: { readonly itemID: UUIDString; readonly index: number } | null = null;
  private lastTap: { readonly point: Point; readonly time: number; readonly count: number } | null = null;
  private textSession: TextSessionState | null = null;
  private readonly listeners = new Set<() => void>();
  private versionValue = 0;
  private needsInitialZoom = true;

  constructor(
    document: MarkupDocument,
    options: { features?: MarkupFeatures; defaults?: StyleDefaults; measurer?: TextMeasurer; now?: () => number } = {},
  ) {
    this.features = options.features ?? MarkupFeatures.all;
    this.store = new EditorStore(document, {
      defaults: options.defaults,
      measurer: options.measurer,
      now: options.now,
    });
    this.viewport.configure(this.store.document);
    this.polylineDraft.onChange = () => this.changed();
    this.store.subscribe((changes) => {
      // Leaving the Polyline tool ends the polyline being drawn (its points are already committed).
      if (changes.has('tool') && this.store.tool !== 'polyline') this.polylineDraft.reset();
      // Undo can remove the polyline being drawn, or points of the line whose point is marked.
      if (changes.has('document')) this.polylineDraft.validate(this.store.document);
      const active = this.activeLineVertex;
      if (
        changes.has('selection') &&
        active &&
        !(this.store.selection.length === 1 && this.store.selection[0] === active.itemID)
      ) {
        this.activeLineVertex = null;
      }
      this.changed();
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Observation

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get version(): number {
    return this.versionValue;
  }

  private changed(): void {
    this.versionValue += 1;
    for (const listener of [...this.listeners]) listener();
  }

  // ------------------------------------------------------------------------------------------------------------
  // InteractionEnvironment

  get zoom(): number {
    return Math.max(this.viewport.zoom, 0.01);
  }

  get tolerance(): number {
    return 10 / this.zoom;
  }

  setPenPreview(preview: { readonly points: readonly Point[]; readonly style: ItemStyle } | null): void {
    this.penPreview = preview;
    this.changed();
  }

  setEraserCursor(cursor: { readonly center: Point; readonly radius: number } | null): void {
    this.eraserCursor = cursor;
    this.changed();
  }

  setBindTarget(item: MarkupItem | null): void {
    const id = item?.id ?? null;
    if (id === this.bindTargetID) return;
    this.bindTargetID = id;
    this.changed();
  }

  setHiddenItems(ids: readonly UUIDString[]): void {
    this.hiddenItemIDs = ids.slice();
    this.changed();
  }

  finishCreating(id: UUIDString, keepTool: boolean): void {
    this.store.select([id]);
    if (!keepTool && !staysActiveAfterUse(this.store.tool)) this.store.tool = 'select';
  }

  finishPolyline(close = false): void {
    const id = this.polylineDraft.itemID;
    this.polylineDraft.reset();
    if (id === null || !findItem(this.store.document, id)) return;
    if (close) this.store.setLineClosed(true, id);
    this.finishCreating(id, false);
  }

  isEditingText(): boolean {
    return this.textSession !== null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Text editing (TextEditingController.swift)

  /** The box being edited, with its current text. */
  get textEditing(): TextEditingSession | null {
    const session = this.textSession;
    return session ? { itemID: session.itemID, isNew: session.isNew, text: session.text } : null;
  }

  /** Starts editing a text item in place (`isNew`: a box just created, removed again if left empty). */
  beginTextEditing(id: UUIDString, isNew: boolean): void {
    // New text is always typed in place; editing existing text can be turned off.
    if (!isNew && !this.features.isEnabled('editText')) return;
    if (this.textSession) this.endTextEditing();
    const item = findItem(this.store.displayed, id);
    if (!item || item.type !== 'text' || item.isLocked) return;
    this.textSession = {
      itemID: id,
      isNew,
      baseDocument: this.store.displayed,
      originalContent: item.content,
      text: item.content.text,
    };
    this.store.select([id]);
    this.hiddenItemIDs = [id];
    this.changed();
  }

  /** The text typed so far (the box grows with it). */
  setEditingText(text: string): void {
    const session = this.textSession;
    if (!session) return;
    session.text = text;
    this.store.setPreview(this.documentWithText(text, session));
    this.revealEditedText();
  }

  /** Screen frame of the text box being edited (it is edited unrotated). */
  get editingFrame(): Rect | null {
    const content = this.editingContent;
    if (!content) return null;
    const center = this.viewport.canvasToScreen(boxCenter(content.box));
    const zoom = this.viewport.zoom;
    const width = content.box.frame.width * zoom;
    const height = content.box.frame.height * zoom;
    return { x: center.x - width / 2, y: center.y - height / 2, width, height };
  }

  /** Scrolls the box being edited back into view when it reaches under the keyboard or above the top. */
  private revealEditedText(): void {
    const frame = this.editingFrame;
    const content = this.editingContent;
    if (!frame || !content) return;
    const visibleHeight = this.viewport.size.height - this.viewport.keyboardInset;
    if (frame.y + frame.height > visibleHeight - 12 || frame.y < 12) {
      this.viewport.centerOn(boxCenter(content.box));
      this.changed();
    }
  }

  /** Applies a text-attribute change (font size, color…) to the box being edited. */
  applyTextChange(change: (content: TextContent) => TextContent): void {
    const session = this.textSession;
    if (!session) return;
    session.baseDocument = updateItem(session.baseDocument, session.itemID, (item) =>
      item.type === 'text' ? { ...item, content: change(item.content) } : item,
    );
    this.store.setPreview(this.documentWithText(session.text, session));
  }

  /** Applies a style change (fill, border…) to the box being edited. */
  applyStyleChange(change: (style: ItemStyle) => ItemStyle): void {
    const session = this.textSession;
    if (!session) return;
    session.baseDocument = updateItem(session.baseDocument, session.itemID, (item) => ({
      ...item,
      style: change(item.style),
    }));
    this.store.setPreview(this.documentWithText(session.text, session));
  }

  /** The content of the box being edited, as displayed. */
  get editingContent(): TextContent | null {
    const session = this.textSession;
    const item = session ? findItem(this.store.displayed, session.itemID) : undefined;
    return item?.type === 'text' ? item.content : null;
  }

  get editingStyle(): ItemStyle | null {
    const session = this.textSession;
    return session ? (findItem(this.store.displayed, session.itemID)?.style ?? null) : null;
  }

  /** Commits the edit: one undo step; an emptied box is deleted; an empty new box leaves no trace. */
  endTextEditing(): void {
    const session = this.textSession;
    if (!session) return;
    this.textSession = null;
    this.hiddenItemIDs = [];
    this.viewport.keyboardInset = 0;
    const id = session.itemID;
    let document = this.documentWithText(session.text, session);
    const isEmpty = session.text.trim() === '';
    if (session.isNew) {
      if (isEmpty) {
        this.store.setPreview(null);
        this.store.clearSelection();
      } else {
        document = reassignParents(document, [id]);
        this.store.commit(document, 'addText', { select: [id] });
        this.finishCreating(id, false);
      }
    } else if (isEmpty) {
      this.store.commit({ ...document, items: document.items.filter((item) => item.id !== id) }, 'delete', {
        select: [],
      });
    } else {
      const edited = findItem(document, id);
      if (edited?.type === 'text' && !modelEquals(edited.content, session.originalContent)) {
        this.store.commit(document, 'editText', { select: [id] });
      } else {
        this.store.setPreview(null);
      }
    }
    this.changed();
  }

  /** The A− and A+ buttons above the keyboard: 15% smaller or larger, between 8 and 400 points. */
  adjustEditingFontSize(larger: boolean): void {
    this.applyTextChange((content) => {
      const size = larger
        ? Math.min(400, swiftRound(content.font.size * 1.15))
        : Math.max(8, swiftRound(content.font.size / 1.15));
      return { ...content, font: { ...content.font, size } };
    });
  }

  /** The B button above the keyboard. */
  toggleEditingBold(): void {
    this.applyTextChange((content) => ({ ...content, font: { ...content.font, bold: !content.font.bold } }));
  }

  /** How much of the canvas an on-screen keyboard covers, while text is edited. */
  setKeyboardInset(inset: number): void {
    if (!this.textSession) return;
    const value = Math.max(0, inset);
    if (Math.abs(this.viewport.keyboardInset - value) <= 0.5) return;
    this.viewport.keyboardInset = value;
    this.viewport.clampOffset();
    this.changed();
    this.revealEditedText();
  }

  private documentWithText(text: string, session: TextSessionState): MarkupDocument {
    return updateItem(session.baseDocument, session.itemID, (item) =>
      item.type === 'text'
        ? { ...item, content: fitTextContent({ ...item.content, text }, this.store.measurer) }
        : item,
    );
  }

  // ------------------------------------------------------------------------------------------------------------
  // Tools, panels, actions

  /** Picks a tool (ignored when turned off); ends text editing, closes the panel and ends the polyline being drawn. */
  selectTool(tool: MarkupTool): void {
    if (!this.features.allows(tool)) return;
    // A shortcut pressed mid-gesture drops the gesture.
    if (this.tracked?.mode === 'interaction') this.stopTracking();
    this.endTextEditing();
    this.dismissPanel();
    this.polylineDraft.reset();
    if (tool !== 'select') this.store.clearSelection();
    this.store.tool = tool;
  }

  /** Opens a style panel (closing it when it is already open); ends text editing like the iOS editor. */
  togglePanel(kind: PanelKind): void {
    if (this.openPanel === kind) {
      this.dismissPanel();
      return;
    }
    this.endTextEditing();
    this.openPanel = kind;
    this.changed();
  }

  dismissPanel(): void {
    if (this.openPanel === null) return;
    this.openPanel = null;
    this.changed();
  }

  undo(): void {
    this.endTextEditing();
    this.store.undo();
  }

  redo(): void {
    this.endTextEditing();
    this.store.redo();
  }

  /** Whether `item` is the polyline being drawn with the Polyline tool. */
  isDrawingPolyline(item: MarkupItem): boolean {
    return this.store.tool === 'polyline' && this.polylineDraft.itemID === item.id;
  }

  /** The marked point of `item`, if it still exists. */
  activeVertexOf(item: MarkupItem): number | null {
    const active = this.activeLineVertex;
    if (!active || active.itemID !== item.id || item.type !== 'line') return null;
    return active.index < item.content.waypoints.length + 2 ? active.index : null;
  }

  /** Actions of the floating bar for the selected item. */
  get selectionActions(): SelectionAction[] {
    const item = this.store.selectedItem;
    if (!item) return [];
    return actionsFor(item, this.features, {
      isDrawingPolyline: this.isDrawingPolyline(item),
      activeVertex: this.activeVertexOf(item),
    });
  }

  performAction(action: SelectionAction): void {
    const item = this.store.selectedItem;
    switch (action) {
      case 'editText':
        if (item) this.beginTextEditing(item.id, false);
        return;
      case 'duplicate':
        this.store.duplicateSelection();
        return;
      case 'bringToFront':
        this.store.moveSelection('front');
        return;
      case 'sendToBack':
        this.store.moveSelection('back');
        return;
      case 'lock':
      case 'unlock':
        this.store.toggleLockOnSelection();
        return;
      case 'delete':
        this.store.deleteSelection();
        return;
      case 'finishPath':
        this.finishPolyline();
        return;
      case 'closePath':
      case 'openPath':
        if (!item) return;
        if (this.isDrawingPolyline(item)) this.finishPolyline(action === 'closePath');
        else this.store.setLineClosed(action === 'closePath', item.id);
        return;
      case 'deletePoint': {
        const index = item ? this.activeVertexOf(item) : null;
        if (!item || index === null) return;
        this.activeLineVertex = null;
        this.store.removeLinePoint(index, item.id);
        return;
      }
    }
  }

  /** Toolbar state: the colors shown on the Border and Fill buttons and which style buttons are enabled. */
  get toolbarState(): ToolbarState {
    const style = this.editingStyle ?? this.store.currentStyle;
    const item = this.store.selectedItem;
    const tool = this.store.tool;
    let fillEnabled: boolean;
    let textEnabled: boolean;
    if (item) {
      fillEnabled =
        item.type === 'shape' ||
        item.type === 'text' ||
        (item.type === 'line' && (item.content.isClosed || this.isDrawingPolyline(item)));
      textEnabled = item.type === 'text';
    } else {
      fillEnabled = !['pen', 'highlighter', 'arrow', 'curve', 'eraser'].includes(tool);
      textEnabled = tool === 'text' || tool === 'note' || tool === 'select';
    }
    return {
      tool,
      strokeColor: style.strokeColor,
      fillColor: style.fillColor,
      strokeEnabled: tool !== 'eraser',
      fillEnabled,
      textEnabled: textEnabled || this.isEditingText(),
    };
  }

  /** Selection chrome in screen coordinates (none while text is edited). */
  get overlay(): SelectionOverlay | null {
    const item = this.textSession ? null : this.store.selectedItem;
    if (!item) return null;
    return selectionOverlay(item, this.store.displayed, (p) => this.viewport.canvasToScreen(p), this.viewport.zoom, {
      actions: this.selectionActions,
      activeVertex: this.activeVertexOf(item),
      isDrawing: this.isDrawingPolyline(item),
    });
  }

  /** Before exporting: ends text editing, closes the panel, ends the polyline and clears the selection. */
  prepareForExport(): void {
    this.resetPointers();
    this.endTextEditing();
    this.dismissPanel();
    this.polylineDraft.reset();
    this.store.clearSelection();
  }

  /** Marks an export in progress: pointers and shortcuts are ignored meanwhile. */
  setExporting(exporting: boolean): void {
    if (this.isExporting === exporting) return;
    this.isExporting = exporting;
    this.changed();
  }

  /** Redraws everything (e.g. after web fonts finished loading). */
  refresh(): void {
    this.changed();
  }

  /** Before cancelling: ends text editing, closes the panel and ends the polyline. True when there is work to discard. */
  prepareForCancel(): boolean {
    this.endTextEditing();
    this.dismissPanel();
    this.polylineDraft.reset();
    return this.store.hasChanges;
  }

  /** Re-lays out the board's photos (one undo step) and shows them all. */
  arrange(arrangement: BoardArrangement): void {
    this.endTextEditing();
    this.store.arrange(arrangement);
    this.zoomToFit();
  }

  /** Adds photos to the board and shows them all. */
  addImages(sources: readonly ImageSource[]): void {
    this.endTextEditing();
    this.store.addImages(sources);
    this.zoomToFit();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Keyboard

  /**
   * Handles a key press; returns true when it was a shortcut (the view then prevents the default action and stops
   * propagation, so e.g. Esc does not also close a host's dialog). Off while text is being edited.
   */
  handleKey(input: KeyInput, apple: boolean): boolean {
    if (this.textSession) return false;
    const command = keyCommand(input, this.features, apple);
    if (!command) return false;
    // While exporting, shortcuts do nothing but still stop here (Esc must not close the host's dialog).
    if (this.isExporting) return true;
    switch (command.type) {
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'zoomToFit':
        this.zoomToFit();
        break;
      case 'duplicate':
        this.store.duplicateSelection();
        break;
      case 'delete':
        this.store.deleteSelection();
        break;
      case 'tool':
        this.selectTool(command.tool);
        break;
      case 'escape':
        this.dismissPanel();
        if (this.polylineDraft.isActive) this.finishPolyline();
        else if (this.store.tool !== 'select') this.selectTool('select');
        else this.store.clearSelection();
        break;
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Viewport

  /** The canvas element was laid out at a new size (zooms to fit the first time it has a size). */
  setViewportSize(width: number, height: number): void {
    if (!(width > 1) || !(height > 1)) return;
    if (!this.needsInitialZoom && width === this.viewport.size.width && height === this.viewport.size.height) return;
    this.viewport.size = { width, height };
    this.viewport.updateLimits(this.store.document);
    if (this.needsInitialZoom) {
      this.needsInitialZoom = false;
      this.viewport.zoomToFit(this.store.document);
    }
    this.changed();
  }

  zoomToFit(): void {
    this.viewport.updateLimits(this.store.document);
    this.viewport.zoomToFit(this.store.document);
    this.changed();
  }

  /** Zooms keeping the canvas point under `screenPoint` in place (a trackpad pinch). */
  zoomAround(screenPoint: Point, zoom: number): void {
    this.viewport.zoomAround(screenPoint, zoom);
    this.changed();
  }

  wheel(input: WheelInput): void {
    if (input.zoom) {
      this.viewport.zoomAround({ x: input.x, y: input.y }, this.viewport.zoom * Math.exp(-input.deltaY / 200));
    } else {
      this.viewport.panBy(-input.deltaX, -input.deltaY);
    }
    this.changed();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Pointers (CanvasTouchRecognizer.swift and InteractionController.swift)

  pointerDown(input: PointerInput): void {
    if (this.isExporting) return;
    // The same pointer going down again means its release was lost.
    if (this.pointers.has(input.id)) this.pointerCancel(input);
    const point = { x: input.x, y: input.y };
    this.pointers.set(input.id, point);
    if (this.pointers.size >= 2) {
      this.startPinch(input.timeStamp);
      return;
    }
    const lastTap = this.lastTap;
    const tapCount =
      lastTap &&
      input.timeStamp - lastTap.time <= DOUBLE_TAP_MS &&
      distance(lastTap.point, point) <= DOUBLE_TAP_DISTANCE
        ? lastTap.count + 1
        : 1;
    let mode: TrackedPointer['mode'];
    if (input.button === 1) {
      mode = 'pan';
    } else if (this.textSession) {
      // A pointer outside the text being edited finishes the edit and does nothing else (it can still scroll in
      // Select mode, where one finger scrolls, and a tap there still clears the selection).
      this.endTextEditing();
      mode = this.store.tool === 'select' ? 'pan' : 'none';
    } else {
      mode = this.shouldTrack(point) ? 'interaction' : 'pan';
    }
    this.tracked = {
      id: input.id,
      start: point,
      current: point,
      startTime: input.timeStamp,
      tapCount,
      hasMoved: false,
      mode,
    };
    if (mode === 'interaction') {
      // Any pointer deselects the tapped line point; tapping a point sets it again.
      this.previousActiveVertex = this.activeLineVertex;
      this.activeLineVertex = null;
      const start = this.viewport.screenToCanvas(point);
      this.active = this.makeInteraction(start, point);
      this.active?.begin(start);
      this.isInteracting = true;
      this.changed();
    }
  }

  pointerMove(input: PointerInput): void {
    if (!this.pointers.has(input.id)) return;
    const point = { x: input.x, y: input.y };
    this.pointers.set(input.id, point);
    if (this.pinch) {
      this.updatePinch();
      return;
    }
    const tracked = this.tracked;
    if (!tracked || tracked.id !== input.id) return;
    const previous = tracked.current;
    tracked.current = point;
    if (!tracked.hasMoved && distance(point, tracked.start) > TAP_SLOP) tracked.hasMoved = true;
    if (tracked.mode === 'none') return;
    if (tracked.mode === 'pan') {
      this.viewport.panBy(point.x - previous.x, point.y - previous.y);
      this.changed();
      return;
    }
    const samples = (input.coalesced && input.coalesced.length > 0 ? input.coalesced : [point]).map((p) =>
      this.viewport.screenToCanvas(p),
    );
    const predicted = (input.predicted ?? []).map((p) => this.viewport.screenToCanvas(p));
    this.active?.move(this.viewport.screenToCanvas(point), samples, predicted);
  }

  pointerUp(input: PointerInput): void {
    if (!this.pointers.has(input.id)) return;
    this.pointers.delete(input.id);
    if (this.pinch) {
      this.restartPinch();
      return;
    }
    const tracked = this.tracked;
    if (!tracked || tracked.id !== input.id) return;
    const point = { x: input.x, y: input.y };
    tracked.current = point;
    if (!tracked.hasMoved && distance(point, tracked.start) > TAP_SLOP) tracked.hasMoved = true;
    this.tracked = null;
    if (!tracked.hasMoved) this.lastTap = { point: tracked.start, time: input.timeStamp, count: tracked.tapCount };
    if (tracked.mode === 'interaction') {
      this.endInteraction(tracked);
    } else if (!tracked.hasMoved && this.store.tool === 'select' && !this.textSession) {
      // A tap on empty canvas clears the selection.
      this.store.clearSelection();
    }
  }

  /** The tracked pointer was released (or a second finger came late): the interaction ends, taps act. */
  private endInteraction(tracked: TrackedPointer): void {
    this.active?.end(this.viewport.screenToCanvas(tracked.current));
    this.active = null;
    if (!tracked.hasMoved) this.handleTap(tracked.tapCount);
    this.tapTarget = null;
    this.isInteracting = false;
    this.changed();
  }

  pointerCancel(input: PointerInput): void {
    this.pointers.delete(input.id);
    if (this.pinch) this.restartPinch();
    if (this.tracked?.id === input.id) this.stopTracking();
  }

  /** Drops the tracked pointer and cancels its interaction (later events of that pointer are ignored). */
  private stopTracking(): void {
    this.tracked = null;
    this.cancelActiveInteraction();
  }

  /** Forgets every pointer (before exporting). */
  private resetPointers(): void {
    this.stopTracking();
    this.pointers.clear();
    this.pinch = null;
  }

  /** Stops the gesture in progress (e.g. when the tool changes). */
  cancelActiveInteraction(): void {
    this.active?.cancel();
    this.active = null;
    this.tapTarget = null;
    if (this.isInteracting) {
      this.isInteracting = false;
      this.changed();
    }
  }

  private startPinch(time: number): void {
    const tracked = this.tracked;
    if (tracked) {
      this.tracked = null;
      if (tracked.mode === 'interaction') {
        // A second finger early and nearly still: the user is pinching, so drop what was drawn. Later, it ends it.
        if (time - tracked.startTime < PINCH_WINDOW_MS && distance(tracked.current, tracked.start) < PINCH_TRAVEL) {
          this.cancelActiveInteraction();
        } else {
          this.endInteraction(tracked);
        }
      }
    }
    this.restartPinch();
  }

  /** Pinches with the first two pointers down (again when a finger of a three-finger pinch lifts), or stops. */
  private restartPinch(): void {
    const [a, b] = [...this.pointers.entries()];
    this.pinch =
      a && b ? { ids: [a[0], b[0]], lastMid: midpoint(a[1], b[1]), lastDistance: distance(a[1], b[1]) } : null;
  }

  private updatePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const a = this.pointers.get(pinch.ids[0]);
    const b = this.pointers.get(pinch.ids[1]);
    if (!a || !b) return;
    const mid = midpoint(a, b);
    const spread = distance(a, b);
    if (pinch.lastDistance > 0 && spread > 0) {
      this.viewport.zoomAround(pinch.lastMid, this.viewport.zoom * (spread / pinch.lastDistance));
    }
    this.viewport.panBy(mid.x - pinch.lastMid.x, mid.y - pinch.lastMid.y);
    pinch.lastMid = mid;
    pinch.lastDistance = spread;
    this.changed();
  }

  private shouldTrack(screenPoint: Point): boolean {
    if (this.store.tool !== 'select') return true;
    if (handleAt(this.overlay, screenPoint) !== null) return true;
    return itemAt(this.viewport.screenToCanvas(screenPoint), this.store.displayed, this.tolerance) !== null;
  }

  private makeInteraction(point: Point, screenPoint: Point): CanvasInteraction | null {
    const store = this.store;
    const handle = handleAt(this.overlay, screenPoint);
    const draftID = this.polylineDraft.itemID;
    if (
      store.tool === 'polyline' &&
      draftID !== null &&
      store.selectedItem?.id === draftID &&
      handle?.kind === 'lineVertex'
    ) {
      // While drawing a polyline, dragging one of its middle points moves it; touches near the first or last point
      // still add, close or finish.
      const item = findItem(store.document, draftID);
      const count = item?.type === 'line' ? item.content.waypoints.length + 2 : 0;
      if (handle.index > 0 && handle.index < count - 1) return new LineVertexInteraction(this, draftID, handle.index);
    }
    if (store.tool !== 'select') return makeToolInteraction(store.tool, this);
    const selected = store.selectedItem;
    if (handle && selected) {
      switch (handle.kind) {
        case 'resize':
          return new ResizeInteraction(this, selected.id, handle.u, handle.v);
        case 'rotate':
          return new RotateInteraction(this, selected.id);
        case 'lineVertex':
          return this.vertexInteraction(selected, handle.index);
        case 'lineInsert':
          return new LineInsertInteraction(this, selected.id, handle.index);
      }
    }
    const item = itemAt(point, store.displayed, this.tolerance);
    if (!item) return null;
    this.tapTarget = { id: item.id, wasSelected: store.selection.includes(item.id) };
    store.select([item.id]);
    return new MoveInteraction(this, item.id);
  }

  /** Drags a line point; tapping a point of a polyline or curve marks it, tapping it again unmarks it. */
  private vertexInteraction(item: MarkupItem, index: number): CanvasInteraction {
    const interaction = new LineVertexInteraction(this, item.id, index);
    const previous = this.previousActiveVertex;
    const wasActive = previous !== null && previous.itemID === item.id && previous.index === index;
    if (item.type === 'line' && item.content.kind !== 'straight' && !wasActive) {
      interaction.onTap = () => {
        this.activeLineVertex = { itemID: item.id, index };
        this.changed();
      };
    }
    return interaction;
  }

  /** Select mode taps: tapping a selected text item (or double-tapping one) edits it. */
  private handleTap(tapCount: number): void {
    const target = this.tapTarget;
    if (this.store.tool !== 'select' || !target) return;
    const item = findItem(this.store.document, target.id);
    if (item?.type === 'text' && !item.isLocked && (target.wasSelected || tapCount >= 2)) {
      this.beginTextEditing(item.id, false);
    }
  }

  /** Resolved points of the selected line, for tests and the debug driver. */
  linePoints(id: UUIDString): Point[] {
    const item = findItem(this.store.document, id);
    return item?.type === 'line' ? resolvedPoints(item.content, this.store.document) : [];
  }
}
