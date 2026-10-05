import { backgroundItem } from '../model/document';
import { swiftRound } from '../model/swift-math';
import type { MarkupDocument, Rect, Size } from '../model/types';
import { visualBoundsOfItems } from '../geometry/item-geometry';
import { insetRect, integralRect, isNullRect, rectHeight, rectWidth } from '../geometry/rect';

/** How the flattened image is produced. */
export type MarkupExportFormat =
  | {
      readonly type: 'jpeg';
      /** 0…1. */
      readonly quality: number;
      /** When the JPEG is larger than this many bytes, it is re-encoded at `fallbackQualities` until it fits. */
      readonly maxBytes?: number;
      /** Qualities tried in order when `maxBytes` is exceeded (default 0.75, 0.6, 0.5). */
      readonly fallbackQualities?: readonly number[];
    }
  | { readonly type: 'png' };

export interface MarkupExportOptions {
  readonly format?: MarkupExportFormat;
  /** Longest side of the output, in pixels. */
  readonly maxPixelDimension?: number;
  /** Total pixel budget of the output (memory guard; iOS Safari refuses canvases above 16,777,216 pixels). */
  readonly maxPixelCount?: number;
  /** Board mode: empty margin around the content, in canvas units. */
  readonly boardPadding?: number;
  /** Board mode: minimum pixels per canvas unit, so text stays sharp even when photos are small. */
  readonly minimumBoardScale?: number;
}

/** The defaults. Unlike the Swift package (40 MP), the pixel budget fits iOS Safari's canvas limit. */
export const DEFAULT_EXPORT_OPTIONS = {
  format: { type: 'jpeg', quality: 0.85 } as MarkupExportFormat,
  maxPixelDimension: 8192,
  maxPixelCount: 16_000_000,
  boardPadding: 24,
  minimumBoardScale: 2,
} as const;

export interface ResolvedExportOptions {
  readonly format: MarkupExportFormat;
  readonly maxPixelDimension: number;
  readonly maxPixelCount: number;
  readonly boardPadding: number;
  readonly minimumBoardScale: number;
}

export function resolveExportOptions(options: MarkupExportOptions = {}): ResolvedExportOptions {
  return {
    format: options.format ?? DEFAULT_EXPORT_OPTIONS.format,
    maxPixelDimension: options.maxPixelDimension ?? DEFAULT_EXPORT_OPTIONS.maxPixelDimension,
    maxPixelCount: options.maxPixelCount ?? DEFAULT_EXPORT_OPTIONS.maxPixelCount,
    boardPadding: options.boardPadding ?? DEFAULT_EXPORT_OPTIONS.boardPadding,
    minimumBoardScale: options.minimumBoardScale ?? DEFAULT_EXPORT_OPTIONS.minimumBoardScale,
  };
}

/** Which canvas rect to export and at what pixel size. */
export interface ExportPlan {
  /** Exported region, in canvas units. */
  readonly rect: Rect;
  /** Output size in whole pixels. */
  readonly pixelSize: Size;
  /** True when the pixel caps reduced the natural resolution. */
  readonly isClamped: boolean;
}

/** Image mode: the photo. Boards: everything drawn plus `boardPadding`, on whole units; an empty board is 800 × 600. */
export function exportRect(document: MarkupDocument, options: MarkupExportOptions = {}): Rect {
  const resolved = resolveExportOptions(options);
  const background = document.kind === 'image' ? backgroundItem(document) : undefined;
  if (background) {
    const canvas = background.content.box.frame;
    if (rectWidth(canvas) > 0 && rectHeight(canvas) > 0) return canvas;
  }
  const bounds = visualBoundsOfItems(document.items, document);
  if (isNullRect(bounds) || !(rectWidth(bounds) > 0) || !(rectHeight(bounds) > 0)) {
    return { x: 0, y: 0, width: 800, height: 600 };
  }
  return integralRect(insetRect(bounds, -resolved.boardPadding, -resolved.boardPadding));
}

/**
 * The export plan: photos keep their resolution (pixels per canvas unit of the sharpest photo; at least
 * `minimumBoardScale` on boards), limited by `maxPixelDimension` and `maxPixelCount`. An unclamped image-mode export
 * is exactly the photo's pixel size.
 */
export function planExport(document: MarkupDocument, options: MarkupExportOptions = {}): ExportPlan {
  const resolved = resolveExportOptions(options);
  const rect = exportRect(document, resolved);
  const width = rectWidth(rect);
  const height = rectHeight(rect);

  let density = 0;
  for (const item of document.items) {
    if (item.type !== 'image') continue;
    const frameWidth = rectWidth(item.content.box.frame);
    if (!(frameWidth > 0)) continue;
    density = Math.max(density, item.content.pixelSize.width / frameWidth);
  }
  if (!(density > 0)) density = 1;

  const isBoard = document.kind === 'board' || backgroundItem(document) === undefined;
  const natural = isBoard ? Math.max(density, resolved.minimumBoardScale) : density;
  const dimensionCap = resolved.maxPixelDimension / Math.max(width, height);
  const countCap = Math.sqrt(resolved.maxPixelCount / Math.max(width * height, 1));
  const scale = Math.min(natural, dimensionCap, countCap);
  const isClamped = scale < natural - 1e-9;

  let pixelSize: Size = {
    width: Math.max(swiftRound(width * scale), 1),
    height: Math.max(swiftRound(height * scale), 1),
  };
  const background = backgroundItem(document);
  if (!isBoard && !isClamped && background) {
    pixelSize = {
      width: swiftRound(background.content.pixelSize.width),
      height: swiftRound(background.content.pixelSize.height),
    };
  }
  return { rect, pixelSize, isClamped };
}
