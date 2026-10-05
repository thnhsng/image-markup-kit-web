import type { Point } from '../model/types';

/**
 * A 2D affine transform in CoreGraphics / SVG / canvas convention:
 * x' = a·x + c·y + tx,  y' = b·x + d·y + ty.
 */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function applyAffine(t: Affine, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty };
}

/** `first` applied, then `second` (`second ∘ first`). */
export function concatAffine(first: Affine, second: Affine): Affine {
  return {
    a: first.a * second.a + first.b * second.c,
    b: first.a * second.b + first.b * second.d,
    c: first.c * second.a + first.d * second.c,
    d: first.c * second.b + first.d * second.d,
    tx: first.tx * second.a + first.ty * second.c + second.tx,
    ty: first.tx * second.b + first.ty * second.d + second.ty,
  };
}

export function translation(x: number, y: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
}

export function rotation(angle: number): Affine {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

export function scaling(sx: number, sy: number = sx): Affine {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
}

export function invertAffine(t: Affine): Affine {
  const determinant = t.a * t.d - t.b * t.c;
  if (determinant === 0) return IDENTITY;
  const a = t.d / determinant;
  const b = -t.b / determinant;
  const c = -t.c / determinant;
  const d = t.a / determinant;
  return { a, b, c, d, tx: -(a * t.tx + c * t.ty), ty: -(b * t.tx + d * t.ty) };
}

/** The transform as an SVG `matrix(…)` attribute value. */
export function affineToSVG(t: Affine): string {
  return `matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.tx} ${t.ty})`;
}
