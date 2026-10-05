export { VERSION } from './version';

// Model
export type {
  ArrowHead,
  Box,
  BoxedItem,
  ConnectorBinding,
  DashStyle,
  Endpoint,
  FontFamily,
  FontSpec,
  ImageContent,
  ImageItem,
  ImageSource,
  ItemStyle,
  LineContent,
  LineItem,
  LineKind,
  MarkupDocument,
  MarkupItem,
  MarkupItemType,
  Point,
  Rect,
  ShapeContent,
  ShapeItem,
  ShapeKind,
  Size,
  StrokeContent,
  StrokeItem,
  StyleDefaults,
  TextAlignment,
  TextContent,
  TextItem,
  UUIDString,
} from './model/types';
export type { RGBAHex } from './model/color';
export { MARKUP_PALETTE, MarkupColors, colorComponents, parseHexColor, rgba, withAlpha } from './model/color';
export {
  DEFAULT_FONT,
  DEFAULT_ITEM_STYLE,
  STANDARD_STYLE_DEFAULTS,
  effectiveLineWidth,
  itemStyle,
} from './model/style';
export {
  BOARD_IMAGE_HEIGHT,
  CURRENT_SCHEMA_VERSION,
  IMAGE_LONG_EDGE,
  backgroundItem,
  findItem,
  imageItems,
  isBoxedItem,
  isImageItem,
  isLineItem,
  isTextItem,
  itemBox,
  locksAspectRatio,
  modelEquals,
  normalizeZOrder,
  updateItem,
  withItemBox,
} from './model/document';
export {
  createCurveItem,
  createImageDocument,
  createImageItem,
  createLineItem,
  createPolylineItem,
  createShapeItem,
  createStrokeItem,
  fittedSize,
} from './model/factories';
export {
  appendImages,
  arrangeBoard,
  attachAnnotationsToPhotos,
  createBoardDocument,
  createConnectorItem,
} from './model/board';
export type { BoardArrangement } from './geometry/board-layout';
export { BOARD_ARRANGEMENTS } from './geometry/board-layout';
export { createUUID, parseUUID } from './model/uuid';
export type { MarkupErrorCode } from './model/errors';
export { MarkupError, isMarkupError } from './model/errors';

// document.json
export { parseDocument } from './codec/decode';
export { serializeDocument } from './codec/encode';

// Export
export type { ExportPlan, MarkupExportFormat, MarkupExportOptions } from './render/export-planner';
export { DEFAULT_EXPORT_OPTIONS, planExport } from './render/export-planner';

// Features and tools
export type { LineTool, MarkupTool, ShapeTool } from './editor/tools';
export { LINE_TOOLS, SHAPE_TOOLS, shapeOfTool, toolOfShape } from './editor/tools';
export type { MarkupFeature, MarkupFeatureGroup } from './features/features';
export {
  MARKUP_FEATURES,
  MARKUP_FEATURE_GROUPS,
  MarkupFeatures,
  MarkupFeaturesError,
  featureGroup,
  featuresOfGroup,
} from './features/features';

// Editor
export type { MarkupEditorProps } from './react/MarkupEditor';
export { MarkupEditor } from './react/MarkupEditor';
