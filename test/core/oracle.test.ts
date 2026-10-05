import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MarkupColors,
  MarkupFeatures,
  STANDARD_STYLE_DEFAULTS,
  createCurveItem,
  createImageDocument,
  createLineItem,
  createPolylineItem,
  createShapeItem,
  createStrokeItem,
  itemStyle,
  serializeDocument,
  type MarkupDocument,
} from '../../src';

// TypeScript → Swift: documents written here must be read by ImageMarkupKit's own decoder and written back
// unchanged. Runs where the codec oracle has been built (tools/swift/build-oracle.sh, macOS); skipped elsewhere.
const oracle = fileURLToPath(new URL('../../.cache/swift-oracle/oracle', import.meta.url));
const available = existsSync(oracle);
const directory = available ? mkdtempSync(join(tmpdir(), 'oracle-')) : '';
afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function swiftRewrite(kind: 'document' | 'features', text: string): string {
  const file = join(directory, `${kind}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, text);
  const result = spawnSync(oracle, [kind, file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stdout || result.stderr);
  return result.stdout;
}

function documents(): Record<string, MarkupDocument> {
  const base = createImageDocument({ assetID: 'photo.jpg', pixelSize: { width: 4032, height: 3024 } });
  const shape = createShapeItem(
    'speechBubble',
    { x: 720, y: 40, width: 250, height: 120 },
    itemStyle({ strokeColor: MarkupColors.purple, fillColor: MarkupColors.white, lineWidth: 4 }),
    { rotation: -0.08 },
  );
  const points = [
    { x: 545, y: 680 },
    { x: 610, y: 590 },
    { x: 520, y: 490 },
    { x: 470, y: 360 },
  ];
  const wave = Array.from({ length: 61 }, (_, i) => ({
    x: 50 + (280 * i) / 60,
    y: 200 + Math.sin((i / 60) * 6 * Math.PI) * 10,
  }));
  return {
    annotated: {
      ...base,
      items: [
        ...base.items,
        shape,
        createShapeItem(
          'ellipse',
          { x: 225, y: 425, width: 90, height: 90 },
          itemStyle({ strokeColor: MarkupColors.pink }),
          {
            lockAspect: true,
          },
        ),
        createShapeItem(
          'highlightBox',
          { x: 40, y: 712, width: 340, height: 46 },
          STANDARD_STYLE_DEFAULTS.highlightBox,
        ),
        createCurveItem(points, itemStyle({ dash: 'dashed' }), { endHead: 'arrow' }),
        createPolylineItem(points, itemStyle({ fillColor: MarkupColors.yellow }), { closed: true }),
        createPolylineItem(points.slice(0, 2), itemStyle()),
        createStrokeItem(wave, STANDARD_STYLE_DEFAULTS.pen),
        createStrokeItem([{ x: 580, y: 252 }], STANDARD_STYLE_DEFAULTS.highlighter, true),
        createLineItem(
          { x: 600, y: 742 },
          { x: 1000, y: 742 },
          itemStyle({ strokeColor: MarkupColors.white, dash: 'dotted' }),
          {
            startHead: 'arrow',
          },
        ),
        {
          id: 'C0FFEE00-0000-4000-8000-0000000000AA',
          type: 'text',
          content: {
            text: 'Start 6:00 at the lodge\n山小屋 6:00 出発 a/b',
            font: { family: 'hiraginoSans', size: 26, bold: false, italic: true },
            color: STANDARD_STYLE_DEFAULTS.noteTextColor,
            alignment: 'right',
            fixedWidth: 340,
            padding: 16,
            box: { frame: { x: 40, y: 60, width: 340, height: 101 }, rotation: 0.03 },
          },
          style: STANDARD_STYLE_DEFAULTS.note,
          isLocked: true,
          parentID: base.items[0]?.id ?? null,
        },
      ],
    },
    board: { ...base, kind: 'board', backgroundItemID: null, items: [] },
    tiny: {
      ...base,
      items: [
        ...base.items,
        createShapeItem('rectangle', { x: -0, y: 1e-7, width: 1e17, height: 0.00012345 }, itemStyle(), {
          rotation: -1e-5,
        }),
      ],
    },
  };
}

describe.skipIf(!available)('Swift reads what TypeScript writes', () => {
  for (const [name, document] of Object.entries(documents())) {
    it(`${name}: decoded and re-encoded by Swift without a byte changed`, () => {
      const text = serializeDocument(document);
      expect(swiftRewrite('document', text)).toBe(text);
    });
  }

  it('features: templates read back by Swift', () => {
    const configurations = [
      MarkupFeatures.all,
      MarkupFeatures.all.withGroup('board', false).with('curve', false).with('lock', false),
    ];
    for (const configuration of configurations) {
      const text = configuration.toJSONString();
      expect(swiftRewrite('features', text)).toBe(text);
    }
  });
});
