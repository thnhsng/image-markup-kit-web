import { describe, expect, it } from 'vitest';
import { toWorld, worldPoint } from '../../src/geometry/box';
import { resized, ResizeSession } from '../../src/geometry/transform';
import { breakOpportunities, graphemes, splitParagraphs, wrapParagraph } from '../../src/text/line-break';
import { lineMetrics } from '../../src/text/metrics';
import {
  DEFAULT_FONT_STACKS,
  MarkupColors,
  createApproximateTextMeasurer,
  createCanvasTextMeasurer,
  createTextItem,
  cssFont,
  fitTextContent,
  layoutText,
  measureTextContent,
  type FontSpec,
  type TextContent,
  type TextItem,
} from '../../src';

const measurer = createApproximateTextMeasurer();
const font = (size: number, extra: Partial<FontSpec> = {}): FontSpec => ({
  family: 'system',
  size,
  bold: false,
  italic: false,
  ...extra,
});
const content = (text: string, extra: Partial<TextContent> = {}): TextContent => ({
  text,
  font: font(30),
  color: MarkupColors.red,
  alignment: 'left',
  fixedWidth: null,
  padding: 8,
  box: { frame: { x: 0, y: 0, width: 0, height: 0 }, rotation: 0 },
  ...extra,
});

// Port of the text parts of GeometryTests and TransformHitTestTests, with the deterministic measurer.
describe('text measuring', () => {
  it('grows with the text, wraps at a fixed width and measures empty text as one line', () => {
    const base = content('Summit');
    const longer = content('Summit at the end of the long ridge');
    expect(measureTextContent(longer, measurer).width).toBeGreaterThan(measureTextContent(base, measurer).width);

    const fixed = { ...longer, fixedWidth: 120 };
    const fixedSize = measureTextContent(fixed, measurer);
    expect(fixedSize.width).toBe(120);
    expect(fixedSize.height).toBeGreaterThan(measureTextContent(longer, measurer).height);

    const japanese = content('山小屋から山頂まで歩く', { font: font(30, { family: 'hiraginoSans' }) });
    expect(measureTextContent(japanese, measurer).width).toBeGreaterThan(30 * 5);

    expect(measureTextContent(content(''), measurer).height).toBeGreaterThan(30);
  });

  it('keeps the top-left corner when fitting', () => {
    const box = { frame: { x: 100, y: 100, width: 10, height: 10 }, rotation: 0.5 };
    const fitted = fitTextContent(content('Some longer text', { box }), measurer);
    const before = toWorld(box, { x: box.frame.x, y: box.frame.y });
    const after = toWorld(fitted.box, { x: fitted.box.frame.x, y: fitted.box.frame.y });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(fitted.box.frame.width).toBeGreaterThan(10);
    expect(fitTextContent(fitted, measurer)).toBe(fitted);
  });

  it('grows text down from the top when resized narrower', () => {
    const item = createTextItem(
      'A fairly long label that wraps',
      { x: 50, y: 50 },
      {
        font: font(30),
        color: MarkupColors.red,
        measurer,
      },
    );
    const box = item.content.box;
    const rightMiddle = worldPoint(box, { x: 1, y: 0.5 });
    const session = new ResizeSession({
      box,
      u: 1,
      v: 0.5,
      touch: rightMiddle,
      lockAspect: false,
      minimumSize: 8,
      anchorsTop: true,
    });
    const narrower = session.box({ x: rightMiddle.x - box.frame.width * 0.5, y: rightMiddle.y });
    const text = resized(item, narrower, session, (c) => measureTextContent(c, measurer)) as TextItem;
    expect(text.content.fixedWidth).toBeCloseTo(narrower.frame.width, 9);
    expect(text.content.box.frame.height).toBeGreaterThan(box.frame.height);
    expect(text.content.box.frame.y).toBeCloseTo(box.frame.y, 6);
    expect(text.content.box.frame.x).toBeCloseTo(box.frame.x, 6);
  });
});

describe('box heights match iOS', () => {
  // Heights only depend on the line count and the iOS line metrics, so they hold whatever the font widths.
  it('uses the SF Pro and Hiragino line heights', () => {
    expect(measureTextContent(content('View? / 山頂?', { font: font(44, { bold: true }) }), measurer).height).toBe(69);
    expect(measureTextContent(content('Ghghjgjhghjghj', { font: font(122, { bold: true }) }), measurer).height).toBe(
      162,
    );
    const note = content('one\ntwo\nthree', {
      font: font(30, { family: 'hiraginoSans' }),
      padding: 16,
      fixedWidth: 380,
    });
    expect(measureTextContent(note, measurer)).toEqual({ width: 380, height: 167 });
  });

  it('counts a trailing line break as a line, like UIKit', () => {
    const one = measureTextContent(content('Ag'), measurer).height;
    const two = measureTextContent(content('Ag\n'), measurer).height;
    expect(two - one).toBeCloseTo(lineMetrics(font(30)).lineHeight, 0);
  });

  it('places baselines at the iOS ascent, one line height apart', () => {
    const text = content('first\nsecond', { font: font(100), padding: 8 });
    const layout = layoutText(text, measureTextContent(text, measurer), measurer);
    expect(layout.lines.map((line) => line.baseline)).toEqual([8 + 95.21484375, 8 + 95.21484375 + 119.3359375]);
    const hiragino = content('a\nb', { font: font(100, { family: 'hiraginoMincho' }), padding: 0 });
    expect(layoutText(hiragino, { width: 300, height: 300 }, measurer).lines.map((line) => line.baseline)).toEqual([
      88, 238,
    ]);
  });

  it('aligns lines inside the padding', () => {
    const size = { width: 200, height: 100 };
    const align = (alignment: TextContent['alignment']) =>
      layoutText(content('ab', { alignment, padding: 10, fixedWidth: 200 }), size, measurer).lines[0];
    const width = measurer.measure('ab', font(30));
    expect(align('left')?.x).toBe(10);
    expect(align('center')?.x).toBeCloseTo(10 + (180 - width) / 2, 9);
    expect(align('right')?.x).toBeCloseTo(10 + 180 - width, 9);
    expect(layoutText(content(''), size, measurer).lines).toEqual([]);
  });

  it('wraps only fixed-width text when drawing', () => {
    const size = { width: 60, height: 100 };
    expect(layoutText(content('auto width text'), size, measurer).lines).toHaveLength(1);
    expect(layoutText(content('fixed width text', { fixedWidth: 60 }), size, measurer).lines.length).toBeGreaterThan(1);
  });
});

describe('line breaking', () => {
  const measure = (text: string) => measurer.measure(text, font(10));

  it('splits paragraphs at every hard break', () => {
    expect(splitParagraphs('a\r\nb\rc\nd\u2028e\u2029f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('breaks after spaces and hyphens, and between CJK characters', () => {
    expect(breakOpportunities('one two-three four')).toEqual(['one ', 'two-', 'three ', 'four']);
    expect(breakOpportunities('山小屋')).toEqual(['山', '小', '屋']);
    expect(breakOpportunities('A山B')).toEqual(['A', '山', 'B']);
  });

  it('follows the Japanese rules for punctuation', () => {
    expect(breakOpportunities('出発。次へ')).toEqual(['出', '発。', '次', 'へ']);
    expect(breakOpportunities('「山頂」')).toEqual(['「山', '頂」']);
    expect(breakOpportunities('ちょっと')).toEqual(['ちょっ', 'と']);
    expect(breakOpportunities('ラーメン')).toEqual(['ラー', 'メ', 'ン']);
  });

  it('fills lines greedily and lets trailing spaces hang', () => {
    const lines = wrapParagraph('aaa bbb ccc', measure('aaa bbb'), measure);
    expect(lines).toEqual(['aaa bbb ', 'ccc']);
  });

  it('cuts a word wider than the line between characters', () => {
    const lines = wrapParagraph('abcdefghij', measure('abcd'), measure);
    expect(lines.join('')).toBe('abcdefghij');
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => measure(line) <= measure('abcd') || line.length === 1)).toBe(true);
    expect(wrapParagraph('x', 0.001, measure)).toEqual(['x']);
    expect(wrapParagraph('', 10, measure)).toEqual(['']);
  });

  it('keeps grapheme clusters together', () => {
    expect(graphemes('e\u0301👩‍👩‍👧')).toEqual(['e\u0301', '👩‍👩‍👧']);
  });
});

describe('fonts', () => {
  it('builds CSS fonts from the stacks', () => {
    expect(cssFont(font(36, { bold: true }))).toBe(`700 36px ${DEFAULT_FONT_STACKS.system.family}`);
    expect(cssFont(font(20, { family: 'hiraginoSans', italic: true }))).toBe(
      `italic 300 20px ${DEFAULT_FONT_STACKS.hiraginoSans.family}`,
    );
    expect(cssFont(font(0), { system: { family: 'Inter', boldWeight: 650 } })).toBe('400 1px Inter');
  });

  it('falls back to the approximate measurer without a canvas', () => {
    const canvas = createCanvasTextMeasurer();
    expect(canvas.measure('Summit', font(30))).toBe(measurer.measure('Summit', font(30)));
    canvas.clear();
  });
});

describe('canvas measuring', () => {
  it('measures with a 2D canvas when one exists, caching by font and text', async () => {
    const { vi } = await import('vitest');
    let calls = 0;
    class FakeOffscreenCanvas {
      getContext() {
        return {
          font: '',
          measureText(text: string) {
            calls += 1;
            return { width: text.length * 10 };
          },
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    try {
      const canvas = createCanvasTextMeasurer();
      expect(canvas.measure('abc', font(30))).toBe(30);
      expect(canvas.measure('abc', font(30))).toBe(30);
      expect(calls).toBe(1);
      for (let i = 0; i < 5001; i += 1) canvas.measure(`x${i}`, font(30));
      canvas.clear();
      expect(canvas.measure('abc', font(30))).toBe(30);
      expect(calls).toBe(5003);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
