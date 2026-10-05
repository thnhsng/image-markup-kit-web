import { boxToWorld } from '../geometry/box';
import { rectHeight, rectWidth } from '../geometry/rect';
import { rectPath, roundedRectPath, type Path } from '../geometry/path';
import {
  dashPattern,
  lineCapFor,
  lineGeometryOf,
  lineJoinFor,
  shapePath,
  smoothedPath,
  strokePoints,
  type LineCap,
  type LineJoin,
} from '../geometry/path-factory';
import type { Affine } from '../geometry/affine';
import type { RGBAHex } from '../model/color';
import type { ItemStyle, MarkupDocument, MarkupItem, Rect, TextContent } from '../model/types';
import { cssFont, type FontStacks } from '../text/font-stacks';
import type { TextMeasurer } from '../text/measurer';
import { layoutText, type TextLine } from '../text/text-layout';

// One description of how an item looks (ItemDrawing.swift), rendered by both the SVG view and the canvas exporter,
// so the screen and the exported image cannot drift apart.

export interface StrokeStyle {
  readonly color: RGBAHex;
  readonly width: number;
  readonly join: LineJoin;
  readonly cap: LineCap;
  /** Dash lengths in canvas units, or null for a solid line. */
  readonly dash: readonly number[] | null;
  readonly miterLimit: number;
}

export type DisplayNode =
  | {
      readonly kind: 'group';
      readonly transform: Affine | null;
      readonly children: readonly DisplayNode[];
    }
  | {
      readonly kind: 'path';
      readonly path: Path;
      readonly fill: RGBAHex | null;
      readonly stroke: StrokeStyle | null;
    }
  | {
      readonly kind: 'text';
      readonly lines: readonly TextLine[];
      readonly font: string;
      readonly fontSize: number;
      readonly color: RGBAHex;
    }
  | {
      readonly kind: 'image';
      readonly assetID: string;
      readonly width: number;
      readonly height: number;
    };

/** An item ready to draw: its content plus the item-level effects drawn as one layer (opacity and shadow). */
export interface DisplayItem {
  readonly id: string;
  /** Opacity of the whole item, 0…1. */
  readonly opacity: number;
  /** A drop shadow under the whole item: black at 30%, 3 units down, blur 8 units. */
  readonly shadow: boolean;
  readonly content: DisplayNode;
}

/** The drop shadow of `style.shadow`, in canvas units. */
export const SHADOW = { offsetY: 3, blur: 8, opacity: 0.3 } as const;
/** Fill of a photo whose image is missing or not decoded yet (iOS systemGray5). */
export const IMAGE_PLACEHOLDER: RGBAHex = '#E5E5EAFF';

export interface DisplayEnvironment {
  readonly measurer: TextMeasurer;
  readonly fontStacks?: FontStacks;
}

function stroke(style: ItemStyle, color: RGBAHex, join: LineJoin, cap: LineCap): StrokeStyle {
  return {
    color,
    width: style.lineWidth,
    join,
    cap: lineCapFor(style.dash, cap),
    dash: dashPattern(style.dash, style.lineWidth),
    miterLimit: 10,
  };
}

/** Fill, then stroke when there is a stroke color and a positive width. */
function fillAndStroke(path: Path, style: ItemStyle, join: LineJoin): DisplayNode {
  return {
    kind: 'path',
    path,
    fill: style.fillColor,
    stroke: style.strokeColor !== null && style.lineWidth > 0 ? stroke(style, style.strokeColor, join, 'butt') : null,
  };
}

/** `CGPath(roundedRect:cornerWidth:cornerHeight:)`, which is a plain rect for a zero radius. */
function cgRoundedRect(rect: Rect, radius: number): Path {
  return radius > 0 ? roundedRectPath(rect, radius) : rectPath(rect);
}

function textNodes(content: TextContent, style: ItemStyle, env: DisplayEnvironment): DisplayNode[] {
  const size = { width: content.box.frame.width, height: content.box.frame.height };
  const nodes: DisplayNode[] = [];
  if (style.fillColor !== null || style.strokeColor !== null) {
    const rect = { x: 0, y: 0, width: size.width, height: size.height };
    const radius = Math.min(style.cornerRadius, rectWidth(rect) / 2, rectHeight(rect) / 2);
    nodes.push(fillAndStroke(cgRoundedRect(rect, radius), style, 'round'));
  }
  const layout = layoutText(content, size, env.measurer);
  if (layout.lines.length > 0) {
    nodes.push({
      kind: 'text',
      lines: layout.lines,
      font: cssFont(content.font, env.fontStacks),
      fontSize: Math.max(content.font.size, 1),
      color: content.color,
    });
  }
  return nodes;
}

function contentNode(item: MarkupItem, document: MarkupDocument, env: DisplayEnvironment): DisplayNode {
  const style = item.style;
  switch (item.type) {
    case 'image': {
      const { width, height } = item.content.box.frame;
      const children: DisplayNode[] = [{ kind: 'image', assetID: item.content.assetID, width, height }];
      if (style.strokeColor !== null && style.lineWidth > 0) {
        children.push({
          kind: 'path',
          path: rectPath({ x: 0, y: 0, width, height }),
          fill: null,
          stroke: stroke(style, style.strokeColor, 'miter', 'butt'),
        });
      }
      return { kind: 'group', transform: boxToWorld(item.content.box), children };
    }
    case 'shape': {
      const { kind, box } = item.content;
      const path = shapePath(kind, { width: box.frame.width, height: box.frame.height }, style.cornerRadius);
      return { kind: 'group', transform: boxToWorld(box), children: [fillAndStroke(path, style, lineJoinFor(kind))] };
    }
    case 'text':
      return { kind: 'group', transform: boxToWorld(item.content.box), children: textNodes(item.content, style, env) };
    case 'stroke': {
      const children: DisplayNode[] =
        style.strokeColor === null
          ? []
          : [
              {
                kind: 'path',
                path: smoothedPath(strokePoints(item.content)),
                fill: null,
                stroke: stroke(style, style.strokeColor, 'round', 'round'),
              },
            ];
      return { kind: 'group', transform: boxToWorld(item.content.box), children };
    }
    case 'line': {
      const line = item.content;
      const geometry = lineGeometryOf(line, document, style.lineWidth);
      const children: DisplayNode[] = [];
      if (line.isClosed && style.fillColor !== null) {
        children.push({ kind: 'path', path: geometry.shaft, fill: style.fillColor, stroke: null });
      }
      if (style.strokeColor !== null) {
        children.push({
          kind: 'path',
          path: geometry.shaft,
          fill: null,
          stroke: stroke(style, style.strokeColor, 'round', 'round'),
        });
        if (geometry.heads)
          children.push({ kind: 'path', path: geometry.heads, fill: style.strokeColor, stroke: null });
      }
      return { kind: 'group', transform: null, children };
    }
  }
}

/** How one item is drawn, in canvas units. */
export function displayItem(item: MarkupItem, document: MarkupDocument, env: DisplayEnvironment): DisplayItem {
  return {
    id: item.id,
    opacity: Math.min(Math.max(item.style.opacity, 0), 1),
    shadow: item.style.shadow,
    content: contentNode(item, document, env),
  };
}

/** Whether an item must be drawn as one layer (group opacity or a shadow), like a CoreGraphics transparency layer. */
export function needsLayer(item: DisplayItem): boolean {
  return item.opacity < 0.999 || item.shadow;
}
