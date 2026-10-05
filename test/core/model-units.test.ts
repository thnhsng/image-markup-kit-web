import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarkupColors,
  MarkupError,
  backgroundItem,
  colorComponents,
  createImageDocument,
  createUUID,
  createShapeItem,
  findItem,
  isLineItem,
  isMarkupError,
  isTextItem,
  itemBox,
  itemStyle,
  locksAspectRatio,
  modelEquals,
  parseUUID,
  rgba,
  updateItem,
  withAlpha,
} from '../../src';

describe('colors', () => {
  it('clamps and quantizes components like RGBAColor', () => {
    expect(rgba(1, 0, 0)).toBe('#FF0000FF');
    expect(rgba(2, -1, NaN, 0.45)).toBe('#FF000073');
    expect(withAlpha(MarkupColors.highlighterYellow, 0.45)).toBe('#FFE60073');
    expect(colorComponents('#80000000').red).toBeCloseTo(128 / 255, 12);
    expect(colorComponents('not a color')).toEqual({ red: 0, green: 0, blue: 0, alpha: 1 });
  });
});

describe('UUIDs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pattern = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

  it('uses randomUUID, then getRandomValues, then Math.random', () => {
    expect(createUUID()).toMatch(pattern);
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) });
    expect(createUUID()).toBe('ABABABAB-ABAB-4BAB-ABAB-ABABABABABAB');
    vi.stubGlobal('crypto', undefined);
    expect(createUUID()).toMatch(pattern);
  });

  it('parses the canonical form only', () => {
    expect(parseUUID('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('3F2504E0-4F89-41D3-9A0C-0305E82C3301');
    expect(parseUUID('{3F2504E0-4F89-41D3-9A0C-0305E82C3301}')).toBeNull();
  });
});

describe('documents and items', () => {
  it('finds items and the background', () => {
    const document = createImageDocument({ assetID: 'a', pixelSize: { width: 10, height: 20 } });
    const background = backgroundItem(document);
    expect(background?.content.box.frame).toEqual({ x: 0, y: 0, width: 512, height: 1024 });
    expect(backgroundItem({ ...document, backgroundItemID: null })).toBeUndefined();
    expect(findItem(document, 'nope')).toBeUndefined();
    expect(updateItem(document, 'nope', (item) => item)).toBe(document);
    const square = createShapeItem('rectangle', { x: 0, y: 0, width: 5, height: 5 }, itemStyle(), { lockAspect: true });
    expect(locksAspectRatio(square)).toBe(true);
    expect(locksAspectRatio(document.items[0]!)).toBe(true);
    expect(isTextItem(square) || isLineItem(square)).toBe(false);
    expect(itemBox(square)?.frame.width).toBe(5);
  });

  it('compares model values structurally', () => {
    expect(modelEquals({ a: [1, { b: 0 }] }, { a: [1, { b: -0 }] })).toBe(true);
    expect(modelEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(modelEquals([1], { 0: 1 })).toBe(false);
    expect(modelEquals({ a: undefined }, { b: undefined })).toBe(false);
    expect(modelEquals(null, {})).toBe(false);
  });

  it('recognizes its errors across copies', () => {
    const own = new MarkupError('aborted', 'stop', { assetID: 'a', detail: 1 });
    expect(isMarkupError(own)).toBe(true);
    const foreign = Object.assign(new Error('x'), { name: 'MarkupError', code: 'aborted' });
    expect(isMarkupError(foreign)).toBe(true);
    expect(isMarkupError(new Error('x'))).toBe(false);
    expect(own.assetID).toBe('a');
  });
});
