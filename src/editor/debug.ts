import { resolvedPoints } from '../geometry/bindings';
import { boxCenter, worldPoint } from '../geometry/box';
import type { BoardArrangement } from '../geometry/board-layout';
import { insertionPoints, lengthOf, pointAtDistance, samplesOf } from '../geometry/line-path';
import { add, rotate, rotateAround, scale } from '../geometry/vec';
import { itemBox } from '../model/document';
import type { RGBAHex } from '../model/color';
import type { MarkupItem, Point } from '../model/types';
import type { EditorController, PanelKind } from './controller';
import {
  LineInsertInteraction,
  LineVertexInteraction,
  makeToolInteraction,
  MoveInteraction,
  ResizeInteraction,
  RotateInteraction,
  type CanvasInteraction,
} from './interactions';
import type { MarkupTool } from './tools';

// Scripted gestures for tests, screenshots and manual QA (MarkupEditorViewController+Debug.swift). They drive the
// same interaction objects pointers drive, so they exercise the real move/resize/rotate/draw code (everything except
// pointer delivery). Points are in canvas units.

export type MarkupDebugGesture =
  /** Drags the item at `itemIndex` (document order) by `by`. */
  | { readonly type: 'drag'; readonly itemIndex: number; readonly by: Point }
  /** Drags the resize handle at normalized (u, v) by `by`. */
  | { readonly type: 'resize'; readonly itemIndex: number; readonly u: number; readonly v: number; readonly by: Point }
  /** Rotates with the rotation handle by `degrees` (clockwise). */
  | { readonly type: 'rotate'; readonly itemIndex: number; readonly degrees: number }
  /** One stroke with a tool through `points`. */
  | { readonly type: 'draw'; readonly tool: MarkupTool; readonly points: readonly Point[] }
  /** Separate taps with a tool, one per point (e.g. the points of a polyline). */
  | { readonly type: 'taps'; readonly tool: MarkupTool; readonly points: readonly Point[] }
  /** Drags point `vertex` (0 = start) of the line at `itemIndex` by `by`. */
  | { readonly type: 'dragLineVertex'; readonly itemIndex: number; readonly vertex: number; readonly by: Point }
  /** Drags a new point out of the "+" handle of `segment` of the polyline or curve at `itemIndex`. */
  | { readonly type: 'insertLineVertex'; readonly itemIndex: number; readonly segment: number; readonly by: Point };

/** Scripted editing of an open editor. */
export interface MarkupDebugDriver {
  perform(gesture: MarkupDebugGesture): void;
  /** Starts editing the text item at `itemIndex`. */
  beginEditingText(itemIndex: number): void;
  /** Types into the text box being edited. */
  typeText(text: string): void;
  /** Opens a style panel. */
  presentPanel(kind: PanelKind): void;
  arrange(arrangement: BoardArrangement): void;
  /** Same as picking a fill color in the Fill panel (applies to the selection). */
  setFill(color: RGBAHex | null): void;
  zoomToFit(): void;
}

export function createDebugDriver(editor: EditorController): MarkupDebugDriver {
  return {
    perform: (gesture) => performDebugGesture(editor, gesture),
    beginEditingText(itemIndex) {
      const item = itemAtIndex(editor, itemIndex);
      if (item?.type === 'text') editor.beginTextEditing(item.id, false);
    },
    typeText(text) {
      const session = editor.textEditing;
      if (session) editor.setEditingText(session.text + text);
    },
    presentPanel(kind) {
      if (editor.openPanel !== kind) editor.togglePanel(kind);
    },
    arrange: (arrangement) => editor.arrange(arrangement),
    setFill: (color) => editor.store.updateStyle((style) => ({ ...style, fillColor: color })),
    zoomToFit: () => editor.zoomToFit(),
  };
}

export function performDebugGesture(editor: EditorController, gesture: MarkupDebugGesture): void {
  const store = editor.store;
  switch (gesture.type) {
    case 'drag': {
      const item = itemAtIndex(editor, gesture.itemIndex);
      if (!item) return;
      store.select([item.id]);
      run(new MoveInteraction(editor, item.id), steps(anchorPoint(editor, item), gesture.by));
      return;
    }
    case 'resize': {
      const item = itemAtIndex(editor, gesture.itemIndex);
      const box = item ? itemBox(item) : null;
      if (!item || !box) return;
      store.select([item.id]);
      const start = worldPoint(box, { x: gesture.u, y: gesture.v });
      run(new ResizeInteraction(editor, item.id, gesture.u, gesture.v), steps(start, gesture.by));
      return;
    }
    case 'rotate': {
      const item = itemAtIndex(editor, gesture.itemIndex);
      const box = item ? itemBox(item) : null;
      if (!item || !box) return;
      store.select([item.id]);
      const start = add(worldPoint(box, { x: 0.5, y: 0 }), rotate({ x: 0, y: -40 }, box.rotation));
      const end = rotateAround(start, (gesture.degrees * Math.PI) / 180, boxCenter(box));
      run(new RotateInteraction(editor, item.id), [start, end]);
      return;
    }
    case 'draw': {
      if (gesture.points.length === 0) return;
      store.tool = gesture.tool;
      const interaction = makeToolInteraction(gesture.tool, editor);
      if (interaction) run(interaction, gesture.points);
      return;
    }
    case 'taps':
      store.tool = gesture.tool;
      for (const point of gesture.points) {
        // Finishing a polyline returns to Select, which ends the taps.
        const interaction = makeToolInteraction(store.tool, editor);
        if (!interaction) return;
        run(interaction, [point]);
      }
      return;
    case 'dragLineVertex': {
      const item = itemAtIndex(editor, gesture.itemIndex);
      if (item?.type !== 'line') return;
      const start = resolvedPoints(item.content, store.document)[gesture.vertex];
      if (!start) return;
      store.select([item.id]);
      run(new LineVertexInteraction(editor, item.id, gesture.vertex), steps(start, gesture.by));
      return;
    }
    case 'insertLineVertex': {
      const item = itemAtIndex(editor, gesture.itemIndex);
      if (item?.type !== 'line') return;
      const line = item.content;
      const handles = insertionPoints(resolvedPoints(line, store.document), line.kind, line.isClosed);
      const start = handles[gesture.segment];
      if (!start) return;
      store.select([item.id]);
      run(new LineInsertInteraction(editor, item.id, gesture.segment), steps(start, gesture.by));
      return;
    }
  }
}

function itemAtIndex(editor: EditorController, index: number): MarkupItem | undefined {
  return editor.store.document.items[index];
}

/** Where a drag grabs an item: the middle of a line, the center of a box. */
function anchorPoint(editor: EditorController, item: MarkupItem): Point {
  if (item.type === 'line') {
    const samples = samplesOf(item.content, editor.store.document);
    return pointAtDistance(lengthOf(samples) / 2, samples);
  }
  return boxCenter(item.content.box);
}

/** A drag from `start` by `delta`, through its middle. */
function steps(start: Point, delta: Point): Point[] {
  return [start, add(start, scale(delta, 0.5)), add(start, delta)];
}

function run(interaction: CanvasInteraction, points: readonly Point[]): void {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return;
  interaction.begin(first);
  for (const point of points.slice(1)) interaction.move(point, [point], []);
  interaction.end(last);
}
