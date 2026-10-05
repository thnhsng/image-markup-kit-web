import { describe, expect, it } from 'vitest';
import { worldPoint } from '../../src/geometry/box';
import { erasableItems, itemAt } from '../../src/geometry/hit-testing';
import { ALL_RESIZE_HANDLES, creationRect, ResizeSession, RotateSession } from '../../src/geometry/transform';
import { add, rotate } from '../../src/geometry/vec';
import {
  MarkupColors,
  createBoardDocument,
  createImageDocument,
  createLineItem,
  createShapeItem,
  createStrokeItem,
  itemStyle,
  type Box,
} from '../../src';
import { boardWith, degrees, expectPoint } from './helpers';

// Port of TransformHitTestTests (the text resize test lives with the text layout).
const angles = [0, 30, 90, 180, -135].map(degrees);

describe('resize and rotate', () => {
  it('keeps the point opposite the dragged handle fixed, for every handle and rotation', () => {
    for (const angle of angles) {
      const box: Box = { frame: { x: 100, y: 100, width: 200, height: 120 }, rotation: angle };
      for (const handle of ALL_RESIZE_HANDLES) {
        if (handle.kind !== 'resize') continue;
        const { u, v } = handle;
        const handleWorld = worldPoint(box, { x: u, y: v });
        const session = new ResizeSession({ box, u, v, touch: handleWorld, lockAspect: false, minimumSize: 8 });
        const resized = session.box(add(handleWorld, rotate({ x: 37, y: -23 }, angle)));
        const anchor = { x: 1 - u, y: 1 - v };
        expectPoint(worldPoint(resized, anchor), worldPoint(box, anchor), 6);
        expect(resized.rotation).toBeCloseTo(angle, 12);
      }
    }
  });

  it('follows the handle', () => {
    const box: Box = { frame: { x: 0, y: 0, width: 100, height: 100 }, rotation: 0 };
    const session = new ResizeSession({
      box,
      u: 1,
      v: 1,
      touch: { x: 100, y: 100 },
      lockAspect: false,
      minimumSize: 8,
    });
    expect(session.box({ x: 150, y: 130 }).frame).toEqual({ x: 0, y: 0, width: 150, height: 130 });
  });

  it('changes one axis from an edge handle', () => {
    const box: Box = { frame: { x: 0, y: 0, width: 100, height: 60 }, rotation: 0 };
    const session = new ResizeSession({
      box,
      u: 1,
      v: 0.5,
      touch: { x: 100, y: 30 },
      lockAspect: false,
      minimumSize: 8,
    });
    const resized = session.box({ x: 140, y: 90 });
    expect(resized.frame.width).toBeCloseTo(140, 9);
    expect(resized.frame.height).toBeCloseTo(60, 9);
  });

  it('keeps the ratio from an aspect-locked corner', () => {
    const box: Box = { frame: { x: 0, y: 0, width: 400, height: 300 }, rotation: 0.3 };
    const corner = worldPoint(box, { x: 1, y: 1 });
    const session = new ResizeSession({ box, u: 1, v: 1, touch: corner, lockAspect: true, minimumSize: 8 });
    const resized = session.box(add(corner, { x: 80, y: 5 }));
    expect(resized.frame.width / resized.frame.height).toBeCloseTo(4 / 3, 9);
    expect(resized.frame.width).toBeGreaterThan(400);
  });

  it('clamps instead of flipping', () => {
    const box: Box = { frame: { x: 0, y: 0, width: 100, height: 100 }, rotation: 0 };
    const session = new ResizeSession({
      box,
      u: 1,
      v: 1,
      touch: { x: 100, y: 100 },
      lockAspect: false,
      minimumSize: 10,
    });
    expect(session.box({ x: -300, y: -300 }).frame).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('snaps rotation to 45°', () => {
    const box: Box = { frame: { x: -50, y: -50, width: 100, height: 100 }, rotation: 0 };
    const session = new RotateSession(box, { x: 0, y: -100 });
    expect(session.box(rotate({ x: 0, y: -100 }, degrees(43))).rotation).toBeCloseTo(Math.PI / 4, 9);
    expect(session.box(rotate({ x: 0, y: -100 }, degrees(20))).rotation).toBeCloseTo(degrees(20), 9);
  });

  it('drags out squares and rects', () => {
    expect(creationRect({ x: 0, y: 0 }, { x: 30, y: -80 }, true)).toEqual({ x: 0, y: -80, width: 80, height: 80 });
    expect(creationRect({ x: 0, y: 0 }, { x: 30, y: -80 }, false)).toEqual({ x: 0, y: -80, width: 30, height: 80 });
  });
});

describe('hit testing', () => {
  it('hits rotated shapes', () => {
    const bar = createShapeItem(
      'rectangle',
      { x: 0, y: 0, width: 200, height: 20 },
      itemStyle({ strokeColor: null, fillColor: MarkupColors.red, lineWidth: 0 }),
      { rotation: Math.PI / 2 },
    );
    const document = boardWith([bar]);
    expect(itemAt({ x: 100, y: 80 }, document, 1)).not.toBeNull();
    expect(itemAt({ x: 180, y: 10 }, document, 1)).toBeNull();
  });

  it('scales the tolerance with the zoom', () => {
    const document = boardWith([createLineItem({ x: 0, y: 0 }, { x: 100, y: 0 }, itemStyle({ lineWidth: 2 }))]);
    expect(itemAt({ x: 50, y: 9 }, document, 10 / 1)).not.toBeNull();
    expect(itemAt({ x: 50, y: 9 }, document, 10 / 4)).toBeNull();
  });

  it('lets an unfilled inside be grabbed only when nothing else is hit', () => {
    const outline = createShapeItem('rectangle', { x: 0, y: 0, width: 200, height: 200 }, itemStyle({ lineWidth: 4 }));
    const dot = createShapeItem(
      'ellipse',
      { x: 90, y: 90, width: 20, height: 20 },
      itemStyle({ strokeColor: null, fillColor: MarkupColors.blue, lineWidth: 0 }),
    );
    const document = boardWith([dot, outline]);
    expect(itemAt({ x: 100, y: 100 }, document, 2)?.id).toBe(dot.id);
    expect(itemAt({ x: 40, y: 150 }, document, 2)?.id).toBe(outline.id);
  });

  it('picks the topmost item and never the background', () => {
    const base = createImageDocument({ assetID: 'a', pixelSize: { width: 1000, height: 1000 } });
    expect(itemAt({ x: 500, y: 500 }, base, 5)).toBeNull();
    const bottom = createShapeItem(
      'rectangle',
      { x: 0, y: 0, width: 100, height: 100 },
      itemStyle({ fillColor: MarkupColors.red }),
    );
    const top = createShapeItem(
      'rectangle',
      { x: 50, y: 50, width: 100, height: 100 },
      itemStyle({ fillColor: MarkupColors.blue }),
    );
    const document = { ...base, items: [...base.items, bottom, top] };
    expect(itemAt({ x: 75, y: 75 }, document, 1)?.id).toBe(top.id);
  });

  it('follows the path of a stroke', () => {
    const stroke = createStrokeItem(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      itemStyle({ lineWidth: 4 }),
    );
    const document = boardWith([stroke]);
    expect(itemAt({ x: 50, y: 52 }, document, 2)).not.toBeNull();
    expect(itemAt({ x: 90, y: 10 }, document, 2)).toBeNull();
  });

  it('never erases photos or locked items', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 400, height: 300 } }]);
    const locked = {
      ...createShapeItem('rectangle', { x: 10, y: 10, width: 100, height: 100 }, itemStyle()),
      isLocked: true,
    };
    const pen = createStrokeItem(
      [
        { x: 0, y: 50 },
        { x: 300, y: 50 },
      ],
      itemStyle({ lineWidth: 4 }),
    );
    const document = { ...board, items: [...board.items, locked, pen] };
    expect(erasableItems({ x: 50, y: 0 }, { x: 50, y: 120 }, 5, document)).toEqual([pen.id]);
  });
});
