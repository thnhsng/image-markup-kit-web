/**
 * An sRGB color with alpha, written `#RRGGBBAA` (uppercase hex, 8 bits per component), the document.json encoding.
 */
export type RGBAHex = string;

/** Foundation's `.whitespacesAndNewlines`: Unicode separators, tab, LF…CR and NEL. */
const SWIFT_WHITESPACE = /^[\p{Z}\t\n\v\f\r\u0085]+|[\p{Z}\t\n\v\f\r\u0085]+$/gu;

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
  return '#' + components.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('');
}
