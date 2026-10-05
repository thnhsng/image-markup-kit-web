import type { Point, Rect, Size } from '../model/types';

// CGRect semantics. Stored frames keep their raw origin and size (a size may be negative); the derived values
// (minX, width, center…) use the standardized rect, like CoreGraphics. `NULL_RECT` is CGRect.null.

export const NULL_RECT: Rect = { x: Infinity, y: Infinity, width: 0, height: 0 };
export const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function makeRect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** `CGRect(center:size:)`. */
export function rectAround(center: Point, size: Size): Rect {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
}

export function isNullRect(rect: Rect): boolean {
  return rect.x === Infinity || rect.y === Infinity;
}

export function isEmptyRect(rect: Rect): boolean {
  return isNullRect(rect) || rect.width === 0 || rect.height === 0;
}

export function standardized(rect: Rect): Rect {
  if (isNullRect(rect)) return NULL_RECT;
  if (rect.width >= 0 && rect.height >= 0) return rect;
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export const minX = (rect: Rect): number => standardized(rect).x;
export const minY = (rect: Rect): number => standardized(rect).y;
export const maxX = (rect: Rect): number => standardized(rect).x + Math.abs(rect.width);
export const maxY = (rect: Rect): number => standardized(rect).y + Math.abs(rect.height);
export const midX = (rect: Rect): number => standardized(rect).x + Math.abs(rect.width) / 2;
export const midY = (rect: Rect): number => standardized(rect).y + Math.abs(rect.height) / 2;
/** `CGRect.width`: the standardized (non-negative) width. */
export const rectWidth = (rect: Rect): number => Math.abs(rect.width);
/** `CGRect.height`: the standardized (non-negative) height. */
export const rectHeight = (rect: Rect): number => Math.abs(rect.height);

export function rectCenter(rect: Rect): Point {
  return { x: midX(rect), y: midY(rect) };
}

export function rectSize(rect: Rect): Size {
  return { width: rect.width, height: rect.height };
}

/** Smallest rect containing all points (`NULL_RECT` for none). */
export function boundingRect(points: readonly Point[]): Rect {
  const first = points[0];
  if (!first) return NULL_RECT;
  let left = first.x;
  let right = first.x;
  let top = first.y;
  let bottom = first.y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index] as Point;
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** `CGRect.insetBy(dx:dy:)`: standardizes; a rect inset past its own size becomes `NULL_RECT`. */
export function insetRect(rect: Rect, dx: number, dy: number): Rect {
  if (isNullRect(rect)) return NULL_RECT;
  const r = standardized(rect);
  const width = r.width - 2 * dx;
  const height = r.height - 2 * dy;
  if (width < 0 || height < 0) return NULL_RECT;
  return { x: r.x + dx, y: r.y + dy, width, height };
}

export function offsetRect(rect: Rect, dx: number, dy: number): Rect {
  if (isNullRect(rect)) return NULL_RECT;
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/** `CGRect.union(_:)`: the null rect is ignored; empty (non-null) rects still count. */
export function unionRect(a: Rect, b: Rect): Rect {
  if (isNullRect(a)) return standardized(b);
  if (isNullRect(b)) return standardized(a);
  const left = Math.min(minX(a), minX(b));
  const top = Math.min(minY(a), minY(b));
  return { x: left, y: top, width: Math.max(maxX(a), maxX(b)) - left, height: Math.max(maxY(a), maxY(b)) - top };
}

/** `CGRect.intersects(_:)`: overlapping interiors (rects that only touch do not intersect). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  if (isNullRect(a) || isNullRect(b)) return false;
  return minX(a) < maxX(b) && minX(b) < maxX(a) && minY(a) < maxY(b) && minY(b) < maxY(a);
}

/** `CGRect.contains(_:)` for a point: the min edges are inside, the max edges are not. */
export function rectContains(rect: Rect, point: Point): boolean {
  if (isNullRect(rect)) return false;
  return point.x >= minX(rect) && point.x < maxX(rect) && point.y >= minY(rect) && point.y < maxY(rect);
}

/** `CGRect.integral`: the smallest rect with integer edges that contains the rect. */
export function integralRect(rect: Rect): Rect {
  if (isNullRect(rect)) return NULL_RECT;
  const left = Math.floor(minX(rect));
  const top = Math.floor(minY(rect));
  return { x: left, y: top, width: Math.ceil(maxX(rect)) - left, height: Math.ceil(maxY(rect)) - top };
}

export function rectCorners(rect: Rect): Point[] {
  const left = minX(rect);
  const top = minY(rect);
  const right = maxX(rect);
  const bottom = maxY(rect);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}
