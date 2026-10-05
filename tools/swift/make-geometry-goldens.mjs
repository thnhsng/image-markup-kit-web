#!/usr/bin/env node
/**
 * Writes test/fixtures/geometry/cases.json (deterministic geometry inputs) and swift.json (what ImageMarkupKit's own
 * geometry makes of them: shape, stroke and line paths, line flattening, resize and rotate sessions, board layout,
 * visual bounds, hit testing, binding, erasing, export plans and photo attachments).
 * Requires the codec oracle (tools/swift/build-oracle.sh). Run after changing the cases; commit the results.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const oracle = join(root, '.cache', 'swift-oracle', 'oracle');
if (!existsSync(oracle)) {
  console.error('Build the oracle first: tools/swift/build-oracle.sh');
  process.exit(1);
}
const directory = join(root, 'test', 'fixtures', 'geometry');
mkdirSync(directory, { recursive: true });

// Deterministic pseudo-random numbers (mulberry32), rounded to 1/1000 so inputs are exact in JSON.
let seed = 0x1badb002;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => Math.round((min + random() * (max - min)) * 1000) / 1000;
const id = (n) => `B0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const style = (extra = {}) => ({ strokeColor: '#FF3B30FF', lineWidth: 6, ...extra });

const kinds = [
  'rectangle',
  'roundedRectangle',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'pentagon',
  'speechBubble',
  'highlightBox',
];
const shapes = [];
for (const kind of kinds) {
  for (const [width, height] of [
    [200, 100],
    [37.5, 91.25],
    [10, 10],
    [0.5, 300],
  ]) {
    for (const cornerRadius of [0, 8, 300, -5]) shapes.push({ kind, width, height, cornerRadius });
  }
}

const zigzag = [
  [0, 0],
  [10, 20],
  [20, 0],
  [30, 20],
  [40, 0],
];
const wave = Array.from({ length: 24 }, (_, i) => [i * 7.5, Math.round(Math.sin(i / 3) * 40 * 1000) / 1000]);
const strokes = [
  [],
  [[5, 5]],
  [
    [0, 0],
    [10, 0],
  ],
  zigzag,
  wave,
];

const sampleSets = [
  [
    [0, 0],
    [100, 0],
  ],
  [
    [0, 0],
    [10, 0],
  ],
  [
    [5, 5],
    [5, 5],
  ],
  [
    [0, 0],
    [100, 0],
    [100, 100],
  ],
  wave,
  [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
    [0, 0],
  ],
];
const lines = [];
for (const samples of sampleSets) {
  for (const lineWidth of [1, 6, 20]) {
    for (const [startHead, endHead] of [
      ['none', 'none'],
      ['none', 'arrow'],
      ['arrow', 'none'],
      ['arrow', 'arrow'],
    ]) {
      for (const closed of [false, true]) lines.push({ samples, closed, lineWidth, startHead, endHead });
    }
  }
}

const pointSets = [
  [],
  [[3, 4]],
  [
    [0, 0],
    [100, 80],
  ],
  [
    [0, 0],
    [100, 80],
    [200, 0],
  ],
  [
    [0, 0],
    [100, 80],
    [200, 0],
    [300, 60],
  ],
  [
    [0, 0],
    [0, 0],
    [50, 50],
    [50, 50.00001],
    [120, 10],
  ],
  Array.from({ length: 6 }, () => [between(-200, 200), between(-200, 200)]),
];
const flatten = [];
for (const points of pointSets) {
  for (const kind of ['straight', 'polyline', 'curve']) {
    for (const closed of [false, true]) flatten.push({ points, kind, closed });
  }
}

const handles = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];
const resize = [];
for (const rotation of [0, 0.3, 1.2, Math.PI, -2.4]) {
  const box = { frame: [100, 50, 200, 120], rotation };
  const center = [200, 110];
  for (const [u, v] of handles) {
    for (const lockAspect of [false, true]) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const lx = 100 + u * 200 - center[0];
      const ly = 50 + v * 120 - center[1];
      const touch = [center[0] + lx * cos - ly * sin, center[1] + lx * sin + ly * cos];
      const drags = [
        [touch[0] + 37, touch[1] - 23],
        [touch[0] - 400, touch[1] - 400],
        [touch[0] + between(-80, 80), touch[1] + between(-80, 80)],
      ];
      resize.push({ box, u, v, touch, lockAspect, minimumSize: 8, anchorsTop: false, drags });
      if (v === 0.5 && u !== 0.5)
        resize.push({ box, u, v, touch, lockAspect, minimumSize: 24, anchorsTop: true, drags });
    }
  }
}
const rotate = [0, 0.5, -1].map((rotation) => ({
  box: { frame: [-50, -50, 100, 100], rotation },
  touch: [0, -100],
  drags: [-30, 43, 44.9, 46, 90, 133, 179, -179, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [Math.round(100 * Math.sin(a) * 1e6) / 1e6, Math.round(-100 * Math.cos(a) * 1e6) / 1e6];
  }),
}));

const boards = [
  { sizes: [] },
  { sizes: [[400, 300]] },
  {
    sizes: [
      [300, 400],
      [400, 300],
      [1600, 900],
      [100, 100],
      [900, 1600],
    ],
  },
  {
    sizes: [
      [400, 300],
      [0, 0],
      [400, -2],
    ],
  },
  {
    sizes: [
      [400, 300],
      [300, 400],
    ],
    append: [
      [800, 600],
      [600, 800],
    ],
  },
];

const box = (x, y, w, h, rotation = 0) => ({
  frame: [
    [x, y],
    [w, h],
  ],
  rotation,
});
const shape = (n, kind, b, extra = {}) => ({
  id: id(n),
  type: 'shape',
  content: { kind, box: b, lockAspect: false },
  style: style(),
  ...extra,
});
const text = (n, b, extra = {}) => ({
  id: id(n),
  type: 'text',
  content: {
    text: 'Summit',
    font: { family: 'system', size: 30, bold: true, italic: false },
    color: '#FF3B30FF',
    alignment: 'left',
    padding: 8,
    box: b,
  },
  style: { lineWidth: 2 },
  ...extra,
});
const stroke = (n, points, b, extra = {}) => ({
  id: id(n),
  type: 'stroke',
  content: { points, box: b, isHighlighter: false },
  style: style({ lineWidth: 4 }),
  ...extra,
});
const line = (n, content, extra = {}) => ({
  id: id(n),
  type: 'line',
  content: { startHead: 'none', endHead: 'arrow', ...content },
  style: style(),
  ...extra,
});
const image = (n, b, extra = {}) => ({
  id: id(n),
  type: 'image',
  content: { assetID: `${n}.jpg`, pixelSize: [4032, 3024], box: b },
  style: {},
  ...extra,
});

const annotated = {
  schemaVersion: 1,
  id: id(900),
  kind: 'image',
  backgroundItemID: id(1),
  backgroundColor: '#FFFFFFFF',
  items: [
    image(1, box(0, 0, 1024, 768), { isLocked: true }),
    ...kinds.map((kind, i) =>
      shape(
        10 + i,
        kind,
        box(40 + (i % 3) * 300, 40 + Math.floor(i / 3) * 220, 180 + i * 7, 120 - i * 5, i % 2 ? 0.35 * i : 0),
        {
          style: style(
            i % 3 === 0
              ? { fillColor: '#FFCC004D' }
              : i % 3 === 1
                ? { strokeColor: null, fillColor: '#007AFFFF', lineWidth: 0 }
                : { lineWidth: 2 + i, cornerRadius: 6 * i },
          ),
        },
      ),
    ),
    text(30, box(600, 600, 220, 62, -0.2)),
    text(31, box(100, 650, 140, 52), {
      style: { fillColor: '#FFF3A6FF', strokeColor: '#E0B300FF', lineWidth: 2, shadow: true },
    }),
    stroke(
      40,
      wave.map(([x, y]) => [x / 180, (y + 40) / 80]),
      box(300, 300, 180, 80, 0.4),
    ),
    stroke(41, [[0, 0.5]], box(900, 100, 6, 6)),
    line(50, { start: { point: [20, 700] }, end: { point: [400, 520] } }),
    line(51, {
      start: { point: [500, 400] },
      end: { point: [700, 520] },
      kind: 'polyline',
      waypoints: [
        [600, 300],
        [650, 450],
      ],
      startHead: 'arrow',
    }),
    line(52, {
      start: { point: [100, 300] },
      end: { point: [300, 300] },
      kind: 'curve',
      waypoints: [
        [150, 200],
        [250, 380],
      ],
    }),
    line(
      53,
      {
        start: { point: [700, 100] },
        end: { point: [700, 300] },
        kind: 'polyline',
        waypoints: [
          [900, 100],
          [900, 300],
        ],
        isClosed: true,
      },
      { style: style({ fillColor: '#34C759FF' }) },
    ),
    line(54, {
      start: { point: [0, 0], binding: { itemID: id(10), anchor: [0.5, 0.5] } },
      end: { point: [0, 0], binding: { itemID: id(30), anchor: [0, 1] } },
    }),
    line(55, { start: { point: [800, 700] }, end: { point: [800, 700] } }),
    shape(60, 'rectangle', box(820, 560, 100, 100), { isLocked: true, style: style({ fillColor: '#FF3B30FF' }) }),
    shape(61, 'ellipse', box(500, 50, 0, 0)),
    shape(62, 'star', box(980, 700, -60, -40, 0.2)),
  ],
};

const board = {
  schemaVersion: 1,
  id: id(901),
  kind: 'board',
  backgroundColor: '#FFFFFFFF',
  items: [
    image(1, box(0, 0, 800, 600)),
    image(2, box(848, 0, 450, 600, 0.3)),
    image(3, box(1346, 0, 1066.667, 600)),
    shape(10, 'ellipse', box(100, 100, 120, 90), { parentID: id(1) }),
    text(11, box(900, 100, 200, 52), { parentID: id(2) }),
    stroke(
      12,
      [
        [0, 0],
        [0.5, 1],
        [1, 0.2],
      ],
      box(1500, 200, 300, 100),
      { parentID: id(3) },
    ),
    line(13, {
      start: { point: [0, 0], binding: { itemID: id(1), anchor: [0.75, 0.25] } },
      end: { point: [0, 0], binding: { itemID: id(2), anchor: [0.3, 0.6] } },
    }),
    line(
      14,
      { start: { point: [1400, 500] }, end: { point: [2000, 450] }, kind: 'curve', waypoints: [[1700, 300]] },
      { parentID: id(3) },
    ),
    line(
      15,
      { start: { point: [300, 300] }, end: { point: [300, 300], binding: { itemID: id(10), anchor: [1, 0.5] } } },
      { parentID: id(1) },
    ),
    shape(16, 'highlightBox', box(1200, 520, 300, 46), {
      style: { fillColor: '#FFE60073', lineWidth: 0, cornerRadius: 4 },
    }),
  ],
};

const emptyBoard = { schemaVersion: 1, id: id(902), kind: 'board', backgroundColor: '#FFFFFFFF', items: [] };

const hitPoints = [];
for (let y = -40; y <= 800; y += 40) for (let x = -40; x <= 2440; x += 40) hitPoints.push([x, y]);
for (let i = 0; i < 600; i += 1) hitPoints.push([between(-50, 2450), between(-50, 820)]);
const bindPoints = Array.from({ length: 120 }, () => [between(-50, 2450), between(-50, 820)]);
const tolerances = [1, 10];
const eraserSegments = Array.from({ length: 40 }, () => ({
  a: [between(-50, 2400), between(-50, 800)],
  b: [between(-50, 2400), between(-50, 800)],
  r: [3, 12, 40][Math.floor(random() * 3)],
}));
const exportOptions = [
  {},
  { maxPixelDimension: 4096, maxPixelCount: 16000000, boardPadding: 0 },
  { maxPixelCount: 1000000 },
  { minimumBoardScale: 5 },
  { maxPixelCount: 16000000 },
];

const carry = [
  { document: board, item: 0, box: { frame: [1000, 300, 1600, 1200], rotation: Math.PI / 2 } },
  { document: board, item: 1, box: { frame: [848, 700, 450, 600], rotation: 0 } },
  { document: board, item: 2, box: { frame: [1346, 0, 533.333, 300], rotation: -0.7 } },
];

const cases = {
  shapes,
  strokes,
  lines,
  flatten,
  resize,
  rotate,
  boards,
  documents: [annotated, board, emptyBoard],
  hitPoints,
  bindPoints,
  tolerances,
  eraserSegments,
  exportOptions,
  carry,
};
const casesFile = join(directory, 'cases.json');
writeFileSync(casesFile, `${JSON.stringify(cases)}\n`);
const result = spawnSync(oracle, ['geometry', casesFile], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
if (result.status !== 0) {
  console.error(result.stdout, result.stderr);
  process.exit(1);
}
writeFileSync(join(directory, 'swift.json'), `${result.stdout}\n`);
console.log(
  `wrote test/fixtures/geometry: ${shapes.length} shapes, ${lines.length} lines, ${flatten.length} flattenings, ${resize.length} resize sessions, ${hitPoints.length} hit points`,
);
