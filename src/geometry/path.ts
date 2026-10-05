import type { Point, Rect } from '../model/types';
import { applyAffine, type Affine } from './affine';
import { distanceToSegment } from './geometry-math';
import { NULL_RECT } from './rect';

/** One path element, as CoreGraphics produces them. */
export type PathCommand =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | { readonly type: 'Q'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
  | {
      readonly type: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'Z' };

/** A path: the same elements CoreGraphics builds, so SVG, canvas and hit testing all see one geometry. */
export type Path = readonly PathCommand[];

/** κ for approximating a quarter circle with one cubic Bézier: 4/3·(√2 − 1). */
export const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/** Builds paths with CGMutablePath's operations (including `addArc(tangent1End:tangent2End:radius:)`). */
export class PathBuilder {
  private readonly commands: PathCommand[] = [];
  private current: Point = { x: 0, y: 0 };
  private subpathStart: Point = { x: 0, y: 0 };

  moveTo(p: Point): this {
    this.commands.push({ type: 'M', x: p.x, y: p.y });
    this.current = p;
    this.subpathStart = p;
    return this;
  }

  lineTo(p: Point): this {
    this.commands.push({ type: 'L', x: p.x, y: p.y });
    this.current = p;
    return this;
  }

  quadTo(control: Point, p: Point): this {
    this.commands.push({ type: 'Q', x1: control.x, y1: control.y, x: p.x, y: p.y });
    this.current = p;
    return this;
  }

  cubicTo(c1: Point, c2: Point, p: Point): this {
    this.commands.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
    this.current = p;
    return this;
  }

  close(): this {
    this.commands.push({ type: 'Z' });
    this.current = this.subpathStart;
    return this;
  }

  /** `addLines(between:)`: a move to the first point and lines to the others. */
  addLines(points: readonly Point[]): this {
    points.forEach((point, index) => (index === 0 ? this.moveTo(point) : this.lineTo(point)));
    return this;
  }

  /**
   * `addArc(tangent1End:tangent2End:radius:)` (canvas `arcTo`): a line to the first tangent point, then an arc of
   * radius `r` tangent to both lines, as cubic Béziers of at most 90° each.
   */
  arcTo(t1: Point, t2: Point, r: number): this {
    const p0 = this.current;
    const v1x = p0.x - t1.x;
    const v1y = p0.y - t1.y;
    const v2x = t2.x - t1.x;
    const v2y = t2.y - t1.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    const cross = v1x * v2y - v1y * v2x;
    if (!(r > 0) || len1 === 0 || len2 === 0 || cross === 0) return this.lineTo(t1);
    const u1 = { x: v1x / len1, y: v1y / len1 };
    const u2 = { x: v2x / len2, y: v2y / len2 };
    const cosTheta = Math.min(Math.max(u1.x * u2.x + u1.y * u2.y, -1), 1);
    const theta = Math.acos(cosTheta); // angle at the corner
    const tangentDistance = r / Math.tan(theta / 2);
    const start = { x: t1.x + u1.x * tangentDistance, y: t1.y + u1.y * tangentDistance };
    const end = { x: t1.x + u2.x * tangentDistance, y: t1.y + u2.y * tangentDistance };
    const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bisectorLength = Math.hypot(bisector.x, bisector.y);
    const centerDistance = r / Math.sin(theta / 2);
    const center = {
      x: t1.x + (bisector.x / bisectorLength) * centerDistance,
      y: t1.y + (bisector.y / bisectorLength) * centerDistance,
    };
    this.lineTo(start);
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / segments;
    const handle = (4 / 3) * Math.tan(step / 4) * r;
    for (let index = 0; index < segments; index += 1) {
      const a0 = startAngle + step * index;
      const a1 = a0 + step;
      const p1 = index === segments - 1 ? end : { x: center.x + r * Math.cos(a1), y: center.y + r * Math.sin(a1) };
      const s = this.current;
      this.cubicTo(
        { x: s.x - handle * Math.sin(a0), y: s.y + handle * Math.cos(a0) },
        { x: p1.x + handle * Math.sin(a1), y: p1.y - handle * Math.cos(a1) },
        p1,
      );
    }
    return this;
  }

  build(): Path {
    return this.commands.slice();
  }
}

/** `CGPath(rect:)`: top-left, clockwise (y down). */
export function rectPath(rect: Rect): Path {
  const { x, y, width: w, height: h } = rect;
  return new PathBuilder()
    .moveTo({ x, y })
    .lineTo({ x: x + w, y })
    .lineTo({ x: x + w, y: y + h })
    .lineTo({ x, y: y + h })
    .close()
    .build();
}

/** `CGPath(roundedRect:cornerWidth:cornerHeight:)`: starts at the middle of the right edge, going down. */
export function roundedRectPath(rect: Rect, r: number): Path {
  const { x, y, width: w, height: h } = rect;
  const k = r * KAPPA;
  const right = x + w;
  const bottom = y + h;
  return new PathBuilder()
    .moveTo({ x: right, y: y + h / 2 })
    .lineTo({ x: right, y: bottom - r })
    .cubicTo({ x: right, y: bottom - r + k }, { x: right - r + k, y: bottom }, { x: right - r, y: bottom })
    .lineTo({ x: x + r, y: bottom })
    .cubicTo({ x: x + r - k, y: bottom }, { x, y: bottom - r + k }, { x, y: bottom - r })
    .lineTo({ x, y: y + r })
    .cubicTo({ x, y: y + r - k }, { x: x + r - k, y }, { x: x + r, y })
    .lineTo({ x: right - r, y })
    .cubicTo({ x: right - r + k, y }, { x: right, y: y + r - k }, { x: right, y: y + r })
    .close()
    .build();
}

/** `CGPath(ellipseIn:)`: four cubics, starting at the middle of the right edge, going down. */
export function ellipsePath(rect: Rect): Path {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const cx = rect.x + rx;
  const cy = rect.y + ry;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return new PathBuilder()
    .moveTo({ x: cx + rx, y: cy })
    .cubicTo({ x: cx + rx, y: cy + ky }, { x: cx + kx, y: cy + ry }, { x: cx, y: cy + ry })
    .cubicTo({ x: cx - kx, y: cy + ry }, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy })
    .cubicTo({ x: cx - rx, y: cy - ky }, { x: cx - kx, y: cy - ry }, { x: cx, y: cy - ry })
    .cubicTo({ x: cx + kx, y: cy - ry }, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy })
    .close()
    .build();
}

export function isEmptyPath(path: Path): boolean {
  return path.length === 0;
}

export function transformPath(path: Path, t: Affine): Path {
  return path.map((command) => {
    switch (command.type) {
      case 'Z':
        return command;
      case 'M':
      case 'L': {
        const p = applyAffine(t, command);
        return { type: command.type, x: p.x, y: p.y };
      }
      case 'Q': {
        const c = applyAffine(t, { x: command.x1, y: command.y1 });
        const p = applyAffine(t, command);
        return { type: 'Q', x1: c.x, y1: c.y, x: p.x, y: p.y };
      }
      case 'C': {
        const c1 = applyAffine(t, { x: command.x1, y: command.y1 });
        const c2 = applyAffine(t, { x: command.x2, y: command.y2 });
        const p = applyAffine(t, command);
        return { type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y };
      }
    }
  });
}

/** SVG path data (`d`). */
export function pathToSVG(path: Path): string {
  return path
    .map((command) => {
      switch (command.type) {
        case 'M':
        case 'L':
          return `${command.type}${command.x} ${command.y}`;
        case 'Q':
          return `Q${command.x1} ${command.y1} ${command.x} ${command.y}`;
        case 'C':
          return `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

/** Replays the path on a canvas context (or a Path2D). */
export function tracePath(
  target: Pick<CanvasPath, 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'>,
  path: Path,
): void {
  for (const command of path) {
    switch (command.type) {
      case 'M':
        target.moveTo(command.x, command.y);
        break;
      case 'L':
        target.lineTo(command.x, command.y);
        break;
      case 'Q':
        target.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
        break;
      case 'C':
        target.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
        break;
      case 'Z':
        target.closePath();
        break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bounds: exact, like `boundingBoxOfPath` (curve extrema, not control points).

function extendWithQuadratic(range: number[], p0: number, p1: number, p2: number): void {
  const denominator = p0 - 2 * p1 + p2;
  if (denominator !== 0) {
    const t = (p0 - p1) / denominator;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      range.push(mt * mt * p0 + 2 * mt * t * p1 + t * t * p2);
    }
  }
}

function extendWithCubic(range: number[], p0: number, p1: number, p2: number, p3: number): void {
  // Derivative: 3[(p1−p0)(1−t)² + 2(p2−p1)(1−t)t + (p3−p2)t²] = a·t² + b·t + c.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const sqrt = Math.sqrt(discriminant);
      roots.push((-b + sqrt) / (2 * a), (-b - sqrt) / (2 * a));
    }
  }
  for (const t of roots) {
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      range.push(mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3);
    }
  }
}

/** Smallest rect containing the path (`NULL_RECT` when it has no points), like `boundingBoxOfPath`. */
export function pathBounds(path: Path): Rect {
  const xs: number[] = [];
  const ys: number[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  for (const command of path) {
    switch (command.type) {
      case 'M':
        current = command;
        start = command;
        xs.push(command.x);
        ys.push(command.y);
        break;
      case 'L':
        current = command;
        xs.push(command.x);
        ys.push(command.y);
        break;
      case 'Q':
        extendWithQuadratic(xs, current.x, command.x1, command.x);
        extendWithQuadratic(ys, current.y, command.y1, command.y);
        current = command;
        xs.push(command.x);
        ys.push(command.y);
        break;
      case 'C':
        extendWithCubic(xs, current.x, command.x1, command.x2, command.x);
        extendWithCubic(ys, current.y, command.y1, command.y2, command.y);
        current = command;
        xs.push(command.x);
        ys.push(command.y);
        break;
      case 'Z':
        current = start;
        break;
    }
  }
  if (xs.length === 0) return NULL_RECT;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

// ---------------------------------------------------------------------------------------------------------------
// Flattening for hit testing.

/** A subpath as a polyline; `closed` subpaths also connect the last point to the first. */
export interface FlatSubpath {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

const FLATTEN_TOLERANCE = 0.02;

function curveSteps(length: number): number {
  return Math.min(Math.max(Math.ceil(Math.sqrt(length / FLATTEN_TOLERANCE)), 4), 256);
}

/** The path as polylines (curves subdivided finely enough for hit testing). */
export function flattenPath(path: Path): FlatSubpath[] {
  const result: FlatSubpath[] = [];
  let points: Point[] = [];
  let closed = false;
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  const finish = () => {
    if (points.length > 0) result.push({ points, closed });
    points = [];
    closed = false;
  };
  for (const command of path) {
    switch (command.type) {
      case 'M':
        finish();
        current = command;
        start = command;
        points.push(command);
        break;
      case 'L':
        if (points.length === 0) points.push(current);
        points.push(command);
        current = command;
        break;
      case 'Q': {
        if (points.length === 0) points.push(current);
        const p0 = current;
        const length =
          Math.hypot(command.x1 - p0.x, command.y1 - p0.y) + Math.hypot(command.x - command.x1, command.y - command.y1);
        const steps = curveSteps(length);
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const mt = 1 - t;
          points.push({
            x: mt * mt * p0.x + 2 * mt * t * command.x1 + t * t * command.x,
            y: mt * mt * p0.y + 2 * mt * t * command.y1 + t * t * command.y,
          });
        }
        current = command;
        break;
      }
      case 'C': {
        if (points.length === 0) points.push(current);
        const p0 = current;
        const length =
          Math.hypot(command.x1 - p0.x, command.y1 - p0.y) +
          Math.hypot(command.x2 - command.x1, command.y2 - command.y1) +
          Math.hypot(command.x - command.x2, command.y - command.y2);
        const steps = curveSteps(length);
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const mt = 1 - t;
          points.push({
            x: mt * mt * mt * p0.x + 3 * mt * mt * t * command.x1 + 3 * mt * t * t * command.x2 + t * t * t * command.x,
            y: mt * mt * mt * p0.y + 3 * mt * mt * t * command.y1 + 3 * mt * t * t * command.y2 + t * t * t * command.y,
          });
        }
        current = command;
        break;
      }
      case 'Z':
        closed = true;
        current = start;
        finish();
        break;
    }
  }
  finish();
  return result;
}

/** Whether a point is inside the filled path (nonzero winding, CoreGraphics' default rule). */
export function pathContains(path: Path | readonly FlatSubpath[], point: Point): boolean {
  const subpaths = isFlat(path) ? path : flattenPath(path);
  let winding = 0;
  for (const subpath of subpaths) {
    const points = subpath.points;
    // Filling closes every subpath.
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index] as Point;
      const b = points[(index + 1) % points.length] as Point;
      if (a.y <= point.y) {
        if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0) winding += 1;
      } else if (b.y <= point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

/**
 * Distance from a point to the path's outline (closed subpaths include their closing segment). A point is inside
 * the path stroked with round caps and joins at width `w` exactly when this distance is at most `w / 2`.
 */
export function distanceToPath(path: Path | readonly FlatSubpath[], point: Point): number {
  const subpaths = isFlat(path) ? path : flattenPath(path);
  let best = Number.MAX_VALUE;
  for (const subpath of subpaths) {
    const points = subpath.points;
    if (points.length === 1) {
      const only = points[0] as Point;
      best = Math.min(best, Math.hypot(point.x - only.x, point.y - only.y));
      continue;
    }
    for (let index = 1; index < points.length; index += 1) {
      best = Math.min(best, distanceToSegment(point, points[index - 1] as Point, points[index] as Point));
    }
    if (subpath.closed && points.length > 2) {
      best = Math.min(best, distanceToSegment(point, points[points.length - 1] as Point, points[0] as Point));
    }
  }
  return best;
}

function isFlat(path: Path | readonly FlatSubpath[]): path is readonly FlatSubpath[] {
  const first = path[0];
  return first !== undefined && 'points' in first;
}
