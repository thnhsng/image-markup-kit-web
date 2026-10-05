import { visualBoundsOfItems } from '../geometry/item-geometry';
import { insetRect, isNullRect, maxX, maxY, midX, midY, minX, minY, rectHeight, rectWidth } from '../geometry/rect';
import { backgroundItem } from '../model/document';
import type { MarkupDocument, Point, Rect, Size } from '../model/types';

// Zoom and pan of the canvas (CanvasView.swift, which uses a UIScrollView): screen = canvas × zoom + offset.

export interface Insets {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** Half of the board canvas, in canvas units (the board is a 20,000-unit square around the origin). */
const BOARD_EXTENT = 20000;
const FIT_INSETS: Insets = { top: 16, left: 16, bottom: 16, right: 16 };

export class Viewport {
  /** Size of the canvas element on screen. */
  size: Size = { width: 0, height: 0 };
  /** Space at the edges kept clear when fitting. */
  fitInsets: Insets = FIT_INSETS;
  /** Part of the bottom covered by an on-screen keyboard. */
  keyboardInset = 0;
  zoom = 1;
  offsetX = 0;
  offsetY = 0;
  minimumZoom = 0.05;
  maximumZoom = 8;
  /** The scrollable canvas: the photo in image mode, a 20,000-unit square on boards. */
  contentBounds: Rect = { x: -BOARD_EXTENT / 2, y: -BOARD_EXTENT / 2, width: BOARD_EXTENT, height: BOARD_EXTENT };
  /** Image mode: drawing is clipped to the photo. */
  clipsToContent = false;

  canvasToScreen(point: Point): Point {
    return { x: point.x * this.zoom + this.offsetX, y: point.y * this.zoom + this.offsetY };
  }

  screenToCanvas(point: Point): Point {
    return { x: (point.x - this.offsetX) / this.zoom, y: (point.y - this.offsetY) / this.zoom };
  }

  /** Sets the scrollable area for a document (`load`). */
  configure(document: MarkupDocument): void {
    const background = document.kind === 'image' ? backgroundItem(document) : undefined;
    const frame = background?.content.box.frame;
    if (frame && rectWidth(frame) > 0 && rectHeight(frame) > 0) {
      this.contentBounds = { x: minX(frame), y: minY(frame), width: rectWidth(frame), height: rectHeight(frame) };
      this.clipsToContent = true;
    } else {
      this.contentBounds = { x: -BOARD_EXTENT / 2, y: -BOARD_EXTENT / 2, width: BOARD_EXTENT, height: BOARD_EXTENT };
      this.clipsToContent = false;
    }
  }

  /** What "zoom to fit" shows: the photo in image mode, everything (plus 40 units) on a board. */
  fitRect(document: MarkupDocument): Rect {
    if (this.clipsToContent) return this.contentBounds;
    const bounds = visualBoundsOfItems(document.items, document);
    if (isNullRect(bounds) || !(rectWidth(bounds) > 0) || !(rectHeight(bounds) > 0)) {
      return { x: -400, y: -300, width: 800, height: 600 };
    }
    return insetRect(bounds, -40, -40);
  }

  fitZoom(rect: Rect): number {
    const width = this.size.width - this.fitInsets.left - this.fitInsets.right;
    const height = this.size.height - this.fitInsets.top - this.fitInsets.bottom;
    if (!(rectWidth(rect) > 0) || !(rectHeight(rect) > 0) || !(width > 0) || !(height > 0)) return 1;
    return Math.min(width / rectWidth(rect), height / rectHeight(rect));
  }

  /** Zoom range: half to 8× the fit in image mode; down to 5% (or half the fit) and up to 4× (or the fit) on boards. */
  updateLimits(document: MarkupDocument): void {
    const fit = this.fitZoom(this.fitRect(document));
    if (this.clipsToContent) {
      this.minimumZoom = fit * 0.5;
      this.maximumZoom = fit * 8;
    } else {
      this.minimumZoom = Math.min(0.05, fit * 0.5);
      this.maximumZoom = Math.max(4, fit);
    }
    this.zoom = clamp(this.zoom, this.minimumZoom, this.maximumZoom);
    this.clampOffset();
  }

  zoomToFit(document: MarkupDocument): void {
    this.zoomToRect(this.fitRect(document));
  }

  /** Shows `rect` (canvas units) centered and as large as fits. */
  zoomToRect(rect: Rect): void {
    this.zoom = clamp(this.fitZoom(rect), this.minimumZoom, this.maximumZoom);
    this.centerOn({ x: midX(rect), y: midY(rect) });
  }

  /** Scrolls so `point` is in the middle of the visible area (as far as scrolling allows). */
  centerOn(point: Point): void {
    this.offsetX = this.size.width / 2 - point.x * this.zoom;
    this.offsetY = (this.size.height - this.keyboardInset) / 2 - point.y * this.zoom;
    this.clampOffset();
  }

  /** Zooms to `zoom` (within limits) keeping the canvas point under `screenPoint` in place. */
  zoomAround(screenPoint: Point, zoom: number): void {
    const anchor = this.screenToCanvas(screenPoint);
    this.zoom = clamp(zoom, this.minimumZoom, this.maximumZoom);
    this.offsetX = screenPoint.x - anchor.x * this.zoom;
    this.offsetY = screenPoint.y - anchor.y * this.zoom;
    this.clampOffset();
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampOffset();
  }

  /**
   * Keeps the content where a scroll view would: centered when it is smaller than the visible area, otherwise never
   * scrolled past its edges.
   */
  clampOffset(): void {
    const visibleHeight = this.size.height - this.keyboardInset;
    const contentLeft = minX(this.contentBounds) * this.zoom;
    const contentRight = maxX(this.contentBounds) * this.zoom;
    const contentTop = minY(this.contentBounds) * this.zoom;
    const contentBottom = maxY(this.contentBounds) * this.zoom;
    const contentWidth = contentRight - contentLeft;
    const contentHeight = contentBottom - contentTop;
    if (contentWidth <= this.size.width) {
      this.offsetX = (this.size.width - contentWidth) / 2 - contentLeft;
    } else {
      this.offsetX = clamp(this.offsetX, this.size.width - contentRight, -contentLeft);
    }
    if (contentHeight <= visibleHeight) {
      this.offsetY = (visibleHeight - contentHeight) / 2 - contentTop;
    } else {
      this.offsetY = clamp(this.offsetY, visibleHeight - contentBottom, -contentTop);
    }
  }
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}
