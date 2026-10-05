import { expect, test } from '@playwright/test';
import { canvas, documentOf, pagePoint, waitForPhotos } from './support';

// Budgets, measured in desktop Chromium: a board of 20 photos stays smooth, and opening and closing the editor 30
// times leaks neither memory nor object URLs.

test.describe('performance', () => {
  test.skip(({ browserName, hasTouch }) => browserName !== 'chromium' || hasTouch, 'measured in desktop Chromium');

  test('a board of 20 photos stays smooth while an item is dragged', async ({ page }) => {
    await page.goto('./');
    await page.getByTestId('open.board20').click();
    await waitForPhotos(page, 20, 60_000);
    const photo = (await documentOf(page)).items[5];
    if (photo?.type !== 'image') throw new Error('no photo');
    const frame = photo.content.box.frame;
    const start = await pagePoint(page, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });

    await page.evaluate(() => {
      const times: number[] = [];
      const record = (time: number) => {
        times.push(time);
        if ((window as { __frames?: number[] }).__frames === times) requestAnimationFrame(record);
      };
      (window as { __frames?: number[] }).__frames = times;
      requestAnimationFrame(record);
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 60; step += 1) {
      await page.mouse.move(start.x + step * 4, start.y + step * 2);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    await page.mouse.up();
    const intervals = await page.evaluate(() => {
      const times = (window as { __frames?: number[] }).__frames ?? [];
      (window as { __frames?: number[] }).__frames = [];
      return times.slice(1).map((time, index) => time - (times[index] ?? time));
    });
    intervals.sort((a, b) => a - b);
    const p95 = intervals[Math.floor(intervals.length * 0.95)] ?? 0;
    console.log(`20-photo board drag: ${intervals.length} frames, p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(50);
  });

  test('opening and closing the editor 30 times leaks nothing', async ({ page }) => {
    await page.addInitScript(() => {
      const live = new Set<string>();
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (object: Blob | MediaSource) => {
        const url = create(object);
        live.add(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => {
        live.delete(url);
        revoke(url);
      };
      (window as { __liveURLs?: Set<string> }).__liveURLs = live;
    });
    await page.goto('./');
    const client = await page.context().newCDPSession(page);
    const heap = async () => {
      await client.send('HeapProfiler.collectGarbage');
      return (await client.send('Runtime.getHeapUsage')).usedSize;
    };
    const cycle = async () => {
      await page.getByTestId('open.waterfall.jpg').click();
      await waitForPhotos(page, 1);
      await page.getByTestId('markup.cancel').click();
      await expect(page.getByTestId('host.modal')).toHaveCount(0);
    };
    await cycle();
    const before = await heap();
    for (let index = 0; index < 30; index += 1) await cycle();
    const after = await heap();
    const live = await page.evaluate(() => (window as { __liveURLs?: Set<string> }).__liveURLs?.size ?? -1);
    console.log(
      `30 sessions: heap ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB, live URLs ${live}`,
    );
    expect(live).toBe(0);
    expect(after - before).toBeLessThan(8_000_000);
    expect(await canvas(page).count()).toBe(0);
  });
});
