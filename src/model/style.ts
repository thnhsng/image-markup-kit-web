import { MarkupColors, withAlpha } from './color';
import type { FontSpec, ItemStyle, StyleDefaults } from './types';

/** `ItemStyle()`: red border 6 units wide, no fill, solid, opaque. Also the style of an item stored without one. */
export const DEFAULT_ITEM_STYLE: ItemStyle = {
  strokeColor: MarkupColors.red,
  fillColor: null,
  lineWidth: 6,
  dash: 'solid',
  opacity: 1,
  cornerRadius: 0,
  shadow: false,
};

/** `FontSpec()`: system font, 36 units, regular. */
export const DEFAULT_FONT: FontSpec = { family: 'system', size: 36, bold: false, italic: false };

/** A style built from `DEFAULT_ITEM_STYLE` with some fields changed. */
export function itemStyle(changes: Partial<ItemStyle> = {}): ItemStyle {
  return { ...DEFAULT_ITEM_STYLE, ...changes };
}

/** Stroke width actually drawn: 0 when there is no stroke color. */
export function effectiveLineWidth(style: ItemStyle): number {
  return style.strokeColor === null ? 0 : style.lineWidth;
}

/** The defaults of the Swift package (`StyleDefaults.standard`). */
export const STANDARD_STYLE_DEFAULTS: StyleDefaults = {
  shape: itemStyle({ strokeColor: MarkupColors.red, lineWidth: 6 }),
  highlightBox: itemStyle({
    strokeColor: null,
    fillColor: withAlpha(MarkupColors.highlighterYellow, 0.45),
    lineWidth: 0,
    cornerRadius: 4,
  }),
  line: itemStyle({ strokeColor: MarkupColors.red, lineWidth: 6 }),
  lineStartHead: 'none',
  lineEndHead: 'arrow',
  pathStartHead: 'none',
  pathEndHead: 'none',
  pen: itemStyle({ strokeColor: MarkupColors.red, lineWidth: 6 }),
  highlighter: itemStyle({ strokeColor: MarkupColors.highlighterYellow, lineWidth: 24, opacity: 0.45 }),
  text: itemStyle({ strokeColor: null, lineWidth: 2 }),
  textFont: { family: 'system', size: 36, bold: true, italic: false },
  textColor: MarkupColors.red,
  note: itemStyle({
    strokeColor: MarkupColors.noteBorder,
    fillColor: MarkupColors.noteYellow,
    lineWidth: 2,
    cornerRadius: 6,
    shadow: true,
  }),
  noteFont: { family: 'system', size: 28, bold: false, italic: false },
  noteTextColor: '#1C1C1EFF',
  textAlignment: 'left',
};
