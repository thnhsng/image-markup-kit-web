import { expect } from 'vitest';
import { createBoardDocument, type MarkupDocument, type MarkupItem, type Point, type Rect } from '../../src';

/** A board holding exactly `items` (MarkupDocument(kind: .board, items:)). */
export function boardWith(items: readonly MarkupItem[]): MarkupDocument {
  return { ...createBoardDocument(), items };
}

export function expectPoint(actual: Point, expected: Point, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

export function expectRect(actual: Rect, expected: Rect, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.width).toBeCloseTo(expected.width, digits);
  expect(actual.height).toBeCloseTo(expected.height, digits);
}

export const degrees = (value: number): number => (value * Math.PI) / 180;
