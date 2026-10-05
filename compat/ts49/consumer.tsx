// Uses the public API, so a declaration TypeScript 4.9 cannot read fails this check.
import {
  BOARD_ARRANGEMENTS,
  DEFAULT_EXPORT_OPTIONS,
  MARKUP_FEATURES,
  MARKUP_PALETTE,
  MarkupColors,
  MarkupEditor,
  MarkupError,
  MarkupFeatures,
  MarkupFeaturesError,
  STANDARD_STYLE_DEFAULTS,
  VERSION,
  appendImages,
  arrangeBoard,
  attachAnnotationsToPhotos,
  createBoardDocument,
  createConnectorItem,
  createCurveItem,
  createImageDocument,
  createLineItem,
  createShapeItem,
  createStrokeItem,
  createTextItem,
  createApproximateTextMeasurer,
  createCanvasTextMeasurer,
  cssFont,
  fitTextContent,
  layoutText,
  measureTextContent,
  DEFAULT_FONT_STACKS,
  isMarkupError,
  itemStyle,
  modelEquals,
  parseDocument,
  renderMarkup,
  importImages,
  readImageMetadata,
  createMarkupPackage,
  readMarkupPackage,
  markupPackageName,
  MARKUP_PACKAGE_EXTENSION,
  planExport,
  parseHexColor,
  rgba,
  serializeDocument,
  shapeOfTool,
} from 'image-markup-kit';
import type {
  ImageMetadata,
  MarkupAssets,
  MarkupImageInput,
  MarkupPackageFiles,
  MarkupRendering,
  MarkupWarning,
  RenderOptions,
  FontStacks,
  TextLayoutResult,
  TextMeasurer,
  BoardArrangement,
  ExportPlan,
  MarkupExportFormat,
  MarkupExportOptions,
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

const board = createBoardDocument([{ assetID: 'a.jpg', pixelSize: { width: 400, height: 300 } }]);
const appended = appendImages(board, [{ assetID: 'b.jpg', pixelSize: { width: 300, height: 400 } }]);
const arrangement: BoardArrangement = BOARD_ARRANGEMENTS[0] ?? 'grid';
const arranged: MarkupDocument = attachAnnotationsToPhotos(arrangeBoard(appended.document, arrangement));
const [first, second] = arranged.items;
const connector: LineItem | null =
  first && second
    ? createConnectorItem({ itemID: first.id, anchor: { x: 0.5, y: 0.5 } }, { itemID: second.id, anchor: { x: 0, y: 0.5 } }, arranged, style)
    : null;
const format: MarkupExportFormat = { type: 'jpeg', quality: 0.85, maxBytes: 10_485_760, fallbackQualities: [0.75, 0.6] };
const exportOptions: MarkupExportOptions = { ...DEFAULT_EXPORT_OPTIONS, format, maxPixelDimension: 4096, boardPadding: 0 };
const plan: ExportPlan = planExport(arranged, exportOptions);

const stacks: FontStacks = { system: { family: 'Inter, sans-serif' }, hiraginoSans: DEFAULT_FONT_STACKS.hiraginoSans };
const measurer: TextMeasurer = typeof document === 'undefined' ? createApproximateTextMeasurer() : createCanvasTextMeasurer(stacks);
const label = createTextItem('Summit 2,456 m', { x: 10, y: 10 }, { font, color: red, fixedWidth: 200, measurer });
const fitted = fitTextContent(label.content, measurer);
const layout: TextLayoutResult = layoutText(fitted, measureTextContent(fitted, measurer), measurer);
const css: string = cssFont(font, stacks);

async function exportFlow(inputs: MarkupImageInput[]): Promise<MarkupPackageFiles> {
  const { sources, assets } = await importImages(inputs);
  const metadata: ImageMetadata = await readImageMetadata(assets[sources[0]?.assetID ?? ''] ?? new Blob());
  const doc = createBoardDocument(sources);
  const options: RenderOptions = { ...exportOptions, fontStacks: stacks, measurer };
  const rendering: MarkupRendering = await renderMarkup(doc, assets as MarkupAssets, options);
  const warnings: readonly MarkupWarning[] = rendering.warnings;
  const files = await createMarkupPackage(doc, assets, rendering.blob);
  const read = await readMarkupPackage(files);
  return warnings.length > 0 || metadata.orientation > 1 || read.exported === null ? files : files;
}
const folder: string = `${markupPackageName(arranged.id)} (${MARKUP_PACKAGE_EXTENSION})`;

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
export { version, color, quantized, palette, font, json, same, shape, allowed, describeError, features, connector, plan, layout, css, exportFlow, folder };
