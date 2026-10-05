import type {
  ArrowHead,
  DashStyle,
  LineContent,
  MarkupDocument,
  Point,
  ShapeKind,
  Size,
  StrokeContent,
} from '../model/types';
import { resolvedPoints } from './bindings';
import { closes, flattened, lengthOf, pointAtDistance, trimmed } from './line-path';
import { ellipsePath, PathBuilder, rectPath, roundedRectPath, type Path } from './path';
import { boundingRect } from './rect';
import { midpoint, normalized, perpendicular, scale, subtract, add } from './vec';

// Builds every path the editor draws, for the screen and the export alike (PathFactory.swift).

export type LineJoin = 'miter' | 'round' | 'bevel';
export type LineCap = 'butt' | 'round' | 'square';

/** Path of a shape in box space (origin at the box's top-left corner). */
export function shapePath(kind: ShapeKind, size: Size, cornerRadius: number): Path {
  const w = size.width;
  const h = size.height;
  const rect = { x: 0, y: 0, width: w, height: h };
  switch (kind) {
    case 'rectangle':
    case 'highlightBox':
      return roundedRect(w, h, cornerRadius);
    case 'roundedRectangle':
      return roundedRect(w, h, cornerRadius > 0 ? cornerRadius : Math.min(w, h) * 0.2);
    case 'ellipse':
      return ellipsePath(rect);
    case 'triangle':
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]);
    case 'diamond':
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]);
    case 'pentagon':
      return polygon(fitted(regularPolygon(5, null), w, h));
    case 'star':
      return polygon(fitted(regularPolygon(5, 0.4), w, h));
    case 'speechBubble':
      return speechBubble(w, h, cornerRadius);
  }
}

/** Stroke joins: sharp for polygons (like Preview), round otherwise. */
export function lineJoinFor(kind: ShapeKind): LineJoin {
  switch (kind) {
    case 'rectangle':
    case 'triangle':
    case 'diamond':
    case 'pentagon':
    case 'star':
      return 'miter';
    default:
      return 'round';
  }
}

function roundedRect(w: number, h: number, radius: number): Path {
  const rect = { x: 0, y: 0, width: w, height: h };
  const r = Math.min(Math.max(radius, 0), Math.min(Math.abs(w), Math.abs(h)) / 2);
  return r > 0.01 ? roundedRectPath(rect, r) : rectPath(rect);
}

function polygon(points: readonly Point[]): Path {
  return new PathBuilder().addLines(points).close().build();
}

/** Vertices on the unit circle starting at 12 o'clock; alternates inner points when `innerRatio` is set. */
function regularPolygon(sides: number, innerRatio: number | null): Point[] {
  const count = innerRatio === null ? sides : sides * 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const radius = innerRatio !== null && i % 2 === 1 ? innerRatio : 1;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

/** Scales points so their bounding box exactly fills a w × h rect at the origin. */
function fitted(points: readonly Point[], w: number, h: number): Point[] {
  const bounds = boundingRect(points);
  if (!(bounds.width > 0) || !(bounds.height > 0)) return points.slice();
  const sx = Math.abs(w) / bounds.width;
  const sy = Math.abs(h) / bounds.height;
  const left = Math.min(0, w);
  const top = Math.min(0, h);
  return points.map((p) => ({ x: left + (p.x - bounds.x) * sx, y: top + (p.y - bounds.y) * sy }));
}

function speechBubble(w: number, h: number, cornerRadius: number): Path {
  const bodyHeight = h * 0.78;
  const tailLeft = w * 0.26;
  const tailRight = w * 0.42;
  const tailTip = { x: w * 0.16, y: h };
  const r = Math.min(cornerRadius > 0 ? cornerRadius : Math.min(w, bodyHeight) * 0.22, tailLeft, bodyHeight / 2, w / 2);
  return new PathBuilder()
    .moveTo({ x: r, y: 0 })
    .lineTo({ x: w - r, y: 0 })
    .arcTo({ x: w, y: 0 }, { x: w, y: r }, r)
    .lineTo({ x: w, y: bodyHeight - r })
    .arcTo({ x: w, y: bodyHeight }, { x: w - r, y: bodyHeight }, r)
    .lineTo({ x: tailRight, y: bodyHeight })
    .lineTo(tailTip)
    .lineTo({ x: tailLeft, y: bodyHeight })
    .lineTo({ x: r, y: bodyHeight })
    .arcTo({ x: 0, y: bodyHeight }, { x: 0, y: bodyHeight - r }, r)
    .lineTo({ x: 0, y: r })
    .arcTo({ x: 0, y: 0 }, { x: r, y: 0 }, r)
    .close()
    .build();
}

// ---------------------------------------------------------------------------------------------------------------
// Freehand strokes

/** Denormalized stroke points in box space. */
export function strokePoints(content: StrokeContent): Point[] {
  const { width, height } = content.box.frame;
  return content.points.map((p) => ({ x: p.x * width, y: p.y * height }));
}

/**
 * Smooth path through the samples: quadratic curves between midpoints, with each sample as the control point
 * (the pen smoothing of Drawsana's `PenShape`). One point draws a dot (a tiny segment with round caps).
 */
export function smoothedPath(points: readonly Point[]): Path {
  const builder = new PathBuilder();
  const first = points[0];
  if (!first) return builder.build();
  builder.moveTo(first);
  if (points.length === 1) {
    builder.lineTo({ x: first.x + 0.01, y: first.y });
  } else if (points.length === 2) {
    builder.lineTo(points[1] as Point);
  } else {
    builder.lineTo(midpoint(first, points[1] as Point));
    for (let i = 1; i < points.length - 1; i += 1) {
      builder.quadTo(points[i] as Point, midpoint(points[i] as Point, points[i + 1] as Point));
    }
    builder.lineTo(points[points.length - 1] as Point);
  }
  return builder.build();
}

// ---------------------------------------------------------------------------------------------------------------
// Lines and arrows (world space)

export interface LineGeometry {
  readonly shaft: Path;
  /** Filled arrowheads, or null when the line has none. */
  readonly heads: Path | null;
}

export function arrowHeadLength(lineWidth: number): number {
  return Math.max(lineWidth * 3.2, 14);
}

/** Shaft and heads of any line (straight, polyline or curve) with its ends resolved in `document`. */
export function lineGeometryOf(line: LineContent, document: MarkupDocument, lineWidth: number): LineGeometry {
  const points = resolvedPoints(line, document);
  return lineGeometry(
    flattened(points, line.kind, line.isClosed),
    closes(points, line.isClosed),
    lineWidth,
    line.startHead,
    line.endHead,
  );
}

/**
 * Shaft and heads along flattened `samples`. Closed lines have no heads; their shaft is a closed path that can also
 * be filled. Heads shrink on very short lines so they never overlap, and the shaft ends inside each head so thick
 * lines do not poke through the tip.
 */
export function lineGeometry(
  samples: readonly Point[],
  closed: boolean,
  lineWidth: number,
  startHead: ArrowHead,
  endHead: ArrowHead,
): LineGeometry {
  const shaft = new PathBuilder();
  const start = samples[0];
  if (!start) return { shaft: shaft.build(), heads: null };
  const length = lengthOf(samples);
  if (!(length > 0.001)) {
    shaft.moveTo(start).lineTo({ x: start.x + 0.01, y: start.y });
    return { shaft: shaft.build(), heads: null };
  }
  if (closed) {
    shaft.addLines(samples.slice(0, -1)).close();
    return { shaft: shaft.build(), heads: null };
  }
  const end = samples[samples.length - 1] as Point;
  const headCount = (startHead === 'arrow' ? 1 : 0) + (endHead === 'arrow' ? 1 : 0);
  const headLength = headCount === 0 ? 0 : Math.min(arrowHeadLength(lineWidth), (length / headCount) * 0.9);
  const halfWidth = headLength * 0.55;
  const inset = headLength * 0.7;
  shaft.addLines(trimmed(samples, startHead === 'arrow' ? inset : 0, endHead === 'arrow' ? inset : 0));
  if (headCount === 0) return { shaft: shaft.build(), heads: null };

  const heads = new PathBuilder();
  // A head points along the line where its base sits, so it follows curves and the last polyline segment.
  const addHead = (tip: Point, baseOnLine: Point) => {
    const direction = normalized(subtract(tip, baseOnLine));
    const base = subtract(tip, scale(direction, headLength));
    const normal = scale(perpendicular(direction), halfWidth);
    heads.addLines([tip, add(base, normal), subtract(base, normal)]).close();
  };
  if (endHead === 'arrow') addHead(end, pointAtDistance(length - headLength, samples));
  if (startHead === 'arrow') addHead(start, pointAtDistance(headLength, samples));
  return { shaft: shaft.build(), heads: heads.build() };
}

// ---------------------------------------------------------------------------------------------------------------
// Dashes

/** Dash lengths for a style (null for solid), in canvas units. */
export function dashPattern(dash: DashStyle, lineWidth: number): number[] | null {
  const w = Math.max(lineWidth, 1);
  switch (dash) {
    case 'solid':
      return null;
    case 'dashed':
      return [w * 3, w * 2];
    case 'dotted':
      return [0, w * 2];
  }
}

/** Dotted lines need round caps (zero-length dashes become dots). */
export function lineCapFor(dash: DashStyle, defaultCap: LineCap): LineCap {
  return dash === 'dotted' ? 'round' : defaultCap;
}
