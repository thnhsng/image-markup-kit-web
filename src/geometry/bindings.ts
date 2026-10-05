import { findItem, itemBox } from '../model/document';
import type {
  ConnectorBinding,
  Endpoint,
  LineContent,
  MarkupDocument,
  MarkupItem,
  Point,
  UUIDString,
} from '../model/types';
import { normalizedPoint, worldPoint } from './box';
import { distance } from './vec';

// Line ends attached to other items (Bindings.swift).

/** Canvas position of an endpoint. Bound ends follow their target's move, resize and rotation. */
export function resolveEndpoint(endpoint: Endpoint, document: MarkupDocument): Point {
  const binding = endpoint.binding;
  if (!binding) return endpoint.point;
  const target = findItem(document, binding.itemID);
  const box = target ? itemBox(target) : null;
  return box ? worldPoint(box, binding.anchor) : endpoint.point;
}

export function resolvedEndpoints(line: LineContent, document: MarkupDocument): { start: Point; end: Point } {
  return { start: resolveEndpoint(line.start, document), end: resolveEndpoint(line.end, document) };
}

/** Every point of the line in drawing order: resolved start, waypoints, resolved end. */
export function resolvedPoints(line: LineContent, document: MarkupDocument): Point[] {
  return [resolveEndpoint(line.start, document), ...line.waypoints, resolveEndpoint(line.end, document)];
}

/** Whether `item` may receive a line end: anything with a box except the image-mode background. */
export function isValidBindTarget(item: MarkupItem, document: MarkupDocument): boolean {
  return item.type !== 'line' && item.id !== document.backgroundItemID;
}

const MAGNETS: readonly Point[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
];

/** Binding for a canvas point dropped on `target`; snaps to the center or an edge midpoint when close. */
export function bindingFor(point: Point, target: MarkupItem, snapDistance: number): ConnectorBinding | null {
  const box = itemBox(target);
  if (!box) return null;
  const raw = normalizedPoint(box, point);
  let anchor: Point = { x: Math.min(Math.max(raw.x, 0), 1), y: Math.min(Math.max(raw.y, 0), 1) };
  for (const magnet of MAGNETS) {
    if (distance(worldPoint(box, magnet), point) <= snapDistance) {
      anchor = magnet;
      break;
    }
  }
  return { itemID: target.id, anchor };
}

/**
 * Removes references to deleted items: bound ends freeze at their last resolved position (the cached `point`), and
 * annotations attached to a deleted photo become free.
 */
export function detachReferences(document: MarkupDocument, removed: ReadonlySet<UUIDString>): MarkupDocument {
  if (removed.size === 0) return document;
  let changed = false;
  const items = document.items.map((item): MarkupItem => {
    let result = item;
    if (result.parentID !== null && removed.has(result.parentID)) result = { ...result, parentID: null };
    if (result.type === 'line') {
      const line = result.content;
      const start =
        line.start.binding && removed.has(line.start.binding.itemID) ? { ...line.start, binding: null } : line.start;
      const end = line.end.binding && removed.has(line.end.binding.itemID) ? { ...line.end, binding: null } : line.end;
      if (start !== line.start || end !== line.end) result = { ...result, content: { ...line, start, end } };
    }
    if (result !== item) changed = true;
    return result;
  });
  return changed ? { ...document, items } : document;
}

/** Writes resolved positions into every line's cached `point`, so stored JSON stays self-consistent. */
export function refreshCachedEndpoints(document: MarkupDocument): MarkupDocument {
  let changed = false;
  const items = document.items.map((item): MarkupItem => {
    if (item.type !== 'line') return item;
    const line = item.content;
    const { start, end } = resolvedEndpoints(line, document);
    if (
      start.x === line.start.point.x &&
      start.y === line.start.point.y &&
      end.x === line.end.point.x &&
      end.y === line.end.point.y
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      content: { ...line, start: { ...line.start, point: start }, end: { ...line.end, point: end } },
    };
  });
  return changed ? { ...document, items } : document;
}
