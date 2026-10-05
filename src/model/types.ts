import type { RGBAHex } from './color';

/** A UUID in canonical uppercase form, e.g. `"3F2504E0-4F89-41D3-9A0C-0305E82C3301"`. */
export type UUIDString = string;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A rectangle as stored: origin and size, not standardized (the size may be negative). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Position of a boxed item: an unrotated frame in canvas units plus a rotation (radians) about its center. */
export interface Box {
  readonly frame: Rect;
  readonly rotation: number;
}

/** Closed shapes. Circle and square are `ellipse` and `rectangle` with `lockAspect`. */
export type ShapeKind =
  | 'rectangle'
  | 'roundedRectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'pentagon'
  | 'speechBubble'
  | 'highlightBox';

export type ArrowHead = 'none' | 'arrow';

export type TextAlignment = 'left' | 'center' | 'right';

export type FontFamily = 'system' | 'rounded' | 'serif' | 'monospaced' | 'hiraginoSans' | 'hiraginoMincho';

export type DashStyle = 'solid' | 'dashed' | 'dotted';

/** How a line runs from `start` to `end`: one segment, straight segments through the waypoints, or a smooth curve. */
export type LineKind = 'straight' | 'polyline' | 'curve';

export interface FontSpec {
  readonly family: FontFamily;
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Visual style shared by all item kinds; each kind ignores the fields that do not apply to it. */
export interface ItemStyle {
  /** Border, line or pen color; null means no border. */
  readonly strokeColor: RGBAHex | null;
  /** Background color; null means transparent. */
  readonly fillColor: RGBAHex | null;
  readonly lineWidth: number;
  readonly dash: DashStyle;
  /** Opacity of the whole item, 0…1. */
  readonly opacity: number;
  readonly cornerRadius: number;
  readonly shadow: boolean;
}

export interface ImageContent {
  /** Key into the document's assets (the original file, stored untouched). */
  readonly assetID: string;
  /** Pixel size after applying the EXIF orientation. */
  readonly pixelSize: Size;
  readonly box: Box;
}

export interface ShapeContent {
  readonly kind: ShapeKind;
  readonly box: Box;
  /** Circle and square: resizing keeps the aspect ratio. */
  readonly lockAspect: boolean;
}

/** Text and notes. A note is a text item whose style has a fill and a border. */
export interface TextContent {
  readonly text: string;
  readonly font: FontSpec;
  readonly color: RGBAHex;
  readonly alignment: TextAlignment;
  /** null: the box grows with the text; otherwise the text wraps at this box width. */
  readonly fixedWidth: number | null;
  readonly padding: number;
  readonly box: Box;
}

/** A freehand pen or highlighter stroke. Points are normalized (0…1) within `box.frame`. */
export interface StrokeContent {
  readonly points: readonly Point[];
  readonly box: Box;
  readonly isHighlighter: boolean;
}

/** Attaches a line end to a point on another item. */
export interface ConnectorBinding {
  readonly itemID: UUIDString;
  /** Normalized position (0…1) inside the target's unrotated frame. */
  readonly anchor: Point;
}

export interface Endpoint {
  /** Canvas position; for a bound end, the last resolved position. */
  readonly point: Point;
  readonly binding: ConnectorBinding | null;
}

export interface LineContent {
  readonly start: Endpoint;
  readonly end: Endpoint;
  readonly startHead: ArrowHead;
  readonly endHead: ArrowHead;
  readonly kind: LineKind;
  /** Points the line passes through between `start` and `end` (never bound). Empty for straight lines. */
  readonly waypoints: readonly Point[];
  /** Polylines and curves only: the last point joins the first. */
  readonly isClosed: boolean;
}

interface ItemBase {
  readonly id: UUIDString;
  readonly style: ItemStyle;
  /** Locked items can be selected (to unlock) but not moved, resized or erased. */
  readonly isLocked: boolean;
  /** Board mode: the photo this annotation is attached to; it follows that photo. */
  readonly parentID: UUIDString | null;
}

export interface ImageItem extends ItemBase {
  readonly type: 'image';
  readonly content: ImageContent;
}

export interface ShapeItem extends ItemBase {
  readonly type: 'shape';
  readonly content: ShapeContent;
}

export interface TextItem extends ItemBase {
  readonly type: 'text';
  readonly content: TextContent;
}

export interface StrokeItem extends ItemBase {
  readonly type: 'stroke';
  readonly content: StrokeContent;
}

export interface LineItem extends ItemBase {
  readonly type: 'line';
  readonly content: LineContent;
}

/** One object on the canvas. The order of `MarkupDocument.items` is the z-order (last on top). */
export type MarkupItem = ImageItem | ShapeItem | TextItem | StrokeItem | LineItem;

export type MarkupItemType = MarkupItem['type'];

/** Items positioned by a box (everything except lines). */
export type BoxedItem = ImageItem | ShapeItem | TextItem | StrokeItem;

/**
 * A markup document: one photo with annotations (`kind: 'image'`), or a board holding several photos.
 * Coordinates are canvas units, independent of the photos' resolution.
 */
export interface MarkupDocument {
  readonly schemaVersion: number;
  readonly id: UUIDString;
  readonly kind: 'image' | 'board';
  /** Image mode: the locked background photo. Null on boards. */
  readonly backgroundItemID: UUIDString | null;
  readonly backgroundColor: RGBAHex;
  /** Z-ordered, bottom first. */
  readonly items: readonly MarkupItem[];
}

/** A photo to place on a canvas: its asset key and oriented pixel size. */
export interface ImageSource {
  readonly assetID: string;
  readonly pixelSize: Size;
}

/** Styles for newly created items, per tool. */
export interface StyleDefaults {
  readonly shape: ItemStyle;
  readonly highlightBox: ItemStyle;
  readonly line: ItemStyle;
  readonly lineStartHead: ArrowHead;
  readonly lineEndHead: ArrowHead;
  /** Arrowheads of new polylines and curves (they share the `line` style). */
  readonly pathStartHead: ArrowHead;
  readonly pathEndHead: ArrowHead;
  readonly pen: ItemStyle;
  readonly highlighter: ItemStyle;
  readonly text: ItemStyle;
  readonly textFont: FontSpec;
  readonly textColor: RGBAHex;
  readonly note: ItemStyle;
  readonly noteFont: FontSpec;
  readonly noteTextColor: RGBAHex;
  readonly textAlignment: TextAlignment;
}
