import { carryChildren, reassignParents } from '../geometry/attachments';
import { refreshCachedEndpoints, resolvedEndpoints } from '../geometry/bindings';
import { boxBoundingRect, boxCenter } from '../geometry/box';
import { arrangementFrames, BOARD_GAP, flowFrames, type BoardArrangement } from '../geometry/board-layout';
import { isNullRect, maxY, NULL_RECT, rectsIntersect, unionRect } from '../geometry/rect';
import { MarkupColors } from './color';
import { BOARD_IMAGE_HEIGHT, CURRENT_SCHEMA_VERSION, imageItems, normalizeZOrder, updateItem } from './document';
import { swiftRound } from './swift-math';
import { createImageItem } from './factories';
import type {
  ArrowHead,
  ConnectorBinding,
  ImageItem,
  ImageSource,
  ItemStyle,
  LineItem,
  MarkupDocument,
  Rect,
  Size,
  UUIDString,
} from './types';
import { createUUID } from './uuid';

/** A board with photos placed side by side (equal heights, 3 per row) in the given order. */
export function createBoardDocument(sources: readonly ImageSource[] = []): MarkupDocument {
  const board: MarkupDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createUUID(),
    kind: 'board',
    backgroundItemID: null,
    backgroundColor: MarkupColors.white,
    items: [],
  };
  return appendImages(board, sources).document;
}

/**
 * Adds photos after the existing ones, continuing the side-by-side reading order. When earlier photos were moved by
 * hand so a new slot would overlap one, the new photos go in a fresh row below everything.
 */
export function appendImages(
  document: MarkupDocument,
  sources: readonly ImageSource[],
): { document: MarkupDocument; ids: UUIDString[] } {
  if (sources.length === 0) return { document, ids: [] };
  const existing = imageItems(document).map((item) => item.content.box.frame);
  const sizes: Size[] = [
    ...existing.map((frame) => ({ width: frame.width, height: frame.height })),
    ...sources.map((source) => source.pixelSize),
  ];
  const first = existing[0];
  const origin = first ? { x: first.x, y: first.y } : { x: 0, y: 0 };
  const frames = flowFrames(sizes, { origin });
  const added: ImageItem[] = sources.map((source, offset) => {
    let frame = frames[existing.length + offset] as Rect;
    if (existing.some((rect) => rectsIntersect(rect, frame))) {
      const bottom = Math.max(...existing.map(maxY));
      frame = { ...frame, x: origin.x + offset * (frame.width + BOARD_GAP), y: bottom + BOARD_GAP };
    }
    return createImageItem(source, frame);
  });
  return {
    document: normalizeZOrder({ ...document, items: [...document.items, ...added] }),
    ids: added.map((item) => item.id),
  };
}

/** Board mode: attaches every annotation to the photo under its center, so it follows that photo. */
export function attachAnnotationsToPhotos(document: MarkupDocument): MarkupDocument {
  return reassignParents(
    document,
    document.items.filter((item) => item.type !== 'image').map((item) => item.id),
  );
}

/** A line whose ends are attached to items of `document` (an arrow at the end unless told otherwise). */
export function createConnectorItem(
  start: ConnectorBinding,
  end: ConnectorBinding,
  document: MarkupDocument,
  style: ItemStyle,
  options: { readonly startHead?: ArrowHead; readonly endHead?: ArrowHead } = {},
): LineItem {
  const content = {
    start: { point: { x: 0, y: 0 }, binding: start },
    end: { point: { x: 0, y: 0 }, binding: end },
    startHead: options.startHead ?? 'none',
    endHead: options.endHead ?? 'arrow',
    kind: 'straight' as const,
    waypoints: [],
    isClosed: false,
  };
  const resolved = resolvedEndpoints(content, document);
  return {
    id: createUUID(),
    type: 'line',
    content: {
      ...content,
      start: { ...content.start, point: resolved.start },
      end: { ...content.end, point: resolved.end },
    },
    style,
    isLocked: false,
    parentID: null,
  };
}

/**
 * Re-lays out a board's photos (row, column, grid or tidy 3 per row) in their current reading order, starting at
 * their current top-left; rotations are reset and attached annotations follow their photo.
 */
export function arrangeBoard(document: MarkupDocument, arrangement: BoardArrangement): MarkupDocument {
  if (document.kind !== 'board') return document;
  const band = BOARD_IMAGE_HEIGHT + BOARD_GAP;
  const images = imageItems(document)
    .map((item, index) => ({ item, index, center: boxCenter(item.content.box) }))
    .sort((a, b) => {
      const rowA = swiftRound(a.center.y / band);
      const rowB = swiftRound(b.center.y / band);
      if (rowA !== rowB) return rowA - rowB;
      return a.center.x === b.center.x ? a.index - b.index : a.center.x - b.center.x;
    })
    .map((entry) => entry.item);
  if (images.length === 0) return document;
  const union = images.reduce((rect, item) => unionRect(rect, boxBoundingRect(item.content.box)), NULL_RECT);
  const origin = isNullRect(union) ? { x: 0, y: 0 } : { x: union.x, y: union.y };
  const sizes = images.map((item) => item.content.pixelSize);
  const frames = arrangementFrames(sizes, arrangement, origin);
  let result = document;
  images.forEach((image, index) => {
    const moved: ImageItem = {
      ...image,
      content: { ...image.content, box: { frame: frames[index] as Rect, rotation: 0 } },
    };
    result = updateItem(result, image.id, () => moved);
    result = carryChildren(image, moved, document, result);
  });
  return refreshCachedEndpoints(normalizeZOrder(result));
}

export type { BoardArrangement };
