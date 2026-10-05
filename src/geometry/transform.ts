import { withItemBox } from '../model/document';
import { ULP_OF_ONE } from '../model/swift-math';
import type { Box, MarkupDocument, MarkupItem, Point, Rect, Size, TextContent } from '../model/types';
import { resolvedEndpoints } from './bindings';
import { boxCenter, boxOffset, toWorld } from './box';
import { snapAngle } from './geometry-math';
import { boundingRect, minX, minY, rectAround, rectHeight, rectWidth } from './rect';
import { add, rotate, subtract } from './vec';

// Moving, resizing and rotating items (TransformMath.swift).

/** Selection handles. */
export type HandleKind =
  /** Resize handle at normalized position (u, v) ∈ {0, ½, 1}² of the box. */
  | { readonly kind: 'resize'; readonly u: number; readonly v: number }
  | { readonly kind: 'rotate' }
  /** A point of a line: 0 is the start, the last index the end. */
  | { readonly kind: 'lineVertex'; readonly index: number }
  /** The "+" in the middle of segment i (point i → i + 1) of a polyline or curve. */
  | { readonly kind: 'lineInsert'; readonly index: number };

/** The eight resize handles, clockwise from the top-left corner. */
export const ALL_RESIZE_HANDLES: readonly HandleKind[] = [
  { kind: 'resize', u: 0, v: 0 },
  { kind: 'resize', u: 0.5, v: 0 },
  { kind: 'resize', u: 1, v: 0 },
  { kind: 'resize', u: 1, v: 0.5 },
  { kind: 'resize', u: 1, v: 1 },
  { kind: 'resize', u: 0.5, v: 1 },
  { kind: 'resize', u: 0, v: 1 },
  { kind: 'resize', u: 0, v: 0.5 },
];

/** Resizing a (possibly rotated) box from one handle; the opposite point (the anchor) stays fixed in world space. */
export class ResizeSession {
  readonly original: Box;
  readonly u: number;
  readonly v: number;
  readonly lockAspect: boolean;
  readonly minimumSize: number;
  /** Text grows downward: its vertical anchor is always the top edge. */
  readonly anchorsTop: boolean;
  private readonly anchor: Point;
  private readonly anchorWorld: Point;
  private readonly grabOffset: Point;

  constructor(options: {
    box: Box;
    u: number;
    v: number;
    touch: Point;
    lockAspect: boolean;
    minimumSize: number;
    anchorsTop?: boolean;
  }) {
    const { box, u, v, touch } = options;
    this.original = box;
    this.u = u;
    this.v = v;
    this.lockAspect = options.lockAspect;
    this.minimumSize = options.minimumSize;
    this.anchorsTop = options.anchorsTop ?? false;
    this.anchor = { x: 1 - u, y: this.anchorsTop ? 0 : 1 - v };
    const frame = box.frame;
    const at = (n: Point) =>
      toWorld(box, { x: minX(frame) + n.x * rectWidth(frame), y: minY(frame) + n.y * rectHeight(frame) });
    this.anchorWorld = at(this.anchor);
    this.grabOffset = subtract(at({ x: u, y: v }), touch);
  }

  /** The resized box for the current pointer position. Width and height never flip; they stop at the minimum. */
  box(touch: Point): Box {
    const w0 = Math.max(rectWidth(this.original.frame), ULP_OF_ONE);
    const h0 = Math.max(rectHeight(this.original.frame), ULP_OF_ONE);
    const d = rotate(subtract(add(touch, this.grabOffset), this.anchorWorld), -this.original.rotation);
    const sx = this.u === 0.5 ? 0 : this.u > this.anchor.x ? 1 : -1;
    const sy = this.v === 0.5 ? 0 : this.v > this.anchor.y ? 1 : -1;
    let w = w0;
    let h = h0;
    if (this.lockAspect) {
      const minimumScale = this.minimumSize / Math.min(w0, h0);
      let factor: number | null = null;
      if (sx !== 0 && sy !== 0) {
        // Project the drag onto the box diagonal.
        factor = Math.max(minimumScale, (sx * d.x * w0 + sy * d.y * h0) / (w0 * w0 + h0 * h0));
      } else if (sx !== 0) {
        factor = Math.max(minimumScale, (sx * d.x) / w0);
      } else if (sy !== 0) {
        factor = Math.max(minimumScale, (sy * d.y) / h0);
      }
      if (factor !== null) {
        w = factor * w0;
        h = factor * h0;
      }
    } else {
      if (sx !== 0) w = Math.max(this.minimumSize, sx * d.x);
      if (sy !== 0) h = Math.max(this.minimumSize, sy * d.y);
    }
    return this.placed(w, h);
  }

  /** A box of the given size positioned so the anchor keeps its world position. */
  placed(width: number, height: number): Box {
    const offset = rotate(
      { x: (this.anchor.x - 0.5) * width, y: (this.anchor.y - 0.5) * height },
      this.original.rotation,
    );
    return {
      frame: rectAround(subtract(this.anchorWorld, offset), { width, height }),
      rotation: this.original.rotation,
    };
  }
}

/** Rotating a box about its center with the rotation handle; snaps to 45° steps within 4°. */
export class RotateSession {
  readonly original: Box;
  private readonly startAngle: number;

  constructor(box: Box, touch: Point) {
    this.original = box;
    const v = subtract(touch, boxCenter(box));
    this.startAngle = Math.atan2(v.y, v.x);
  }

  box(touch: Point): Box {
    const v = subtract(touch, boxCenter(this.original));
    return {
      frame: this.original.frame,
      rotation: snapAngle(this.original.rotation + Math.atan2(v.y, v.x) - this.startAngle),
    };
  }
}

/** Rect dragged out from `start` to `point`. Aspect-locked shapes (circle, square) use the longer side. */
export function creationRect(start: Point, point: Point, lockAspect: boolean): Rect {
  if (!lockAspect) return boundingRect([start, point]);
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: dx < 0 ? start.x - side : start.x, y: dy < 0 ? start.y - side : start.y, width: side, height: side };
}

/** Moves an item by `delta`. Dragging a line's body detaches both of its ends. */
export function translated(item: MarkupItem, delta: Point, document: MarkupDocument): MarkupItem {
  if (item.type !== 'line') return withItemBox(item, boxOffset(item.content.box, delta));
  const line = item.content;
  const { start, end } = resolvedEndpoints(line, document);
  return {
    ...item,
    content: {
      ...line,
      start: { point: add(start, delta), binding: null },
      end: { point: add(end, delta), binding: null },
      waypoints: line.waypoints.map((p) => add(p, delta)),
    },
  };
}

/**
 * Replaces an item's box after a resize. Text switches to a fixed width and re-measures its height
 * (`measure` returns the box size TextLayout would give the content).
 */
export function resized(
  item: MarkupItem,
  box: Box,
  session: ResizeSession,
  measure: (content: TextContent) => Size,
): MarkupItem {
  if (item.type !== 'text') return withItemBox(item, box);
  const width = rectWidth(box.frame);
  const content: TextContent = { ...item.content, fixedWidth: width, box };
  const height = measure(content).height;
  return { ...item, content: { ...content, box: session.placed(width, height) } };
}

/** Minimum item size at a zoom level: never smaller than 8 units or 24 screen points. */
export function minimumItemSize(zoom: number): number {
  return Math.max(8, 24 / Math.max(zoom, 0.01));
}
