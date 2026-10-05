import { describe, expect, it } from 'vitest';
import { exportRect } from '../../src/render/export-planner';
import {
  DEFAULT_EXPORT_OPTIONS,
  createBoardDocument,
  createImageDocument,
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

  it('exports a board as the union of what is drawn plus padding', () => {
    const board = createBoardDocument([{ assetID: 'a', pixelSize: { width: 800, height: 600 } }]);
    const document = {
      ...board,
      items: [
        ...board.items,
        createShapeItem('rectangle', { x: 900, y: 100, width: 100, height: 100 }, itemStyle({ lineWidth: 6 })),
      ],
    };
    expect(exportRect(document)).toEqual({ x: -24, y: -24, width: 1003 + 48, height: 648 });
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
