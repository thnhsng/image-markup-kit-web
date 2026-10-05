import type { Box, Point, Rect } from '../model/types';
import { concatAffine, rotation, translation, type Affine } from './affine';
import {
  boundingRect,
  insetRect,
  maxX,
  maxY,
  minX,
  minY,
  offsetRect,
  rectAround,
  rectContains,
  rectHeight,
  rectWidth,
} from './rect';
import { rotateAround } from './vec';
import { ULP_OF_ONE } from '../model/swift-math';

// Terminology (as in the Swift package):
// - world: canvas coordinates;
// - frame space: world coordinates with the box's rotation undone (the space `frame` lives in);
// - box space: origin at the frame's top-left, x and y in 0…width and 0…height. Paths are built here.

export function boxCenter(box: Box): Point {
  return { x: minX(box.frame) + rectWidth(box.frame) / 2, y: minY(box.frame) + rectHeight(box.frame) / 2 };
}

/** Frame space → world. */
export function toWorld(box: Box, point: Point): Point {
  return box.rotation === 0 ? point : rotateAround(point, box.rotation, boxCenter(box));
}

/** World → frame space. */
export function toLocal(box: Box, point: Point): Point {
  return box.rotation === 0 ? point : rotateAround(point, -box.rotation, boxCenter(box));
}

/** World position of a normalized (0…1) point inside the box. */
export function worldPoint(box: Box, normalized: Point): Point {
  const frame = box.frame;
  return toWorld(box, {
    x: minX(frame) + normalized.x * rectWidth(frame),
    y: minY(frame) + normalized.y * rectHeight(frame),
  });
}

/** Normalized (0…1, unclamped) position of a world point inside the box. */
export function normalizedPoint(box: Box, world: Point): Point {
  const q = toLocal(box, world);
  return {
    x: (q.x - minX(box.frame)) / Math.max(rectWidth(box.frame), ULP_OF_ONE),
    y: (q.y - minY(box.frame)) / Math.max(rectHeight(box.frame), ULP_OF_ONE),
  };
}

/** Box space → world: translate to the center, rotate, and move the box's top-left corner to the origin. */
export function boxToWorld(box: Box): Affine {
  const center = boxCenter(box);
  const toCorner = translation(-rectWidth(box.frame) / 2, -rectHeight(box.frame) / 2);
  return concatAffine(concatAffine(toCorner, rotation(box.rotation)), translation(center.x, center.y));
}

/** World point → box space (origin at the frame's top-left, rotation undone). */
export function boxSpacePoint(box: Box, point: Point): Point {
  const q = toLocal(box, point);
  return { x: q.x - minX(box.frame), y: q.y - minY(box.frame) };
}

/** Corners in world space: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(box: Box): Point[] {
  const frame = box.frame;
  return [
    { x: minX(frame), y: minY(frame) },
    { x: maxX(frame), y: minY(frame) },
    { x: maxX(frame), y: maxY(frame) },
    { x: minX(frame), y: maxY(frame) },
  ].map((corner) => toWorld(box, corner));
}

/** Axis-aligned bounds of the rotated box. */
export function boxBoundingRect(box: Box): Rect {
  return box.rotation === 0 ? box.frame : boundingRect(boxCorners(box));
}

export function boxContains(box: Box, point: Point, tolerance = 0): boolean {
  return rectContains(insetRect(box.frame, -tolerance, -tolerance), toLocal(box, point));
}

/** The box moved so its center is at `center`, keeping size and rotation. */
export function boxCentered(box: Box, center: Point): Box {
  return { frame: rectAround(center, { width: box.frame.width, height: box.frame.height }), rotation: box.rotation };
}

export function boxOffset(box: Box, delta: Point): Box {
  return { frame: offsetRect(box.frame, delta.x, delta.y), rotation: box.rotation };
}

export function boxesEqual(a: Box, b: Box): boolean {
  return (
    a.rotation === b.rotation &&
    a.frame.x === b.frame.x &&
    a.frame.y === b.frame.y &&
    a.frame.width === b.frame.width &&
    a.frame.height === b.frame.height
  );
}
