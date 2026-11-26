import { describe, expect, it } from 'vitest';
import { exportRect } from '../../src/render/export-planner';
import {
  DEFAULT_EXPORT_OPTIONS,
  createBoardDocument,
  createImageDocument,
  createLineItem,
  createShapeItem,
  itemStyle,
  planExport,
  type ImageSource,
} from '../../src';

// Port of the planning half of ExportTests. The Swift defaults allow 40 MP; tests of those numbers pass them in.
const swiftDefaults = { maxPixelCount: 40_000_000 };

describe('export plan', () => {
  it('keeps the original pixel size in image mode', () => {
    const plan = planExport(createImageDocument({ assetID: 'a', pixelSize: { width: 1200, height: 900 } }));
    expect(plan.pixelSize).toEqual({ width: 1200, height: 900 });
    expect(plan.isClamped).toBe(false);
  });

  it('clamps a huge photo to the maximum dimension', () => {
    const document = createImageDocument({ assetID: 'huge', pixelSize: { width: 20000, height: 15000 } });
    const plan = planExport(document, swiftDefaults);
    expect(plan.isClamped).toBe(true);
    expect(Math.max(plan.pixelSize.width, plan.pixelSize.height)).toBeLessThanOrEqual(8192);
    expect(plan.pixelSize.width * plan.pixelSize.height).toBeLessThanOrEqual(40_000_000);
    expect(plan.pixelSize.width / plan.pixelSize.height).toBeCloseTo(20000 / 15000, 2);
  });

  it('keeps boards within the pixel budget', () => {
    const sources: ImageSource[] = Array.from({ length: 9 }, (_, i) => ({
      assetID: String(i),
      pixelSize: { width: 8000, height: 6000 },
    }));
    const plan = planExport(createBoardDocument(sources), swiftDefaults);
    expect(plan.pixelSize.width * plan.pixelSize.height).toBeLessThanOrEqual(40_000_000 + 20_000);
    expect(Math.max(plan.pixelSize.width, plan.pixelSize.height)).toBeLessThanOrEqual(8192);
  });

  it('exports a board as the union of what is drawn, plus padding when asked', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 800, height: 600 } }]);
    const document = {
      ...board,
      items: [
        ...board.items,
        createShapeItem('rectangle', { x: 900, y: 100, width: 100, height: 100 }, itemStyle({ lineWidth: 6 })),
      ],
    };
    expect(exportRect(document)).toEqual({ x: 0, y: 0, width: 1003, height: 600 });
    expect(exportRect(document, { boardPadding: 24 })).toEqual({ x: -24, y: -24, width: 1003 + 48, height: 648 });
  });

  it('exports a photo opened as a board and marked up inside as just the photo', () => {
    // 600 units high, so 899.55… units wide: rounding out to whole units would leave a sliver on the right.
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 2000, height: 1334 } }]);
    const photo = board.items[0]!.type === 'image' ? board.items[0]!.content.box.frame : null;
    if (!photo) throw new Error('no photo');
    // An arrow whose tip is 5 units inside the right edge.
    const arrow = createLineItem({ x: 500, y: 300 }, { x: photo.width - 5, y: 300 }, itemStyle());
    const plan = planExport({ ...board, items: [...board.items, arrow] });
    expect(plan.rect).toEqual(photo);
    expect(plan.pixelSize).toEqual({ width: 2000, height: 1334 });
    expect(plan.isClamped).toBe(false);
  });

  it('ends a board export at the tip of an arrow past the photo', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 800, height: 600 } }]);
    const arrow = createLineItem({ x: 700, y: 300 }, { x: 850, y: 300 }, itemStyle());
    const rect = exportRect({ ...board, items: [...board.items, arrow] });
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.x + rect.width).toBeCloseTo(850, 9);
    expect(rect.height).toBe(600);
  });

  it('fits rounded corners without miters', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 800, height: 600 } }]);
    const frame = { x: 300, y: -100, width: 100, height: 100 };
    const square = createShapeItem('rectangle', frame, itemStyle({ cornerRadius: 20 }), { rotation: Math.PI / 4 });
    const rect = exportRect({ ...board, items: [...board.items, square] });
    // Turned 45°, the rounded square reaches 30√2 (its corners' centers) + 20 (their radius) + 3 above its center.
    expect(rect.y).toBeCloseTo(-50 - (30 * Math.SQRT2 + 23), 1);
    expect(rect.height).toBeCloseTo(650 + 30 * Math.SQRT2 + 23, 1);
  });

  it('keeps the miter tip of a shape past the photo', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 800, height: 600 } }]);
    const triangle = createShapeItem('triangle', { x: 300, y: -80, width: 100, height: 100 }, itemStyle());
    const rect = exportRect({ ...board, items: [...board.items, triangle] });
    // The apex's half-angle is atan(1/2), so its miter reaches 3 / sin(atan(1/2)) = 3√5 above it, not just 3.
    expect(rect.y).toBeCloseTo(-80 - 3 * Math.sqrt(5), 9);
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(800);
  });

  it('fits the web default budget, below iOS Safari canvas limit', () => {
    expect(DEFAULT_EXPORT_OPTIONS.maxPixelCount).toBeLessThanOrEqual(16_777_216);
    const document = createImageDocument({ assetID: 'a', pixelSize: { width: 8064, height: 6048 } });
    const plan = planExport(document);
    expect(plan.isClamped).toBe(true);
    // Rounding each side may add a few hundred pixels to the budget; the canvas limit still holds.
    expect(plan.pixelSize.width * plan.pixelSize.height).toBeLessThanOrEqual(16_000_000 + 20_000);
    expect(plan.pixelSize.width * plan.pixelSize.height).toBeLessThanOrEqual(16_777_216);
  });

  it('plans the one-photo board of a typical host: JPEG, 4096 px, 16 MP, no padding', () => {
    const board = createBoardDocument([{ assetID: 'photo.jpg', pixelSize: { width: 4032, height: 3024 } }]);
    const plan = planExport(board, { maxPixelDimension: 4096, maxPixelCount: 16_000_000, boardPadding: 0 });
    expect(plan.rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(plan.pixelSize).toEqual({ width: 4032, height: 3024 });
    expect(plan.isClamped).toBe(false);
  });

  it('exports an empty board as 800 × 600', () => {
    expect(exportRect(createBoardDocument())).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
