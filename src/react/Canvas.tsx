import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import type { EditorController, PointerInput } from '../editor/controller';
import { HANDLE_RADIUS, INSERT_HANDLE_RADIUS } from '../editor/overlay';
import { boxCorners } from '../geometry/box';
import { pathToSVG } from '../geometry/path';
import { dashPattern, smoothedPath } from '../geometry/path-factory';
import { backgroundItem, findItem, itemBox } from '../model/document';
import type { Point } from '../model/types';
import { cssColor } from '../render/canvas-backend';
import type { DisplayEnvironment } from '../render/display-list';
import { ItemsLayer } from './svg';

// The canvas: items as SVG in canvas units under the viewport transform, transient previews above them, and the
// selection chrome in screen units on top (SelectionOverlayView), so handles keep their size at any zoom.

let nextCanvasID = 0;

interface CanvasProps {
  readonly controller: EditorController;
  /** Changes whenever the controller does; the canvas re-renders with it. */
  readonly version: number;
  readonly env: DisplayEnvironment;
  readonly images: ReadonlyMap<string, string>;
  /** Called after every pointer down reached the controller (the editor then takes the keyboard focus). */
  readonly onCanvasPointerDown: () => void;
  /** The in-place text editor, focused when a tap starts editing (so phones show their keyboard). */
  readonly textEditorRef: RefObject<HTMLTextAreaElement>;
}

function localPoint(element: Element, event: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pointerInput(element: Element, event: ReactPointerEvent): PointerInput {
  const point = localPoint(element, event);
  const native = event.nativeEvent;
  const coalesced =
    typeof native.getCoalescedEvents === 'function'
      ? native.getCoalescedEvents().map((sample) => localPoint(element, sample))
      : undefined;
  const predicted =
    typeof native.getPredictedEvents === 'function'
      ? native.getPredictedEvents().map((sample) => localPoint(element, sample))
      : undefined;
  return {
    id: event.pointerId,
    x: point.x,
    y: point.y,
    pointerType: event.pointerType,
    timeStamp: event.timeStamp,
    button: event.button,
    coalesced,
    predicted,
  };
}

/** Pixels per line or page of `WheelEvent.deltaMode`. */
function wheelScale(event: WheelEvent, height: number): number {
  if (event.deltaMode === 1) return 16;
  if (event.deltaMode === 2) return height;
  return 1;
}

interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

export function Canvas({
  controller,
  version,
  env,
  images,
  onCanvasPointerDown,
  textEditorRef,
}: CanvasProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  // Touch pointers down: on iOS a two-finger pinch also sends Safari's gesture events, which must not zoom twice.
  const touches = useRef(new Set<number>());
  // Ids for url(#…) references, unique in the page and made of plain characters (React's useId adds colons).
  const [ids] = useState(() => {
    nextCanvasID += 1;
    return { shadow: `imk-shadow-${nextCanvasID}`, clip: `imk-clip-${nextCanvasID}` };
  });

  // The canvas size drives the zoom: fit on the first layout, keep the zoom afterwards.
  useEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      controller.setViewportSize(rect.width, rect.height);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [controller]);

  // Wheel scrolls and zooms, Safari's trackpad pinch zooms; both must be able to prevent the page from scrolling.
  useEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(node, event);
      const scale = wheelScale(event, node.clientHeight);
      controller.wheel({
        x: point.x,
        y: point.y,
        deltaX: event.deltaX * scale,
        deltaY: event.deltaY * scale,
        zoom: event.ctrlKey || event.metaKey,
      });
    };
    let gestureZoom = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureZoom = controller.viewport.zoom;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      // Touch pinches arrive as pointers too; only trackpad pinches (macOS Safari) zoom from here.
      if (touches.current.size > 0) return;
      const gesture = event as GestureEvent;
      controller.zoomAround(localPoint(node, gesture), gestureZoom * gesture.scale);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('gesturestart', onGestureStart);
    node.addEventListener('gesturechange', onGestureChange);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('gesturestart', onGestureStart);
      node.removeEventListener('gesturechange', onGestureChange);
    };
  }, [controller]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Mouse: the primary and middle buttons only (the context menu stays the browser's).
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
    const node = event.currentTarget;
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      // Some pointers cannot be captured (e.g. already released); events still arrive while over the canvas.
    }
    if (event.button === 1) event.preventDefault();
    if (event.pointerType === 'touch') touches.current.add(event.pointerId);
    controller.pointerDown(pointerInput(node, event));
    // Only now may the editor take the focus: that blurs the text box, and the pointer must first end its edit (a
    // pointer outside the text being edited does nothing else).
    onCanvasPointerDown();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    controller.pointerMove(pointerInput(event.currentTarget, event));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    controller.pointerUp(pointerInput(event.currentTarget, event));
    // Focus inside the release handler, which phones count as a user gesture that may show the keyboard.
    if (controller.isEditingText()) textEditorRef.current?.focus({ preventScroll: true });
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    controller.pointerCancel(pointerInput(event.currentTarget, event));
  };

  const viewport = controller.viewport;
  const zoom = viewport.zoom;
  const store = controller.store;
  const document = store.displayed;
  const photo = document.kind === 'image' ? backgroundItem(document) : undefined;
  const clip = photo?.content.box.frame;
  const transform = `matrix(${zoom} 0 0 ${zoom} ${viewport.offsetX} ${viewport.offsetY})`;
  const background = document.kind === 'board' ? cssColor(document.backgroundColor) : undefined;

  return (
    <div
      ref={element}
      className="imk-canvas"
      data-testid="markup.canvas"
      data-tool={store.tool}
      data-version={version}
      style={background ? { background } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <svg className="imk-content" aria-hidden="true">
        {clip ? (
          <defs>
            <clipPath id={ids.clip}>
              <rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} />
            </clipPath>
          </defs>
        ) : null}
        <g transform={transform}>
          <g clipPath={clip ? `url(#${ids.clip})` : undefined}>
            <ItemsLayer
              document={document}
              hidden={controller.hiddenItemIDs}
              env={env}
              images={images}
              idPrefix={ids.shadow}
            />
            <Previews controller={controller} />
          </g>
        </g>
      </svg>
      <SelectionChrome controller={controller} />
    </div>
  );
}

/** The pen stroke being drawn, the first point of a polyline and the eraser, in canvas units. */
function Previews({ controller }: { readonly controller: EditorController }): ReactElement {
  const zoom = controller.zoom;
  const pen = controller.penPreview;
  const pending = controller.polylineDraft.pendingStart;
  const eraser = controller.eraserCursor;
  const penStroke = pen?.style.strokeColor ?? null;
  const penDash = pen ? dashPattern(pen.style.dash, pen.style.lineWidth) : null;
  return (
    <g className="imk-previews">
      {pen && penStroke ? (
        <path
          d={pathToSVG(smoothedPath(pen.points))}
          fill="none"
          stroke={cssColor(penStroke)}
          strokeWidth={pen.style.lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={penDash ? penDash.join(' ') : undefined}
          opacity={pen.style.opacity}
        />
      ) : null}
      {pending ? (
        <circle
          cx={pending.point.x}
          cy={pending.point.y}
          r={Math.max(pending.style.lineWidth * 1.6, 8 / zoom) / 2}
          fill={cssColor(pending.style.strokeColor ?? '#FF3B30FF')}
          stroke="#FFFFFF"
          strokeWidth={1.5 / zoom}
        />
      ) : null}
      {eraser ? (
        <circle
          cx={eraser.center.x}
          cy={eraser.center.y}
          r={eraser.radius}
          fill="rgba(142, 142, 147, 0.25)"
          stroke="rgb(142, 142, 147)"
          strokeWidth={1 / zoom}
        />
      ) : null}
    </g>
  );
}

function polygonPoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

/** Handles, outline and the item a line end will attach to, in screen units. */
function SelectionChrome({ controller }: { readonly controller: EditorController }): ReactElement {
  const overlay = controller.overlay;
  const viewport = controller.viewport;
  const target = controller.bindTargetID ? findItem(controller.store.displayed, controller.bindTargetID) : undefined;
  const targetBox = target ? itemBox(target) : null;
  const targetCorners = targetBox ? boxCorners(targetBox).map((point) => viewport.canvasToScreen(point)) : null;
  const arm = INSERT_HANDLE_RADIUS * 0.55;
  return (
    <svg className="imk-overlay" aria-hidden="true" data-testid="markup.overlay">
      {targetCorners ? (
        <polygon
          points={polygonPoints(targetCorners)}
          fill="var(--imk-success)"
          fillOpacity={0.12}
          stroke="var(--imk-success)"
          strokeWidth={3}
        />
      ) : null}
      {overlay ? (
        <g>
          {overlay.outline ? (
            <polygon
              points={polygonPoints(overlay.outline)}
              fill="none"
              stroke={overlay.locked ? 'rgb(142, 142, 147)' : 'var(--imk-accent)'}
              strokeWidth={1.5}
            />
          ) : null}
          {overlay.rotationLine ? (
            <line
              x1={overlay.rotationLine[0].x}
              y1={overlay.rotationLine[0].y}
              x2={overlay.rotationLine[1].x}
              y2={overlay.rotationLine[1].y}
              stroke="var(--imk-accent)"
              strokeWidth={1.5}
            />
          ) : null}
          {overlay.insertHandles.map((point, index) => (
            <g key={`insert-${index}`} data-handle="insert">
              <circle
                cx={point.x}
                cy={point.y}
                r={INSERT_HANDLE_RADIUS}
                fill="rgba(255, 255, 255, 0.9)"
                stroke="var(--imk-accent)"
                strokeOpacity={0.8}
                strokeWidth={1}
              />
              <path
                d={`M${point.x - arm} ${point.y}H${point.x + arm}M${point.x} ${point.y - arm}V${point.y + arm}`}
                stroke="var(--imk-accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </g>
          ))}
          {overlay.dots.map((dot, index) => (
            <circle
              key={`dot-${index}`}
              data-handle={dot.style}
              cx={dot.point.x}
              cy={dot.point.y}
              r={HANDLE_RADIUS}
              fill={
                dot.style === 'normal' ? '#FFFFFF' : dot.style === 'bound' ? 'var(--imk-success)' : 'var(--imk-accent)'
              }
              stroke={dot.style === 'normal' ? 'var(--imk-accent)' : '#FFFFFF'}
              strokeWidth={dot.style === 'active' ? 2 : 1.5}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
