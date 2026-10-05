import { effectiveLineWidth } from '../model/style';
import type { MarkupDocument, MarkupItem, Rect } from '../model/types';
import { boxBoundingRect } from './box';
import { samplesOf } from './line-path';
import { arrowHeadLength } from './path-factory';
import { boundingRect, insetRect, NULL_RECT, unionRect } from './rect';

/** How far a drop shadow reaches beyond an item, in canvas units. */
export const SHADOW_EXTENT = 10;

/** Extent of an item as drawn: stroke width, arrowheads and shadow included (ItemGeometry.swift). */
export function visualBounds(item: MarkupItem, document: MarkupDocument): Rect {
  const shadow = item.style.shadow ? SHADOW_EXTENT : 0;
  switch (item.type) {
    case 'line': {
      // Curves can swing outside their points, so measure the flattened samples.
      const line = item.content;
      const samples = samplesOf(line, document);
      const hasHead = !line.isClosed && (line.startHead === 'arrow' || line.endHead === 'arrow');
      const pad = Math.max(item.style.lineWidth / 2, hasHead ? arrowHeadLength(item.style.lineWidth) : 0);
      return insetRect(boundingRect(samples), -(pad + shadow), -(pad + shadow));
    }
    case 'stroke':
      // Stroke boxes already include half the line width.
      return insetRect(boxBoundingRect(item.content.box), -shadow, -shadow);
    default: {
      const pad = effectiveLineWidth(item.style) / 2 + shadow;
      return insetRect(boxBoundingRect(item.content.box), -pad, -pad);
    }
  }
}

export function visualBoundsOfItems(items: readonly MarkupItem[], document: MarkupDocument): Rect {
  return items.reduce((bounds, item) => unionRect(bounds, visualBounds(item, document)), NULL_RECT);
}
