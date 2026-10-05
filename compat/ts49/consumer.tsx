// Uses the public API, so a declaration TypeScript 4.9 cannot read fails this check.
import {
  MARKUP_FEATURES,
  MARKUP_PALETTE,
  MarkupColors,
  MarkupEditor,
  MarkupError,
  MarkupFeatures,
  MarkupFeaturesError,
  STANDARD_STYLE_DEFAULTS,
  VERSION,
  createCurveItem,
  createImageDocument,
  createLineItem,
  createShapeItem,
  createStrokeItem,
  isMarkupError,
  itemStyle,
  modelEquals,
  parseDocument,
  parseHexColor,
  rgba,
  serializeDocument,
  shapeOfTool,
} from 'image-markup-kit';
import type {
  FontSpec,
  ItemStyle,
  LineItem,
  MarkupDocument,
  MarkupEditorProps,
  MarkupErrorCode,
  MarkupFeature,
  MarkupFeatureGroup,
  MarkupItem,
  MarkupTool,
  RGBAHex,
  StyleDefaults,
} from 'image-markup-kit';

const version: string = VERSION;
const color: RGBAHex | null = parseHexColor('#FF3B30');
const quantized: RGBAHex = rgba(1, 0.5, 0, 0.45);
const palette: readonly RGBAHex[] = MARKUP_PALETTE;
const red: RGBAHex = MarkupColors.red;
const style: ItemStyle = itemStyle({ dash: 'dashed', fillColor: red });
const defaults: StyleDefaults = STANDARD_STYLE_DEFAULTS;
const font: FontSpec = defaults.noteFont;

const document: MarkupDocument = createImageDocument({ assetID: 'photo.jpg', pixelSize: { width: 4032, height: 3024 } });
const items: MarkupItem[] = [
  createShapeItem('star', { x: 0, y: 0, width: 10, height: 10 }, style, { rotation: 0.1 }),
  createStrokeItem([{ x: 0, y: 0 }], defaults.pen, true),
  createCurveItem([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 0 }], style, { closed: true }),
];
const arrow: LineItem = createLineItem({ x: 0, y: 0 }, { x: 1, y: 1 }, style, { startHead: 'arrow' });
const json: string = serializeDocument({ ...document, items: [...document.items, ...items, arrow] });
const same: boolean = modelEquals(parseDocument(json), parseDocument(JSON.parse(json) as object));

const tool: MarkupTool = 'circle';
const shape = shapeOfTool('circle');
const feature: MarkupFeature = MARKUP_FEATURES[0] ?? 'pen';
const group: MarkupFeatureGroup = 'board';
const features: MarkupFeatures = MarkupFeatures.fromJSON('{ "board": { "enabled": false } }').with(feature, false);
const allowed: boolean = features.allows(tool) && features.isGroupEnabled(group);

function describeError(error: unknown): string {
  if (isMarkupError(error)) {
    const code: MarkupErrorCode = error.code;
    return code;
  }
  if (error instanceof MarkupFeaturesError) return `${error.kind} ${error.path}`;
  return error instanceof MarkupError ? 'impossible' : String(error);
}

const props: MarkupEditorProps = { className: 'editor', style: { width: 100 } };
export const element = <MarkupEditor {...props} />;
export { version, color, quantized, palette, font, json, same, shape, allowed, describeError, features };
