import type { FontFamily, FontSpec } from '../model/types';

/** How a font family is drawn in the browser. */
export interface FontStackSpec {
  /** A CSS font-family list. */
  readonly family: string;
  /** CSS font-weight for regular and bold text. */
  readonly regularWeight: number;
  readonly boldWeight: number;
}

/** Per-family overrides, e.g. a web font loaded by the host page for consistent text on every platform. */
export type FontStacks = { readonly [F in FontFamily]?: Partial<FontStackSpec> };

const JAPANESE_SANS =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", "Noto Sans CJK JP"';
const JAPANESE_SERIF = '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP"';
const SYSTEM = `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, ${JAPANESE_SANS}, sans-serif`;

/**
 * The fonts used for each family. Apple devices get the same fonts as iOS (SF Pro, SF Pro Rounded, New York, SF Mono,
 * Hiragino); other systems get the closest common fonts. Hiragino's W3 and W6 are weights 300 and 600.
 */
export const DEFAULT_FONT_STACKS: Readonly<Record<FontFamily, FontStackSpec>> = {
  system: { family: SYSTEM, regularWeight: 400, boldWeight: 700 },
  rounded: {
    family: `ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", ${SYSTEM}`,
    regularWeight: 400,
    boldWeight: 700,
  },
  serif: {
    family: `ui-serif, "New York", Georgia, "Times New Roman", ${JAPANESE_SERIF}, serif`,
    regularWeight: 400,
    boldWeight: 700,
  },
  monospaced: {
    family: `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", ${JAPANESE_SANS}, monospace`,
    regularWeight: 400,
    boldWeight: 700,
  },
  hiraginoSans: { family: `${JAPANESE_SANS}, sans-serif`, regularWeight: 300, boldWeight: 600 },
  hiraginoMincho: { family: `${JAPANESE_SERIF}, serif`, regularWeight: 300, boldWeight: 600 },
};

export function resolveFontStack(family: FontFamily, stacks?: FontStacks): FontStackSpec {
  const base = DEFAULT_FONT_STACKS[family] ?? DEFAULT_FONT_STACKS.system;
  const override = stacks?.[family];
  return override ? { ...base, ...override } : base;
}

/** The CSS `font` shorthand for canvas `font` and `document.fonts.load`, sized in canvas units (px). */
export function cssFont(font: FontSpec, stacks?: FontStacks): string {
  const stack = resolveFontStack(font.family, stacks);
  const weight = font.bold ? stack.boldWeight : stack.regularWeight;
  return `${font.italic ? 'italic ' : ''}${weight} ${Math.max(font.size, 1)}px ${stack.family}`;
}
