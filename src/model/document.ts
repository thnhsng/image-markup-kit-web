import type { Box, BoxedItem, ImageItem, LineItem, MarkupDocument, MarkupItem, TextItem, UUIDString } from './types';

export const CURRENT_SCHEMA_VERSION = 1;
/** Image mode: the background photo is fitted so its long edge is this many canvas units. */
export const IMAGE_LONG_EDGE = 1024;
/** Board mode: photos are placed at this height. */
export const BOARD_IMAGE_HEIGHT = 600;

export function isBoxedItem(item: MarkupItem): item is BoxedItem {
  return item.type !== 'line';
}

export function isImageItem(item: MarkupItem): item is ImageItem {
  return item.type === 'image';
}

export function isLineItem(item: MarkupItem): item is LineItem {
  return item.type === 'line';
}

export function isTextItem(item: MarkupItem): item is TextItem {
  return item.type === 'text';
}

/** The item's box; null for lines, which are positioned by their points. */
export function itemBox(item: MarkupItem): Box | null {
  return item.type === 'line' ? null : item.content.box;
}

/** The item with another box (lines are returned unchanged). */
export function withItemBox<T extends MarkupItem>(item: T, box: Box): T {
  if (item.type === 'line') return item;
  return { ...item, content: { ...item.content, box } } as T;
}

/** Whether resizing must keep the width/height ratio: photos, and circles and squares. */
export function locksAspectRatio(item: MarkupItem): boolean {
  if (item.type === 'image') return true;
  return item.type === 'shape' && item.content.lockAspect;
}

export function findItem(document: MarkupDocument, id: UUIDString): MarkupItem | undefined {
  return document.items.find((item) => item.id === id);
}

export function imageItems(document: MarkupDocument): ImageItem[] {
  return document.items.filter(isImageItem);
}

export function backgroundItem(document: MarkupDocument): ImageItem | undefined {
  const id = document.backgroundItemID;
  if (id === null) return undefined;
  const item = findItem(document, id);
  return item && isImageItem(item) ? item : undefined;
}

/** The document with one item changed (unchanged when there is no such item). */
export function updateItem(
  document: MarkupDocument,
  id: UUIDString,
  change: (item: MarkupItem) => MarkupItem,
): MarkupDocument {
  const index = document.items.findIndex((item) => item.id === id);
  if (index < 0) return document;
  const items = document.items.slice();
  items[index] = change(items[index] as MarkupItem);
  return { ...document, items };
}

/**
 * Keeps the z-bands intact: the background first (image mode), then photos, then annotations, preserving the order
 * inside each band. Returns the same document when nothing moves.
 */
export function normalizeZOrder(document: MarkupDocument): MarkupDocument {
  const background: MarkupItem[] = [];
  const images: MarkupItem[] = [];
  const annotations: MarkupItem[] = [];
  for (const item of document.items) {
    if (item.id === document.backgroundItemID) background.push(item);
    else if (item.type === 'image') images.push(item);
    else annotations.push(item);
  }
  const items = [...background, ...images, ...annotations];
  return items.every((item, index) => item === document.items[index]) ? document : { ...document, items };
}

/**
 * Structural equality of model values (documents, items, styles…), like Swift's synthesized `==`: numbers compare
 * with `===` (so 0 equals -0), objects by their own enumerable keys.
 */
export function modelEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((value, index) => modelEquals(value, b[index]));
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  const aRecord = a as Record<string, unknown>;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && modelEquals(aRecord[key], bRecord[key]));
}
