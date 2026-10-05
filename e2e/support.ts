import { expect, type Locator, type Page } from '@playwright/test';
import type { MarkupDocument } from '../src';

// Helpers for the end-to-end tests: open the example's editor, read its document, and turn canvas points into page
// points.

export const editor = (page: Page): Locator => page.getByTestId('markup.editor');
export const canvas = (page: Page): Locator => page.getByTestId('markup.canvas');

/** Opens one sample photo and waits until it is on screen. */
export async function openSample(page: Page, file = 'mountains-dusk.jpg'): Promise<void> {
  await page.goto('./');
  await page.getByTestId(`open.${file}`).click();
  await expect(editor(page)).toBeVisible();
  await waitForPhotos(page, 1);
}

/** Waits until `count` photos show their on-screen copies. */
export async function waitForPhotos(page: Page, count: number, timeout = 30_000): Promise<void> {
  await expect(canvas(page).locator('svg.imk-content image')).toHaveCount(count, { timeout });
}

export async function documentOf(page: Page): Promise<MarkupDocument> {
  const document = await page.evaluate(() => window.markupEditor?.getDocument() ?? null);
  if (!document) throw new Error('no editor document');
  return document;
}

export async function tool(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.markupEditor?.getTool());
}

/** The viewport transform of the canvas: screen = canvas × zoom + offset. */
export async function viewport(page: Page): Promise<{ zoom: number; x: number; y: number }> {
  const transform = await canvas(page).locator('svg.imk-content > g').first().getAttribute('transform');
  const values = (transform ?? '')
    .replace(/^matrix\(|\)$/g, '')
    .split(/[\s,]+/)
    .map(Number);
  return { zoom: values[0] ?? 1, x: values[4] ?? 0, y: values[5] ?? 0 };
}

/** Page coordinates of a canvas point. */
export async function pagePoint(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const { zoom, x, y } = await viewport(page);
  return { x: box.x + x + point.x * zoom, y: box.y + y + point.y * zoom };
}

/** A mouse drag between two canvas points. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
): Promise<void> {
  const start = await pagePoint(page, from);
  const end = await pagePoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/** A click (or a tap with a touch screen) at a canvas point. */
export async function press(page: Page, point: { x: number; y: number }, touch = false): Promise<void> {
  const target = await pagePoint(page, point);
  if (touch) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
}

/** Picks a tool from the toolbar (through its menu when it has one). */
export async function pickTool(page: Page, button: string, entry?: string): Promise<void> {
  await page.getByTestId(`toolbar.${button}`).click();
  if (entry) await page.getByTestId(`menu.${entry}`).click();
}

/** The command key the editor listens to on this page's platform (⌘ on Apple platforms, Ctrl elsewhere). */
export async function commandKey(page: Page): Promise<'Meta' | 'Control'> {
  const apple = await page.evaluate(() => {
    const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const platform = data?.platform || navigator.platform || '';
    return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X/.test(navigator.userAgent);
  });
  return apple ? 'Meta' : 'Control';
}
