import { parseHexColor, type RGBAHex } from '../model/color';
import { MarkupError } from '../model/errors';
import type { Box, Endpoint, FontSpec, ItemStyle, MarkupDocument, MarkupItem, Point, Rect, Size } from '../model/types';
import { stringifySwiftJSON, type JSONValue } from './swift-json';

// Encoding mirrors the Swift package's Codable implementations, key for key: optional values are left out when
// absent, `isLocked` is written only when true, and straight lines omit `kind`, `waypoints` and `isClosed`.

function encodeColor(value: RGBAHex): string {
  const canonical = parseHexColor(value);
  if (canonical === null) throw new MarkupError('invalidDocument', `Invalid color ${JSON.stringify(value)}`);
  return canonical;
}

const encodePoint = (point: Point): JSONValue => [point.x, point.y];
const encodeSize = (size: Size): JSONValue => [size.width, size.height];
const encodeRect = (rect: Rect): JSONValue => [
  [rect.x, rect.y],
  [rect.width, rect.height],
];
const encodeBox = (box: Box): JSONValue => ({ frame: encodeRect(box.frame), rotation: box.rotation });

function encodeFont(font: FontSpec): JSONValue {
  return { family: font.family, size: font.size, bold: font.bold, italic: font.italic };
}

function encodeStyle(style: ItemStyle): JSONValue {
  return {
    strokeColor: style.strokeColor === null ? undefined : encodeColor(style.strokeColor),
    fillColor: style.fillColor === null ? undefined : encodeColor(style.fillColor),
    lineWidth: style.lineWidth,
    dash: style.dash,
    opacity: style.opacity,
    cornerRadius: style.cornerRadius,
    shadow: style.shadow,
  } as { [key: string]: JSONValue };
}

function encodeEndpoint(endpoint: Endpoint): JSONValue {
  const binding = endpoint.binding;
  return {
    point: encodePoint(endpoint.point),
    binding:
      binding === null ? undefined : { itemID: binding.itemID.toUpperCase(), anchor: encodePoint(binding.anchor) },
  } as { [key: string]: JSONValue };
}

function encodeContent(item: MarkupItem): JSONValue {
  switch (item.type) {
    case 'image': {
      const { assetID, pixelSize, box } = item.content;
      return { assetID, pixelSize: encodeSize(pixelSize), box: encodeBox(box) };
    }
    case 'shape': {
      const { kind, box, lockAspect } = item.content;
      return { kind, box: encodeBox(box), lockAspect };
    }
    case 'text': {
      const content = item.content;
      return {
        text: content.text,
        font: encodeFont(content.font),
        color: encodeColor(content.color),
        alignment: content.alignment,
        fixedWidth: content.fixedWidth === null ? undefined : content.fixedWidth,
        padding: content.padding,
        box: encodeBox(content.box),
      } as { [key: string]: JSONValue };
    }
    case 'stroke': {
      const { points, box, isHighlighter } = item.content;
      return { points: points.map(encodePoint), box: encodeBox(box), isHighlighter };
    }
    case 'line': {
      const line = item.content;
      const encoded: { [key: string]: JSONValue } = {
        start: encodeEndpoint(line.start),
        end: encodeEndpoint(line.end),
        startHead: line.startHead,
        endHead: line.endHead,
      };
      if (line.kind !== 'straight') {
        encoded.kind = line.kind;
        encoded.waypoints = line.waypoints.map(encodePoint);
        if (line.isClosed) encoded.isClosed = true;
      }
      return encoded;
    }
  }
}

function encodeItem(item: MarkupItem): JSONValue {
  const encoded: { [key: string]: JSONValue } = {
    id: item.id.toUpperCase(),
    type: item.type,
    content: encodeContent(item),
    style: encodeStyle(item.style),
  };
  if (item.isLocked) encoded.isLocked = true;
  if (item.parentID !== null) encoded.parentID = item.parentID.toUpperCase();
  return encoded;
}

/** The document as the JSON value the Swift package encodes (before formatting). */
export function documentToJSON(document: MarkupDocument): JSONValue {
  // Like the Swift enum `.image(backgroundItemID:)`: image mode needs its background photo.
  const backgroundItemID = document.kind === 'image' ? document.backgroundItemID : null;
  const encoded: { [key: string]: JSONValue } = {
    schemaVersion: document.schemaVersion,
    id: document.id.toUpperCase(),
    kind: backgroundItemID === null ? 'board' : 'image',
    backgroundColor: encodeColor(document.backgroundColor),
    items: document.items.map(encodeItem),
  };
  if (backgroundItemID !== null) encoded.backgroundItemID = backgroundItemID.toUpperCase();
  return encoded;
}

/**
 * Writes `document.json` byte for byte like the Swift package (`JSONEncoder` with `[.prettyPrinted, .sortedKeys]`).
 * Throws `MarkupError` (`invalidDocument`) for non-finite numbers or invalid colors.
 */
export function serializeDocument(document: MarkupDocument): string {
  return stringifySwiftJSON(documentToJSON(document));
}
