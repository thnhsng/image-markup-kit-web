import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carryChildren, parentFor } from '../../src/geometry/attachments';
import { bindingFor } from '../../src/geometry/bindings';
import { flowFrames } from '../../src/geometry/board-layout';
import { bindTargetAt, erasableItems, itemAt } from '../../src/geometry/hit-testing';
import { visualBounds } from '../../src/geometry/item-geometry';
import { flattened, insertionPoints, samplesOf, trimmed } from '../../src/geometry/line-path';
import { isNullRect } from '../../src/geometry/rect';
import { pathBounds, type Path, type PathCommand } from '../../src/geometry/path';
import { lineGeometry, shapePath, smoothedPath } from '../../src/geometry/path-factory';
import { ResizeSession, RotateSession } from '../../src/geometry/transform';
import {
  appendImages,
  createBoardDocument,
  imageItems,
  parseDocument,
  planExport,
  serializeDocument,
  updateItem,
  withItemBox,
  type ArrowHead,
  type Box,
  type LineKind,
  type MarkupDocument,
  type Point,
  type Rect,
  type ShapeKind,
} from '../../src';

// Differential test against ImageMarkupKit's own geometry (tools/swift/make-geometry-goldens.mjs): the same inputs
// through the Swift code and through this port must give the same paths, points, boxes, hits and plans.
type Num = number;
type Pair = [Num, Num];
type Quad = [Num, Num, Num, Num];
type SwiftElement = [string, ...Num[]];
interface Cases {
  shapes: Array<{ kind: ShapeKind; width: Num; height: Num; cornerRadius: Num }>;
  strokes: Pair[][];
  lines: Array<{ samples: Pair[]; closed: boolean; lineWidth: Num; startHead: ArrowHead; endHead: ArrowHead }>;
  flatten: Array<{ points: Pair[]; kind: LineKind; closed: boolean }>;
  resize: Array<{
    box: { frame: Quad; rotation: Num };
    u: Num;
    v: Num;
    touch: Pair;
    lockAspect: boolean;
    minimumSize: Num;
    anchorsTop: boolean;
    drags: Pair[];
  }>;
  rotate: Array<{ box: { frame: Quad; rotation: Num }; touch: Pair; drags: Pair[] }>;
  boards: Array<{ sizes: Pair[]; append?: Pair[] }>;
  documents: object[];
  hitPoints: Pair[];
  bindPoints: Pair[];
  tolerances: Num[];
  eraserSegments: Array<{ a: Pair; b: Pair; r: Num }>;
  exportOptions: Array<Record<string, Num>>;
  carry: Array<{ document: object; item: Num; box: { frame: Quad; rotation: Num } }>;
}
interface SwiftBox {
  frame: Quad | null;
  rotation: Num;
}
interface SwiftDocument {
  bounds: Array<Quad | null>;
  samples: Array<Pair[] | null>;
  hits: Array<Array<string | null>>;
  bindTargets: Array<string | null>;
  bindings: Array<Array<{ itemID: string; anchor: Pair } | null>>;
  erase: string[][];
  plans: Array<{ rect: Quad | null; pixelSize: Pair; isClamped: boolean }>;
  parents: Array<string | null>;
}
interface Swift {
  shapes: Array<{ elements: SwiftElement[]; bounds: Quad | null }>;
  strokes: Array<{ elements: SwiftElement[]; bounds: Quad | null }>;
  lines: Array<{ shaft: SwiftElement[]; heads: SwiftElement[] | null; shaftBounds: Quad | null }>;
  flatten: Array<{ samples: Pair[]; insertion: Pair[]; trimmed: Pair[] }>;
  resize: SwiftBox[][];
  rotate: SwiftBox[][];
  boards: Quad[][];
  documents: SwiftDocument[];
  carry: string[];
}

const read = (name: string) => readFileSync(new URL(`../fixtures/geometry/${name}`, import.meta.url), 'utf8');
const cases = JSON.parse(read('cases.json')) as Cases;
const swift = JSON.parse(read('swift.json')) as Swift;

function close(actual: number, expected: number, what: string): void {
  const tolerance = 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
  if (!(Math.abs(actual - expected) <= tolerance)) {
    expect.fail(`${what}: ${actual} differs from Swift's ${expected}`);
  }
}

function closeArray(actual: readonly number[], expected: readonly number[], what: string): void {
  expect(actual.length, `${what} length`).toBe(expected.length);
  actual.forEach((value, index) => close(value, expected[index] as number, `${what}[${index}]`));
}

const P = ([x, y]: Pair): Point => ({ x, y });
const toPairs = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);
const rectValues = (rect: Rect): number[] | null =>
  isNullRect(rect) ? null : [rect.x, rect.y, rect.width, rect.height];
const toBox = (box: { frame: Quad; rotation: Num }): Box => ({
  frame: { x: box.frame[0], y: box.frame[1], width: box.frame[2], height: box.frame[3] },
  rotation: box.rotation,
});

function commandValues(command: PathCommand): [string, ...number[]] {
  switch (command.type) {
    case 'M':
    case 'L':
      return [command.type, command.x, command.y];
    case 'Q':
      return ['Q', command.x1, command.y1, command.x, command.y];
    case 'C':
      return ['C', command.x1, command.y1, command.x2, command.y2, command.x, command.y];
    case 'Z':
      return ['Z'];
  }
}

function comparePath(path: Path, expected: SwiftElement[], what: string): void {
  expect(path.map((command) => command.type).join(''), `${what} element types`).toBe(
    expected.map((e) => e[0]).join(''),
  );
  path.forEach((command, index) => {
    const [, ...values] = commandValues(command);
    const [, ...swiftValues] = expected[index] as SwiftElement;
    closeArray(values, swiftValues, `${what} element ${index}`);
  });
}

function compareRect(actual: Rect, expected: Quad | null, what: string): void {
  const values = rectValues(actual);
  if (expected === null || values === null) {
    expect(values, what).toBe(expected);
    return;
  }
  closeArray(values, expected, what);
}

describe('geometry matches the Swift package', () => {
  it('builds the same shape paths', () => {
    cases.shapes.forEach((shape, index) => {
      const what = `${shape.kind} ${shape.width}×${shape.height} r${shape.cornerRadius}`;
      const path = shapePath(shape.kind, { width: shape.width, height: shape.height }, shape.cornerRadius);
      const expected = swift.shapes[index];
      if (!expected) throw new Error('missing');
      comparePath(path, expected.elements, what);
      compareRect(pathBounds(path), expected.bounds, `${what} bounds`);
    });
  });

  it('smooths pen strokes the same way', () => {
    cases.strokes.forEach((points, index) => {
      const path = smoothedPath(points.map(P));
      const expected = swift.strokes[index];
      if (!expected) throw new Error('missing');
      comparePath(path, expected.elements, `stroke ${index}`);
      compareRect(pathBounds(path), expected.bounds, `stroke ${index} bounds`);
    });
  });

  it('builds the same shafts and arrowheads', () => {
    cases.lines.forEach((line, index) => {
      const what = `line ${index} (${line.startHead}/${line.endHead}, w${line.lineWidth}, closed ${line.closed})`;
      const geometry = lineGeometry(line.samples.map(P), line.closed, line.lineWidth, line.startHead, line.endHead);
      const expected = swift.lines[index];
      if (!expected) throw new Error('missing');
      comparePath(geometry.shaft, expected.shaft, `${what} shaft`);
      if (expected.heads === null) expect(geometry.heads, `${what} heads`).toBeNull();
      else comparePath(geometry.heads ?? [], expected.heads, `${what} heads`);
      compareRect(pathBounds(geometry.shaft), expected.shaftBounds, `${what} shaft bounds`);
    });
  });

  it('flattens polylines and curves, places "+" handles and trims ends the same way', () => {
    cases.flatten.forEach((entry, index) => {
      const what = `flatten ${index} (${entry.kind}, closed ${entry.closed}, ${entry.points.length} points)`;
      const points = entry.points.map(P);
      const samples = flattened(points, entry.kind, entry.closed);
      const expected = swift.flatten[index];
      if (!expected) throw new Error('missing');
      closeArray(toPairs(samples), expected.samples.flat(), `${what} samples`);
      closeArray(
        toPairs(insertionPoints(points, entry.kind, entry.closed)),
        expected.insertion.flat(),
        `${what} insertion`,
      );
      closeArray(toPairs(trimmed(samples, 7.5, 12.25)), expected.trimmed.flat(), `${what} trimmed`);
    });
  });

  it('resizes and rotates boxes the same way', () => {
    cases.resize.forEach((entry, index) => {
      const session = new ResizeSession({
        box: toBox(entry.box),
        u: entry.u,
        v: entry.v,
        touch: P(entry.touch),
        lockAspect: entry.lockAspect,
        minimumSize: entry.minimumSize,
        anchorsTop: entry.anchorsTop,
      });
      entry.drags.forEach((drag, step) => {
        const box = session.box(P(drag));
        const expected = swift.resize[index]?.[step];
        if (!expected) throw new Error('missing');
        compareRect(box.frame, expected.frame, `resize ${index}.${step} frame`);
        close(box.rotation, expected.rotation, `resize ${index}.${step} rotation`);
      });
    });
    cases.rotate.forEach((entry, index) => {
      const session = new RotateSession(toBox(entry.box), P(entry.touch));
      entry.drags.forEach((drag, step) => {
        const expected = swift.rotate[index]?.[step];
        if (!expected) throw new Error('missing');
        close(session.box(P(drag)).rotation, expected.rotation, `rotate ${index}.${step}`);
      });
    });
  });

  it('lays out boards the same way', () => {
    cases.boards.forEach((entry, index) => {
      const sources = entry.sizes.map(([width, height]) => ({ assetID: 'x', pixelSize: { width, height } }));
      let board = createBoardDocument(sources);
      if (entry.append) {
        board = appendImages(
          board,
          entry.append.map(([width, height]) => ({ assetID: 'y', pixelSize: { width, height } })),
        ).document;
      }
      const frames = imageItems(board).map((item) => item.content.box.frame);
      const expected = swift.boards[index] ?? [];
      expect(frames.length, `board ${index}`).toBe(expected.length);
      frames.forEach((frame, i) => compareRect(frame, expected[i] ?? null, `board ${index} frame ${i}`));
    });
    expect(flowFrames([]).length).toBe(0);
  });

  cases.documents.forEach((json, documentIndex) => {
    describe(`document ${documentIndex}`, () => {
      const document: MarkupDocument = parseDocument(json);
      const expected = swift.documents[documentIndex] as SwiftDocument;

      it('has the same visual bounds and line samples', () => {
        document.items.forEach((item, index) => {
          compareRect(visualBounds(item, document), expected.bounds[index] ?? null, `item ${index} bounds`);
          const swiftSamples = expected.samples[index];
          if (item.type === 'line' && swiftSamples) {
            closeArray(toPairs(samplesOf(item.content, document)), swiftSamples.flat(), `item ${index} samples`);
          }
        });
      });

      it('hits the same items', () => {
        // CoreGraphics tests a stroked outline that is itself an approximation (about 0.001 unit from the true
        // offset curve), so a point within 0.02 unit of the threshold may land on either side; such points count as
        // agreeing when the other answer is reached by nudging the tolerance by that much.
        const borderline = (point: Pair, tolerance: number, swiftID: string | null) =>
          [tolerance - 0.02, tolerance + 0.02].some(
            (nudged) => (itemAt(P(point), document, nudged)?.id ?? null) === swiftID,
          );
        cases.tolerances.forEach((tolerance, t) => {
          const swiftHits = expected.hits[t] ?? [];
          const differences = cases.hitPoints.flatMap((point, index) => {
            const id = itemAt(P(point), document, tolerance)?.id ?? null;
            const swiftID = swiftHits[index] ?? null;
            return id === swiftID || borderline(point, tolerance, swiftID)
              ? []
              : [`(${point.join(', ')}): ${id} vs ${swiftID}`];
          });
          expect(differences, `tolerance ${tolerance}`).toEqual([]);
        });
      });

      it('finds the same bind targets and bindings', () => {
        const targets = cases.bindPoints.map((point) => bindTargetAt(P(point), document, 5)?.id ?? null);
        expect(targets).toEqual(expected.bindTargets);
        document.items.forEach((item, index) => {
          cases.bindPoints.forEach((point, p) => {
            const binding = bindingFor(P(point), item, 12);
            const swiftBinding = expected.bindings[index]?.[p] ?? null;
            if (swiftBinding === null || binding === null) {
              expect(binding, `item ${index} point ${p}`).toBe(swiftBinding);
              return;
            }
            expect(binding.itemID).toBe(swiftBinding.itemID);
            closeArray([binding.anchor.x, binding.anchor.y], swiftBinding.anchor, `item ${index} point ${p} anchor`);
          });
        });
      });

      it('erases the same items', () => {
        const erased = cases.eraserSegments.map((segment) =>
          erasableItems(P(segment.a), P(segment.b), segment.r, document),
        );
        expect(erased).toEqual(expected.erase);
      });

      it('plans the same exports', () => {
        cases.exportOptions.forEach((options, index) => {
          const plan = planExport(document, { minimumBoardScale: 2, maxPixelCount: 40_000_000, ...options });
          const swiftPlan = expected.plans[index];
          if (!swiftPlan) throw new Error('missing');
          compareRect(plan.rect, swiftPlan.rect, `plan ${index} rect`);
          expect([plan.pixelSize.width, plan.pixelSize.height], `plan ${index} pixels`).toEqual(swiftPlan.pixelSize);
          expect(plan.isClamped, `plan ${index} clamped`).toBe(swiftPlan.isClamped);
        });
      });

      it('finds the same parent photos', () => {
        expect(document.items.map((item) => parentFor(item, document))).toEqual(expected.parents);
      });
    });
  });

  it('carries attached annotations the same way', () => {
    cases.carry.forEach((entry, index) => {
      const document = parseDocument(entry.document);
      const old = document.items[entry.item];
      if (!old) throw new Error('missing item');
      const updated = withItemBox(old, toBox(entry.box));
      const moved = carryChildren(
        old,
        updated,
        document,
        updateItem(document, old.id, () => updated),
      );
      const actual = JSON.parse(serializeDocument(moved)) as unknown;
      const expected = JSON.parse(swift.carry[index] ?? '') as unknown;
      compareJSON(actual, expected, `carry ${index}`);
    });
  });
});

function compareJSON(actual: unknown, expected: unknown, what: string): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    close(actual, expected, what);
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    expect(actual.length, `${what} length`).toBe(expected.length);
    expected.forEach((value, index) => compareJSON(actual[index], value, `${what}[${index}]`));
  } else if (expected && typeof expected === 'object' && actual && typeof actual === 'object') {
    expect(Object.keys(actual).sort(), `${what} keys`).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      compareJSON((actual as Record<string, unknown>)[key], value, `${what}.${key}`);
    }
  } else {
    expect(actual, what).toEqual(expected);
  }
}
