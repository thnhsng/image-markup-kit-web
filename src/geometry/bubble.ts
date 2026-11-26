import { findItem, updateItem } from '../model/document';
import type {
  Box,
  BubbleTail,
  BubbleTailPart,
  Endpoint,
  MarkupDocument,
  MarkupItem,
  Point,
  Rect,
  ShapeContent,
  Size,
  UUIDString,
} from '../model/types';
import { ULP_OF_ONE } from '../model/swift-math';
import { applyAffine, invertAffine } from './affine';
import { boxToWorld, toWorld } from './box';
import { PathBuilder, type Path } from './path';
import { boundingRect, minX, minY, rectAround, rectCorners, unionRect } from './rect';

// Speech bubbles (BubbleGeometry.swift). Without a tail (`ShapeContent.tail === null`) a bubble is drawn as it
// always was: the body fills the top 78% of the box and the tail's tip sits on the box's bottom edge. With a tail,
// the box is the body, a rounded rectangle, and the tail leaves the side that faces its tip, which may lie outside
// the box.

/** The body's share of the box height in a bubble without a tail. */
export const ORIGINAL_BODY_RATIO = 0.78;
/** The tail of a bubble without one, relative to its body: tip at 16% of the width, base from 26% to 42%. */
export const ORIGINAL_TAIL: BubbleTail = { tip: { x: 0.16, y: 1 / 0.78 }, width: 0.16 };
/** How far the base leans from the middle of its side toward the tip; 8/17 puts the original base back at 26–42%. */
export const TAIL_LEAN = 8 / 17;
/** The narrowest tail the width handle makes, as a fraction of the side. */
export const MINIMUM_TAIL_WIDTH = 0.04;

export type BubbleSide = 'top' | 'right' | 'bottom' | 'left';

/** Where a tail goes, in box space with the box's size made positive (see `mirrored`). */
export interface TailLayout {
  readonly side: BubbleSide;
  /** The side's length. */
  readonly length: number;
  readonly radius: number;
  /** The base's middle and width along the side, measured from its left (top and bottom) or top end. */
  readonly center: number;
  readonly width: number;
  readonly tip: Point;
  /** The tip projected onto the side, clamped to it. */
  readonly projection: number;
  readonly size: Size;
}

const isHorizontal = (side: BubbleSide): boolean => side === 'top' || side === 'bottom';
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/** The point `along` units from the side's left or top end. */
function pointAlong(layout: TailLayout, along: number): Point {
  switch (layout.side) {
    case 'top':
      return { x: along, y: 0 };
    case 'bottom':
      return { x: along, y: layout.size.height };
    case 'left':
      return { x: 0, y: along };
    case 'right':
      return { x: layout.size.width, y: along };
  }
}

/** The base's ends in the order a clockwise outline meets them. */
function clockwiseBase(layout: TailLayout): [Point, Point] {
  const low = pointAlong(layout, layout.center - layout.width / 2);
  const high = pointAlong(layout, layout.center + layout.width / 2);
  return layout.side === 'top' || layout.side === 'right' ? [low, high] : [high, low];
}

/** The end of the base away from the tip, where the width handle sits. */
export function widthHandlePoint(layout: TailLayout): Point {
  const offset = layout.projection <= layout.center ? layout.width / 2 : -layout.width / 2;
  return pointAlong(layout, layout.center + offset);
}

/** Corner radius of a bubble with a tail. */
export function bubbleRadius(size: Size, cornerRadius: number): number {
  const w = Math.abs(size.width);
  const h = Math.abs(size.height);
  return Math.min(cornerRadius > 0 ? cornerRadius : Math.min(w, h) * 0.22, w / 2, h / 2);
}

/** Where the tail goes, or null when its tip is inside the body (then no tail is drawn). */
export function tailLayout(size: Size, cornerRadius: number, tail: BubbleTail): TailLayout | null {
  const w = Math.abs(size.width);
  const h = Math.abs(size.height);
  const dx = tail.tip.x - 0.5;
  const dy = tail.tip.y - 0.5;
  if (!(Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) return null;
  const radius = bubbleRadius(size, cornerRadius);
  const side: BubbleSide = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'bottom' : 'top') : dx > 0 ? 'right' : 'left';
  const horizontal = isHorizontal(side);
  const length = horizontal ? w : h;
  const projection = clamp((horizontal ? tail.tip.x : tail.tip.y) * length, 0, length);
  const width = clamp(tail.width * length, 0, Math.max(length - 2 * radius, 0));
  const center = clamp(
    length / 2 + (projection - length / 2) * TAIL_LEAN,
    radius + width / 2,
    length - radius - width / 2,
  );
  return {
    side,
    length,
    radius,
    center,
    width,
    tip: { x: tail.tip.x * w, y: tail.tip.y * h },
    projection,
    size: { width: w, height: h },
  };
}

/** Box-space point for a point computed with the size made positive (a negative width or height mirrors it). */
export function mirrored(point: Point, size: Size): Point {
  return { x: size.width < 0 ? -point.x : point.x, y: size.height < 0 ? -point.y : point.y };
}

/**
 * Outline of a bubble with a tail, in box space: the rounded body, clockwise from the top-left corner like the
 * original drawing, with the tail inserted into the side facing its tip.
 */
export function bubblePath(size: Size, cornerRadius: number, tail: BubbleTail): Path {
  const w = Math.abs(size.width);
  const h = Math.abs(size.height);
  const r = bubbleRadius(size, cornerRadius);
  const layout = tailLayout(size, cornerRadius, tail);
  const m = (point: Point): Point => mirrored(point, size);
  const builder = new PathBuilder();
  const addTail = (side: BubbleSide) => {
    if (!layout || layout.side !== side) return;
    const [first, last] = clockwiseBase(layout);
    builder.lineTo(m(first)).lineTo(m(layout.tip)).lineTo(m(last));
  };
  builder.moveTo(m({ x: r, y: 0 }));
  addTail('top');
  builder.lineTo(m({ x: w - r, y: 0 })).arcTo(m({ x: w, y: 0 }), m({ x: w, y: r }), r);
  addTail('right');
  builder.lineTo(m({ x: w, y: h - r })).arcTo(m({ x: w, y: h }), m({ x: w - r, y: h }), r);
  addTail('bottom');
  builder.lineTo(m({ x: r, y: h })).arcTo(m({ x: 0, y: h }), m({ x: 0, y: h - r }), r);
  addTail('left');
  builder.lineTo(m({ x: 0, y: r })).arcTo(m({ x: 0, y: 0 }), m({ x: r, y: 0 }), r);
  return builder.close().build();
}

// ---------------------------------------------------------------------------------------------------------------
// Adjusting

/**
 * A speech bubble with a tail drawing the same outline: one without a tail gets its box shrunk to the body and the
 * original tail. A bubble that has a tail is returned unchanged, anything but a speech bubble gives null.
 */
export function bubbleWithTail(item: MarkupItem): MarkupItem | null {
  if (item.type !== 'shape' || item.content.kind !== 'speechBubble') return null;
  if (item.content.tail !== null) return item;
  const box = item.content.box;
  const size = { width: box.frame.width, height: box.frame.height };
  const body = { width: size.width, height: size.height * ORIGINAL_BODY_RATIO };
  const center = applyAffine(boxToWorld(box), { x: size.width / 2, y: body.height / 2 });
  const content: ShapeContent = {
    ...item.content,
    box: { frame: rectAround(center, body), rotation: box.rotation },
    tail: ORIGINAL_TAIL,
  };
  // The original drawing keeps its corners clear of the tail: their radius is at most 26% of the width.
  const limit = Math.abs(size.width) * 0.26;
  const style = item.style.cornerRadius > limit ? { ...item.style, cornerRadius: limit } : item.style;
  return { ...item, content, style };
}

/**
 * The document with the speech bubble `id` given a tail (`bubbleWithTail`). The ends of lines attached to the bubble
 * stay where they are: their anchors are measured against the smaller box. Null when `id` is not a speech bubble.
 */
export function documentWithTail(document: MarkupDocument, id: UUIDString): MarkupDocument | null {
  const item = findItem(document, id);
  const adjusted = item ? bubbleWithTail(item) : null;
  if (!item || !adjusted) return null;
  const result = updateItem(document, id, () => adjusted);
  if (item.type !== 'shape' || item.content.tail !== null) return result;
  const rescaled = (end: Endpoint): Endpoint =>
    end.binding?.itemID === id
      ? {
          ...end,
          binding: {
            ...end.binding,
            anchor: { x: end.binding.anchor.x, y: end.binding.anchor.y / ORIGINAL_BODY_RATIO },
          },
        }
      : end;
  const items = result.items.map((other) => {
    if (other.type !== 'line') return other;
    const { start, end } = other.content;
    if (start.binding?.itemID !== id && end.binding?.itemID !== id) return other;
    return { ...other, content: { ...other.content, start: rescaled(start), end: rescaled(end) } };
  });
  return { ...result, items };
}

/** World positions of a tail's handles. The width handle is null when no tail is drawn (its tip is inside the body). */
export interface BubbleTailHandles {
  readonly tip: Point;
  readonly width: Point | null;
}

/**
 * The tail handles of a speech bubble (null for other items). A bubble without a tail gets those of
 * `bubbleWithTail`, which sit on its tail as drawn.
 */
export function bubbleTailHandles(item: MarkupItem): BubbleTailHandles | null {
  const adjusted = bubbleWithTail(item);
  if (adjusted?.type !== 'shape' || adjusted.content.tail === null) return null;
  const { box, tail } = adjusted.content;
  const size = { width: box.frame.width, height: box.frame.height };
  const toWorld = boxToWorld(box);
  const tip = applyAffine(toWorld, { x: tail.tip.x * size.width, y: tail.tip.y * size.height });
  const layout = tailLayout(size, adjusted.style.cornerRadius, tail);
  if (!layout) return { tip, width: null };
  return { tip, width: applyAffine(toWorld, mirrored(widthHandlePoint(layout), size)) };
}

/**
 * The tail of a bubble that has one after dragging `part` to the world point `world`. The tip goes where it is
 * dragged; the width handle (the end of the base away from the tip) follows the pointer along the side, the base
 * widening about its middle, or from its other end where a corner stops the middle from moving.
 */
export function draggedTail(item: MarkupItem, part: BubbleTailPart, world: Point): BubbleTail | null {
  if (item.type !== 'shape' || item.content.kind !== 'speechBubble' || item.content.tail === null) return null;
  const { box, tail } = item.content;
  const size = { width: box.frame.width, height: box.frame.height };
  const local = applyAffine(invertAffine(boxToWorld(box)), world);
  if (part === 'tip') {
    const w = size.width === 0 ? ULP_OF_ONE : size.width;
    const h = size.height === 0 ? ULP_OF_ONE : size.height;
    return { tip: { x: local.x / w, y: local.y / h }, width: tail.width };
  }
  const layout = tailLayout(size, item.style.cornerRadius, tail);
  if (!layout || !(layout.length > 0)) return tail;
  const p = mirrored(local, size);
  const along = isHorizontal(layout.side) ? p.x : p.y;
  const { length, radius: r } = layout;
  // Where the middle of the base would be if no corner stopped it (see `tailLayout`).
  const free = length / 2 + (layout.projection - length / 2) * TAIL_LEAN;
  const base =
    layout.projection <= layout.center
      ? // The handle is the base's far end: at max(free + b / 2, r + b).
        Math.min(2 * (along - free), along - r)
      : // The handle is the base's near end: at min(free - b / 2, length - r - b).
        Math.min(2 * (free - along), length - r - along);
  const maximum = Math.max(length - 2 * r, 0) / length;
  const width = Math.min(Math.max(base / length, MINIMUM_TAIL_WIDTH), maximum);
  return { tip: tail.tip, width };
}

// ---------------------------------------------------------------------------------------------------------------
// Extent

/** What a shape covers in frame space: its frame, plus the tip of a speech bubble's tail. */
export function shapeFrameSpaceBounds(shape: ShapeContent): Rect {
  const frame = shape.box.frame;
  if (shape.kind !== 'speechBubble' || shape.tail === null) return frame;
  const tip = {
    x: minX(frame) + shape.tail.tip.x * frame.width,
    y: minY(frame) + shape.tail.tip.y * frame.height,
  };
  return unionRect(frame, { x: tip.x, y: tip.y, width: 0, height: 0 });
}

/** Axis-aligned world bounds of `shapeFrameSpaceBounds`. */
export function shapeWorldBounds(shape: ShapeContent): Rect {
  const rect = shapeFrameSpaceBounds(shape);
  const box: Box = shape.box;
  if (box.rotation === 0) return rect;
  return boundingRect(rectCorners(rect).map((corner) => toWorld(box, corner)));
}
