import { effectiveLineWidth } from '../model/style';
import type { LineContent, MarkupDocument, MarkupItem, Point, UUIDString } from '../model/types';
import { isValidBindTarget } from './bindings';
import { boxContains, boxSpacePoint, toWorld } from './box';
import { distanceBetweenSegments, distanceToPolyline, distanceToSegment } from './geometry-math';
import { visualBounds } from './item-geometry';
import { samplesOf } from './line-path';
import { distanceToPath, flattenPath, pathContains, PathBuilder, type FlatSubpath } from './path';
import { lineGeometryOf, shapePath, strokePoints } from './path-factory';
import { boundingRect, insetRect, rectsIntersect } from './rect';
import { add, distance, scale, subtract } from './vec';

// Which item a pointer lands on. All tests run against the model (HitTesting.swift); "is inside the path stroked
// with round caps and joins at width w" is computed as "distance to the outline ≤ w / 2", which is the same set.

const flatShapes = new WeakMap<MarkupItem, readonly FlatSubpath[]>();

/** The item's shape path in box space, flattened (cached per item value). */
function flatShape(item: MarkupItem & { type: 'shape' }): readonly FlatSubpath[] {
  let flat = flatShapes.get(item);
  if (!flat) {
    const { kind, box } = item.content;
    flat = flattenPath(shapePath(kind, { width: box.frame.width, height: box.frame.height }, item.style.cornerRadius));
    flatShapes.set(item, flat);
  }
  return flat;
}

/** Outline of a closed polyline or curve (canvas units). */
function closedLinePath(line: LineContent, document: MarkupDocument): readonly FlatSubpath[] {
  return flattenPath(new PathBuilder().addLines(samplesOf(line, document)).close().build());
}

/**
 * Topmost selectable item at `point` (canvas units); `tolerance` is in canvas units (about 10 screen points).
 * Pass 1 respects what is drawn (strokes, outlines, fills). Pass 2 lets a finger grab an unfilled shape or closed
 * line by its inside, when nothing else was hit. The image-mode background is never hit.
 */
export function itemAt(point: Point, document: MarkupDocument, tolerance: number): MarkupItem | null {
  const backgroundID = document.backgroundItemID;
  for (let index = document.items.length - 1; index >= 0; index -= 1) {
    const item = document.items[index] as MarkupItem;
    if (item.id !== backgroundID && hits(item, point, document, tolerance)) return item;
  }
  for (let index = document.items.length - 1; index >= 0; index -= 1) {
    const item = document.items[index] as MarkupItem;
    if (item.id === backgroundID || item.style.fillColor !== null) continue;
    if (item.type === 'shape') {
      if (pathContains(flatShape(item), boxSpacePoint(item.content.box, point))) return item;
    } else if (item.type === 'line' && item.content.isClosed) {
      if (pathContains(closedLinePath(item.content, document), point)) return item;
    }
  }
  return null;
}

export function hits(item: MarkupItem, point: Point, document: MarkupDocument, tolerance: number): boolean {
  const lineWidth = effectiveLineWidth(item.style);
  switch (item.type) {
    case 'image':
    case 'text':
      return boxContains(item.content.box, point, tolerance);
    case 'shape': {
      const box = item.content.box;
      if (!boxContains(box, point, tolerance + lineWidth / 2)) return false;
      const local = boxSpacePoint(box, point);
      const flat = flatShape(item);
      if (item.style.fillColor !== null && pathContains(flat, local)) return true;
      return distanceToPath(flat, local) <= (Math.max(lineWidth, 1) + 2 * tolerance) / 2;
    }
    case 'stroke': {
      const content = item.content;
      if (!boxContains(content.box, point, tolerance)) return false;
      const local = boxSpacePoint(content.box, point);
      return distanceToPolyline(local, strokePoints(content)) <= lineWidth / 2 + tolerance;
    }
    case 'line': {
      const line = item.content;
      const samples = samplesOf(line, document);
      if (distanceToPolyline(point, samples) <= Math.max(lineWidth, 1) / 2 + tolerance) return true;
      if (line.isClosed && item.style.fillColor !== null && pathContains(closedLinePath(line, document), point)) {
        return true;
      }
      const heads = lineGeometryOf(line, document, item.style.lineWidth).heads;
      return heads !== null && pathContains(heads, point);
    }
  }
}

function sample(a: Point, b: Point, step: number): Point[] {
  const count = Math.max(Math.ceil(distance(a, b) / step), 1);
  return Array.from({ length: count + 1 }, (_, i) => add(a, scale(subtract(b, a), i / count)));
}

/**
 * Items touched by an eraser moving from `a` to `b` with radius `r` (canvas units), in document order. Photos, the
 * background and locked items are never erased.
 */
export function erasableItems(a: Point, b: Point, radius: number, document: MarkupDocument): UUIDString[] {
  const segmentBounds = insetRect(boundingRect([a, b]), -radius, -radius);
  const samples = sample(a, b, Math.max(radius / 2, 0.5));
  const result: UUIDString[] = [];
  for (const item of document.items) {
    if (item.type === 'image' || item.isLocked || item.id === document.backgroundItemID) continue;
    if (!rectsIntersect(visualBounds(item, document), segmentBounds)) continue;
    const lineWidth = effectiveLineWidth(item.style);
    let hit = false;
    switch (item.type) {
      case 'stroke': {
        const box = item.content.box;
        const points = strokePoints(item.content).map((p) =>
          toWorld(box, { x: p.x + box.frame.x, y: p.y + box.frame.y }),
        );
        for (let index = 1; index < points.length && !hit; index += 1) {
          hit =
            distanceBetweenSegments(points[index - 1] as Point, points[index] as Point, a, b) <= radius + lineWidth / 2;
        }
        if (!hit && points.length === 1) hit = distanceToSegment(points[0] as Point, a, b) <= radius + lineWidth / 2;
        break;
      }
      case 'line': {
        const line = item.content;
        const points = samplesOf(line, document);
        for (let index = 1; index < points.length && !hit; index += 1) {
          hit =
            distanceBetweenSegments(points[index - 1] as Point, points[index] as Point, a, b) <=
            radius + Math.max(lineWidth, 1) / 2;
        }
        if (!hit && line.isClosed && item.style.fillColor !== null) {
          const fill = closedLinePath(line, document);
          hit = samples.some((s) => pathContains(fill, s));
        }
        break;
      }
      case 'shape': {
        const flat = flatShape(item);
        const box = item.content.box;
        const filled = item.style.fillColor !== null;
        hit = samples.some((s) => {
          const local = boxSpacePoint(box, s);
          return (
            distanceToPath(flat, local) <= (Math.max(lineWidth, 1) + 2 * radius) / 2 ||
            (filled && pathContains(flat, local))
          );
        });
        break;
      }
      case 'text': {
        const box = item.content.box;
        hit = samples.some((s) => boxContains(box, s, radius));
        break;
      }
    }
    if (hit) result.push(item.id);
  }
  return result;
}

/** Topmost item that can receive a line end at `point`, skipping `excluding`. */
export function bindTargetAt(
  point: Point,
  document: MarkupDocument,
  tolerance: number,
  excluding: ReadonlySet<UUIDString> = new Set(),
): MarkupItem | null {
  for (let index = document.items.length - 1; index >= 0; index -= 1) {
    const item = document.items[index] as MarkupItem;
    if (excluding.has(item.id) || !isValidBindTarget(item, document) || item.type === 'line') continue;
    if (boxContains(item.content.box, point, tolerance)) return item;
  }
  return null;
}
