import { describe, expect, it } from 'vitest';
import { carryChildren } from '../../src/geometry/attachments';
import { boxCenter, boxOffset } from '../../src/geometry/box';
import { erasableItems, itemAt } from '../../src/geometry/hit-testing';
import { visualBounds } from '../../src/geometry/item-geometry';
import { flattened, insertionPoints, samplesOf } from '../../src/geometry/line-path';
import { pathBounds } from '../../src/geometry/path';
import { lineGeometry, lineGeometryOf } from '../../src/geometry/path-factory';
import { maxX, maxY, midX, minX, minY, rectContains } from '../../src/geometry/rect';
import { translated } from '../../src/geometry/transform';
import { add } from '../../src/geometry/vec';
import {
  MarkupColors,
  createBoardDocument,
  createCurveItem,
  createPolylineItem,
  createShapeItem,
  itemStyle,
  type ImageItem,
  type LineItem,
} from '../../src';
import { boardWith } from './helpers';

// Port of LinePathTests: geometry, hit testing, erasing and carrying (store and gesture tests come with the editor).
const P = (x: number, y: number) => ({ x, y });

describe('line geometry', () => {
  it('passes curves through every point', () => {
    const points = [P(0, 0), P(100, 80), P(200, 0), P(300, 60)];
    const samples = flattened(points, 'curve', false);
    expect(samples.length).toBeGreaterThan(30);
    for (const point of points) expect(samples.some((s) => s.x === point.x && s.y === point.y)).toBe(true);
    const closed = flattened(points, 'curve', true);
    expect(closed[0]).toEqual(closed[closed.length - 1]);
  });

  it('samples polylines at their points', () => {
    const points = [P(0, 0), P(100, 0), P(100, 100)];
    expect(flattened(points, 'polyline', false)).toEqual(points);
    expect(flattened(points, 'polyline', true)).toEqual([...points, points[0]]);
    expect(insertionPoints(points, 'polyline', false)).toEqual([P(50, 0), P(100, 50)]);
  });

  it('covers the samples with the curve bounds', () => {
    const curve = createCurveItem([P(0, 0), P(40, 100), P(60, 100), P(100, 0)], itemStyle({ lineWidth: 2 }));
    const document = boardWith([curve]);
    const bounds = visualBounds(curve, document);
    for (const sample of samplesOf(curve.content, document)) expect(rectContains(bounds, sample)).toBe(true);
  });

  it('keeps straight line geometry', () => {
    const geometry = lineGeometry([P(0, 0), P(100, 0)], false, 6, 'none', 'arrow');
    // Head length max(6 × 3.2, 14) = 19.2; the shaft stops 0.7 × 19.2 inside it.
    const shaft = pathBounds(geometry.shaft);
    expect(minX(shaft)).toBeCloseTo(0, 9);
    expect(maxX(shaft)).toBeCloseTo(100 - 19.2 * 0.7, 9);
    const heads = pathBounds(geometry.heads ?? []);
    expect(maxX(heads)).toBeCloseTo(100, 9);
    expect(minX(heads)).toBeCloseTo(100 - 19.2, 9);
  });

  it('points the arrowhead along the last segment', () => {
    const polyline = createPolylineItem([P(0, 0), P(100, 0), P(100, 100)], itemStyle({ lineWidth: 6 }), {
      endHead: 'arrow',
    });
    const heads = pathBounds(lineGeometryOf(polyline.content, boardWith([polyline]), 6).heads ?? []);
    expect(midX(heads)).toBeCloseTo(100, 6);
    expect(maxY(heads)).toBeCloseTo(100, 6);
    expect(minY(heads)).toBeCloseTo(100 - 19.2, 6);
  });

  it('gives closed lines no arrowheads', () => {
    const polygon = createPolylineItem([P(0, 0), P(100, 0), P(50, 80)], itemStyle(), {
      closed: true,
      endHead: 'arrow',
    });
    expect(lineGeometryOf(polygon.content, boardWith([polygon]), 6).heads).toBeNull();
  });
});

describe('line hit testing and erasing', () => {
  it('follows every polyline segment', () => {
    const polyline = createPolylineItem([P(0, 0), P(100, 0), P(100, 100)], itemStyle({ lineWidth: 2 }));
    const document = boardWith([polyline]);
    expect(itemAt(P(102, 60), document, 3)).not.toBeNull();
    expect(itemAt(P(50, 50), document, 3)).toBeNull();
  });

  it('follows the curve, not the chord', () => {
    const curve = createCurveItem([P(0, 0), P(100, 100), P(200, 0)], itemStyle({ lineWidth: 2 }));
    const document = boardWith([curve]);
    expect(itemAt(P(100, 97), document, 3)).not.toBeNull();
    expect(itemAt(P(100, 0), document, 3)).toBeNull();
  });

  it('grabs closed polygons by their inside', () => {
    const points = [P(0, 0), P(200, 0), P(200, 200), P(0, 200)];
    const filled = createPolylineItem(points, itemStyle({ fillColor: MarkupColors.yellow }), { closed: true });
    expect(itemAt(P(100, 100), boardWith([filled]), 2)).not.toBeNull();

    const outline = createPolylineItem(points, itemStyle(), { closed: true });
    const dot = createShapeItem(
      'ellipse',
      { x: 90, y: 90, width: 20, height: 20 },
      itemStyle({ strokeColor: null, fillColor: MarkupColors.blue, lineWidth: 0 }),
    );
    const document = boardWith([dot, outline]);
    expect(itemAt(P(100, 100), document, 2)?.id).toBe(dot.id);
    expect(itemAt(P(40, 150), document, 2)?.id).toBe(outline.id);
  });

  it('erases later segments', () => {
    const polyline = createPolylineItem([P(0, 0), P(100, 0), P(100, 100)], itemStyle({ lineWidth: 2 }));
    const document = boardWith([polyline]);
    expect(erasableItems(P(80, 60), P(120, 60), 3, document)).toEqual([polyline.id]);
    expect(erasableItems(P(20, 60), P(60, 60), 3, document)).toEqual([]);
  });
});

describe('moving lines', () => {
  it('carries waypoints when moving', () => {
    const polyline = createPolylineItem([P(0, 0), P(50, 50), P(100, 0)], itemStyle());
    const moved = translated(polyline, P(10, 20), boardWith([polyline])) as LineItem;
    expect(moved.content.waypoints).toEqual([P(60, 70)]);
  });

  it('carries the waypoints attached to a moved photo', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 400, height: 300 } }]);
    const photo = board.items[0] as ImageItem;
    const center = boxCenter(photo.content.box);
    const polyline = {
      ...createPolylineItem([center, add(center, P(20, 10)), add(center, P(40, 0))], itemStyle()),
      parentID: photo.id,
    };
    const source = { ...board, items: [...board.items, polyline] };
    const moved: ImageItem = { ...photo, content: { ...photo.content, box: boxOffset(photo.content.box, P(300, 0)) } };
    const result = carryChildren(photo, moved, source, {
      ...source,
      items: source.items.map((item) => (item.id === photo.id ? moved : item)),
    });
    const line = result.items.find((item) => item.id === polyline.id) as LineItem;
    expect(line.content.waypoints).toEqual([add(center, P(320, 10))]);
  });
});
