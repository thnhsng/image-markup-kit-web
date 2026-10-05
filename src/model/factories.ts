import {
  boundingRect,
  insetRect,
  isNullRect,
  minX,
  minY,
  rectHeight,
  rectWidth,
  standardized,
  ZERO_RECT,
} from '../geometry/rect';
import { MarkupColors } from './color';
import { CURRENT_SCHEMA_VERSION, IMAGE_LONG_EDGE } from './document';
import { ULP_OF_ONE } from './swift-math';
import { itemStyle } from './style';
import type {
  ArrowHead,
  ImageItem,
  ImageSource,
  ItemStyle,
  LineItem,
  LineKind,
  MarkupDocument,
  Point,
  Rect,
  ShapeItem,
  ShapeKind,
  Size,
  StrokeItem,
} from './types';
import { createUUID } from './uuid';

/** Canvas-unit size of a photo whose long edge is `longEdge` (a square when the pixel size is unknown). */
export function fittedSize(pixelSize: Size, longEdge: number): Size {
  const { width, height } = pixelSize;
  if (!(width > 0) || !(height > 0)) return { width: longEdge, height: longEdge };
  if (width >= height) return { width: longEdge, height: (longEdge * height) / width };
  return { width: (longEdge * width) / height, height: longEdge };
}

/** A photo item with no border (`style: ItemStyle(strokeColor: nil)`). */
export function createImageItem(source: ImageSource, frame: Rect): ImageItem {
  return {
    id: createUUID(),
    type: 'image',
    content: { assetID: source.assetID, pixelSize: source.pixelSize, box: { frame, rotation: 0 } },
    style: itemStyle({ strokeColor: null }),
    isLocked: false,
    parentID: null,
  };
}

/** One photo to annotate: the photo becomes the locked background, and the canvas is clipped to it. */
export function createImageDocument(source: ImageSource): MarkupDocument {
  const size = fittedSize(source.pixelSize, IMAGE_LONG_EDGE);
  const background: ImageItem = {
    ...createImageItem(source, { x: 0, y: 0, width: size.width, height: size.height }),
    isLocked: true,
  };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createUUID(),
    kind: 'image',
    backgroundItemID: background.id,
    backgroundColor: MarkupColors.white,
    items: [background],
  };
}

/** A shape filling `frame` (standardized), rotated about its center. */
export function createShapeItem(
  kind: ShapeKind,
  frame: Rect,
  style: ItemStyle,
  options: { readonly rotation?: number; readonly lockAspect?: boolean } = {},
): ShapeItem {
  return {
    id: createUUID(),
    type: 'shape',
    content: {
      kind,
      box: { frame: standardized(frame), rotation: options.rotation ?? 0 },
      lockAspect: options.lockAspect ?? false,
    },
    style,
    isLocked: false,
    parentID: null,
  };
}

/** Box of a freehand stroke: the samples' bounds plus half the line width, never thinner than the line width. */
export function strokeBox(points: readonly Point[], lineWidth: number): Rect {
  const pad = Math.max(lineWidth, 1) / 2;
  let rect = boundingRect(points);
  if (isNullRect(rect)) rect = ZERO_RECT;
  rect = insetRect(rect, -pad, -pad);
  const minimum = Math.max(lineWidth, 1);
  if (rectWidth(rect) < minimum) rect = insetRect(rect, (rectWidth(rect) - minimum) / 2, 0);
  if (rectHeight(rect) < minimum) rect = insetRect(rect, 0, (rectHeight(rect) - minimum) / 2);
  return rect;
}

/** Points relative to a rect: (0, 0) is its top-left corner, (1, 1) its bottom-right. */
export function normalizePoints(points: readonly Point[], rect: Rect): Point[] {
  const width = Math.max(rectWidth(rect), ULP_OF_ONE);
  const height = Math.max(rectHeight(rect), ULP_OF_ONE);
  const left = minX(rect);
  const top = minY(rect);
  return points.map((point) => ({ x: (point.x - left) / width, y: (point.y - top) / height }));
}

/** A freehand stroke through canvas-space `points`. */
export function createStrokeItem(points: readonly Point[], style: ItemStyle, isHighlighter = false): StrokeItem {
  const box = strokeBox(points, style.lineWidth);
  return {
    id: createUUID(),
    type: 'stroke',
    content: { points: normalizePoints(points, box), box: { frame: box, rotation: 0 }, isHighlighter },
    style,
    isLocked: false,
    parentID: null,
  };
}

interface LineOptions {
  readonly startHead?: ArrowHead;
  readonly endHead?: ArrowHead;
}

/** A free line or arrow between two canvas points (an arrow at the end unless told otherwise). */
export function createLineItem(from: Point, to: Point, style: ItemStyle, options: LineOptions = {}): LineItem {
  return {
    id: createUUID(),
    type: 'line',
    content: {
      start: { point: from, binding: null },
      end: { point: to, binding: null },
      startHead: options.startHead ?? 'none',
      endHead: options.endHead ?? 'arrow',
      kind: 'straight',
      waypoints: [],
      isClosed: false,
    },
    style,
    isLocked: false,
    parentID: null,
  };
}

function createPathItem(
  kind: LineKind,
  points: readonly Point[],
  style: ItemStyle,
  options: LineOptions & { readonly closed?: boolean },
): LineItem {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points.length > 1 ? (points[points.length - 1] as Point) : first;
  return {
    id: createUUID(),
    type: 'line',
    content: {
      start: { point: first, binding: null },
      end: { point: last, binding: null },
      startHead: options.startHead ?? 'none',
      endHead: options.endHead ?? 'none',
      kind,
      waypoints: points.slice(1, -1),
      isClosed: (options.closed ?? false) && points.length >= 3,
    },
    style,
    isLocked: false,
    parentID: null,
  };
}

/** Straight segments through canvas `points` (at least two); `closed` joins the last point to the first. */
export function createPolylineItem(
  points: readonly Point[],
  style: ItemStyle,
  options: LineOptions & { readonly closed?: boolean } = {},
): LineItem {
  return createPathItem('polyline', points, style, options);
}

/** A smooth curve through canvas `points` (at least two). */
export function createCurveItem(
  points: readonly Point[],
  style: ItemStyle,
  options: LineOptions & { readonly closed?: boolean } = {},
): LineItem {
  return createPathItem('curve', points, style, options);
}
