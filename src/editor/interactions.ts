import { carryChildren, reassignParents } from '../geometry/attachments';
import { bindingFor, detachReferences, resolveEndpoint, resolvedEndpoints, resolvedPoints } from '../geometry/bindings';
import { simplify } from '../geometry/geometry-math';
import { bindTargetAt, erasableItems } from '../geometry/hit-testing';
import { insertionPoints } from '../geometry/line-path';
import { rectAround, rectHeight, rectWidth } from '../geometry/rect';
import {
  creationRect,
  minimumItemSize,
  resized,
  ResizeSession,
  RotateSession,
  translated,
} from '../geometry/transform';
import { add, distance, length, midpoint, subtract } from '../geometry/vec';
import { findItem, itemBox, locksAspectRatio, updateItem, withItemBox } from '../model/document';
import { createPolylineItem, createShapeItem, createStrokeItem, createTextItem } from '../model/factories';
import type {
  Endpoint,
  ItemStyle,
  LineContent,
  LineItem,
  LineKind,
  MarkupDocument,
  MarkupItem,
  Point,
  ShapeKind,
  UUIDString,
} from '../model/types';
import { createUUID } from '../model/uuid';
import { measureTextContent } from '../text/text-layout';
import type { EditorStore } from './store';
import { isShapeTool, shapeOfTool, type MarkupTool } from './tools';

// The gestures on the canvas (SelectInteraction.swift, DrawInteractions.swift). Points are in canvas units. An
// interaction shows its progress as a preview document (or a preview layer) and commits once at the end.

export interface CanvasInteraction {
  begin(point: Point): void;
  /** `samples`: coalesced positions since the last call (oldest first); `predicted`: only for drawing previews. */
  move(point: Point, samples: readonly Point[], predicted: readonly Point[]): void;
  end(point: Point): void;
  cancel(): void;
}

/** Touch targets on screen, in points. */
export const TOUCH_RADIUS = 22;

/** Services the interactions use (InteractionEnvironment). */
export interface InteractionEnvironment {
  readonly store: EditorStore;
  /** Current zoom (screen points per canvas unit). */
  readonly zoom: number;
  /** Touch tolerance in canvas units (10 screen points). */
  readonly tolerance: number;
  readonly polylineDraft: PolylineDraft;
  /** Point of the selected polyline or curve the user tapped (offers "Delete Point"). */
  activeLineVertex: { readonly itemID: UUIDString; readonly index: number } | null;
  beginTextEditing(id: UUIDString, isNew: boolean): void;
  isEditingText(): boolean;
  endTextEditing(): void;
  /** Selects a new item and returns to Select, unless the tool is sticky. */
  finishCreating(id: UUIDString, keepTool: boolean): void;
  /** Ends the polyline being drawn (`close`: joining its last point to the first). */
  finishPolyline(close?: boolean): void;
  /** Transient drawing feedback, shown above the items. */
  setPenPreview(preview: { readonly points: readonly Point[]; readonly style: ItemStyle } | null): void;
  setEraserCursor(cursor: { readonly center: Point; readonly radius: number } | null): void;
  setBindTarget(item: MarkupItem | null): void;
  setHiddenItems(ids: readonly UUIDString[]): void;
}

/** A polyline drawn over several touches: the committed item being extended, or the first tapped point. */
export class PolylineDraft {
  /** The polyline being drawn (committed after its first segment; each further point is one undo step). */
  itemID: UUIDString | null = null;
  /** The first point, tapped before any segment exists (nothing is committed for it). */
  pendingStart: { readonly point: Point; readonly style: ItemStyle } | null = null;
  onChange: () => void = () => undefined;

  get isActive(): boolean {
    return this.itemID !== null || this.pendingStart !== null;
  }

  begin(itemID: UUIDString): void {
    this.itemID = itemID;
    this.pendingStart = null;
    this.onChange();
  }

  setPendingStart(point: Point, style: ItemStyle): void {
    this.pendingStart = { point, style };
    this.onChange();
  }

  clearPendingStart(): void {
    if (this.pendingStart === null) return;
    this.pendingStart = null;
    this.onChange();
  }

  reset(): void {
    if (!this.isActive) return;
    this.itemID = null;
    this.pendingStart = null;
    this.onChange();
  }

  /** Drops the draft when its polyline no longer exists (undone past its creation) or was closed. */
  validate(document: MarkupDocument): void {
    if (this.itemID === null) return;
    const item = findItem(document, this.itemID);
    if (!item || item.type !== 'line' || item.content.kind !== 'polyline' || item.content.isClosed) {
      this.itemID = null;
      this.onChange();
    }
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Select tool

/** Drags an item. Photos carry their attached annotations along (boards). */
export class MoveInteraction implements CanvasInteraction {
  private startDocument: MarkupDocument;
  private startPoint: Point = { x: 0, y: 0 };
  private didMove = false;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly itemID: UUIDString,
  ) {
    this.startDocument = env.store.document;
  }

  begin(point: Point): void {
    this.startDocument = this.env.store.document;
    this.startPoint = point;
  }

  move(point: Point): void {
    const item = findItem(this.startDocument, this.itemID);
    if (!item || item.isLocked) return;
    const delta = subtract(point, this.startPoint);
    if (!this.didMove && !(length(delta) * this.env.zoom > 2)) return;
    this.didMove = true;
    const moved = translated(item, delta, this.startDocument);
    const document = carryChildren(
      item,
      moved,
      this.startDocument,
      updateItem(this.startDocument, this.itemID, () => moved),
    );
    this.env.store.setPreview(document);
  }

  end(): void {
    const preview = this.env.store.preview;
    if (!this.didMove || !preview) {
      this.env.store.setPreview(null);
      return;
    }
    this.env.store.commit(reassignParents(preview, [this.itemID]), 'move');
  }

  cancel(): void {
    this.env.store.setPreview(null);
  }
}

/** Resizes the selected item from one of its handles (text: left and right only). */
export class ResizeInteraction implements CanvasInteraction {
  private startDocument: MarkupDocument;
  private session: ResizeSession | null = null;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly itemID: UUIDString,
    private readonly u: number,
    private readonly v: number,
  ) {
    this.startDocument = env.store.document;
  }

  begin(point: Point): void {
    this.startDocument = this.env.store.document;
    const item = findItem(this.startDocument, this.itemID);
    const box = item ? itemBox(item) : null;
    if (!item || !box || item.isLocked) return;
    this.session = new ResizeSession({
      box,
      u: this.u,
      v: this.v,
      touch: point,
      lockAspect: locksAspectRatio(item),
      minimumSize: minimumItemSize(this.env.zoom),
      anchorsTop: item.type === 'text',
    });
  }

  move(point: Point): void {
    const item = findItem(this.startDocument, this.itemID);
    if (!this.session || !item) return;
    const result = resized(item, this.session.box(point), this.session, (content) =>
      measureTextContent(content, this.env.store.measurer),
    );
    const document = carryChildren(
      item,
      result,
      this.startDocument,
      updateItem(this.startDocument, this.itemID, () => result),
    );
    this.env.store.setPreview(document);
  }

  end(): void {
    const preview = this.env.store.preview;
    if (!this.session || !preview) {
      this.env.store.setPreview(null);
      return;
    }
    this.env.store.commit(preview, 'resize');
  }

  cancel(): void {
    this.env.store.setPreview(null);
  }
}

/** Rotates the selected item about its center; snaps to 45° steps. */
export class RotateInteraction implements CanvasInteraction {
  private startDocument: MarkupDocument;
  private session: RotateSession | null = null;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly itemID: UUIDString,
  ) {
    this.startDocument = env.store.document;
  }

  begin(point: Point): void {
    this.startDocument = this.env.store.document;
    const item = findItem(this.startDocument, this.itemID);
    const box = item ? itemBox(item) : null;
    if (!item || !box || item.isLocked) return;
    this.session = new RotateSession(box, point);
  }

  move(point: Point): void {
    const item = findItem(this.startDocument, this.itemID);
    if (!this.session || !item) return;
    const rotated = withItemBox(item, this.session.box(point));
    const document = carryChildren(
      item,
      rotated,
      this.startDocument,
      updateItem(this.startDocument, this.itemID, () => rotated),
    );
    this.env.store.setPreview(document);
  }

  end(): void {
    const preview = this.env.store.preview;
    if (!this.session || !preview) {
      this.env.store.setPreview(null);
      return;
    }
    this.env.store.commit(preview, 'rotate');
  }

  cancel(): void {
    this.env.store.setPreview(null);
  }
}

/**
 * Drags one point of a line (0 is the start, the last index the end). The ends of an open line attach to the item
 * they are released over. A tap without dragging calls `onTap`.
 */
export class LineVertexInteraction implements CanvasInteraction {
  private startDocument: MarkupDocument;
  private startTouch: Point = { x: 0, y: 0 };
  private origin: Point | null = null;
  private didMove = false;
  onTap: (() => void) | null = null;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly itemID: UUIDString,
    private readonly index: number,
  ) {
    this.startDocument = env.store.document;
  }

  private get line(): LineContent | null {
    const item = findItem(this.startDocument, this.itemID);
    return item?.type === 'line' ? item.content : null;
  }

  private get isBindable(): boolean {
    const line = this.line;
    return line !== null && !line.isClosed && (this.index === 0 || this.index === line.waypoints.length + 1);
  }

  begin(point: Point): void {
    this.startDocument = this.env.store.document;
    this.startTouch = point;
    const item = findItem(this.startDocument, this.itemID);
    if (!item || item.isLocked || item.type !== 'line') return;
    const points = resolvedPoints(item.content, this.startDocument);
    this.origin = points[this.index] ?? null;
  }

  move(point: Point): void {
    if (!this.origin) return;
    if (!this.didMove && !(distance(point, this.startTouch) * this.env.zoom > 3)) return;
    this.didMove = true;
    // Keep the pointer's offset from the point, so the point does not jump under it.
    const position = add(this.origin, subtract(point, this.startTouch));
    if (this.isBindable) {
      this.env.setBindTarget(bindTargetAt(position, this.startDocument, this.env.tolerance, new Set([this.itemID])));
    }
    this.update({ point: position, binding: null });
  }

  end(point: Point): void {
    this.env.setBindTarget(null);
    if (!this.didMove || !this.origin) {
      this.env.store.setPreview(null);
      if (!this.didMove) this.onTap?.();
      return;
    }
    const position = add(this.origin, subtract(point, this.startTouch));
    let endpoint: Endpoint = { point: position, binding: null };
    if (this.isBindable) {
      const target = bindTargetAt(position, this.startDocument, this.env.tolerance, new Set([this.itemID]));
      const binding = target ? bindingFor(position, target, 12 / this.env.zoom) : null;
      if (binding) endpoint = { point: position, binding };
    }
    this.update(endpoint);
    const preview = this.env.store.preview;
    if (preview) {
      const isEnd = this.index === 0 || this.index === (this.line?.waypoints.length ?? 0) + 1;
      this.env.store.commit(preview, isEnd ? 'moveEndpoint' : 'movePoint');
    }
  }

  cancel(): void {
    this.env.setBindTarget(null);
    this.env.store.setPreview(null);
  }

  private update(endpoint: Endpoint): void {
    const item = findItem(this.startDocument, this.itemID);
    if (!item || item.isLocked || item.type !== 'line') return;
    let line = item.content;
    if (this.index === 0) {
      line = { ...line, start: endpoint };
    } else if (this.index === line.waypoints.length + 1) {
      line = { ...line, end: endpoint };
    } else if (this.index - 1 >= 0 && this.index - 1 < line.waypoints.length) {
      const waypoints = line.waypoints.slice();
      waypoints[this.index - 1] = endpoint.point;
      line = { ...line, waypoints };
    } else {
      return;
    }
    const content = line;
    this.env.store.setPreview(
      updateItem(this.startDocument, this.itemID, (current) => ({ ...current, content }) as MarkupItem),
    );
  }
}

/** The "+" handle in the middle of a polyline or curve segment: inserts a point there and drags it. */
export class LineInsertInteraction implements CanvasInteraction {
  private startDocument: MarkupDocument;
  private startTouch: Point = { x: 0, y: 0 };
  private origin: Point | null = null;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly itemID: UUIDString,
    /** Segment from point `segment` to point `segment + 1` (for closed lines, the last one returns to the start). */
    private readonly segment: number,
  ) {
    this.startDocument = env.store.document;
  }

  begin(point: Point): void {
    this.startDocument = this.env.store.document;
    this.startTouch = point;
    const item = findItem(this.startDocument, this.itemID);
    if (!item || item.isLocked || item.type !== 'line' || item.content.kind === 'straight') return;
    const handles = insertionPoints(
      resolvedPoints(item.content, this.startDocument),
      item.content.kind,
      item.content.isClosed,
    );
    const handle = handles[this.segment];
    if (!handle) return;
    this.origin = handle;
    this.update(handle);
  }

  move(point: Point): void {
    if (this.origin) this.update(add(this.origin, subtract(point, this.startTouch)));
  }

  end(point: Point): void {
    if (!this.origin) return;
    this.update(add(this.origin, subtract(point, this.startTouch)));
    const preview = this.env.store.preview;
    if (preview) this.env.store.commit(preview, 'addPoint');
  }

  cancel(): void {
    this.env.store.setPreview(null);
  }

  private update(position: Point): void {
    const item = findItem(this.startDocument, this.itemID);
    if (!item || item.type !== 'line') return;
    const line = item.content;
    let content: LineContent;
    if (this.segment <= line.waypoints.length) {
      const waypoints = line.waypoints.slice();
      waypoints.splice(this.segment, 0, position);
      content = { ...line, waypoints };
    } else {
      // Closing segment (end → start): the old end becomes a waypoint and the new point the end.
      content = {
        ...line,
        waypoints: [...line.waypoints, resolveEndpoint(line.end, this.startDocument)],
        end: { point: position, binding: null },
      };
    }
    this.env.store.setPreview(
      updateItem(this.startDocument, this.itemID, (current) => ({ ...current, content }) as MarkupItem),
    );
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Drawing tools

/** Freehand pen and highlighter: a preview while drawing, a simplified stroke item on release. */
export class PenInteraction implements CanvasInteraction {
  private readonly style: ItemStyle;
  private points: Point[] = [];

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly isHighlighter: boolean,
  ) {
    this.style = isHighlighter ? env.store.defaults.highlighter : env.store.defaults.pen;
  }

  begin(point: Point): void {
    this.points = [point];
    this.env.setPenPreview({ points: this.points, style: this.style });
  }

  move(_point: Point, samples: readonly Point[], predicted: readonly Point[]): void {
    const minimumDistance = 0.75 / this.env.zoom;
    for (const sample of samples) {
      if (distance(sample, this.points[this.points.length - 1] as Point) >= minimumDistance) this.points.push(sample);
    }
    this.env.setPenPreview({ points: [...this.points, ...predicted], style: this.style });
  }

  end(point: Point): void {
    if (distance(point, this.points[this.points.length - 1] as Point) > 0) this.points.push(point);
    const item = createStrokeItem(simplify(this.points, 0.5 / this.env.zoom), this.style, this.isHighlighter);
    const document = reassignParents({ ...this.env.store.document, items: [...this.env.store.document.items, item] }, [
      item.id,
    ]);
    this.env.store.commit(document, this.isHighlighter ? 'highlight' : 'draw');
    this.env.setPenPreview(null);
  }

  cancel(): void {
    this.env.setPenPreview(null);
  }
}

/** Drags out a shape; a tap inserts a default-size shape (160×120, or 140×140 for circles and squares). */
export class ShapeCreateInteraction implements CanvasInteraction {
  private readonly itemID = createUUID();
  private start: Point = { x: 0, y: 0 };
  private startDocument: MarkupDocument;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly kind: ShapeKind,
    private readonly lockAspect: boolean,
  ) {
    this.startDocument = env.store.document;
  }

  private get style(): ItemStyle {
    return this.kind === 'highlightBox' ? this.env.store.defaults.highlightBox : this.env.store.defaults.shape;
  }

  begin(point: Point): void {
    this.start = point;
    this.startDocument = this.env.store.document;
  }

  move(point: Point): void {
    const rect = creationRect(this.start, point, this.lockAspect);
    if (!(Math.max(rectWidth(rect), rectHeight(rect)) * this.env.zoom > 4)) return;
    this.env.store.setPreview(this.documentWith(rect));
  }

  end(point: Point): void {
    let rect = creationRect(this.start, point, this.lockAspect);
    const minimum = minimumItemSize(this.env.zoom);
    if (rectWidth(rect) < minimum || rectHeight(rect) < minimum) {
      rect = rectAround(this.start, this.lockAspect ? { width: 140, height: 140 } : { width: 160, height: 120 });
    }
    this.env.store.commit(reassignParents(this.documentWith(rect), [this.itemID]), 'addShape', {
      select: [this.itemID],
    });
    this.env.finishCreating(this.itemID, false);
  }

  cancel(): void {
    this.env.store.setPreview(null);
  }

  private documentWith(rect: ReturnType<typeof creationRect>): MarkupDocument {
    const item = { ...createShapeItem(this.kind, rect, this.style, { lockAspect: this.lockAspect }), id: this.itemID };
    return { ...this.startDocument, items: [...this.startDocument.items, item] };
  }
}

/**
 * Lines and arrows, and curves (a line with one bend point in the middle, selected afterwards so it can be bent
 * right away). Ends that start or finish on an item attach to it.
 */
export class ArrowCreateInteraction implements CanvasInteraction {
  private readonly itemID = createUUID();
  private start: Point = { x: 0, y: 0 };
  private startTarget: MarkupItem | null = null;
  private startDocument: MarkupDocument;

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly kind: LineKind = 'straight',
  ) {
    this.startDocument = env.store.document;
  }

  begin(point: Point): void {
    this.start = point;
    this.startDocument = this.env.store.document;
    this.startTarget = bindTargetAt(point, this.startDocument, this.env.tolerance);
  }

  move(point: Point): void {
    if (!(distance(this.start, point) * this.env.zoom > 6)) return;
    this.env.setBindTarget(bindTargetAt(point, this.startDocument, this.env.tolerance));
    this.env.store.setPreview(this.documentTo(point, null));
  }

  end(point: Point): void {
    this.env.setBindTarget(null);
    if (!(distance(this.start, point) * this.env.zoom > 6)) {
      this.env.store.setPreview(null);
      return;
    }
    const endTarget = bindTargetAt(point, this.startDocument, this.env.tolerance);
    const document = reassignParents(this.documentTo(point, endTarget), [this.itemID]);
    this.env.store.commit(document, this.kind === 'curve' ? 'addCurve' : 'addArrow', { select: [this.itemID] });
    this.env.finishCreating(this.itemID, false);
  }

  cancel(): void {
    this.env.setBindTarget(null);
    this.env.store.setPreview(null);
  }

  private documentTo(point: Point, endTarget: MarkupItem | null): MarkupDocument {
    const snap = 12 / this.env.zoom;
    const defaults = this.env.store.defaults;
    const isCurve = this.kind === 'curve';
    const content: LineContent = {
      start: { point: this.start, binding: this.startTarget ? bindingFor(this.start, this.startTarget, snap) : null },
      end: { point, binding: endTarget ? bindingFor(point, endTarget, snap) : null },
      startHead: isCurve ? defaults.pathStartHead : defaults.lineStartHead,
      endHead: isCurve ? defaults.pathEndHead : defaults.lineEndHead,
      kind: this.kind,
      waypoints: [],
      isClosed: false,
    };
    const { start, end } = resolvedEndpoints(content, this.startDocument);
    const item: LineItem = {
      id: this.itemID,
      type: 'line',
      content: {
        ...content,
        start: { ...content.start, point: start },
        end: { ...content.end, point: end },
        // The bend point starts in the middle, so a new curve is straight until it is dragged.
        waypoints: isCurve ? [midpoint(start, end)] : [],
      },
      style: defaults.line,
      isLocked: false,
      parentID: null,
    };
    return { ...this.startDocument, items: [...this.startDocument.items, item] };
  }
}

/**
 * Polylines, Paint-style for fingers: each tap (or drag) adds a point, and while the pointer is down a segment
 * follows it from the last point. Tapping the last point again finishes, tapping the first point closes the shape.
 * Every point is its own undo step.
 */
export class PolylineCreateInteraction implements CanvasInteraction {
  private readonly newItemID = createUUID();
  private startDocument: MarkupDocument;
  private touchStart: Point = { x: 0, y: 0 };
  private didMove = false;

  constructor(private readonly env: InteractionEnvironment) {
    this.startDocument = env.store.document;
  }

  private get draft(): PolylineDraft {
    return this.env.polylineDraft;
  }

  /** Pointer within this distance of a point hits it (canvas units, like the handles). */
  private get snapDistance(): number {
    return TOUCH_RADIUS / this.env.zoom;
  }

  private get style(): ItemStyle {
    return this.env.store.defaults.line;
  }

  private get line(): { id: UUIDString; content: LineContent } | null {
    const id = this.draft.itemID;
    if (id === null) return null;
    const item = findItem(this.startDocument, id);
    return item?.type === 'line' ? { id, content: item.content } : null;
  }

  /** Where the segment being drawn starts. */
  private get anchor(): Point | null {
    const line = this.line;
    if (line) return resolveEndpoint(line.content.end, this.startDocument);
    return this.draft.pendingStart?.point ?? (this.didMove ? this.touchStart : null);
  }

  begin(point: Point): void {
    this.draft.validate(this.env.store.document);
    this.startDocument = this.env.store.document;
    this.touchStart = point;
    this.didMove = false;
    this.updatePreview(point);
  }

  move(point: Point): void {
    if (!this.didMove && distance(point, this.touchStart) * this.env.zoom > 6) this.didMove = true;
    this.updatePreview(point);
  }

  end(point: Point): void {
    this.env.store.setPreview(null);
    const line = this.line;
    if (line) {
      const points = resolvedPoints(line.content, this.startDocument);
      if (distance(point, points[points.length - 1] as Point) <= this.snapDistance) {
        this.env.finishPolyline();
      } else if (points.length >= 3 && distance(point, points[0] as Point) <= this.snapDistance) {
        this.env.finishPolyline(true);
      } else {
        this.env.store.commit(this.documentAppending(point, line), 'addPoint', { select: [line.id] });
      }
      return;
    }
    const pending = this.draft.pendingStart;
    if (pending) {
      // Tapping the only point again takes it back.
      if (distance(point, pending.point) <= this.snapDistance) this.draft.clearPendingStart();
      else this.create(pending.point, point);
      return;
    }
    if (this.didMove) this.create(this.touchStart, point);
    else this.draft.setPendingStart(point, this.style);
  }

  cancel(): void {
    this.env.store.setPreview(null);
  }

  private updatePreview(point: Point): void {
    const anchor = this.anchor;
    if (!anchor || !(distance(anchor, point) * this.env.zoom > 1)) {
      if (this.env.store.preview !== null) this.env.store.setPreview(null);
      return;
    }
    const line = this.line;
    this.env.store.setPreview(line ? this.documentAppending(point, line) : this.documentCreating(anchor, point));
  }

  private create(start: Point, end: Point): void {
    const document = reassignParents(this.documentCreating(start, end), [this.newItemID]);
    this.env.store.commit(document, 'addPolyline', { select: [this.newItemID] });
    this.draft.begin(this.newItemID);
  }

  private documentCreating(start: Point, end: Point): MarkupDocument {
    const defaults = this.env.store.defaults;
    const item = {
      ...createPolylineItem([start, end], this.style, {
        startHead: defaults.pathStartHead,
        endHead: defaults.pathEndHead,
      }),
      id: this.newItemID,
    };
    return { ...this.startDocument, items: [...this.startDocument.items, item] };
  }

  /** The old end becomes a (free) waypoint and `point` the new end. */
  private documentAppending(point: Point, line: { id: UUIDString; content: LineContent }): MarkupDocument {
    const content: LineContent = {
      ...line.content,
      waypoints: [...line.content.waypoints, resolveEndpoint(line.content.end, this.startDocument)],
      end: { point, binding: null },
    };
    const document = updateItem(this.startDocument, line.id, (current) => ({ ...current, content }) as MarkupItem);
    return reassignParents(document, [line.id]);
  }
}

/**
 * Text and notes: a tap creates an empty box and starts editing it in place. Nothing is committed until the text is
 * non-empty (an abandoned box leaves no undo step).
 */
export class TextCreateInteraction implements CanvasInteraction {
  private start: Point = { x: 0, y: 0 };

  constructor(
    private readonly env: InteractionEnvironment,
    private readonly isNote: boolean,
  ) {}

  begin(point: Point): void {
    this.start = point;
  }

  move(): void {
    // A text box goes where the pointer went down.
  }

  end(): void {
    const defaults = this.env.store.defaults;
    const font = this.isNote ? defaults.noteFont : defaults.textFont;
    const padding = this.isNote ? 16 : 8;
    // Put the first line's middle under the pointer.
    const origin = { x: this.start.x - padding, y: this.start.y - padding - font.size * 0.6 };
    const item = createTextItem('', origin, {
      font,
      color: this.isNote ? defaults.noteTextColor : defaults.textColor,
      alignment: defaults.textAlignment,
      fixedWidth: this.isNote ? 280 : null,
      padding,
      style: this.isNote ? defaults.note : defaults.text,
      measurer: this.env.store.measurer,
    });
    this.env.store.setPreview({ ...this.env.store.document, items: [...this.env.store.document.items, item] });
    this.env.beginTextEditing(item.id, true);
  }

  cancel(): void {
    // Nothing to undo before the pointer is released.
  }
}

/** Object eraser: removes whole annotations the pointer passes over (never photos or locked items). */
export class EraserInteraction implements CanvasInteraction {
  private last: Point = { x: 0, y: 0 };
  private erased: UUIDString[] = [];

  constructor(private readonly env: InteractionEnvironment) {}

  private get radius(): number {
    return 12 / this.env.zoom;
  }

  begin(point: Point): void {
    this.last = point;
    this.erase(point, point);
  }

  move(_point: Point, samples: readonly Point[]): void {
    for (const sample of samples) {
      this.erase(this.last, sample);
      this.last = sample;
    }
  }

  end(): void {
    this.env.setEraserCursor(null);
    const ids = new Set(this.erased);
    this.env.setHiddenItems([]);
    if (ids.size === 0) return;
    this.env.store.perform(
      'erase',
      (document) => detachReferences({ ...document, items: document.items.filter((item) => !ids.has(item.id)) }, ids),
      { select: [] },
    );
  }

  cancel(): void {
    this.env.setEraserCursor(null);
    this.env.setHiddenItems([]);
    this.erased = [];
  }

  private erase(a: Point, b: Point): void {
    this.env.setEraserCursor({ center: b, radius: this.radius });
    const fresh = erasableItems(a, b, this.radius, this.env.store.document).filter((id) => !this.erased.includes(id));
    if (fresh.length === 0) return;
    this.erased.push(...fresh);
    this.env.setHiddenItems(this.erased);
  }
}

/** The interaction a drawing tool starts (null for Select, which the controller handles). */
export function makeToolInteraction(tool: MarkupTool, env: InteractionEnvironment): CanvasInteraction | null {
  if (tool === 'select') return null;
  if (tool === 'pen') return new PenInteraction(env, false);
  if (tool === 'highlighter') return new PenInteraction(env, true);
  if (isShapeTool(tool)) {
    const { kind, lockAspect } = shapeOfTool(tool);
    return new ShapeCreateInteraction(env, kind, lockAspect);
  }
  if (tool === 'arrow') return new ArrowCreateInteraction(env);
  if (tool === 'curve') return new ArrowCreateInteraction(env, 'curve');
  if (tool === 'polyline') return new PolylineCreateInteraction(env);
  if (tool === 'text') return new TextCreateInteraction(env, false);
  if (tool === 'note') return new TextCreateInteraction(env, true);
  return new EraserInteraction(env);
}
