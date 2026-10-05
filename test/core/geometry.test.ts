import { describe, expect, it } from 'vitest';
import { applyAffine } from '../../src/geometry/affine';
import { boxToWorld, normalizedPoint, toLocal, toWorld, worldPoint } from '../../src/geometry/box';
import { flowFrames } from '../../src/geometry/board-layout';
import { simplify } from '../../src/geometry/geometry-math';
import { isEmptyPath, pathBounds } from '../../src/geometry/path';
import { lineGeometry, shapePath, smoothedPath, strokePoints } from '../../src/geometry/path-factory';
import {
  boundingRect,
  insetRect,
  isNullRect,
  maxX,
  maxY,
  minX,
  minY,
  rectContains,
  rectsIntersect,
} from '../../src/geometry/rect';
import { createStrokeItem, itemStyle, type Box, type ShapeKind } from '../../src';
import { expectPoint } from './helpers';

// Port of GeometryTests (the text measuring tests live with the text layout).
describe('Box', () => {
  it('round-trips world and local coordinates', () => {
    const box: Box = { frame: { x: 100, y: 50, width: 200, height: 80 }, rotation: 0.7 };
    for (const p of [
      { x: 0, y: 0 },
      { x: 150, y: 90 },
      { x: -40, y: 300 },
    ]) {
      expectPoint(toLocal(box, toWorld(box, p)), p);
    }
  });

  it('moves normalized points with the rotation', () => {
    const box: Box = { frame: { x: 0, y: 0, width: 200, height: 100 }, rotation: Math.PI / 2 };
    expectPoint(worldPoint(box, { x: 0.5, y: 0.5 }), { x: 100, y: 50 });
    // Rotating 90° clockwise (y down) moves the top-left corner to the top-right of the rotated box.
    const topLeft = worldPoint(box, { x: 0, y: 0 });
    expectPoint(topLeft, { x: 150, y: -50 });
    expectPoint(normalizedPoint(box, topLeft), { x: 0, y: 0 });
  });

  it('maps box space with boxToWorld like toWorld', () => {
    const box: Box = { frame: { x: 30, y: 40, width: 120, height: 60 }, rotation: -0.4 };
    expectPoint(applyAffine(boxToWorld(box), { x: 120, y: 0 }), toWorld(box, { x: 150, y: 40 }));
  });
});

describe('paths', () => {
  it('handles short inputs to the pen smoothing', () => {
    expect(isEmptyPath(smoothedPath([]))).toBe(true);
    expect(isNullRect(pathBounds(smoothedPath([{ x: 5, y: 5 }])))).toBe(false);
    expect(
      pathBounds(
        smoothedPath([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ]),
      ).width,
    ).toBeCloseTo(10, 9);
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
      { x: 30, y: 20 },
      { x: 40, y: 0 },
    ];
    const bounds = pathBounds(smoothedPath(points));
    const hull = insetRect(boundingRect(points), -0.001, -0.001);
    expect(minX(bounds) >= minX(hull) && maxX(bounds) <= maxX(hull)).toBe(true);
    expect(minY(bounds) >= minY(hull) && maxY(bounds) <= maxY(hull)).toBe(true);
  });

  it('fills the box with every shape but the speech bubble', () => {
    const kinds: ShapeKind[] = [
      'rectangle',
      'roundedRectangle',
      'ellipse',
      'triangle',
      'diamond',
      'star',
      'pentagon',
      'highlightBox',
    ];
    for (const kind of kinds) {
      const bounds = pathBounds(shapePath(kind, { width: 200, height: 100 }, 0));
      expect(bounds.width, kind).toBeCloseTo(200, 0);
      expect(Math.abs(bounds.width - 200), kind).toBeLessThanOrEqual(0.5);
      expect(Math.abs(bounds.height - 100), kind).toBeLessThanOrEqual(0.5);
    }
  });

  it('shrinks arrowheads on short lines', () => {
    const geometry = lineGeometry(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
      10,
      'arrow',
      'arrow',
    );
    expect(geometry.heads).not.toBeNull();
    expect(pathBounds(geometry.heads ?? []).width).toBeLessThanOrEqual(10.001);
  });
});

describe('strokes', () => {
  it('simplifies collinear points and keeps the ends', () => {
    const line = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 2 * i }));
    expect(simplify(line, 0.5)).toEqual([line[0], line[100]]);
    const zigzag = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    expect(simplify(zigzag, 0.5)).toEqual(zigzag);
  });

  it('gives a straight stroke a usable box', () => {
    const item = createStrokeItem(
      [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      itemStyle({ lineWidth: 6 }),
    );
    const stroke = item.content;
    expect(stroke.box.frame.height).toBeGreaterThanOrEqual(6);
    for (const p of stroke.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).toBe(true);
    }
    const first = strokePoints(stroke)[0];
    expect(first ? first.x + stroke.box.frame.x : NaN).toBeCloseTo(0, 9);
    expect(first ? first.y + stroke.box.frame.y : NaN).toBeCloseTo(50, 9);
  });
});

describe('board layout', () => {
  it('flows photos three per row', () => {
    const sizes = [
      { width: 400, height: 300 },
      { width: 300, height: 400 },
      { width: 800, height: 300 },
      { width: 400, height: 400 },
    ];
    const frames = flowFrames(sizes);
    expect(frames.map((frame) => frame.height)).toEqual([600, 600, 600, 600]);
    expect(frames[0]?.y).toBe(frames[2]?.y);
    expect((frames[3]?.y ?? 0) > maxY(frames[0] ?? { x: 0, y: 0, width: 0, height: 0 })).toBe(true);
    expect(frames[3]?.x).toBe(frames[0]?.x);
    frames.forEach((a, i) =>
      frames.forEach((b, j) => {
        if (j > i) expect(rectsIntersect(a, b), `${i} overlaps ${j}`).toBe(false);
      }),
    );
  });
});

describe('CGRect semantics', () => {
  it('matches CoreGraphics at the edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 5, y: 5, width: 0, height: 0 })).toBe(true);
    expect(isNullRect(insetRect(a, 6, 0))).toBe(true);
    expect(insetRect({ x: 10, y: 10, width: -4, height: -6 }, -1, -1)).toEqual({ x: 5, y: 3, width: 6, height: 8 });
    expect(rectContains(a, { x: 10, y: 5 })).toBe(false);
    expect(rectContains(a, { x: 0, y: 5 })).toBe(true);
  });
});
