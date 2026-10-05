import type { FontFamily, FontSpec } from '../model/types';

/** Height of a line and the distance from its top to its baseline, as fractions of the font size. */
export interface LineMetrics {
  readonly lineHeight: number;
  readonly ascent: number;
}

/**
 * The line metrics the Swift package gets from Apple's fonts on iOS (measured with UIKit and TextKit:
 * tools/swift/text-metrics.swift). Using them everywhere gives text boxes the same height as on iOS, whatever
 * font a browser actually draws with: SF Pro and New York lines are 2444/2048 em tall with the baseline 1950/2048 em
 * below the top; Hiragino lines are 1.5 em (0.5 em of leading below the line) with the baseline at 0.88 em.
 */
export const IOS_LINE_METRICS: Readonly<Record<FontFamily, LineMetrics>> = {
  system: { lineHeight: 2444 / 2048, ascent: 1950 / 2048 },
  rounded: { lineHeight: 2444 / 2048, ascent: 1950 / 2048 },
  serif: { lineHeight: 2444 / 2048, ascent: 1950 / 2048 },
  monospaced: { lineHeight: 2444 / 2048, ascent: 1950 / 2048 },
  hiraginoSans: { lineHeight: 1.5, ascent: 0.88 },
  hiraginoMincho: { lineHeight: 1.5, ascent: 0.88 },
};

/** Line height and ascent of a font, in canvas units. */
export function lineMetrics(font: FontSpec): LineMetrics {
  const size = Math.max(font.size, 1);
  const ratios = IOS_LINE_METRICS[font.family] ?? IOS_LINE_METRICS.system;
  return { lineHeight: ratios.lineHeight * size, ascent: ratios.ascent * size };
}
