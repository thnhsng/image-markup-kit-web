import { createElement, type ReactElement, type ReactNode } from 'react';
import type { LineTool, ShapeTool } from '../editor/tools';
import { shapeOfTool } from '../editor/tools';
import { pathToSVG } from '../geometry/path';
import { shapePath } from '../geometry/path-factory';
import type { RGBAHex } from '../model/color';
import { cssColor } from '../render/canvas-backend';
import { LUCIDE_ICONS, type LucideIconName } from './icons-data';

// Toolbar, menu and action bar icons (ToolbarCatalog.swift). Lucide supplies the symbols; shapes are drawn with the
// editor's own path factory, and the polyline, polygon, curve and line weight glyphs are drawn like Swift draws them.

interface SvgProps {
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly children: ReactNode;
}

function Svg({ size = 24, strokeWidth = 2, children }: SvgProps): ReactElement {
  return (
    <svg
      className="imk-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export type IconName = LucideIconName;

export function Icon({ name, size }: { readonly name: IconName; readonly size?: number }): ReactElement {
  return (
    <Svg size={size}>
      {LUCIDE_ICONS[name].map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
    </Svg>
  );
}

/** A shape tool: the shape itself, from the path factory. */
export function ShapeIcon({ tool, size }: { readonly tool: ShapeTool; readonly size?: number }): ReactElement {
  const { kind, lockAspect } = shapeOfTool(tool);
  const box =
    lockAspect || kind === 'star' || kind === 'pentagon' ? { width: 17, height: 17 } : { width: 19, height: 14 };
  const x = (24 - box.width) / 2;
  const y = (24 - box.height) / 2;
  const d = pathToSVG(shapePath(kind, box, kind === 'speechBubble' ? 3 : 0));
  return (
    <Svg size={size} strokeWidth={1.75}>
      <path d={d} transform={`translate(${x} ${y})`} />
      {kind === 'highlightBox' ? (
        <rect x={x + 3.5} y={y + 3.5} width={box.width - 7} height={box.height - 7} fill="currentColor" stroke="none" />
      ) : null}
    </Svg>
  );
}

const OPEN_PATH = [
  [3.5, 19],
  [9, 6],
  [15, 17],
  [20.5, 5],
] as const;
const CLOSED_PATH = [
  [4, 9],
  [12, 3.5],
  [20, 9],
  [17, 20],
  [7, 20],
] as const;

/** Polyline icon (open zigzag) or polygon icon (closed), with dots on the points. */
export function PathIcon({ closed, size }: { readonly closed: boolean; readonly size?: number }): ReactElement {
  const points = closed ? CLOSED_PATH : OPEN_PATH;
  const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ') + (closed ? ' Z' : '');
  return (
    <Svg size={size} strokeWidth={1.6}>
      <path d={d} />
      {points.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={2} fill="currentColor" stroke="none" />
      ))}
    </Svg>
  );
}

/** S-curve with dots on its ends. */
export function CurveIcon({ size }: { readonly size?: number }): ReactElement {
  return (
    <Svg size={size} strokeWidth={1.6}>
      <path d="M3.5 19 C6 2 18 22 20.5 5" />
      <circle cx={3.5} cy={19} r={2} fill="currentColor" stroke="none" />
      <circle cx={20.5} cy={5} r={2} fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** The icon of a line tool. */
export function LineToolIcon({ tool, size }: { readonly tool: LineTool; readonly size?: number }): ReactElement {
  if (tool === 'polyline') return <PathIcon closed={false} size={size} />;
  if (tool === 'curve') return <CurveIcon size={size} />;
  return <Icon name="arrow" size={size} />;
}

/** Three lines of increasing weight (the Shape Style button). */
export function LineWeightIcon({ size }: { readonly size?: number }): ReactElement {
  return (
    <Svg size={size}>
      <path d="M4 6h16" strokeWidth={1} />
      <path d="M4 11.5h16" strokeWidth={2} />
      <path d="M4 18h16" strokeWidth={3.5} />
    </Svg>
  );
}

/**
 * Color swatch for the Border (outline) and Fill (solid) buttons and the color panels; a null color draws a red
 * "none" slash.
 */
export function Swatch({
  color,
  filled,
  size = 24,
}: {
  readonly color: RGBAHex | null;
  readonly filled: boolean;
  readonly size?: number;
}): ReactElement {
  const inset = 3;
  const side = size - 2 * inset;
  return (
    <svg
      className="imk-swatch"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
    >
      {filled ? (
        <rect
          x={inset}
          y={inset}
          width={side}
          height={side}
          rx={4}
          fill={color === null ? 'var(--imk-surface)' : cssColor(color)}
          stroke="var(--imk-separator)"
          strokeWidth={1}
        />
      ) : (
        <rect
          x={inset + 2}
          y={inset + 2}
          width={side - 4}
          height={side - 4}
          rx={3}
          fill="none"
          stroke={color === null ? 'var(--imk-disabled)' : cssColor(color)}
          strokeWidth={4}
        />
      )}
      {color === null ? (
        <path
          d={`M${inset + side - 1} ${inset + 1} L${inset + 1} ${inset + side - 1}`}
          stroke="var(--imk-danger)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
