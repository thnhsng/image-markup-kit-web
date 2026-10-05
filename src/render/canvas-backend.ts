import { colorComponents, type RGBAHex } from '../model/color';
import { tracePath } from '../geometry/path';
import type { Affine } from '../geometry/affine';
import { IMAGE_PLACEHOLDER, SHADOW, needsLayer, type DisplayItem, type DisplayNode } from './display-list';

// Draws display lists on a 2D canvas (the export path). The canvas transform maps canvas units to device pixels;
// items with group opacity or a shadow are drawn into an offscreen layer first and composited once, like a
// CoreGraphics transparency layer, so overlapping parts of one item do not darken and the item casts one shadow.

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Decoded photos by asset ID (null: draw the placeholder). */
export type ImageLookup = (assetID: string) => CanvasImageSource | null;

export interface CanvasEnvironment {
  readonly images: ImageLookup;
  /** Output pixels per canvas unit (shadows and hairlines are specified in device space). */
  readonly deviceScale: number;
  /** Creates an offscreen canvas for layers. */
  readonly createLayer: (
    width: number,
    height: number,
  ) => { canvas: HTMLCanvasElement | OffscreenCanvas; context: Canvas2D } | null;
}

export function cssColor(color: RGBAHex): string {
  const { red, green, blue, alpha } = colorComponents(color);
  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}

function applyTransform(context: Canvas2D, t: Affine): void {
  context.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
}

function drawNode(context: Canvas2D, node: DisplayNode, env: CanvasEnvironment): void {
  switch (node.kind) {
    case 'group':
      context.save();
      if (node.transform) applyTransform(context, node.transform);
      for (const child of node.children) drawNode(context, child, env);
      context.restore();
      return;
    case 'path': {
      if (node.fill !== null) {
        context.beginPath();
        tracePath(context, node.path);
        context.fillStyle = cssColor(node.fill);
        context.fill('nonzero');
      }
      if (node.stroke !== null) {
        const stroke = node.stroke;
        context.beginPath();
        tracePath(context, node.path);
        context.strokeStyle = cssColor(stroke.color);
        // CoreGraphics draws a zero width as the thinnest visible line; canvas would ignore it.
        context.lineWidth = stroke.width > 0 ? stroke.width : 1 / env.deviceScale;
        context.lineJoin = stroke.join;
        context.lineCap = stroke.cap;
        context.miterLimit = stroke.miterLimit;
        context.setLineDash(stroke.dash ? [...stroke.dash] : []);
        context.lineDashOffset = 0;
        context.stroke();
      }
      return;
    }
    case 'text':
      context.font = node.font;
      context.fillStyle = cssColor(node.color);
      context.textBaseline = 'alphabetic';
      context.textAlign = 'left';
      for (const line of node.lines) context.fillText(line.text, line.x, line.baseline);
      return;
    case 'image': {
      const image = env.images(node.assetID);
      if (image) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, node.width, node.height);
      } else {
        context.fillStyle = cssColor(IMAGE_PLACEHOLDER);
        context.fillRect(0, 0, node.width, node.height);
      }
      return;
    }
  }
}

/**
 * Draws one item. `deviceBounds` is the item's visual extent in device pixels (clipped to the canvas); it sizes the
 * offscreen layer for items with group opacity or a shadow.
 */
export function drawDisplayItem(
  context: Canvas2D,
  item: DisplayItem,
  env: CanvasEnvironment,
  deviceBounds: { x: number; y: number; width: number; height: number } | null,
): void {
  if (!needsLayer(item)) {
    drawNode(context, item.content, env);
    return;
  }
  const shadowStyle = () => {
    if (!item.shadow) return;
    context.shadowColor = `rgba(0, 0, 0, ${SHADOW.opacity})`;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = SHADOW.offsetY * env.deviceScale;
    context.shadowBlur = SHADOW.blur * env.deviceScale;
  };
  const bounds = deviceBounds ? integral(deviceBounds) : null;
  const layer = bounds && bounds.width > 0 && bounds.height > 0 ? env.createLayer(bounds.width, bounds.height) : null;
  if (!bounds || !layer) {
    // No room for a layer: draw directly (overlaps within the item may darken slightly).
    context.save();
    context.globalAlpha *= item.opacity;
    shadowStyle();
    drawNode(context, item.content, env);
    context.restore();
    return;
  }
  const transform = context.getTransform();
  layer.context.setTransform(
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e - bounds.x,
    transform.f - bounds.y,
  );
  drawNode(layer.context, item.content, env);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha *= item.opacity;
  shadowStyle();
  context.drawImage(layer.canvas as CanvasImageSource, bounds.x, bounds.y);
  context.restore();
  layer.canvas.width = 0;
  layer.canvas.height = 0;
}

function integral(rect: { x: number; y: number; width: number; height: number }) {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return { x, y, width: Math.ceil(rect.x + rect.width) - x, height: Math.ceil(rect.y + rect.height) - y };
}
