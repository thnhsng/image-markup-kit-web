import type { Point } from '../model/types';

// Vector helpers for points, mirroring the Swift package's CGPoint operators.

export const ORIGIN: Point = { x: 0, y: 0 };

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, factor: number): Point {
  return { x: a.x * factor, y: a.y * factor };
}

export function divide(a: Point, divisor: number): Point {
  return { x: a.x / divisor, y: a.y / divisor };
}

export function negate(a: Point): Point {
  return { x: -a.x, y: -a.y };
}

export function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Rotates about the origin. */
export function rotate(a: Point, angle: number): Point {
  if (angle === 0) return a;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function rotateAround(a: Point, angle: number, center: Point): Point {
  return add(rotate(subtract(a, center), angle), center);
}

/** The unit vector in the same direction, or the origin for a zero vector. */
export function normalized(a: Point): Point {
  const len = length(a);
  return len > 0 ? divide(a, len) : ORIGIN;
}

/** Perpendicular (rotated +90°). */
export function perpendicular(a: Point): Point {
  return { x: -a.y, y: a.x };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
