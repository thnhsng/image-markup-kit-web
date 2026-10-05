import { carryChildren } from '../geometry/attachments';
import { detachReferences, refreshCachedEndpoints } from '../geometry/bindings';
import { boxBoundingRect, boxCenter, boxOffset } from '../geometry/box';
import { arrangementFrames, BOARD_GAP, type BoardArrangement } from '../geometry/board-layout';
import { isNullRect, NULL_RECT, unionRect } from '../geometry/rect';
import { add } from '../geometry/vec';
import { appendImages } from '../model/board';
import {
  BOARD_IMAGE_HEIGHT,
  findItem,
  imageItems,
  modelEquals,
  normalizeZOrder,
  updateItem,
  withItemBox,
} from '../model/document';
import { STANDARD_STYLE_DEFAULTS } from '../model/style';
import { swiftRound } from '../model/swift-math';
import type {
  ArrowHead,
  ImageItem,
  ImageSource,
  ItemStyle,
  LineContent,
  MarkupDocument,
  MarkupItem,
  Point,
  Rect,
  StyleDefaults,
  TextContent,
  UUIDString,
} from '../model/types';
import { createUUID } from '../model/uuid';
import { defaultTextMeasurer, type TextMeasurer } from '../text/measurer';
import { fitTextContent } from '../text/text-layout';
import { isShapeTool, shapeOfTool, type MarkupTool } from './tools';

/** What an undo step does, for the Undo/Redo menu titles (looked up in the strings table). */
export type MarkupActionName =
  | 'add'
  | 'delete'
  | 'duplicate'
  | 'bringToFront'
  | 'sendToBack'
  | 'lock'
  | 'unlock'
  | 'style'
  | 'move'
  | 'resize'
  | 'rotate'
  | 'draw'
  | 'highlight'
  | 'addShape'
  | 'addArrow'
  | 'moveEndpoint'
  | 'addPolyline'
  | 'addCurve'
  | 'addPoint'
  | 'movePoint'
  | 'deletePoint'
  | 'closeShape'
  | 'openShape'
  | 'addText'
  | 'editText'
  | 'erase'
  | 'arrange'
  | 'addImages';

/** What changed in the editor state. */
export type EditorChange = 'document' | 'selection' | 'tool' | 'undoState' | 'defaults';

interface UndoEntry {
  readonly document: MarkupDocument;
  readonly selection: readonly UUIDString[];
  readonly actionName: MarkupActionName;
}

const UNDO_LEVELS = 100;
/** Commits with the same coalescing key within this time share one undo step (a slider drag). */
const COALESCING_WINDOW_MS = 1500;

/**
 * Editor state (EditorStore.swift): the committed document, a transient preview shown during gestures, the
 * selection, the tool and the style defaults. Every commit is one undo step holding a whole-document snapshot
 * (the model is immutable, so snapshots are cheap).
 */
export class EditorStore {
  private documentValue: MarkupDocument;
  private previewValue: MarkupDocument | null = null;
  private selectionValue: readonly UUIDString[] = [];
  private toolValue: MarkupTool = 'select';
  private defaultsValue: StyleDefaults;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private lastCoalescingKey: string | null = null;
  private lastCommitTime = 0;
  private readonly listeners = new Set<(changes: ReadonlySet<EditorChange>) => void>();
  private versionValue = 0;
  readonly measurer: TextMeasurer;
  private readonly now: () => number;

  constructor(
    document: MarkupDocument,
    options: { defaults?: StyleDefaults; measurer?: TextMeasurer; now?: () => number } = {},
  ) {
    this.documentValue = refreshCachedEndpoints(normalizeZOrder(document));
    this.defaultsValue = options.defaults ?? STANDARD_STYLE_DEFAULTS;
    this.measurer = options.measurer ?? defaultTextMeasurer();
    this.now = options.now ?? (() => Date.now());
  }

  // ------------------------------------------------------------------------------------------------------------
  // Observation (for React's useSyncExternalStore)

  subscribe(listener: (changes: ReadonlySet<EditorChange>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Increases on every change. */
  get version(): number {
    return this.versionValue;
  }

  private notify(...changes: EditorChange[]): void {
    this.versionValue += 1;
    const set = new Set(changes);
    for (const listener of [...this.listeners]) listener(set);
  }

  // ------------------------------------------------------------------------------------------------------------
  // State

  get document(): MarkupDocument {
    return this.documentValue;
  }

  /** Shown instead of `document` while a gesture is in progress. */
  get preview(): MarkupDocument | null {
    return this.previewValue;
  }

  get displayed(): MarkupDocument {
    return this.previewValue ?? this.documentValue;
  }

  get selection(): readonly UUIDString[] {
    return this.selectionValue;
  }

  get tool(): MarkupTool {
    return this.toolValue;
  }

  set tool(tool: MarkupTool) {
    if (tool === this.toolValue) return;
    this.toolValue = tool;
    this.notify('tool');
  }

  get defaults(): StyleDefaults {
    return this.defaultsValue;
  }

  set defaults(defaults: StyleDefaults) {
    if (modelEquals(defaults, this.defaultsValue)) return;
    this.defaultsValue = defaults;
    this.notify('defaults');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** "Has changes" means "Undo is available": undoing everything leaves nothing to discard. */
  get hasChanges(): boolean {
    return this.canUndo;
  }

  get undoActionName(): MarkupActionName | null {
    return this.undoStack[this.undoStack.length - 1]?.actionName ?? null;
  }

  get redoActionName(): MarkupActionName | null {
    return this.redoStack[this.redoStack.length - 1]?.actionName ?? null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Preview and commit

  setPreview(document: MarkupDocument | null): void {
    this.previewValue = document;
    this.notify('document');
  }

  /**
   * Commits a new document as one undo step. Consecutive commits with the same `coalescingKey` within 1.5 s share
   * one undo step. A commit that changes nothing only updates the selection.
   */
  commit(
    newDocument: MarkupDocument,
    actionName: MarkupActionName,
    options: { coalescingKey?: string; select?: readonly UUIDString[] } = {},
  ): void {
    const next = refreshCachedEndpoints(normalizeZOrder(newDocument));
    this.previewValue = null;
    const resolvedSelection = (options.select ?? this.selectionValue).filter((id) => findItem(next, id) !== undefined);
    if (modelEquals(next, this.documentValue)) {
      const selectionChanged = !sameIDs(resolvedSelection, this.selectionValue);
      this.selectionValue = resolvedSelection;
      if (selectionChanged) this.notify('document', 'selection');
      else this.notify('document');
      return;
    }
    const now = this.now();
    const key = options.coalescingKey ?? null;
    const coalesce =
      key !== null &&
      key === this.lastCoalescingKey &&
      now - this.lastCommitTime < COALESCING_WINDOW_MS &&
      this.canUndo;
    if (!coalesce) {
      this.undoStack.push({ document: this.documentValue, selection: this.selectionValue, actionName });
      if (this.undoStack.length > UNDO_LEVELS) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastCoalescingKey = key;
    this.lastCommitTime = now;
    this.documentValue = next;
    this.selectionValue = resolvedSelection;
    this.notify('document', 'selection', 'undoState');
  }

  /** Applies `change` to the committed document and commits the result. */
  perform(
    actionName: MarkupActionName,
    change: (document: MarkupDocument) => MarkupDocument,
    options: { coalescingKey?: string; select?: readonly UUIDString[] } = {},
  ): void {
    this.commit(change(this.documentValue), actionName, options);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ document: this.documentValue, selection: this.selectionValue, actionName: entry.actionName });
    this.restore(entry);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ document: this.documentValue, selection: this.selectionValue, actionName: entry.actionName });
    this.restore(entry);
  }

  private restore(entry: UndoEntry): void {
    this.documentValue = entry.document;
    this.selectionValue = entry.selection.filter((id) => findItem(entry.document, id) !== undefined);
    this.previewValue = null;
    this.lastCoalescingKey = null;
    this.notify('document', 'selection', 'undoState');
  }

  /** Ends the current coalescing run (e.g. when a slider is released). */
  endCoalescing(): void {
    this.lastCoalescingKey = null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Selection

  select(ids: readonly UUIDString[]): void {
    const filtered = ids.filter(
      (id) => findItem(this.documentValue, id) !== undefined && id !== this.documentValue.backgroundItemID,
    );
    if (sameIDs(filtered, this.selectionValue)) return;
    this.selectionValue = filtered;
    this.notify('selection');
  }

  clearSelection(): void {
    this.select([]);
  }

  get selectedItems(): MarkupItem[] {
    return this.selectionValue.flatMap((id) => {
      const item = findItem(this.displayed, id);
      return item ? [item] : [];
    });
  }

  /** The selected item when exactly one is selected (the editor shows chrome for one item). */
  get selectedItem(): MarkupItem | null {
    const id = this.selectionValue.length === 1 ? this.selectionValue[0] : undefined;
    return (id !== undefined && findItem(this.displayed, id)) || null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Item operations

  /** Deletes the unlocked selected items; line ends bound to them freeze in place, attached marks become free. */
  deleteSelection(): void {
    const ids = new Set(this.selectedItems.filter((item) => !item.isLocked).map((item) => item.id));
    if (ids.size === 0) return;
    this.perform(
      'delete',
      (document) => detachReferences({ ...document, items: document.items.filter((item) => !ids.has(item.id)) }, ids),
      { select: [] },
    );
  }

  /** Copies the selection 24 units down and right; copies are unlocked, and copied lines are free. */
  duplicateSelection(): void {
    const originals = this.selectedItems.filter((item) => item.id !== this.documentValue.backgroundItemID);
    if (originals.length === 0) return;
    const offset: Point = { x: 24, y: 24 };
    const copies = originals.map((original): MarkupItem => {
      const copy = { ...original, id: createUUID(), isLocked: false };
      if (copy.type === 'line') {
        const line = copy.content;
        return {
          ...copy,
          content: {
            ...line,
            start: { point: add(line.start.point, offset), binding: null },
            end: { point: add(line.end.point, offset), binding: null },
            waypoints: line.waypoints.map((point) => add(point, offset)),
          },
        };
      }
      return withItemBox(copy, boxOffset(copy.content.box, offset));
    });
    this.perform('duplicate', (document) => ({ ...document, items: [...document.items, ...copies] }), {
      select: copies.map((copy) => copy.id),
    });
  }

  /** Moves the selection to the top or the bottom of its band (photos always stay below annotations). */
  moveSelection(direction: 'front' | 'back'): void {
    const ids = new Set(this.selectionValue);
    if (ids.size === 0) return;
    this.perform(direction === 'front' ? 'bringToFront' : 'sendToBack', (document) => {
      const moving = document.items.filter((item) => ids.has(item.id));
      const rest = document.items.filter((item) => !ids.has(item.id));
      return { ...document, items: direction === 'front' ? [...rest, ...moving] : [...moving, ...rest] };
    });
  }

  /** Unlocks when every selected item is locked, locks otherwise. */
  toggleLockOnSelection(): void {
    const ids = new Set(this.selectionValue);
    if (ids.size === 0) return;
    const lock = !this.selectedItems.every((item) => item.isLocked);
    this.perform(lock ? 'lock' : 'unlock', (document) => ({
      ...document,
      items: document.items.map((item) => (ids.has(item.id) ? { ...item, isLocked: lock } : item)),
    }));
  }

  // ------------------------------------------------------------------------------------------------------------
  // Board

  /** Re-lays out the board's photos; annotations attached to a photo move with it. One undo step. */
  arrange(arrangement: BoardArrangement): void {
    const source = this.documentValue;
    if (source.kind !== 'board') return;
    const band = BOARD_IMAGE_HEIGHT + BOARD_GAP;
    const images = imageItems(source)
      .map((item, index) => ({ item, index, center: boxCenter(item.content.box) }))
      .sort((a, b) => {
        const rowA = swiftRound(a.center.y / band);
        const rowB = swiftRound(b.center.y / band);
        if (rowA !== rowB) return rowA - rowB;
        return a.center.x === b.center.x ? a.index - b.index : a.center.x - b.center.x;
      })
      .map((entry) => entry.item);
    if (images.length === 0) return;
    const union = images.reduce((rect, item) => unionRect(rect, boxBoundingRect(item.content.box)), NULL_RECT);
    const origin = isNullRect(union) ? { x: 0, y: 0 } : { x: union.x, y: union.y };
    const frames = arrangementFrames(
      images.map((item) => item.content.pixelSize),
      arrangement,
      origin,
    );
    let result = source;
    images.forEach((image, index) => {
      const moved: ImageItem = {
        ...image,
        content: { ...image.content, box: { frame: frames[index] as Rect, rotation: 0 } },
      };
      result = updateItem(result, image.id, () => moved);
      result = carryChildren(image, moved, source, result);
    });
    this.commit(result, 'arrange');
  }

  /** Adds photos to the board after the existing ones; selects the new photo when there is one. */
  addImages(sources: readonly ImageSource[]): void {
    if (this.documentValue.kind !== 'board' || sources.length === 0) return;
    const { document, ids } = appendImages(this.documentValue, sources);
    this.commit(document, 'addImages', { select: ids.length === 1 ? ids : [] });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Styles

  /** The style shown in the style panels: the selection's, or the active tool's defaults. */
  get currentStyle(): ItemStyle {
    const item = this.selectedItem;
    if (item) return item.style;
    return styleForTool(this.defaultsValue, this.toolValue);
  }

  /** Text attributes shown in the Text Style panel. */
  get currentTextContent(): TextContent {
    const item = this.selectedItem;
    if (item?.type === 'text') return item.content;
    const isNote = this.toolValue === 'note';
    const defaults = this.defaultsValue;
    return {
      text: '',
      font: isNote ? defaults.noteFont : defaults.textFont,
      color: isNote ? defaults.noteTextColor : defaults.textColor,
      alignment: defaults.textAlignment,
      fixedWidth: null,
      padding: isNote ? 16 : 8,
      box: { frame: { x: 0, y: 0, width: 0, height: 0 }, rotation: 0 },
    };
  }

  get currentArrowHeads(): { start: ArrowHead; end: ArrowHead } {
    const item = this.selectedItem;
    if (item?.type === 'line') return { start: item.content.startHead, end: item.content.endHead };
    const defaults = this.defaultsValue;
    return this.toolValue === 'polyline' || this.toolValue === 'curve'
      ? { start: defaults.pathStartHead, end: defaults.pathEndHead }
      : { start: defaults.lineStartHead, end: defaults.lineEndHead };
  }

  /**
   * Edits the style of the selection (undoable) and makes it the default for new items of that kind. With nothing
   * selected, only the active tool's default changes.
   */
  updateStyle(change: (style: ItemStyle) => ItemStyle, coalescingKey?: string): void {
    const items = this.selectedItems;
    if (items.length === 0) {
      this.defaults = withToolStyle(this.defaultsValue, this.toolValue, change(this.currentStyle));
      return;
    }
    const ids = new Set(items.map((item) => item.id));
    this.perform(
      'style',
      (document) => ({
        ...document,
        items: document.items.map((item) => (ids.has(item.id) ? { ...item, style: change(item.style) } : item)),
      }),
      { coalescingKey },
    );
    const updated = this.selectedItem;
    if (updated) this.adoptDefaults(updated);
  }

  /** Edits text attributes of the selected text items (boxes re-fitted), or the text defaults. */
  updateText(change: (content: TextContent) => TextContent, coalescingKey?: string): void {
    const items = this.selectedItems.filter((item) => item.type === 'text');
    if (items.length === 0) {
      const content = change(this.currentTextContent);
      const isNote = this.toolValue === 'note';
      this.defaults = {
        ...this.defaultsValue,
        ...(isNote
          ? { noteFont: content.font, noteTextColor: content.color }
          : { textFont: content.font, textColor: content.color }),
        textAlignment: content.alignment,
      };
      return;
    }
    const ids = new Set(items.map((item) => item.id));
    this.perform(
      'style',
      (document) => ({
        ...document,
        items: document.items.map((item) =>
          ids.has(item.id) && item.type === 'text'
            ? { ...item, content: fitTextContent(change(item.content), this.measurer) }
            : item,
        ),
      }),
      { coalescingKey },
    );
    const updated = this.selectedItem;
    if (updated) this.adoptDefaults(updated);
  }

  /** Sets the arrowheads of the selected lines and the defaults of their kind (arrows, or polylines and curves). */
  updateArrowHeads(start: ArrowHead, end: ArrowHead): void {
    const lines = this.selectedItems.filter((item): item is MarkupItem & { type: 'line' } => item.type === 'line');
    const first = lines[0];
    const isPath = first
      ? first.content.kind !== 'straight'
      : this.toolValue === 'polyline' || this.toolValue === 'curve';
    this.defaults = isPath
      ? { ...this.defaultsValue, pathStartHead: start, pathEndHead: end }
      : { ...this.defaultsValue, lineStartHead: start, lineEndHead: end };
    if (lines.length === 0) return;
    const ids = new Set(lines.map((item) => item.id));
    this.perform('style', (document) => ({
      ...document,
      items: document.items.map((item) =>
        ids.has(item.id) && item.type === 'line'
          ? { ...item, content: { ...item.content, startHead: start, endHead: end } }
          : item,
      ),
    }));
  }

  // ------------------------------------------------------------------------------------------------------------
  // Line points

  /**
   * Removes point `index` (0 = start) of a polyline or curve. A line keeps at least two points; removing an end
   * promotes the next point, which is free; a closed line left with fewer than three points opens.
   */
  removeLinePoint(index: number, itemID: UUIDString): void {
    const item = findItem(this.documentValue, itemID);
    if (!item || item.isLocked || item.type !== 'line' || item.content.kind === 'straight') return;
    const line = item.content;
    const points = [line.start.point, ...line.waypoints, line.end.point];
    if (points.length <= 2 || index < 0 || index >= points.length) return;
    points.splice(index, 1);
    let content: LineContent = { ...line, waypoints: points.slice(1, -1) };
    if (index === 0) content = { ...content, start: { point: points[0] as Point, binding: null } };
    if (index === points.length)
      content = { ...content, end: { point: points[points.length - 1] as Point, binding: null } };
    if (points.length < 3) content = { ...content, isClosed: false };
    this.perform('deletePoint', (document) =>
      updateItem(document, itemID, (current) => ({ ...current, content }) as MarkupItem),
    );
  }

  /** Joins (or separates) the last and the first point of a polyline or curve. Closing drops the end bindings. */
  setLineClosed(closed: boolean, itemID: UUIDString): void {
    const item = findItem(this.documentValue, itemID);
    if (!item || item.isLocked || item.type !== 'line' || item.content.kind === 'straight') return;
    const line = item.content;
    const count = line.waypoints.length + 2;
    if (line.isClosed === closed || (closed && count < 3)) return;
    const content: LineContent = closed
      ? { ...line, isClosed: true, start: { ...line.start, binding: null }, end: { ...line.end, binding: null } }
      : { ...line, isClosed: false };
    this.perform(closed ? 'closeShape' : 'openShape', (document) =>
      updateItem(document, itemID, (current) => ({ ...current, content }) as MarkupItem),
    );
  }

  /** The last styled item sets the look of the next one of its kind (Preview behavior). */
  private adoptDefaults(item: MarkupItem): void {
    const defaults = this.defaultsValue;
    switch (item.type) {
      case 'shape':
        this.defaults =
          item.content.kind === 'highlightBox'
            ? { ...defaults, highlightBox: item.style }
            : { ...defaults, shape: item.style };
        return;
      case 'line':
        this.defaults = { ...defaults, line: item.style };
        return;
      case 'stroke':
        this.defaults = item.content.isHighlighter
          ? { ...defaults, highlighter: item.style }
          : { ...defaults, pen: item.style };
        return;
      case 'text':
        this.defaults =
          item.style.fillColor !== null
            ? {
                ...defaults,
                note: item.style,
                noteFont: item.content.font,
                noteTextColor: item.content.color,
                textAlignment: item.content.alignment,
              }
            : {
                ...defaults,
                text: item.style,
                textFont: item.content.font,
                textColor: item.content.color,
                textAlignment: item.content.alignment,
              };
        return;
      case 'image':
        return;
    }
  }
}

function sameIDs(a: readonly UUIDString[], b: readonly UUIDString[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** The default style a tool draws with (Select and Eraser show the shape default). */
export function styleForTool(defaults: StyleDefaults, tool: MarkupTool): ItemStyle {
  if (tool === 'pen') return defaults.pen;
  if (tool === 'highlighter') return defaults.highlighter;
  if (isShapeTool(tool)) return shapeOfTool(tool).kind === 'highlightBox' ? defaults.highlightBox : defaults.shape;
  if (tool === 'arrow' || tool === 'polyline' || tool === 'curve') return defaults.line;
  if (tool === 'text') return defaults.text;
  if (tool === 'note') return defaults.note;
  return defaults.shape;
}

function withToolStyle(defaults: StyleDefaults, tool: MarkupTool, style: ItemStyle): StyleDefaults {
  if (tool === 'pen') return { ...defaults, pen: style };
  if (tool === 'highlighter') return { ...defaults, highlighter: style };
  if (isShapeTool(tool)) {
    return shapeOfTool(tool).kind === 'highlightBox'
      ? { ...defaults, highlightBox: style }
      : { ...defaults, shape: style };
  }
  if (tool === 'arrow' || tool === 'polyline' || tool === 'curve') return { ...defaults, line: style };
  if (tool === 'text') return { ...defaults, text: style };
  if (tool === 'note') return { ...defaults, note: style };
  return { ...defaults, shape: style };
}
