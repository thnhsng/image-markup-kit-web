import { BOARD_IMAGE_HEIGHT } from '../model/document';
import type { Point, Rect, Size } from '../model/types';

// Automatic placement of photos on a board (BoardLayout.swift).

export const BOARD_GAP = 48;
export const IMAGES_PER_ROW = 3;
export const COLUMN_WIDTH = 800;

/** How Arrange lays out a board's photos. */
export type BoardArrangement = 'row' | 'column' | 'grid' | 'tidy';

export const BOARD_ARRANGEMENTS: readonly BoardArrangement[] = ['row', 'column', 'grid', 'tidy'];

/** Side by side: equal heights, left to right, wrapping after `perRow` photos. */
export function flowFrames(
  sizes: readonly Size[],
  options: { perRow?: number; height?: number; gap?: number; origin?: Point } = {},
): Rect[] {
  const perRow = Math.max(options.perRow ?? IMAGES_PER_ROW, 1);
  const height = options.height ?? BOARD_IMAGE_HEIGHT;
  const gap = options.gap ?? BOARD_GAP;
  const origin = options.origin ?? { x: 0, y: 0 };
  const frames: Rect[] = [];
  let x = origin.x;
  let y = origin.y;
  sizes.forEach((size, index) => {
    if (index > 0 && index % perRow === 0) {
      x = origin.x;
      y += height + gap;
    }
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const width = height * aspect;
    frames.push({ x, y, width, height });
    x += width + gap;
  });
  return frames;
}

/** One photo per row, all the same width. */
export function columnFrames(
  sizes: readonly Size[],
  options: { width?: number; gap?: number; origin?: Point } = {},
): Rect[] {
  const width = options.width ?? COLUMN_WIDTH;
  const gap = options.gap ?? BOARD_GAP;
  const origin = options.origin ?? { x: 0, y: 0 };
  const frames: Rect[] = [];
  let y = origin.y;
  for (const size of sizes) {
    const aspect = size.width > 0 ? size.height / size.width : 1;
    const height = width * aspect;
    frames.push({ x: origin.x, y, width, height });
    y += height + gap;
  }
  return frames;
}

export function arrangementFrames(sizes: readonly Size[], arrangement: BoardArrangement, origin?: Point): Rect[] {
  switch (arrangement) {
    case 'row':
      return flowFrames(sizes, { perRow: Math.max(sizes.length, 1), origin });
    case 'column':
      return columnFrames(sizes, { origin });
    case 'grid':
      return flowFrames(sizes, { perRow: Math.max(Math.ceil(Math.sqrt(sizes.length)), 1), origin });
    case 'tidy':
      return flowFrames(sizes, { origin });
  }
}
