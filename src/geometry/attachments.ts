import { findItem, itemBox, updateItem, withItemBox } from '../model/document';
import { ULP_OF_ONE } from '../model/swift-math';
import type { MarkupDocument, MarkupItem, Point, UUIDString } from '../model/types';
import { resolvedPoints } from './bindings';
import { boxCenter, boxCentered, boxContains, boxesEqual } from './box';
import { boundingRect, rectAround, rectCenter, rectWidth } from './rect';
import { add, rotate, scale, subtract } from './vec';

// Board mode: annotations drawn on a photo are attached to it (`parentID`) and follow it when the photo is moved,
// resized or rotated (Attachments.swift).

/**
 * Applies a photo's change (`old` → `updated`) to its attached annotations as one similarity transform
 * S(p) = c₁ + k·R(θ₁ − θ₀)(p − c₀), k = w₁ / w₀. Shapes and strokes move, scale and rotate; text only moves; free
 * line ends and waypoints move (bound ends already follow their targets). Children are read from `source`.
 */
export function carryChildren(
  old: MarkupItem,
  updated: MarkupItem,
  source: MarkupDocument,
  document: MarkupDocument,
): MarkupDocument {
  const b0 = itemBox(old);
  const b1 = itemBox(updated);
  if (source.kind !== 'board' || old.type !== 'image' || !b0 || !b1 || boxesEqual(b0, b1)) return document;
  const k = rectWidth(b1.frame) / Math.max(rectWidth(b0.frame), ULP_OF_ONE);
  const deltaAngle = b1.rotation - b0.rotation;
  const c0 = boxCenter(b0);
  const c1 = boxCenter(b1);
  const map = (p: Point): Point => add(c1, scale(rotate(subtract(p, c0), deltaAngle), k));

  let result = document;
  for (const child of source.items) {
    if (child.parentID !== old.id) continue;
    result = updateItem(result, child.id, (item) => {
      switch (item.type) {
        case 'shape':
        case 'stroke': {
          const box = item.content.box;
          const size = { width: rectWidth(box.frame) * k, height: Math.abs(box.frame.height) * k };
          return withItemBox(item, {
            frame: rectAround(map(boxCenter(box)), size),
            rotation: box.rotation + deltaAngle,
          });
        }
        case 'text':
          return withItemBox(item, boxCentered(item.content.box, map(boxCenter(item.content.box))));
        case 'line': {
          const line = item.content;
          return {
            ...item,
            content: {
              ...line,
              start: line.start.binding === null ? { ...line.start, point: map(line.start.point) } : line.start,
              end: line.end.binding === null ? { ...line.end, point: map(line.end.point) } : line.end,
              waypoints: line.waypoints.map(map),
            },
          };
        }
        case 'image':
          return item;
      }
    });
  }
  return result;
}

/** The photo an annotation belongs to: the topmost photo containing the annotation's center. */
export function parentFor(item: MarkupItem, document: MarkupDocument): UUIDString | null {
  if (document.kind !== 'board' || item.type === 'image') return null;
  const center =
    item.type === 'line'
      ? rectCenter(boundingRect(resolvedPoints(item.content, document)))
      : boxCenter(item.content.box);
  for (let index = document.items.length - 1; index >= 0; index -= 1) {
    const candidate = document.items[index] as MarkupItem;
    if (candidate.type === 'image' && boxContains(candidate.content.box, center)) return candidate.id;
  }
  return null;
}

/** Re-evaluates the parent of the given annotations (after they were created or moved). */
export function reassignParents(document: MarkupDocument, ids: readonly UUIDString[]): MarkupDocument {
  if (document.kind !== 'board') return document;
  let result = document;
  for (const id of ids) {
    const item = findItem(document, id);
    if (!item || item.type === 'image') continue;
    const parent = parentFor(item, document);
    if (parent !== item.parentID) result = updateItem(result, id, (current) => ({ ...current, parentID: parent }));
  }
  return result;
}
