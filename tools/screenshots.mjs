// Screenshots for the README, taken from the example app's scripted links (run `npm run example:build` and
// `npm run example:preview` first). Usage: node tools/screenshots.mjs [base URL]
import { chromium, devices, webkit } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../docs/screenshots/', import.meta.url);

const shots = [
  {
    name: 'desktop-annotate',
    engine: chromium,
    device: { viewport: { width: 1180, height: 820 } },
    link: '?open=mountains-dusk.jpg&demo=1',
  },
  {
    name: 'desktop-board',
    engine: chromium,
    device: { viewport: { width: 1180, height: 820 } },
    link: '?board=mountains-dusk.jpg,mountain-hut.jpg,waterfall.jpg&demo=1',
  },
  {
    name: 'phone-panel',
    engine: webkit,
    device: devices['iPhone 14'],
    link: '?open=old-town-snow.jpg&demo=1&panel=shapeStyle',
  },
  {
    name: 'tablet-japanese',
    engine: webkit,
    device: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 },
    link: '?open=mountain-hut-exif6.jpg&demo=1&locale=ja&panel=textStyle',
  },
];

for (const shot of shots) {
  const browser = await shot.engine.launch();
  const page = await browser.newPage(shot.device);
  await page.goto(new URL(shot.link, base).href);
  await page.waitForFunction(() => (globalThis.markupEditor?.getDocument()?.items.length ?? 0) > 5);
  await page.waitForFunction(
    () => globalThis.document.querySelectorAll('[data-testid="markup.canvas"] svg.imk-content image').length > 0,
  );
  await page.waitForTimeout(400);
  await page.locator('.modal-frame').screenshot({ path: new URL(`${shot.name}.png`, out).pathname });
  await browser.close();
  console.log(`docs/screenshots/${shot.name}.png`);
}
