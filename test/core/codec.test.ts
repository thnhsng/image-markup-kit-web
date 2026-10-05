import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MarkupColors,
  MarkupError,
  STANDARD_STYLE_DEFAULTS,
  createCurveItem,
  createImageDocument,
  createLineItem,
  createPolylineItem,
  createShapeItem,
  createStrokeItem,
  isMarkupError,
  itemStyle,
  modelEquals,
  normalizeZOrder,
  parseDocument,
  serializeDocument,
  type MarkupDocument,
  type MarkupItem,
  type TextItem,
} from '../../src';

const fixtures = new URL('../fixtures/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, fixtures), 'utf8');

function roundTrip(document: MarkupDocument): MarkupDocument {
  return parseDocument(serializeDocument(document));
}

function textItem(): TextItem {
  return {
    id: 'C0FFEE00-0000-4000-8000-000000000001',
    type: 'text',
    content: {
      text: 'Hello 世界',
      font: { family: 'hiraginoMincho', size: 24, bold: true, italic: true },
      color: MarkupColors.red,
      alignment: 'center',
      fixedWidth: 200,
      padding: 12,
      box: { frame: { x: 5, y: 5, width: 200, height: 61 }, rotation: -0.2 },
    },
    style: STANDARD_STYLE_DEFAULTS.note,
    isLocked: false,
    parentID: null,
  };
}

// Port of ModelCodableTests.sampleDocument (the text box is given instead of measured).
function sampleDocument(): MarkupDocument {
  const document = createImageDocument({ assetID: 'a.jpg', pixelSize: { width: 4032, height: 3024 } });
  const shape = createShapeItem(
    'star',
    { x: 10, y: 20, width: 100, height: 80 },
    itemStyle({
      strokeColor: MarkupColors.blue,
      fillColor: MarkupColors.yellow,
      lineWidth: 3,
      dash: 'dotted',
      opacity: 0.8,
      cornerRadius: 4,
      shadow: true,
    }),
    { rotation: 0.4 },
  );
  const text = textItem();
  const stroke = createStrokeItem(
    [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 90, y: 10 },
    ],
    STANDARD_STYLE_DEFAULTS.pen,
  );
  const line: MarkupItem = {
    ...createLineItem({ x: 60, y: 60 }, { x: 5, y: 66 }, STANDARD_STYLE_DEFAULTS.line, {
      startHead: 'arrow',
      endHead: 'arrow',
    }),
  };
  const connector: MarkupItem =
    line.type === 'line'
      ? {
          ...line,
          content: {
            ...line.content,
            start: { point: { x: 60, y: 60 }, binding: { itemID: shape.id, anchor: { x: 0.5, y: 0.5 } } },
            end: { point: { x: 5, y: 66 }, binding: { itemID: text.id, anchor: { x: 0, y: 1 } } },
          },
        }
      : line;
  const items = [...document.items, shape, text, stroke, connector];
  items[3] = { ...stroke, parentID: document.items[0]?.id ?? null };
  return { ...document, items };
}

describe('document.json round trip (ModelCodableTests)', () => {
  it('preserves every kind', () => {
    const document = sampleDocument();
    const decoded = roundTrip(document);
    expect(modelEquals(decoded, document)).toBe(true);
    expect(decoded.items.map((item) => item.type)).toEqual(['image', 'shape', 'text', 'stroke', 'line']);
  });

  it('preserves a board', () => {
    const board: MarkupDocument = {
      ...createImageDocument({ assetID: 'a', pixelSize: { width: 400, height: 300 } }),
      kind: 'board',
      backgroundItemID: null,
    };
    const decoded = roundTrip(board);
    expect(modelEquals(decoded, board)).toBe(true);
    expect(decoded.kind).toBe('board');
  });

  it('skips unknown item types', () => {
    const json = `{"schemaVersion":1,"id":"11111111-1111-1111-1111-111111111111","kind":"board","items":[
      {"id":"33333333-3333-3333-3333-333333333333","type":"hologram","content":{}},
      {"id":"44444444-4444-4444-4444-444444444444","type":"shape","content":{"kind":"ellipse","box":{"frame":[[0,0],[10,10]]}}}
    ]}`;
    const document = parseDocument(json);
    expect(document.items).toHaveLength(1);
    const first = document.items[0];
    expect(first?.type === 'shape' && first.content.kind).toBe('ellipse');
  });

  it('rejects a newer schema version', () => {
    expect(() => parseDocument('{"schemaVersion":99,"kind":"board","items":[]}')).toThrow(MarkupError);
    try {
      parseDocument('{"schemaVersion":99,"kind":"board","items":[]}');
    } catch (error) {
      expect(isMarkupError(error) && error.code).toBe('unsupportedSchemaVersion');
      expect(isMarkupError(error) && error.schemaVersion).toBe(99);
    }
  });

  it('decodes the version 1 fixture', () => {
    const document = parseDocument(read('document_v1.json'));
    expect(document.backgroundItemID).toBe('22222222-2222-2222-2222-222222222222');
    expect(document.items).toHaveLength(5);
    const [, ellipse, text, stroke, line] = document.items;
    expect(ellipse?.style.dash).toBe('dashed');
    expect(ellipse?.type === 'shape' && ellipse.content.box.rotation).toBeCloseTo(0.3, 9);
    expect(text?.type === 'text' && text.content.font.family).toBe('hiraginoSans');
    expect(text?.type === 'text' && text.content.padding).toBe(8);
    expect(stroke?.type === 'stroke' && stroke.content.isHighlighter).toBe(true);
    expect(line?.type === 'line' && line.content.start.binding?.itemID).toBe('33333333-3333-3333-3333-333333333333');
    expect(line?.parentID).toBe(document.backgroundItemID);
  });

  it('keeps photos below annotations', () => {
    const base = createImageDocument({ assetID: 'a', pixelSize: { width: 400, height: 300 } });
    const photo = base.items[0] as MarkupItem;
    const second = { ...photo, id: 'B0000000-0000-4000-8000-000000000002', isLocked: false };
    const board: MarkupDocument = {
      ...base,
      kind: 'board',
      backgroundItemID: null,
      items: [photo, createShapeItem('rectangle', { x: 0, y: 0, width: 10, height: 10 }, itemStyle()), second],
    };
    expect(normalizeZOrder(board).items.map((item) => item.type === 'image')).toEqual([true, true, false]);
  });
});

describe('lines in document.json (LinePathTests)', () => {
  it('writes straight lines as before polylines existed', () => {
    const arrow = createLineItem({ x: 0, y: 0 }, { x: 10, y: 10 }, itemStyle());
    const document = { ...createImageDocument({ assetID: 'a', pixelSize: { width: 10, height: 10 } }) };
    const json = serializeDocument({ ...document, items: [...document.items, arrow] });
    for (const key of ['"kind" : "straight"', '"waypoints"', '"isClosed"']) expect(json).not.toContain(key);
  });

  it('round-trips polylines and curves', () => {
    const document = createImageDocument({ assetID: 'a', pixelSize: { width: 1000, height: 800 } });
    const points = [
      { x: 1, y: 2 },
      { x: 30, y: 40 },
      { x: 50, y: 6 },
    ];
    const items = [
      ...document.items,
      createPolylineItem(points, itemStyle(), { endHead: 'arrow' }),
      createPolylineItem(points, itemStyle({ fillColor: MarkupColors.yellow }), { closed: true }),
      createCurveItem(
        [
          { x: 5, y: 5 },
          { x: 60, y: 90 },
          { x: 120, y: 5 },
          { x: 150, y: 40 },
        ],
        itemStyle(),
      ),
    ];
    const decoded = roundTrip({ ...document, items });
    expect(modelEquals(decoded, { ...document, items })).toBe(true);
    expect(decoded.items.flatMap((item) => (item.type === 'line' ? [item.content.kind] : []))).toEqual([
      'polyline',
      'polyline',
      'curve',
    ]);
  });

  it('decodes legacy lines as straight', () => {
    const lines = parseDocument(read('document_v1.json')).items.flatMap((item) =>
      item.type === 'line' ? [item.content] : [],
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.kind === 'straight' && line.waypoints.length === 0 && !line.isClosed)).toBe(true);
  });
});

describe('Swift-encoded documents', () => {
  const goldens = readdirSync(new URL('swift/', fixtures)).filter((name) => name.startsWith('board-'));

  it('has the scrubbed demo documents', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(7);
  });

  for (const name of goldens) {
    it(`${name} is written back byte for byte`, () => {
      const text = read(`swift/${name}`);
      expect(serializeDocument(parseDocument(text))).toBe(text);
    });
  }

  it('the version 1 fixture is written like the Swift package writes it', () => {
    expect(serializeDocument(parseDocument(read('document_v1.json')))).toBe(read('document_v1.swift.json'));
  });
});

describe('lossy decoding matches the Swift package', () => {
  // test/fixtures/decode: each input and what ImageMarkupKit's own decoder made of it
  // (tools/swift/make-decode-goldens.mjs).
  const names = readdirSync(new URL('decode/', fixtures))
    .filter((name) => name.endsWith('.input.json'))
    .map((name) => name.replace('.input.json', ''));
  const files = new Set(readdirSync(new URL('decode/', fixtures)));

  it('has the cases', () => {
    expect(names.length).toBeGreaterThan(40);
  });

  for (const name of names) {
    it(name, () => {
      const input = read(`decode/${name}.input.json`);
      if (files.has(`${name}.swift.json`)) {
        expect(serializeDocument(parseDocument(input))).toBe(read(`decode/${name}.swift.json`));
      } else {
        const swiftError = read(`decode/${name}.swift-error.txt`);
        let caught: unknown;
        try {
          parseDocument(input);
        } catch (error) {
          caught = error;
        }
        expect(isMarkupError(caught)).toBe(true);
        const expectedCode = swiftError.includes('unsupportedSchemaVersion')
          ? 'unsupportedSchemaVersion'
          : 'invalidDocument';
        expect(isMarkupError(caught) && caught.code).toBe(expectedCode);
      }
    });
  }

  it('gives a document without an id a new uppercase UUID', () => {
    const document = parseDocument('{}');
    expect(document.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    expect(document.kind).toBe('board');
    expect(document.items).toEqual([]);
  });

  it('accepts the parsed value as well as the text', () => {
    const text = read('swift/board-1.json');
    expect(modelEquals(parseDocument(JSON.parse(text) as object), parseDocument(text))).toBe(true);
  });

  it('reports invalid JSON', () => {
    expect(() => parseDocument('{')).toThrow(MarkupError);
  });
});
