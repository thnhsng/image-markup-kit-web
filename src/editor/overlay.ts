import { resolvedPoints } from '../geometry/bindings';
import { boxCorners, worldPoint } from '../geometry/box';
import { lengthOf, pointAtDistance, segments } from '../geometry/line-path';
import { boundingRect, rectHeight, rectWidth, unionRect } from '../geometry/rect';
import { ALL_RESIZE_HANDLES, type HandleKind } from '../geometry/transform';
import { add, distance, rotate, scale } from '../geometry/vec';
import type { MarkupFeatures } from '../features/features';
import type { MarkupDocument, MarkupItem, Point, Rect, Size, UUIDString } from '../model/types';
import { TOUCH_RADIUS } from './interactions';

// Selection chrome in screen space (SelectionOverlayView.swift), so handles keep a constant size at any zoom.

export const HANDLE_RADIUS = 6;
export const ROTATION_KNOB_OFFSET = 28;
/** "+" handles are smaller and grab less, so the line around them can still be dragged. */
export const INSERT_HANDLE_RADIUS = 5;
export const INSERT_TOUCH_RADIUS = 14;
/** Segments shorter than this on screen get no "+" handle. */
export const MINIMUM_INSERT_SEGMENT = 44;

/** Actions of the floating bar above the selection. */
export type SelectionAction =
  | 'editText'
  | 'duplicate'
  | 'bringToFront'
  | 'sendToBack'
  | 'lock'
  | 'unlock'
  | 'delete'
  | 'finishPath'
  | 'closePath'
  | 'openPath'
  | 'deletePoint';

export interface OverlayHandle {
  readonly kind: HandleKind;
  /** Screen position. */
  readonly point: Point;
  readonly touchRadius: number;
}

export interface OverlayDot {
  readonly point: Point;
  /** `bound`: a line end attached to an item; `active`: the line point the user tapped. */
  readonly style: 'normal' | 'bound' | 'active';
}

export interface SelectionOverlay {
  readonly itemID: UUIDString;
  readonly locked: boolean;
  /** Outline of a boxed item (screen polygon), or null for lines. */
  readonly outline: readonly Point[] | null;
  readonly rotationLine: readonly [Point, Point] | null;
  readonly handles: readonly OverlayHandle[];
  readonly dots: readonly OverlayDot[];
  readonly insertHandles: readonly Point[];
  /** Screen bounds of the selection (with the rotation knob), for placing the action bar. */
  readonly bounds: Rect | null;
  readonly actions: readonly SelectionAction[];
  /** While a polyline is drawn, the bar sits at the bottom, away from where the next point goes. */
  readonly pinsActionBarToBottom: boolean;
}

/** Selection chrome for `item`. `toScreen` maps canvas points to screen points; `zoom` is the viewport zoom. */
export function selectionOverlay(
  item: MarkupItem,
  document: MarkupDocument,
  toScreen: (point: Point) => Point,
  zoom: number,
  options: { actions: readonly SelectionAction[]; activeVertex: number | null; isDrawing: boolean },
): SelectionOverlay {
  const handles: OverlayHandle[] = [];
  const dots: OverlayDot[] = [];
  const insertHandles: Point[] = [];
  let outline: Point[] | null = null;
  let rotationLine: [Point, Point] | null = null;
  let bounds: Rect;

  if (item.type === 'line') {
    const line = item.content;
    const points = resolvedPoints(line, document);
    const screenPoints = points.map(toScreen);
    const parts = segments(points, line.kind, line.isClosed);
    // Curves can swing outside their points.
    bounds = boundingRect([...parts.flat().map(toScreen), ...screenPoints]);
    if (!item.isLocked) {
      const last = screenPoints.length - 1;
      screenPoints.forEach((point, index) => {
        handles.push({ kind: { kind: 'lineVertex', index }, point, touchRadius: TOUCH_RADIUS });
        const isBound = (index === 0 && line.start.binding !== null) || (index === last && line.end.binding !== null);
        dots.push({ point, style: index === options.activeVertex ? 'active' : isBound ? 'bound' : 'normal' });
      });
      if (line.kind !== 'straight' && !options.isDrawing) {
        parts.forEach((part, index) => {
          const partLength = lengthOf(part);
          if (partLength * zoom < MINIMUM_INSERT_SEGMENT) return;
          const point = toScreen(pointAtDistance(partLength / 2, part));
          handles.push({ kind: { kind: 'lineInsert', index }, point, touchRadius: INSERT_TOUCH_RADIUS });
          insertHandles.push(point);
        });
      }
    }
  } else {
    const box = item.content.box;
    const corners = boxCorners(box).map(toScreen);
    outline = corners;
    bounds = boundingRect(corners);
    if (!item.isLocked) {
      // Fewer handles on items that are small on screen, so they stay individually grabbable.
      const smaller = Math.min(rectWidth(box.frame), rectHeight(box.frame)) * zoom;
      const kinds: readonly HandleKind[] =
        item.type === 'text'
          ? [
              { kind: 'resize', u: 0, v: 0.5 },
              { kind: 'resize', u: 1, v: 0.5 },
            ]
          : smaller < 36
            ? [{ kind: 'resize', u: 1, v: 1 }]
            : smaller < 72
              ? [
                  { kind: 'resize', u: 0, v: 0 },
                  { kind: 'resize', u: 1, v: 0 },
                  { kind: 'resize', u: 1, v: 1 },
                  { kind: 'resize', u: 0, v: 1 },
                ]
              : ALL_RESIZE_HANDLES;
      for (const kind of kinds) {
        if (kind.kind !== 'resize') continue;
        const point = toScreen(worldPoint(box, { x: kind.u, y: kind.v }));
        handles.push({ kind, point, touchRadius: TOUCH_RADIUS });
        dots.push({ point, style: 'normal' });
      }
      // Rotation knob above the top edge, in the box's rotated "up" direction.
      const top = toScreen(worldPoint(box, { x: 0.5, y: 0 }));
      const knob = add(top, scale(rotate({ x: 0, y: -1 }, box.rotation), ROTATION_KNOB_OFFSET));
      rotationLine = [top, knob];
      handles.push({ kind: { kind: 'rotate' }, point: knob, touchRadius: TOUCH_RADIUS });
      dots.push({ point: knob, style: 'normal' });
      bounds = unionRect(bounds, { x: knob.x, y: knob.y, width: 0, height: 0 });
    }
  }
  return {
    itemID: item.id,
    locked: item.isLocked,
    outline,
    rotationLine,
    handles,
    dots,
    insertHandles,
    bounds,
    actions: options.actions,
    pinsActionBarToBottom: options.isDrawing,
  };
}

/** The handle under a screen point, nearest first. */
export function handleAt(overlay: SelectionOverlay | null, point: Point): HandleKind | null {
  if (!overlay) return null;
  let best: OverlayHandle | null = null;
  let bestDistance = Infinity;
  for (const handle of overlay.handles) {
    const d = distance(handle.point, point);
    if (d <= handle.touchRadius && d < bestDistance) {
      best = handle;
      bestDistance = d;
    }
  }
  return best?.kind ?? null;
}

/**
 * Actions for the selected item, minus those turned off (Unlock always stays, so a locked item never gets stuck;
 * the polyline actions come with the tools).
 */
export function actionsFor(
  item: MarkupItem,
  features: MarkupFeatures,
  options: { isDrawingPolyline: boolean; activeVertex: number | null },
): SelectionAction[] {
  if (item.isLocked) return ['unlock'];
  const actions: SelectionAction[] = [];
  if (item.type === 'line' && item.content.kind !== 'straight') {
    const count = item.content.waypoints.length + 2;
    const canClose = count >= 3;
    if (options.isDrawingPolyline) return canClose ? ['finishPath', 'closePath'] : ['finishPath'];
    if (options.activeVertex !== null && count > 2) actions.push('deletePoint');
    if (item.content.isClosed) actions.push('openPath');
    else if (canClose) actions.push('closePath');
  }
  if (item.type === 'text') actions.push('editText');
  actions.push('duplicate', 'bringToFront', 'sendToBack', 'lock', 'delete');
  return actions.filter((action) => {
    switch (action) {
      case 'editText':
      case 'duplicate':
      case 'bringToFront':
      case 'sendToBack':
      case 'lock':
      case 'delete':
        return features.isEnabled(action);
      default:
        return true;
    }
  });
}

export const ACTION_BUTTON_SIZE = 40;

/** Size of the action bar for `count` buttons. */
export function actionBarSize(count: number): Size {
  return { width: count * ACTION_BUTTON_SIZE + Math.max(count - 1, 0) * 2 + 12, height: ACTION_BUTTON_SIZE + 4 };
}

/**
 * Where the action bar goes: 14 points above the selection (below it when there is no room), kept on screen, or
 * pinned to the bottom center while a polyline is drawn. Null when it should be hidden.
 */
export function actionBarOrigin(
  overlay: SelectionOverlay,
  viewSize: Size,
  insets: { top: number; bottom: number } = { top: 0, bottom: 0 },
): Point | null {
  if (!overlay.bounds || overlay.actions.length === 0) return null;
  const size = actionBarSize(overlay.actions.length);
  const margin = 8;
  if (overlay.pinsActionBarToBottom) {
    return { x: (viewSize.width - size.width) / 2, y: viewSize.height - insets.bottom - size.height - 12 };
  }
  const bounds = overlay.bounds;
  let y = bounds.y - size.height - 14;
  if (y < insets.top + margin) y = bounds.y + bounds.height + 14;
  y = Math.min(Math.max(y, insets.top + margin), viewSize.height - insets.bottom - size.height - margin);
  let x = bounds.x + bounds.width / 2 - size.width / 2;
  x = Math.min(Math.max(x, margin), viewSize.width - size.width - margin);
  // Hidden when the selection is off screen.
  const visible =
    bounds.x - 40 < viewSize.width &&
    bounds.x + bounds.width + 40 > 0 &&
    bounds.y - 40 < viewSize.height &&
    bounds.y + bounds.height + 40 > 0;
  return visible ? { x, y } : null;
}
