import type { FontSpec } from '../model/types';
import { cssFont, type FontStacks } from './font-stacks';

/** Measures the advance width of a single line of text, in canvas units. */
export interface TextMeasurer {
  measure(text: string, font: FontSpec): number;
}

// Approximate widths in em, by character class: good enough to lay text out where no canvas exists (Node, jsdom),
// and deterministic for tests.
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const NARROW = /[ilj.,:;'!|()[\]{}`"]/;
const UPPER = /[A-Z0-9@#%&MW]/;

/** A deterministic measurer from per-character estimates (CJK 1 em, Latin about 0.55 em). */
export function createApproximateTextMeasurer(): TextMeasurer {
  return {
    measure(text: string, font: FontSpec): number {
      let ems = 0;
      for (const character of text) {
        if (character === ' ' || character === '\t') ems += 0.28;
        else if (WIDE.test(character)) ems += 1;
        else if (NARROW.test(character)) ems += 0.3;
        else if (UPPER.test(character)) ems += 0.68;
        else if ((character.codePointAt(0) ?? 0) > 0x2000) ems += 1;
        else ems += 0.55;
      }
      return ems * Math.max(font.size, 1) * (font.bold ? 1.06 : 1);
    },
  };
}

type Context2D = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

function createContext(): Context2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const context = new OffscreenCanvas(1, 1).getContext('2d');
      if (context) return context as unknown as Context2D;
    }
    if (typeof document !== 'undefined') {
      const context = document.createElement('canvas').getContext('2d');
      if (context && typeof context.measureText === 'function') return context;
    }
  } catch {
    // Falls through to the approximate measurer (e.g. jsdom without canvas support).
  }
  return null;
}

const CACHE_LIMIT = 5000;

/**
 * Measures with a canvas, using the same CSS fonts the editor draws with. Falls back to the approximate measurer
 * where no 2D canvas exists. Results are cached; call `clear()` after web fonts finish loading.
 */
export function createCanvasTextMeasurer(stacks?: FontStacks): TextMeasurer & { clear(): void } {
  let context: Context2D | null | undefined;
  const fallback = createApproximateTextMeasurer();
  const cache = new Map<string, number>();
  return {
    measure(text: string, font: FontSpec): number {
      if (context === undefined) context = createContext();
      if (!context) return fallback.measure(text, font);
      const css = cssFont(font, stacks);
      const key = `${css}\u0000${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      context.font = css;
      const width = context.measureText(text).width;
      if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, width);
      return width;
    },
    clear(): void {
      cache.clear();
    },
  };
}

let shared: (TextMeasurer & { clear(): void }) | undefined;

/** The measurer used when none is given: a shared canvas measurer with the default fonts. */
export function defaultTextMeasurer(): TextMeasurer & { clear(): void } {
  shared ??= createCanvasTextMeasurer();
  return shared;
}
