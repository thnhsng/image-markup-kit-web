import { visualBounds } from '../geometry/item-geometry';
import { isNullRect, maxX, maxY, minX, minY, rectHeight, rectWidth } from '../geometry/rect';
import { createCanvas, decodeImage, type DecodedImage } from '../image/decode';
import { encodeCanvas, readImageMetadata, type MarkupAssets } from '../image/import';
import { backgroundItem } from '../model/document';
import { MarkupError } from '../model/errors';
import type { FontSpec, MarkupDocument, Size } from '../model/types';
import { cssFont, type FontStacks } from '../text/font-stacks';
import { createCanvasTextMeasurer, type TextMeasurer } from '../text/measurer';
import { cssColor, drawDisplayItem, type Canvas2D } from './canvas-backend';
import { displayItem } from './display-list';
import { planExport, resolveExportOptions, type MarkupExportOptions } from './export-planner';

export interface MarkupWarning {
  /** `missingAsset`: no bytes for the photo; `undecodableAsset`: this browser cannot decode them (e.g. HEIC). */
  readonly code: 'missingAsset' | 'undecodableAsset';
  readonly assetID: string;
}

/** A flattened export of a document. */
export interface MarkupRendering {
  readonly blob: Blob;
  readonly pixelSize: Size;
  /** True when the pixel caps (or the browser's canvas limits) reduced the natural resolution. */
  readonly isClamped: boolean;
  /** True when a JPEG with `maxBytes` is still larger than that after every fallback quality. */
  readonly exceedsMaxBytes: boolean;
  /** Photos drawn as a gray placeholder. */
  readonly warnings: readonly MarkupWarning[];
}

export interface RenderOptions extends MarkupExportOptions {
  readonly signal?: AbortSignal;
  readonly fontStacks?: FontStacks;
  readonly measurer?: TextMeasurer;
}

const DEFAULT_FALLBACK_QUALITIES = [0.75, 0.6, 0.5];
const FONT_TIMEOUT_MS = 3000;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MarkupError('aborted', 'The operation was cancelled.');
}

/** Waits (up to 3 s) for the fonts the document's text uses, so measuring and drawing use the real fonts. */
export async function loadFonts(fonts: readonly FontSpec[], stacks?: FontStacks): Promise<void> {
  const fontSet = typeof document !== 'undefined' ? (document as Document).fonts : undefined;
  if (!fontSet || typeof fontSet.load !== 'function' || fonts.length === 0) return;
  const unique = [...new Set(fonts.map((font) => cssFont(font, stacks)))];
  const loads = Promise.all(unique.map((css) => fontSet.load(css, 'Ag山').catch(() => [])));
  await Promise.race([loads, new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS))]);
}

function textFonts(document: MarkupDocument): FontSpec[] {
  return document.items.flatMap((item) => (item.type === 'text' ? [item.content.font] : []));
}

/** Allocates the export canvas, retrying at 70% when the browser refuses the size (iOS Safari limits canvases). */
function allocate(pixelSize: Size): { canvas: HTMLCanvasElement | OffscreenCanvas; context: Canvas2D; size: Size } {
  let size = pixelSize;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = createCanvas(size.width, size.height);
    const context = canvas?.getContext('2d', { alpha: true }) as Canvas2D | null | undefined;
    if (canvas && context && canvas.width === size.width && canvas.height === size.height) {
      return { canvas, context, size };
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    size = { width: Math.max(Math.round(size.width * 0.7), 1), height: Math.max(Math.round(size.height * 0.7), 1) };
  }
  throw new MarkupError('canvasAllocationFailed', 'The browser could not allocate a canvas for the export.');
}

/**
 * Flattens a document into one JPEG or PNG (MarkupRenderer.swift): photos at their resolution within the export
 * caps, every item drawn with the same paths and text layout as the editor. Photos that are missing or cannot be
 * decoded are drawn as a gray placeholder and reported in `warnings`.
 */
export async function renderMarkup(
  document: MarkupDocument,
  assets: MarkupAssets,
  options: RenderOptions = {},
): Promise<MarkupRendering> {
  const resolved = resolveExportOptions(options);
  const plan = planExport(document, resolved);
  const measurer = options.measurer ?? createCanvasTextMeasurer(options.fontStacks);
  await loadFonts(textFonts(document), options.fontStacks);
  throwIfAborted(options.signal);

  const { canvas, context, size } = allocate(plan.pixelSize);
  const isClamped = plan.isClamped || size.width !== plan.pixelSize.width || size.height !== plan.pixelSize.height;
  const scaleX = size.width / rectWidth(plan.rect);
  const scaleY = size.height / rectHeight(plan.rect);
  const deviceScale = Math.max(scaleX, scaleY);

  // Decode each photo once, at the largest size it is drawn (never above the original).
  const warnings: MarkupWarning[] = [];
  const needed = new Map<string, number>();
  for (const item of document.items) {
    if (item.type !== 'image') continue;
    const { box, pixelSize, assetID } = item.content;
    const drawn = Math.ceil(Math.max(rectWidth(box.frame), rectHeight(box.frame)) * deviceScale);
    const size = Math.min(drawn, Math.max(pixelSize.width, pixelSize.height));
    needed.set(assetID, Math.max(needed.get(assetID) ?? 0, size));
  }
  const decoded = new Map<string, DecodedImage>();
  try {
    for (const [assetID, maxPixelSize] of needed) {
      throwIfAborted(options.signal);
      const blob = assets[assetID];
      if (!blob) {
        warnings.push({ code: 'missingAsset', assetID });
        continue;
      }
      try {
        const metadata = await readImageMetadata(blob).catch(() => null);
        decoded.set(
          assetID,
          await decodeImage(blob, {
            maxPixelSize: Math.max(maxPixelSize, 1),
            orientation: metadata?.orientation,
            pixelCount: metadata ? metadata.pixelSize.width * metadata.pixelSize.height : undefined,
            signal: options.signal,
          }),
        );
      } catch (error) {
        if (error instanceof MarkupError && error.code === 'aborted') throw error;
        warnings.push({ code: 'undecodableAsset', assetID });
      }
    }

    context.fillStyle = cssColor(document.backgroundColor);
    context.fillRect(0, 0, size.width, size.height);
    context.setTransform(scaleX, 0, 0, scaleY, -minX(plan.rect) * scaleX, -minY(plan.rect) * scaleY);
    if (document.kind === 'image' && backgroundItem(document)) {
      context.beginPath();
      context.rect(minX(plan.rect), minY(plan.rect), rectWidth(plan.rect), rectHeight(plan.rect));
      context.clip();
    }
    const env = {
      images: (assetID: string) => decoded.get(assetID)?.source ?? null,
      deviceScale,
      createLayer: (width: number, height: number) => {
        const layer = createCanvas(width, height);
        const layerContext = layer?.getContext('2d') as Canvas2D | null | undefined;
        return layer && layerContext ? { canvas: layer, context: layerContext } : null;
      },
    };
    for (const item of document.items) {
      const bounds = visualBounds(item, document);
      const device = isNullRect(bounds)
        ? null
        : clipToCanvas(
            {
              x: (minX(bounds) - minX(plan.rect)) * scaleX - SHADOW_MARGIN * deviceScale,
              y: (minY(bounds) - minY(plan.rect)) * scaleY - SHADOW_MARGIN * deviceScale,
              width: (maxX(bounds) - minX(bounds)) * scaleX + 2 * SHADOW_MARGIN * deviceScale,
              height: (maxY(bounds) - minY(bounds)) * scaleY + 2 * SHADOW_MARGIN * deviceScale,
            },
            size,
          );
      drawDisplayItem(context, displayItem(item, document, { measurer, fontStacks: options.fontStacks }), env, device);
    }
  } finally {
    for (const image of decoded.values()) image.close();
  }

  try {
    throwIfAborted(options.signal);
    const format = resolved.format;
    if (format.type === 'png') {
      return {
        blob: await encodeCanvas(canvas, 'image/png'),
        pixelSize: size,
        isClamped,
        exceedsMaxBytes: false,
        warnings,
      };
    }
    let blob = await encodeCanvas(canvas, 'image/jpeg', format.quality);
    let exceedsMaxBytes = false;
    if (format.maxBytes !== undefined && blob.size > format.maxBytes) {
      exceedsMaxBytes = true;
      for (const quality of format.fallbackQualities ?? DEFAULT_FALLBACK_QUALITIES) {
        throwIfAborted(options.signal);
        blob = await encodeCanvas(canvas, 'image/jpeg', quality);
        if (blob.size <= format.maxBytes) {
          exceedsMaxBytes = false;
          break;
        }
      }
    }
    return { blob, pixelSize: size, isClamped, exceedsMaxBytes, warnings };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Room around an item's visual bounds for its blurred shadow edge, in canvas units. */
const SHADOW_MARGIN = 8;

function clipToCanvas(rect: { x: number; y: number; width: number; height: number }, size: Size) {
  const x = Math.max(rect.x, 0);
  const y = Math.max(rect.y, 0);
  const right = Math.min(rect.x + rect.width, size.width);
  const bottom = Math.min(rect.y + rect.height, size.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
