import type { LineContent, LineKind, MarkupDocument, Point } from '../model/types';
import { resolvedPoints } from './bindings';
import { add, distance, scale, subtract } from './vec';

// Geometry of lines through several points (LinePath.swift). Curves are centripetal Catmull-Rom splines through the
// points, flattened to short segments; drawing, hit testing, erasing and bounds all use the samples.

/** Samples along the line in canvas units. Closed lines end with the first sample. */
export function samplesOf(line: LineContent, document: MarkupDocument): Point[] {
  return flattened(resolvedPoints(line, document), line.kind, line.isClosed);
}

/** Samples through `points` (first to last, then back to the first when `closed`). */
export function flattened(points: readonly Point[], kind: LineKind, closed: boolean): Point[] {
  const parts = segments(points, kind, closed);
  const first = parts[0];
  if (!first) return points.slice();
  const result = first.slice();
  for (let index = 1; index < parts.length; index += 1) result.push(...(parts[index] as Point[]).slice(1));
  return result;
}

/** Whether `points` form a closed line (closing needs at least three points). */
export function closes(points: readonly Point[], closed: boolean): boolean {
  return closed && points.length >= 3;
}

/** Samples of each segment (point i → point i+1, plus last → first when closed), both ends included. */
export function segments(points: readonly Point[], kind: LineKind, closed: boolean): Point[][] {
  if (points.length <= 1) return points.length === 0 ? [] : [points.slice()];
  const isClosed = closes(points, closed);
  const count = points.length;
  const segmentCount = isClosed ? count : count - 1;
  const smooth = kind === 'curve' && (count >= 3 || isClosed);
  const point = (i: number): Point => {
    if (isClosed) return points[((i % count) + count) % count] as Point;
    // Open ends: reflect the neighbor, so the curve leaves the end smoothly without a zero-length knot.
    if (i < 0) return subtract(scale(points[0] as Point, 2), points[1] as Point);
    if (i >= count) return subtract(scale(points[count - 1] as Point, 2), points[count - 2] as Point);
    return points[i] as Point;
  };
  return Array.from({ length: segmentCount }, (_, i) => {
    const a = point(i);
    const b = point(i + 1);
    return smooth ? catmullRom(point(i - 1), a, b, point(i + 2)) : [a, b];
  });
}

/** Where the "+" handles go: the middle (by length) of each segment. */
export function insertionPoints(points: readonly Point[], kind: LineKind, closed: boolean): Point[] {
  return segments(points, kind, closed).map((part) => pointAtDistance(lengthOf(part) / 2, part));
}

export function lengthOf(samples: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < samples.length; index += 1) {
    total += distance(samples[index - 1] as Point, samples[index] as Point);
  }
  return total;
}

/** The point `distance` along the samples from the first one (clamped to the ends). */
export function pointAtDistance(along: number, samples: readonly Point[]): Point {
  let previous = samples[0];
  if (!previous) return { x: 0, y: 0 };
  let remaining = Math.max(along, 0);
  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index] as Point;
    const step = distance(previous, next);
    if (step >= remaining && step > 0) return add(previous, scale(subtract(next, previous), remaining / step));
    remaining -= step;
    previous = next;
  }
  return previous;
}

/** The samples with `head` removed from the start and `tail` from the end (lengths along the line). */
export function trimmed(samples: readonly Point[], head: number, tail: number): Point[] {
  if (samples.length <= 1 || !(head > 0 || tail > 0)) return samples.slice();
  const total = lengthOf(samples);
  const from = Math.min(Math.max(head, 0), total);
  const to = Math.max(total - Math.max(tail, 0), from);
  const result = [pointAtDistance(from, samples)];
  let travelled = 0;
  for (let index = 1; index < samples.length; index += 1) {
    travelled += distance(samples[index - 1] as Point, samples[index] as Point);
    if (travelled > from && travelled < to) result.push(samples[index] as Point);
  }
  result.push(pointAtDistance(to, samples));
  return result;
}

/**
 * Centripetal Catmull-Rom (α = ½) from `p1` to `p2`, sampled densely enough to look smooth when zoomed in or
 * exported at full resolution (Barry–Goldman evaluation).
 */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const chord = distance(p1, p2);
  if (!(chord > 0.0001)) return [p1, p2];
  const knot = (a: Point, b: Point) => Math.max(Math.sqrt(distance(a, b)), 0.0001);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const lerp = (a: Point, b: Point, ta: number, tb: number, t: number): Point =>
    add(scale(a, (tb - t) / (tb - ta)), scale(b, (t - ta) / (tb - ta)));
  const count = Math.min(Math.max(Math.ceil(chord / 6), 12), 96);
  const result: Point[] = [p1];
  for (let step = 1; step < count; step += 1) {
    const t = t1 + ((t2 - t1) * step) / count;
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    result.push(lerp(b1, b2, t1, t2, t));
  }
  result.push(p2);
  return result;
}
