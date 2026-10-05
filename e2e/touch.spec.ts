import { expect, test, type CDPSession } from '@playwright/test';
import { canvas, documentOf, openSample, pagePoint, viewport } from './support';

// Fingers: taps that open the keyboard, two-finger pinches, and an input method. Pinches and the input method use
// the Chrome DevTools Protocol, so they run in Chromium only.

test.describe('touch', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'needs a touch screen');

  test('a tap with the Text tool focuses the text box', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('toolbar.text').tap();
    const point = await pagePoint(page, { x: 700, y: 500 });
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByTestId('markup.textEditor')).toBeFocused();
    await page.keyboard.type('Best view!');
    await page.getByTestId('markup.textAccessory').getByRole('button', { name: 'Done' }).tap();
    const text = (await documentOf(page)).items[1];
    expect(text?.type === 'text' && text.content.text).toBe('Best view!');
  });

  test('two fingers pinch to zoom without drawing', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch events need the DevTools protocol');
    await openSample(page);
    await page.getByTestId('toolbar.sketch').tap();
    const client = await page.context().newCDPSession(page);
    const box = (await canvas(page).boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await viewport(page);
    await pinch(client, center, 60, 160);
    const after = await viewport(page);
    expect(after.zoom).toBeGreaterThan(before.zoom * 1.5);
    // The fingers drew nothing.
    expect((await documentOf(page)).items).toHaveLength(1);
  });

  test('an input method types Japanese into a text box', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'input methods need the DevTools protocol');
    await openSample(page);
    await page.getByTestId('toolbar.text').tap();
    const point = await pagePoint(page, { x: 700, y: 500 });
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByTestId('markup.textEditor')).toBeFocused();
    const client = await page.context().newCDPSession(page);
    await client.send('Input.imeSetComposition', { text: 'やまごや', selectionStart: 4, selectionEnd: 4 });
    // While composing, the box shows the text but nothing is committed or triggered.
    await expect(page.getByTestId('markup.textEditor')).toHaveValue('やまごや');
    await client.send('Input.insertText', { text: '山小屋 6:00 出発' });
    await expect(page.getByTestId('markup.textEditor')).toHaveValue('山小屋 6:00 出発');
    await page.getByTestId('markup.textAccessory').getByRole('button', { name: 'Done' }).tap();
    const text = (await documentOf(page)).items[1];
    expect(text?.type === 'text' && text.content.text).toBe('山小屋 6:00 出発');
  });
});

/** Two fingers moving apart from `from` to `to` pixels around `center`. */
async function pinch(client: CDPSession, center: { x: number; y: number }, from: number, to: number): Promise<void> {
  const points = (spread: number) => [
    { x: center.x - spread / 2, y: center.y, id: 1 },
    { x: center.x + spread / 2, y: center.y, id: 2 },
  ];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let step = 1; step <= 10; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(from + ((to - from) * step) / 10),
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
