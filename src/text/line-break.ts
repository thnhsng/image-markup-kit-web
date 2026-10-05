// Line breaking for fixed-width text, close to what UIKit's word wrapping does: break after spaces, between CJK
// characters (but not before closing punctuation or small kana, nor after opening brackets), after hyphens, and
// inside a word only when the word alone is wider than the line. Spaces at the end of a line do not count.

/** Splits text into paragraphs at hard line breaks. */
export function splitParagraphs(text: string): string[] {
  return text.split(/\r\n|\r|\n|\u2028|\u2029/);
}

const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
// Japanese line-breaking rules (kinsoku shori), plus their Latin counterparts.
const NO_BREAK_BEFORE =
  /[、。，．,.:;!?！？）)\]］｝}〕〉》」』】〙〗〟’”・ー々ゝゞヽヾぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰ-ㇿ…‥〜～%％]/;
const NO_BREAK_AFTER = /[（(［[｛{〔〈《「『【〘〖〝‘“$＄]/;
const SPACE = /\s/;

type Segmenter = { segment(text: string): Iterable<{ segment: string }> };

let graphemeSegmenter: Segmenter | null | undefined;

/** User-perceived characters (grapheme clusters) where `Intl.Segmenter` exists, code points otherwise. */
export function graphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    const Intl_ = Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => Segmenter };
    graphemeSegmenter =
      typeof Intl_.Segmenter === 'function' ? new Intl_.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

function canBreakBetween(before: string, after: string): boolean {
  if (SPACE.test(after)) return false; // spaces stay with the text before them
  if (NO_BREAK_BEFORE.test(after) || NO_BREAK_AFTER.test(before)) return false;
  if (SPACE.test(before)) return true;
  if (WIDE.test(before) || WIDE.test(after)) return true;
  return (before === '-' || before === '‐') && /\p{L}/u.test(after);
}

/** The paragraph cut at its break opportunities; each piece keeps its trailing spaces. */
export function breakOpportunities(paragraph: string): string[] {
  const characters = graphemes(paragraph);
  const pieces: string[] = [];
  let current = '';
  characters.forEach((character, index) => {
    const previous = characters[index - 1];
    if (previous !== undefined && current !== '' && canBreakBetween(previous, character)) {
      pieces.push(current);
      current = '';
    }
    current += character;
  });
  if (current !== '') pieces.push(current);
  return pieces;
}

const trimEnd = (text: string) => text.replace(/\s+$/u, '');

/**
 * Greedy line filling of one paragraph at `maxWidth` (measured without trailing spaces). A piece wider than a whole
 * line is cut between characters, at least one per line.
 */
export function wrapParagraph(paragraph: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (paragraph === '') return [''];
  const lines: string[] = [];
  let line = '';
  const fits = (text: string) => measure(trimEnd(text)) <= maxWidth;
  for (const piece of breakOpportunities(paragraph)) {
    if (fits(line + piece)) {
      line += piece;
      continue;
    }
    if (line !== '') {
      lines.push(line);
      line = '';
    }
    if (fits(piece)) {
      line = piece;
      continue;
    }
    // Wider than a line on its own: cut between characters.
    for (const character of graphemes(piece)) {
      if (line !== '' && !fits(line + character)) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  lines.push(line);
  return lines;
}
