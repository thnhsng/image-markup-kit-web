import { swiftRound } from '../model/swift-math';
import type { Point } from '../model/types';
import { add, cross, distance, dot, scale, subtract } from './vec';

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const ab = subtract(b, a);
  const lengthSquared = dot(ab, ab);
  if (!(lengthSquared > 0)) return distance(point, a);
  const t = Math.min(Math.max(dot(subtract(point, a), ab) / lengthSquared, 0), 1);
  return distance(point, add(a, scale(ab, t)));
}

/** Distance to the nearest segment of a polyline (`Number.MAX_VALUE` for no points). */
export function distanceToPolyline(point: Point, points: readonly Point[]): number {
  const first = points[0];
  if (!first) return Number.MAX_VALUE;
  if (points.length === 1) return distance(point, first);
  let best = Number.MAX_VALUE;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, points[index - 1] as Point, points[index] as Point));
  }
  return best;
}

/** Whether two segments properly cross (touching or collinear segments do not). */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(subtract(a2, a1), subtract(b1, a1));
  const d2 = cross(subtract(a2, a1), subtract(b2, a1));
  const d3 = cross(subtract(b2, b1), subtract(a1, b1));
  const d4 = cross(subtract(b2, b1), subtract(a2, b1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function distanceBetweenSegments(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distanceToSegment(a1, b1, b2),
    distanceToSegment(a2, b1, b2),
    distanceToSegment(b1, a1, a2),
    distanceToSegment(b2, a1, a2),
  );
}

/** Ramer–Douglas–Peucker simplification; always keeps the first and the last point. */
export function simplify(points: readonly Point[], epsilon: number): Point[] {
  if (points.length <= 2 || !(epsilon > 0)) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    if (end <= start + 1) continue;
    let maxDistance = 0;
    let index = start;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegment(points[i] as Point, points[start] as Point, points[end] as Point);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (maxDistance > epsilon) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** Normalizes an angle to (-π, π]. */
export function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Snaps to the nearest multiple of `step` (45°) when within `tolerance` (4°). */
export function snapAngle(angle: number, step = Math.PI / 4, tolerance = (4 * Math.PI) / 180): number {
  const nearest = swiftRound(angle / step) * step;
  return Math.abs(angle - nearest) <= tolerance ? normalizeAngle(nearest) : normalizeAngle(angle);
}
