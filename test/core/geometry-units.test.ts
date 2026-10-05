import { describe, expect, it } from 'vitest';
import {
  affineToSVG,
  applyAffine,
  concatAffine,
  IDENTITY,
  invertAffine,
  rotation,
  scaling,
  translation,
} from '../../src/geometry/affine';
import { detachReferences, isValidBindTarget, refreshCachedEndpoints } from '../../src/geometry/bindings';
import { arrangementFrames, columnFrames } from '../../src/geometry/board-layout';
import { boxCorners, boxesEqual } from '../../src/geometry/box';
import { distanceToPolyline, normalizeAngle, segmentsIntersect } from '../../src/geometry/geometry-math';
import {
  distanceToPath,
  ellipsePath,
  flattenPath,
  isEmptyPath,
  pathBounds,
  pathContains,
  pathToSVG,
  PathBuilder,
  rectPath,
  tracePath,
  transformPath,
} from '../../src/geometry/path';
import { dashPattern, lineCapFor, lineJoinFor, strokePoints } from '../../src/geometry/path-factory';
import {
  integralRect,
  isEmptyRect,
  isNullRect,
  makeRect,
  NULL_RECT,
  offsetRect,
  rectCorners,
  rectSize,
  standardized,
  unionRect,
} from '../../src/geometry/rect';
import { minimumItemSize, resized, ResizeSession, translated } from '../../src/geometry/transform';
import { normalized, pointsEqual } from '../../src/geometry/vec';
import {
  createBoardDocument,
  createConnectorItem,
  createShapeItem,
  createStrokeItem,
  itemStyle,
  type ImageItem,
  type LineItem,
  type TextItem,
} from '../../src';
import { expectPoint } from './helpers';

describe('affine transforms', () => {
  it('composes, inverts and prints', () => {
    const t = concatAffine(concatAffine(scaling(2, 3), rotation(0.5)), translation(10, -4));
    const p = { x: 3, y: 7 };
    expectPoint(applyAffine(invertAffine(t), applyAffine(t, p)), p);
    expect(invertAffine({ a: 0, b: 0, c: 0, d: 0, tx: 1, ty: 1 })).toEqual(IDENTITY);
    expect(affineToSVG(translation(1, 2))).toBe('matrix(1 0 0 1 1 2)');
    expect(scaling(2)).toEqual({ a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 });
  });
});

describe('paths', () => {
  it('converts to SVG, transforms and replays on a canvas', () => {
    const path = new PathBuilder()
      .moveTo({ x: 0, y: 0 })
      .lineTo({ x: 10, y: 0 })
      .quadTo({ x: 15, y: 5 }, { x: 10, y: 10 })
      .cubicTo({ x: 8, y: 12 }, { x: 2, y: 12 }, { x: 0, y: 10 })
      .close()
      .build();
    expect(pathToSVG(path)).toBe('M0 0L10 0Q15 5 10 10C8 12 2 12 0 10Z');
    const moved = transformPath(path, translation(1, 2));
    expect(pathToSVG(moved)).toBe('M1 2L11 2Q16 7 11 12C9 14 3 14 1 12Z');
    const calls: string[] = [];
    tracePath(
      {
        moveTo: (x, y) => calls.push(`M${x},${y}`),
        lineTo: (x, y) => calls.push(`L${x},${y}`),
        quadraticCurveTo: (a, b, x, y) => calls.push(`Q${a},${b},${x},${y}`),
        bezierCurveTo: (a, b, c, d, x, y) => calls.push(`C${a},${b},${c},${d},${x},${y}`),
        closePath: () => calls.push('Z'),
      },
      path,
    );
    expect(calls).toEqual(['M0,0', 'L10,0', 'Q15,5,10,10', 'C8,12,2,12,0,10', 'Z']);
    // The quadratic bulges to x = 12.5.
    expect(pathBounds(path).width).toBeCloseTo(12.5, 9);
  });

  it('handles degenerate arcs with a straight line, like CoreGraphics', () => {
    const collinear = new PathBuilder().moveTo({ x: 0, y: 0 }).arcTo({ x: 10, y: 0 }, { x: 20, y: 0 }, 5).build();
    expect(pathToSVG(collinear)).toBe('M0 0L10 0');
    const zeroRadius = new PathBuilder().moveTo({ x: 0, y: 0 }).arcTo({ x: 10, y: 0 }, { x: 10, y: 10 }, 0).build();
    expect(pathToSVG(zeroRadius)).toBe('M0 0L10 0');
    const reflex = new PathBuilder().moveTo({ x: 0, y: 0 }).arcTo({ x: 10, y: 0 }, { x: 0, y: 1 }, 2).build();
    expect(reflex.filter((command) => command.type === 'C').length).toBeGreaterThan(0);
  });

  it('flattens subpaths and measures distances', () => {
    const path = new PathBuilder()
      .moveTo({ x: 0, y: 0 })
      .lineTo({ x: 10, y: 0 })
      .close()
      .lineTo({ x: 0, y: 10 })
      .quadTo({ x: 5, y: 15 }, { x: 10, y: 10 })
      .moveTo({ x: 50, y: 50 })
      .build();
    const flat = flattenPath(path);
    expect(flat.map((subpath) => subpath.closed)).toEqual([true, false, false]);
    expect(distanceToPath(flat, { x: 50, y: 53 })).toBeCloseTo(3, 9);
    expect(distanceToPath([], { x: 0, y: 0 })).toBe(Number.MAX_VALUE);
    expect(pathContains(ellipsePath({ x: 0, y: 0, width: 10, height: 10 }), { x: 5, y: 5 })).toBe(true);
    expect(pathContains(rectPath({ x: 0, y: 0, width: 10, height: 10 }), { x: 15, y: 5 })).toBe(false);
    expect(isEmptyPath([])).toBe(true);
    expect(isNullRect(pathBounds([]))).toBe(true);
  });

  it('describes dashes, caps and joins', () => {
    expect(dashPattern('solid', 4)).toBeNull();
    expect(dashPattern('dashed', 4)).toEqual([12, 8]);
    expect(dashPattern('dotted', 0.5)).toEqual([0, 2]);
    expect(lineCapFor('dotted', 'butt')).toBe('round');
    expect(lineCapFor('dashed', 'butt')).toBe('butt');
    expect(lineJoinFor('star')).toBe('miter');
    expect(lineJoinFor('ellipse')).toBe('round');
  });
});

describe('rects and vectors', () => {
  it('follows CGRect for null and empty rects', () => {
    expect(makeRect(1, 2, 3, 4)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(standardized(NULL_RECT)).toBe(NULL_RECT);
    expect(offsetRect(NULL_RECT, 1, 1)).toBe(NULL_RECT);
    expect(integralRect(NULL_RECT)).toBe(NULL_RECT);
    expect(unionRect(makeRect(0, 0, 1, 1), NULL_RECT)).toEqual(makeRect(0, 0, 1, 1));
    expect(isEmptyRect(makeRect(0, 0, 0, 5))).toBe(true);
    expect(isEmptyRect(NULL_RECT)).toBe(true);
    expect(rectCorners(makeRect(0, 0, 2, 1))).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(rectSize(makeRect(0, 0, -2, 1))).toEqual({ width: -2, height: 1 });
  });

  it('handles zero vectors and angles', () => {
    expect(normalized({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(pointsEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(distanceToPolyline({ x: 3, y: 4 }, [])).toBe(Number.MAX_VALUE);
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(false);
  });

  it('compares boxes and lists corners', () => {
    const box = { frame: makeRect(0, 0, 10, 10), rotation: 0 };
    expect(boxesEqual(box, { ...box })).toBe(true);
    expect(boxesEqual(box, { ...box, rotation: 1 })).toBe(false);
    expect(boxCorners(box)[2]).toEqual({ x: 10, y: 10 });
  });

  it('lays out columns and arrangements', () => {
    expect(columnFrames([{ width: 0, height: 0 }])[0]).toEqual({ x: 0, y: 0, width: 800, height: 800 });
    expect(arrangementFrames([{ width: 4, height: 3 }], 'row')).toHaveLength(1);
    expect(arrangementFrames([], 'grid')).toEqual([]);
  });
});

describe('items', () => {
  it('detaches references to removed items', () => {
    const board = createBoardDocument([
      { assetID: 'a', pixelSize: { width: 400, height: 300 } },
      { assetID: 'b', pixelSize: { width: 400, height: 300 } },
    ]);
    const [a, b] = board.items as ImageItem[];
    if (!a || !b) throw new Error('two photos');
    const connector = createConnectorItem(
      { itemID: a.id, anchor: { x: 0.5, y: 0.5 } },
      { itemID: b.id, anchor: { x: 0.5, y: 0.5 } },
      board,
      itemStyle(),
    );
    const child = { ...createShapeItem('rectangle', makeRect(10, 10, 10, 10), itemStyle()), parentID: a.id };
    const document = { ...board, items: [...board.items, connector, child] };
    expect(detachReferences(document, new Set())).toBe(document);
    const detached = detachReferences(document, new Set([a.id]));
    const line = detached.items.find((item) => item.id === connector.id) as LineItem;
    expect(line.content.start.binding).toBeNull();
    expect(line.content.end.binding).not.toBeNull();
    expect(line.content.start.point).toEqual(connector.content.start.point);
    expect(detached.items.find((item) => item.id === child.id)?.parentID).toBeNull();
    expect(refreshCachedEndpoints(document)).toBe(document);
    expect(isValidBindTarget(a, board)).toBe(true);
    expect(isValidBindTarget(connector, board)).toBe(false);
  });

  it('resizes text to a fixed width and other items to the new box', () => {
    const text: TextItem = {
      id: 'C0FFEE00-0000-4000-8000-000000000001',
      type: 'text',
      content: {
        text: 'Best view!',
        font: { family: 'system', size: 30, bold: false, italic: false },
        color: '#000000FF',
        alignment: 'left',
        fixedWidth: null,
        padding: 8,
        box: { frame: makeRect(0, 0, 200, 52), rotation: 0 },
      },
      style: itemStyle({ strokeColor: null }),
      isLocked: false,
      parentID: null,
    };
    const session = new ResizeSession({
      box: text.content.box,
      u: 1,
      v: 0.5,
      touch: { x: 200, y: 26 },
      lockAspect: false,
      minimumSize: 8,
      anchorsTop: true,
    });
    const narrower = session.box({ x: 100, y: 26 });
    const result = resized(text, narrower, session, () => ({ width: 100, height: 90 })) as TextItem;
    expect(result.content.fixedWidth).toBe(100);
    expect(result.content.box.frame).toEqual(makeRect(0, 0, 100, 90));
    const shape = createShapeItem('rectangle', makeRect(0, 0, 10, 10), itemStyle());
    expect(resized(shape, narrower, session, () => ({ width: 0, height: 0 })).type).toBe('shape');
    expect(minimumItemSize(1)).toBe(24);
    expect(minimumItemSize(10)).toBe(8);
    expect(minimumItemSize(0)).toBe(2400);
  });

  it('moves boxed items', () => {
    const stroke = createStrokeItem([{ x: 0, y: 0 }], itemStyle());
    const moved = translated(stroke, { x: 5, y: 6 }, createBoardDocument());
    expect(moved.type === 'stroke' && moved.content.box.frame.x).toBe(stroke.content.box.frame.x + 5);
    expect(strokePoints(stroke.content)).toHaveLength(1);
  });
});
