import { effectiveLineWidth } from '../model/style';
import type { MarkupDocument, MarkupItem, Point, Rect } from '../model/types';
import type { Affine } from './affine';
import { boxBoundingRect, boxToWorld } from './box';
import { samplesOf } from './line-path';
import { pathBounds, rectPath, transformPath, type Path } from './path';
import { arrowHeadLength, lineGeometryOf, lineJoinFor, shapePath, type LineJoin } from './path-factory';
import { boundingRect, insetRect, isNullRect, NULL_RECT, unionRect } from './rect';
import { add, distance, dot, length, normalized, scale, subtract } from './vec';

/** How far a drop shadow reaches beyond an item, in canvas units. */
export const SHADOW_EXTENT = 10;

/** Extent of an item as drawn: stroke width, arrowheads and shadow included (ItemGeometry.swift). */
export function visualBounds(item: MarkupItem, document: MarkupDocument): Rect {
  const shadow = item.style.shadow ? SHADOW_EXTENT : 0;
  switch (item.type) {
    case 'line': {
      // Curves can swing outside their points, so measure the flattened samples.
      const line = item.content;
      const samples = samplesOf(line, document);
      const hasHead = !line.isClosed && (line.startHead === 'arrow' || line.endHead === 'arrow');
      const pad = Math.max(item.style.lineWidth / 2, hasHead ? arrowHeadLength(item.style.lineWidth) : 0);
      return insetRect(boundingRect(samples), -(pad + shadow), -(pad + shadow));
    }
    case 'stroke':
      // Stroke boxes already include half the line width.
      return insetRect(boxBoundingRect(item.content.box), -shadow, -shadow);
    default: {
      const pad = effectiveLineWidth(item.style) / 2 + shadow;
      return insetRect(boxBoundingRect(item.content.box), -pad, -pad);
    }
  }
}

export function visualBoundsOfItems(items: readonly MarkupItem[], document: MarkupDocument): Rect {
  return items.reduce((bounds, item) => unionRect(bounds, visualBounds(item, document)), NULL_RECT);
}

// ---------------------------------------------------------------------------------------------------------------
// Ink

/**
 * What an item puts on the canvas, for fitting a board export edge to edge: tight around arrowheads, with the sharp
 * corners of mitered borders, and without the drop shadow (ItemGeometry.inkBounds). `visualBounds` stays the looser
 * extent the editor works with.
 */
export function inkBounds(item: MarkupItem, document: MarkupDocument): Rect {
  const style = item.style;
  const half = style.strokeColor !== null && style.lineWidth > 0 ? style.lineWidth / 2 : 0;
  switch (item.type) {
    case 'image': {
      const { box } = item.content;
      const path = rectPath({ x: 0, y: 0, width: box.frame.width, height: box.frame.height });
      return strokedBounds(path, boxToWorld(box), half, 'miter');
    }
    case 'shape': {
      const { kind, box } = item.content;
      const path = shapePath(kind, { width: box.frame.width, height: box.frame.height }, style.cornerRadius);
      return strokedBounds(path, boxToWorld(box), half, lineJoinFor(kind));
    }
    case 'text': {
      const pad = effectiveLineWidth(style) / 2;
      return insetRect(boxBoundingRect(item.content.box), -pad, -pad);
    }
    case 'stroke':
      // Stroke boxes already include half the line width.
      return boxBoundingRect(item.content.box);
    case 'line': {
      // Round caps and joins: the shaft reaches half the line width past its path; heads are filled.
      const geometry = lineGeometryOf(item.content, document, style.lineWidth);
      const shaft = insetRect(pathBounds(geometry.shaft), -half, -half);
      if (style.strokeColor === null || !geometry.heads) return shaft;
      return unionRect(shaft, pathBounds(geometry.heads));
    }
  }
}

export function inkBoundsOfItems(items: readonly MarkupItem[], document: MarkupDocument): Rect {
  return items.reduce((bounds, item) => unionRect(bounds, inkBounds(item, document)), NULL_RECT);
}

/** Miter limit of every stroke the editor draws (display list, ItemDrawing.swift). */
export const MITER_LIMIT = 10;

/** Bounds of a box-space `path` placed in the world by `transform`, stroked `half` wide on each side of it. */
function strokedBounds(path: Path, transform: Affine, half: number, join: LineJoin): Rect {
  const world = transformPath(path, transform);
  const bounds = pathBounds(world);
  if (!(half > 0) || isNullRect(bounds)) return bounds;
  const stroked = insetRect(bounds, -half, -half);
  if (join !== 'miter') return stroked;
  // Curved outlines (rounded corners) meet their straight edges smoothly, so only polygons have miters.
  const tips = polygons(world).flatMap((polygon) => miterTips(polygon, half));
  return unionRect(stroked, boundingRect(tips));
}

/** The closed subpaths made only of straight segments, as their vertices. */
function polygons(path: Path): Point[][] {
  const found: Point[][] = [];
  let points: Point[] = [];
  let straight = true;
  for (const command of path) {
    switch (command.type) {
      case 'M':
        points = [{ x: command.x, y: command.y }];
        straight = true;
        break;
      case 'L':
        points.push({ x: command.x, y: command.y });
        break;
      case 'Q':
      case 'C':
        straight = false;
        break;
      case 'Z':
        if (straight) found.push(points);
        points = [];
        break;
    }
  }
  return found;
}

/**
 * Outer points of the miter joins around a polygon. A join whose miter would pass the limit is beveled instead, and
 * stays within `half` of the path.
 */
function miterTips(polygon: readonly Point[], half: number): Point[] {
  // Repeated points (such as a last point back on the first) have no direction.
  const vertices = polygon.filter(
    (point, index) => distance(point, polygon[(index + 1) % polygon.length] as Point) > 1e-9,
  );
  const count = vertices.length;
  const tips: Point[] = [];
  vertices.forEach((vertex, index) => {
    const incoming = normalized(subtract(vertex, vertices[(index + count - 1) % count] as Point));
    const outgoing = normalized(subtract(vertices[(index + 1) % count] as Point, vertex));
    // Sine of half the corner's angle; the miter reaches half / sine from the vertex.
    const sine = Math.sqrt(Math.max((1 + dot(incoming, outgoing)) / 2, 0));
    const outward = subtract(incoming, outgoing);
    if (sine >= 1 / MITER_LIMIT && length(outward) > 1e-9)
      tips.push(add(vertex, scale(normalized(outward), half / sine)));
  });
  return tips;
}
