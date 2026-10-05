#!/usr/bin/env node
/**
 * Writes the decode goldens in test/fixtures/decode: for each case, `<case>.input.json` and what the Swift package
 * makes of it, `<case>.swift.json` (MarkupDocument.decode followed by jsonData()) or `<case>.swift-error.txt`.
 * Requires the codec oracle (tools/swift/build-oracle.sh). Run after changing the cases; commit the results.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const oracle = join(root, '.cache', 'swift-oracle', 'oracle');
if (!existsSync(oracle)) {
  console.error('Build the oracle first: tools/swift/build-oracle.sh');
  process.exit(1);
}
const directory = join(root, 'test', 'fixtures', 'decode');
mkdirSync(directory, { recursive: true });
for (const file of readdirSync(directory)) rmSync(join(directory, file));

const DOC = '11111111-1111-4111-8111-111111111111';
const id = (n) => `AAAAAAAA-0000-4000-8000-${String(n).padStart(12, '0')}`;
const box = {
  frame: [
    [10, 20],
    [100, 50],
  ],
};
const doc = (items, extra = {}) => ({ schemaVersion: 1, id: DOC, kind: 'board', items, ...extra });
const shape = (n, content = {}, extra = {}) => ({
  id: id(n),
  type: 'shape',
  content: { kind: 'rectangle', box, ...content },
  ...extra,
});
const text = (n, content = {}, extra = {}) => ({ id: id(n), type: 'text', content: { box, ...content }, ...extra });
const stroke = (n, points, extra = {}) => ({ id: id(n), type: 'stroke', content: { points, box }, ...extra });
const line = (n, content = {}, extra = {}) => ({
  id: id(n),
  type: 'line',
  content: { start: { point: [0, 0] }, end: { point: [50, 60] }, ...content },
  ...extra,
});
const image = (n, content = {}, extra = {}) => ({
  id: id(n),
  type: 'image',
  content: {
    assetID: 'photo.jpg',
    pixelSize: [4000, 3000],
    box: {
      frame: [
        [0, 0],
        [800, 600],
      ],
    },
    ...content,
  },
  ...extra,
});

const cases = {
  'point-extra-elements': doc([
    stroke(1, [
      [0, 0, 9],
      [1, 1],
    ]),
  ]),
  'point-too-short': doc([stroke(1, [[0]]), shape(2)]),
  'point-null-element': doc([stroke(1, [[null, 1]]), shape(2)]),
  'frame-extra-element': doc([
    shape(1, {
      box: {
        frame: [
          [0, 0],
          [10, 10],
          [5, 5],
        ],
      },
    }),
  ]),
  'frame-negative-size': doc([
    shape(1, {
      box: {
        frame: [
          [50, 50],
          [-20, -10],
        ],
        rotation: 0.5,
      },
    }),
  ]),
  'bad-item-color': doc([shape(1, {}, { style: { strokeColor: '#12' } }), shape(2)]),
  'bad-document-color': doc([shape(1)], { backgroundColor: 'red' }),
  'whitespace-color': doc([shape(1, {}, { style: { strokeColor: ' #ff0000 ', fillColor: '00ff0080' } })]),
  'unknown-shape-kind': doc([shape(1, { kind: 'hexagon' }), shape(2, { kind: null }), shape(3)]),
  'lenient-enums': doc([
    shape(1, {}, { style: { dash: 'wavy' } }),
    text(2, { text: 'Best view!', alignment: 'justify', font: { family: 'comic', size: 20 } }),
    line(3, { startHead: 'circle', endHead: 'diamond', kind: 'spline', waypoints: [[1]], isClosed: true }),
    line(4, { startHead: null, endHead: null, kind: null }),
    text(5, { alignment: null, font: { family: null } }),
  ]),
  'style-absent-empty-null': doc([shape(1), shape(2, {}, { style: {} }), shape(3, {}, { style: null })]),
  'style-wrong-types': doc([
    shape(1, {}, { style: { lineWidth: true } }),
    shape(2, {}, { style: { shadow: 1 } }),
    shape(3, {}, { style: { opacity: '1' } }),
    shape(4, {}, { style: [] }),
    shape(5),
  ]),
  'is-locked': doc([
    shape(1, {}, { isLocked: 'yes' }),
    shape(2, {}, { isLocked: false }),
    shape(3, {}, { isLocked: true }),
    shape(4, {}, { isLocked: null }),
  ]),
  'parent-id': doc([
    image(9),
    shape(1, {}, { parentID: 'not-a-uuid' }),
    shape(2, {}, { parentID: null }),
    shape(3, {}, { parentID: id(9).toLowerCase() }),
  ]),
  'lowercase-ids': doc([{ ...shape(1), id: id(1).toLowerCase() }], { id: DOC.toLowerCase() }),
  'uuid-forms': doc([
    { ...shape(1), id: `{${id(1)}}` },
    { ...shape(2), id: id(2).replace(/-/g, '') },
    { ...shape(3), id: ` ${id(3)}` },
    shape(4),
  ]),
  'missing-or-bad-type': doc([
    { ...shape(1), type: undefined },
    { ...shape(2), type: 5 },
    { ...shape(3), type: 'hologram' },
    shape(4),
  ]),
  'item-not-object': doc([1, 'x', null, [], shape(1)]),
  'content-not-object': doc([{ id: id(1), type: 'shape', content: [] }, { id: id(2), type: 'shape' }, shape(3)]),
  'text-defaults': doc([text(1)]),
  'text-values': doc([
    text(1, {
      text: 'Summit 2,456 m\nBest view! a/b',
      font: { family: 'hiraginoMincho', size: 24, bold: true, italic: true },
      color: '#AF52DE',
      alignment: 'center',
      fixedWidth: 200,
      padding: 12,
      box: {
        frame: [
          [5, 5],
          [200, 80],
        ],
        rotation: -0.2,
      },
    }),
  ]),
  'text-fixed-width-null': doc([text(1, { fixedWidth: null, padding: null, text: null })]),
  'text-bad-fields': doc([
    text(1, { font: { size: '36' } }),
    text(2, { color: '#GG0000' }),
    text(3, { text: 5 }),
    text(4, { font: 'Helvetica' }),
    text(5, { font: { bold: 'yes' } }),
    text(6),
  ]),
  'image-fields': doc([
    image(1),
    image(2, { pixelSize: undefined }),
    image(3, { assetID: 7 }),
    image(4, { pixelSize: [4000] }),
  ]),
  'image-without-background': doc([image(1)], { kind: 'image' }),
  'image-missing-background': doc([image(1)], { kind: 'image', backgroundItemID: id(2) }),
  'image-kind': doc([image(1, {}, { isLocked: true, style: { lineWidth: 6 } }), shape(2)], {
    kind: 'image',
    backgroundItemID: id(1),
  }),
  'image-bad-background-id': doc([image(1)], { kind: 'image', backgroundItemID: 'x' }),
  'board-ignores-background-id': doc([image(1)], { kind: 'board', backgroundItemID: 'x' }),
  'kind-other-string': doc([shape(1)], { kind: 'photo' }),
  'kind-missing': doc([shape(1)], { kind: undefined }),
  'kind-number': doc([shape(1)], { kind: 5 }),
  'schema-zero': doc([], { schemaVersion: 0 }),
  'schema-negative': doc([], { schemaVersion: -3 }),
  'schema-string': doc([], { schemaVersion: '1' }),
  'schema-fraction': doc([], { schemaVersion: 1.5 }),
  'schema-newer': doc([], { schemaVersion: 2 }),
  'schema-missing': doc([shape(1)], { schemaVersion: undefined }),
  'items-object': doc({}),
  'items-null': doc(null),
  'items-missing': doc(undefined),
  'background-null': doc([], { backgroundColor: null }),
  'background-short': doc([], { backgroundColor: 'F2F2F7' }),
  'id-invalid': doc([], { id: 'x' }),
  'id-number': doc([], { id: 1 }),
  'root-array': [],
  'root-string': 'document',
  'line-variants': doc([
    line(1),
    line(2, {
      kind: 'polyline',
      waypoints: [
        [10, 10],
        [20, 0],
      ],
      startHead: 'arrow',
      endHead: 'arrow',
    }),
    line(3, {
      kind: 'polyline',
      waypoints: [
        [10, 10],
        [20, 0],
      ],
      isClosed: true,
    }),
    line(4, { kind: 'curve' }),
    line(5, { kind: 'curve', waypoints: [], isClosed: true }),
    line(6, { kind: 'straight', waypoints: [[5, 5]], isClosed: true }),
    line(7, { kind: 'polyline', waypoints: null, isClosed: null }),
  ]),
  'line-bad-fields': doc([
    line(1, { kind: 'polyline', waypoints: [[1]] }),
    line(2, { kind: 'polyline', isClosed: 'true' }),
    line(3, { start: undefined }),
    line(4, { end: { point: [1] } }),
    line(5),
  ]),
  bindings: doc([
    shape(9),
    line(1, { start: { point: [1, 2], binding: { itemID: id(9), anchor: [0.5, 0.5] } } }),
    line(2, { start: { point: [1, 2], binding: null } }),
    line(3, { start: { point: [1, 2], binding: { itemID: id(9), anchor: [0.5] } } }),
    line(4, { end: { point: [1, 2], binding: { itemID: 'x', anchor: [0, 0] } } }),
    line(5, { end: { point: [1, 2], binding: { itemID: id(9).toLowerCase(), anchor: [1, 0], extra: true } } }),
  ]),
  'stroke-variants': doc([
    stroke(1, []),
    stroke(
      2,
      [
        [0, 0],
        [0.5, 1],
        [1, 0.5],
      ],
      { content: { points: [[0, 0]], box, isHighlighter: true } },
    ),
    { id: id(3), type: 'stroke', content: { box } },
    stroke(4, [[0, 0]], { content: { points: [[0, 0]], box, isHighlighter: 'yes' } }),
  ]),
  'box-variants': doc([
    shape(1, {
      box: {
        frame: [
          [1, 2],
          [3, 4],
        ],
        rotation: null,
      },
    }),
    shape(2, {
      box: {
        frame: [
          [1, 2],
          [3, 4],
        ],
      },
    }),
    shape(3, { box: { rotation: 1 } }),
    shape(4, { box: { frame: [[1, 2]] } }),
    shape(5, { box: null }),
    shape(6, { lockAspect: 'true' }),
    shape(7, { lockAspect: null }),
  ]),
  'extra-keys': doc([shape(1, { future: { nested: [1, 2] } }, { future: 'x', style: { glow: true } })], {
    future: [1, 2, 3],
  }),
  numbers: doc([
    shape(1, {
      box: {
        frame: [
          [-0, 1e-7],
          [1e17, 0.00012345],
        ],
        rotation: -1e-5,
      },
    }),
    shape(2, {
      box: {
        frame: [
          [0.1, 0.2],
          [1 / 3, 2 / 3],
        ],
        rotation: 2 ** 53 + 1,
      },
    }),
    shape(3, {
      box: {
        frame: [
          [1e-320, -1e300],
          [123456789.123, 5e-324],
        ],
      },
    }),
  ]),
  strings: doc([
    text(1, { text: 'a/b "q" \\ \t \n \u0001 \u001f \u007f     😀 山小屋 6:00 出発' }),
    image(2, { assetID: 'folder/photo name.jpg' }),
  ]),
  'duplicate-ids': doc([shape(1), shape(1, { kind: 'ellipse' })]),
  'empty-document': { id: DOC },
};

let written = 0;
for (const [name, input] of Object.entries(cases)) {
  const inputFile = join(directory, `${name}.input.json`);
  writeFileSync(inputFile, `${JSON.stringify(input, null, 2)}\n`);
  const result = spawnSync(oracle, ['document', inputFile], { encoding: 'utf8' });
  if (result.status === 0) {
    writeFileSync(join(directory, `${name}.swift.json`), result.stdout);
  } else {
    writeFileSync(join(directory, `${name}.swift-error.txt`), `${result.stdout.trim()}\n`);
  }
  written += 1;
}
console.log(`wrote ${written} decode cases to test/fixtures/decode`);
