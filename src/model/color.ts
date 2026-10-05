import { swiftRound } from './swift-math';

/**
 * An sRGB color with alpha, written `#RRGGBBAA` (uppercase hex, 8 bits per component), the document.json encoding.
 */
export type RGBAHex = string;

/** Foundation's `.whitespacesAndNewlines`: Unicode separators, tab, LF…CR and NEL. */
const SWIFT_WHITESPACE = /^[\p{Z}\t\n\v\f\r\u0085]+|[\p{Z}\t\n\v\f\r\u0085]+$/gu;

function hexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Parses `RRGGBB` or `RRGGBBAA` hex digits (any case), with an optional leading `#` and surrounding whitespace,
 * like `RGBAColor(hex:)`. Six digits mean an opaque color. Returns the canonical `#RRGGBBAA` form, or null.
 */
export function parseHexColor(hex: string): RGBAHex | null {
  let text = hex.replace(SWIFT_WHITESPACE, '');
  if (text.startsWith('#')) text = text.slice(1);
  if (text.length !== 6 && text.length !== 8) return null;
  // Swift reads the digits with `UInt64(_:radix:)`, which also accepts a leading sign.
  const match = /^([+-]?)([0-9a-fA-F]+)$/.exec(text);
  if (!match) return null;
  const value = parseInt(match[2] ?? '', 16);
  if (match[1] === '-' && value !== 0) return null;
  const hasAlpha = text.length === 8;
  const byte = (shift: number) => Math.floor(value / 2 ** shift) % 256;
  const components = hasAlpha ? [byte(24), byte(16), byte(8), byte(0)] : [byte(16), byte(8), byte(0), 0xff];
  return '#' + components.map(hexByte).join('');
}

function quantize(component: number): number {
  const clamped = Number.isFinite(component) ? Math.min(Math.max(component, 0), 1) : 0;
  return swiftRound(clamped * 255);
}

/**
 * A color from sRGB components in 0…1, clamped and quantized to 8 bits like `RGBAColor(red:green:blue:alpha:)`.
 */
export function rgba(red: number, green: number, blue: number, alpha = 1): RGBAHex {
  return '#' + [red, green, blue, alpha].map((component) => hexByte(quantize(component))).join('');
}

/** The components of a `#RRGGBBAA` color, each 0…1. */
export function colorComponents(color: RGBAHex): { red: number; green: number; blue: number; alpha: number } {
  const hex = parseHexColor(color) ?? '#000000FF';
  const byte = (index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return { red: byte(0), green: byte(1), blue: byte(2), alpha: byte(3) };
}

/** The same color with another alpha (0…1), like `RGBAColor.withAlpha(_:)`. */
export function withAlpha(color: RGBAHex, alpha: number): RGBAHex {
  const { red, green, blue } = colorComponents(color);
  return rgba(red, green, blue, alpha);
}

/** Named colors of the Swift package. */
export const MarkupColors = {
  black: '#000000FF',
  white: '#FFFFFFFF',
  red: '#FF3B30FF',
  orange: '#FF9500FF',
  yellow: '#FFCC00FF',
  green: '#34C759FF',
  teal: '#30B0C7FF',
  blue: '#007AFFFF',
  purple: '#AF52DEFF',
  pink: '#FF2D55FF',
  brown: '#A2845EFF',
  gray: '#8E8E93FF',
  darkGray: '#3A3A3CFF',
  highlighterYellow: '#FFE600FF',
  noteYellow: '#FFF3A6FF',
  noteBorder: '#E0B300FF',
  boardBackground: '#F2F2F7FF',
} as const;

/** Colors offered by the Border and Fill color panels, in display order. */
export const MARKUP_PALETTE: readonly RGBAHex[] = [
  MarkupColors.black,
  MarkupColors.darkGray,
  MarkupColors.gray,
  MarkupColors.white,
  MarkupColors.red,
  MarkupColors.orange,
  MarkupColors.yellow,
  MarkupColors.green,
  MarkupColors.teal,
  MarkupColors.blue,
  MarkupColors.purple,
  MarkupColors.pink,
  MarkupColors.brown,
  MarkupColors.highlighterYellow,
  MarkupColors.noteYellow,
  '#B3E5FCFF',
];
