import { toWorld } from '../geometry/box';
import { rectAround, rectHeight, rectWidth } from '../geometry/rect';
import { add, rotate } from '../geometry/vec';
import type { FontSpec, Size, TextContent } from '../model/types';
import { splitParagraphs, wrapParagraph } from './line-break';
import { lineMetrics } from './metrics';
import { defaultTextMeasurer, type TextMeasurer } from './measurer';

// Measures and lays out text items (TextLayout.swift). The same layout is used on screen and in the export, and the
// line metrics come from the iOS fonts (src/text/metrics.ts), so boxes have the same height as on iOS.

export interface TextLine {
  readonly text: string;
  /** Left edge of the line in box space. */
  readonly x: number;
  /** Baseline in box space. */
  readonly baseline: number;
  readonly width: number;
}

export interface TextLayoutResult {
  readonly lines: readonly TextLine[];
  readonly lineHeight: number;
}

function lines(text: string, font: FontSpec, maxWidth: number, measurer: TextMeasurer): string[] {
  const measure = (line: string) => measurer.measure(line, font);
  return splitParagraphs(text).flatMap((paragraph) =>
    Number.isFinite(maxWidth) ? wrapParagraph(paragraph, maxWidth, measure) : [paragraph],
  );
}

const trimEnd = (text: string) => text.replace(/\s+$/u, '');

/**
 * Box size for the content (`TextLayout.measuredSize`): auto-width text grows with its longest line; fixed-width text
 * wraps at the width minus padding. Empty text measures as one line.
 */
export function measureTextContent(content: TextContent, measurer: TextMeasurer = defaultTextMeasurer()): Size {
  const padding = Math.max(content.padding, 0);
  const text = content.text === '' ? ' ' : content.text;
  const maxWidth = content.fixedWidth === null ? Infinity : Math.max(content.fixedWidth - 2 * padding, 1);
  const textLines = lines(text, content.font, maxWidth, measurer);
  const textWidth = Math.max(0, ...textLines.map((line) => measurer.measure(trimEnd(line), content.font)));
  const textHeight = textLines.length * lineMetrics(content.font).lineHeight;
  const width = content.fixedWidth ?? Math.ceil(textWidth) + 1 + 2 * padding;
  return { width: Math.max(width, 2 * padding + 4), height: Math.ceil(textHeight) + 2 * padding };
}

/**
 * Lines to draw inside a box of `size` (box space), with iOS baselines. Fixed-width text wraps at the box width minus
 * padding; auto-width text only breaks at line breaks (its box came from measuring on some platform, and wrapping it
 * again where fonts are wider would add lines).
 */
export function layoutText(
  content: TextContent,
  size: Size,
  measurer: TextMeasurer = defaultTextMeasurer(),
): TextLayoutResult {
  const metrics = lineMetrics(content.font);
  if (content.text === '') return { lines: [], lineHeight: metrics.lineHeight };
  const padding = Math.max(content.padding, 0);
  const available = Math.max(size.width - 2 * padding, 1);
  const textLines = lines(content.text, content.font, content.fixedWidth === null ? Infinity : available, measurer);
  return {
    lineHeight: metrics.lineHeight,
    lines: textLines.map((text, index) => {
      const visible = trimEnd(text);
      const width = measurer.measure(visible, content.font);
      const x =
        content.alignment === 'center'
          ? padding + (available - width) / 2
          : content.alignment === 'right'
            ? padding + available - width
            : padding;
      return { text: visible, x, baseline: padding + index * metrics.lineHeight + metrics.ascent, width };
    }),
  };
}

/**
 * A copy whose box matches the measured size, keeping the top-left corner fixed in world space
 * (`TextLayout.fitted`).
 */
export function fitTextContent(content: TextContent, measurer: TextMeasurer = defaultTextMeasurer()): TextContent {
  const measured = measureTextContent(content, measurer);
  const box = content.box;
  if (
    Math.abs(measured.width - rectWidth(box.frame)) <= 0.01 &&
    Math.abs(measured.height - rectHeight(box.frame)) <= 0.01
  ) {
    return content;
  }
  const topLeft = toWorld(box, { x: box.frame.x, y: box.frame.y });
  const center = add(topLeft, rotate({ x: measured.width / 2, y: measured.height / 2 }, box.rotation));
  return { ...content, box: { frame: rectAround(center, measured), rotation: box.rotation } };
}
