import type { ShapeKind } from '../model/types';

/** Shape tools, named after their Shapes menu entries. Circle and square are aspect-locked ellipse and rectangle. */
export type ShapeTool =
  | 'rectangle'
  | 'roundedRectangle'
  | 'oval'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'pentagon'
  | 'speechBubble'
  | 'highlightBox';

/** The line tools of the Arrow menu. */
export type LineTool = 'arrow' | 'polyline' | 'curve';

/** The active tool of the editor. Every tool except `select` is named after the feature that offers it. */
export type MarkupTool = 'select' | 'pen' | 'highlighter' | ShapeTool | LineTool | 'text' | 'note' | 'eraser';

/** Shape tools in Shapes menu order. */
export const SHAPE_TOOLS: readonly ShapeTool[] = [
  'rectangle',
  'roundedRectangle',
  'oval',
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'pentagon',
  'speechBubble',
  'highlightBox',
];

/** Line tools in Arrow menu order. */
export const LINE_TOOLS: readonly LineTool[] = ['arrow', 'polyline', 'curve'];

export function isShapeTool(tool: MarkupTool): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly string[]).includes(tool);
}

export function isLineTool(tool: MarkupTool): tool is LineTool {
  return (LINE_TOOLS as readonly string[]).includes(tool);
}

/** The shape a shape tool draws. */
export function shapeOfTool(tool: ShapeTool): { readonly kind: ShapeKind; readonly lockAspect: boolean } {
  switch (tool) {
    case 'oval':
      return { kind: 'ellipse', lockAspect: false };
    case 'circle':
      return { kind: 'ellipse', lockAspect: true };
    case 'square':
      return { kind: 'rectangle', lockAspect: true };
    default:
      return { kind: tool, lockAspect: false };
  }
}

/** The shape tool that draws a shape (`MarkupFeature(shape:lockAspect:)`). */
export function toolOfShape(kind: ShapeKind, lockAspect: boolean): ShapeTool {
  if (kind === 'rectangle') return lockAspect ? 'square' : 'rectangle';
  if (kind === 'ellipse') return lockAspect ? 'circle' : 'oval';
  return kind;
}

/** Tools that draw continuously stay active after each use; the others return to Select, as in Preview. */
export function staysActiveAfterUse(tool: MarkupTool): boolean {
  return tool === 'select' || tool === 'pen' || tool === 'highlighter' || tool === 'eraser';
}
