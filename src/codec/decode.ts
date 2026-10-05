import { MarkupColors, parseHexColor, type RGBAHex } from '../model/color';
import { CURRENT_SCHEMA_VERSION } from '../model/document';
import { MarkupError } from '../model/errors';
import { DEFAULT_FONT, DEFAULT_ITEM_STYLE } from '../model/style';
import type {
  ArrowHead,
  Box,
  ConnectorBinding,
  DashStyle,
  Endpoint,
  FontFamily,
  FontSpec,
  ImageContent,
  ItemStyle,
  LineContent,
  LineKind,
  MarkupDocument,
  MarkupItem,
  Point,
  Rect,
  ShapeContent,
  ShapeKind,
  Size,
  StrokeContent,
  TextAlignment,
  TextContent,
  UUIDString,
} from '../model/types';
import { createUUID, parseUUID } from '../model/uuid';

// Decoding mirrors the Swift package's Codable implementations:
// - `decode` (required): a missing key, JSON null or a value of the wrong type is a failure;
// - `decodeIfPresent` (optional): a missing key or null means absent, a value of the wrong type is a failure;
// - lenient enums (`try? decodeIfPresent`): anything unreadable falls back to the default;
// - a failure inside an item drops that item; a failure at document level fails the whole document.

/** A value the Swift decoder would reject. */
class DecodingFailure extends Error {}

type JSONObject = { readonly [key: string]: unknown };

const SHAPE_KINDS: readonly ShapeKind[] = [
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
const ARROW_HEADS: readonly ArrowHead[] = ['none', 'arrow'];
const ALIGNMENTS: readonly TextAlignment[] = ['left', 'center', 'right'];
const FONT_FAMILIES: readonly FontFamily[] = [
  'system',
  'rounded',
  'serif',
  'monospaced',
  'hiraginoSans',
  'hiraginoMincho',
];
const DASH_STYLES: readonly DashStyle[] = ['solid', 'dashed', 'dotted'];
const LINE_KINDS: readonly LineKind[] = ['straight', 'polyline', 'curve'];

function failure(what: string): never {
  throw new DecodingFailure(what);
}

function isObject(value: unknown): value is JSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, what: string): JSONObject {
  return isObject(value) ? value : failure(`${what} must be an object`);
}

/** The value of `key`, or undefined when it is missing or null (`decodeIfPresent`). */
function present(container: JSONObject, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(container, key)) return undefined;
  const value = container[key];
  return value === null ? undefined : value;
}

function required(container: JSONObject, key: string): unknown {
  const value = present(container, key);
  return value === undefined ? failure(`${key} is required`) : value;
}

function number(value: unknown, what: string): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : failure(`${what} must be a number`);
}

function optionalNumber(container: JSONObject, key: string, fallback: number): number {
  const value = present(container, key);
  return value === undefined ? fallback : number(value, key);
}

function optionalBoolean(container: JSONObject, key: string, fallback: boolean): boolean {
  const value = present(container, key);
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : failure(`${key} must be true or false`);
}

function string(value: unknown, what: string): string {
  return typeof value === 'string' ? value : failure(`${what} must be a string`);
}

function uuid(value: unknown, what: string): UUIDString {
  return parseUUID(string(value, what)) ?? failure(`${what} must be a UUID`);
}

function color(value: unknown, what: string): RGBAHex {
  return parseHexColor(string(value, what)) ?? failure(`${what} must be a #RRGGBB or #RRGGBBAA color`);
}

/** A lenient enum: anything that is not one of `values` gives `fallback`. */
function lenient<T extends string>(container: JSONObject, key: string, values: readonly T[], fallback: T): T {
  const value = present(container, key);
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** CoreGraphics decodes a point from an array of (at least) two numbers. */
function point(value: unknown, what: string): Point {
  if (!Array.isArray(value) || value.length < 2) failure(`${what} must be [x, y]`);
  return { x: number(value[0], what), y: number(value[1], what) };
}

function size(value: unknown, what: string): Size {
  if (!Array.isArray(value) || value.length < 2) failure(`${what} must be [width, height]`);
  return { width: number(value[0], what), height: number(value[1], what) };
}

function rect(value: unknown, what: string): Rect {
  if (!Array.isArray(value) || value.length < 2) failure(`${what} must be [[x, y], [width, height]]`);
  const origin = point(value[0], what);
  const extent = size(value[1], what);
  return { x: origin.x, y: origin.y, width: extent.width, height: extent.height };
}

function points(value: unknown, what: string): Point[] {
  if (!Array.isArray(value)) failure(`${what} must be an array of points`);
  return value.map((element) => point(element, what));
}

function box(value: unknown): Box {
  const container = object(value, 'box');
  return { frame: rect(required(container, 'frame'), 'frame'), rotation: optionalNumber(container, 'rotation', 0) };
}

function fontSpec(value: unknown): FontSpec {
  const container = object(value, 'font');
  return {
    family: lenient(container, 'family', FONT_FAMILIES, DEFAULT_FONT.family),
    size: optionalNumber(container, 'size', DEFAULT_FONT.size),
    bold: optionalBoolean(container, 'bold', DEFAULT_FONT.bold),
    italic: optionalBoolean(container, 'italic', DEFAULT_FONT.italic),
  };
}

function itemStyle(value: unknown): ItemStyle {
  const container = object(value, 'style');
  const stroke = present(container, 'strokeColor');
  const fill = present(container, 'fillColor');
  return {
    strokeColor: stroke === undefined ? null : color(stroke, 'strokeColor'),
    fillColor: fill === undefined ? null : color(fill, 'fillColor'),
    lineWidth: optionalNumber(container, 'lineWidth', 6),
    dash: lenient(container, 'dash', DASH_STYLES, 'solid'),
    opacity: optionalNumber(container, 'opacity', 1),
    cornerRadius: optionalNumber(container, 'cornerRadius', 0),
    shadow: optionalBoolean(container, 'shadow', false),
  };
}

function imageContent(value: unknown): ImageContent {
  const container = object(value, 'content');
  return {
    assetID: string(required(container, 'assetID'), 'assetID'),
    pixelSize: size(required(container, 'pixelSize'), 'pixelSize'),
    box: box(required(container, 'box')),
  };
}

function shapeContent(value: unknown): ShapeContent {
  const container = object(value, 'content');
  const kind = string(required(container, 'kind'), 'kind');
  if (!(SHAPE_KINDS as readonly string[]).includes(kind)) failure('unknown shape kind');
  return {
    kind: kind as ShapeKind,
    box: box(required(container, 'box')),
    lockAspect: optionalBoolean(container, 'lockAspect', false),
  };
}

function textContent(value: unknown): TextContent {
  const container = object(value, 'content');
  const text = present(container, 'text');
  const font = present(container, 'font');
  const textColor = present(container, 'color');
  const fixedWidth = present(container, 'fixedWidth');
  return {
    text: text === undefined ? '' : string(text, 'text'),
    font: font === undefined ? DEFAULT_FONT : fontSpec(font),
    color: textColor === undefined ? MarkupColors.black : color(textColor, 'color'),
    alignment: lenient(container, 'alignment', ALIGNMENTS, 'left'),
    fixedWidth: fixedWidth === undefined ? null : number(fixedWidth, 'fixedWidth'),
    padding: optionalNumber(container, 'padding', 8),
    box: box(required(container, 'box')),
  };
}

function strokeContent(value: unknown): StrokeContent {
  const container = object(value, 'content');
  return {
    points: points(required(container, 'points'), 'points'),
    box: box(required(container, 'box')),
    isHighlighter: optionalBoolean(container, 'isHighlighter', false),
  };
}

function binding(value: unknown): ConnectorBinding {
  const container = object(value, 'binding');
  return {
    itemID: uuid(required(container, 'itemID'), 'itemID'),
    anchor: point(required(container, 'anchor'), 'anchor'),
  };
}

function endpoint(value: unknown): Endpoint {
  const container = object(value, 'endpoint');
  const bound = present(container, 'binding');
  return {
    point: point(required(container, 'point'), 'point'),
    binding: bound === undefined ? null : binding(bound),
  };
}

function lineContent(value: unknown): LineContent {
  const container = object(value, 'content');
  const start = endpoint(required(container, 'start'));
  const end = endpoint(required(container, 'end'));
  const startHead = lenient(container, 'startHead', ARROW_HEADS, 'none');
  const endHead = lenient(container, 'endHead', ARROW_HEADS, 'arrow');
  const kind = lenient(container, 'kind', LINE_KINDS, 'straight');
  if (kind === 'straight') {
    return { start, end, startHead, endHead, kind, waypoints: [], isClosed: false };
  }
  const waypoints = present(container, 'waypoints');
  return {
    start,
    end,
    startHead,
    endHead,
    kind,
    waypoints: waypoints === undefined ? [] : points(waypoints, 'waypoints'),
    isClosed: optionalBoolean(container, 'isClosed', false),
  };
}

function markupItem(value: unknown): MarkupItem {
  const container = object(value, 'item');
  const id = uuid(required(container, 'id'), 'id');
  const type = string(required(container, 'type'), 'type');
  const content = required(container, 'content');
  const style = present(container, 'style');
  const parentID = present(container, 'parentID');
  const base = {
    id,
    // An item stored without a style gets `ItemStyle()`; an empty style object means no border.
    style: style === undefined ? DEFAULT_ITEM_STYLE : itemStyle(style),
    isLocked: optionalBoolean(container, 'isLocked', false),
    parentID: parentID === undefined ? null : uuid(parentID, 'parentID'),
  };
  switch (type) {
    case 'image':
      return { ...base, type, content: imageContent(content) };
    case 'shape':
      return { ...base, type, content: shapeContent(content) };
    case 'text':
      return { ...base, type, content: textContent(content) };
    case 'stroke':
      return { ...base, type, content: strokeContent(content) };
    case 'line':
      return { ...base, type, content: lineContent(content) };
    default:
      return failure('unknown item type');
  }
}

function documentField<T>(read: () => T, what: string): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof DecodingFailure) {
      throw new MarkupError('invalidDocument', `Invalid document: ${what}: ${error.message}`, { detail: error });
    }
    throw error;
  }
}

/**
 * Reads a `document.json` (schema 1) exactly like the Swift package:
 * - an item that cannot be read (an unknown type from a newer version, a bad color, a missing box…) is skipped;
 * - unknown values of lenient fields (dash, font family, alignment, arrowheads, line kind) fall back to defaults;
 * - a newer `schemaVersion` throws `MarkupError` with code `unsupportedSchemaVersion`;
 * - malformed document-level fields throw `MarkupError` with code `invalidDocument`.
 * Accepts the JSON text or the value `JSON.parse` returns.
 */
export function parseDocument(input: string | object): MarkupDocument {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new MarkupError('invalidDocument', 'The document is not valid JSON.', { detail: error });
    }
  }
  const root = documentField(() => object(value, 'document'), 'root');

  const schemaVersion = documentField(() => {
    const version = present(root, 'schemaVersion');
    if (version === undefined) return 1;
    return typeof version === 'number' && Number.isInteger(version)
      ? version
      : failure('schemaVersion must be an integer');
  }, 'schemaVersion');
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new MarkupError(
      'unsupportedSchemaVersion',
      `The document uses schema version ${schemaVersion}; this version of image-markup-kit reads version ${CURRENT_SCHEMA_VERSION}.`,
      { schemaVersion },
    );
  }

  const id = documentField(() => {
    const stored = present(root, 'id');
    return stored === undefined ? createUUID() : uuid(stored, 'id');
  }, 'id');

  const kindName = documentField(() => {
    const stored = present(root, 'kind');
    return stored === undefined ? 'board' : string(stored, 'kind');
  }, 'kind');
  let backgroundItemID: UUIDString | null = null;
  if (kindName === 'image') {
    backgroundItemID = documentField(() => {
      const stored = present(root, 'backgroundItemID');
      return stored === undefined ? null : uuid(stored, 'backgroundItemID');
    }, 'backgroundItemID');
  }

  const backgroundColor = documentField(() => {
    const stored = present(root, 'backgroundColor');
    return stored === undefined ? MarkupColors.white : color(stored, 'backgroundColor');
  }, 'backgroundColor');

  const items: MarkupItem[] = [];
  const storedItems = present(root, 'items');
  if (Array.isArray(storedItems)) {
    for (const element of storedItems) {
      try {
        items.push(markupItem(element));
      } catch (error) {
        if (!(error instanceof DecodingFailure)) throw error;
      }
    }
  }

  if (backgroundItemID !== null && !items.some((item) => item.id === backgroundItemID)) {
    backgroundItemID = null;
  }
  return {
    schemaVersion,
    id,
    kind: backgroundItemID === null ? 'board' : 'image',
    backgroundItemID,
    backgroundColor,
    items,
  };
}
