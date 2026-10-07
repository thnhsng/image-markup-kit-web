import { expect, test } from '@playwright/test';
import {
  canvas,
  commandKey,
  documentOf,
  drag,
  editor,
  openSample,
  pickTool,
  press,
  tool,
  waitForPhotos,
} from './support';

// The editor as users meet it in the example app, in every browser of the configuration.

test('annotates a photo and exports it', async ({ page }) => {
  await openSample(page);

  await pickTool(page, 'shapes', 'rectangle');
  expect(await tool(page)).toBe('rectangle');
  await drag(page, { x: 200, y: 200 }, { x: 600, y: 450 });
  let document = await documentOf(page);
  expect(document.items).toHaveLength(2);
  expect(document.items[1]?.type).toBe('shape');
  expect(await tool(page)).toBe('select');

  // Text is typed in place; a click outside finishes it. (The photo spans 1024 × 683 canvas units.)
  await page.getByTestId('toolbar.text').click();
  await press(page, { x: 650, y: 560 });
  const textEditor = page.getByTestId('markup.textEditor');
  await expect(textEditor).toBeFocused();
  await page.keyboard.type('Summit 2,456 m');
  await press(page, { x: 900, y: 100 });
  document = await documentOf(page);
  const text = document.items[2];
  expect(text?.type === 'text' && text.content.text).toBe('Summit 2,456 m');

  // Undo from the header, redo from the keyboard.
  await page.getByTestId('markup.undo').click();
  expect((await documentOf(page)).items).toHaveLength(2);
  await editor(page).focus();
  await page.keyboard.press(`${await commandKey(page)}+Shift+KeyZ`);
  expect((await documentOf(page)).items).toHaveLength(3);

  await page.getByTestId('markup.done').click();
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('result.size')).toContainText('1440 × 961 px');
  await expect(page.getByTestId('host.modal')).toHaveCount(0);
});

test('keeps its Escape presses from the host dialog', async ({ page }) => {
  await openSample(page);
  await pickTool(page, 'shapes', 'oval');
  await drag(page, { x: 300, y: 300 }, { x: 500, y: 450 });
  expect((await page.evaluate(() => window.markupEditor?.getSelectedItemIDs()))?.length).toBe(1);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.markupEditor?.getSelectedItemIDs())).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('host.modal')).toBeVisible();

  // Cancel asks before throwing the oval away.
  await page.getByTestId('markup.cancel').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('host.modal')).toHaveCount(0);
});

test('lays out a board, adds a photo and arranges it', async ({ page }) => {
  await page.goto('./');
  for (const file of ['mountains-dusk.jpg', 'mountain-hut.jpg', 'waterfall.jpg']) {
    await page.getByTestId(`select.${file}`).check();
  }
  await page.getByTestId('open.board').click();
  await waitForPhotos(page, 3);

  await page.getByTestId('markup.photoInput').setInputFiles('example/public/samples/mossy-trees.jpg');
  await waitForPhotos(page, 4);
  expect((await documentOf(page)).kind).toBe('board');

  await pickTool(page, 'arrange', 'grid');
  await expect(page.getByTestId('markup.undo')).toHaveAttribute('aria-label', 'Undo Arrange');
  await page.getByTestId('markup.done').click();
  await expect(page.getByTestId('result')).toBeVisible();
});

test('opens your photo to annotate, or as a board to add more to', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open.photoInput').setInputFiles('example/public/samples/waterfall.jpg');
  await waitForPhotos(page, 1);
  expect((await documentOf(page)).kind).toBe('image');
  await expect(page.getByTestId('toolbar.addImages')).toHaveCount(0);
  await page.getByTestId('markup.cancel').click();
  await expect(page.getByTestId('host.modal')).toHaveCount(0);

  // One photo picked for a board still opens a board, with Add Images.
  await page.getByTestId('open.boardPhotosInput').setInputFiles('example/public/samples/waterfall.jpg');
  await waitForPhotos(page, 1);
  expect((await documentOf(page)).kind).toBe('board');
  await expect(page.getByTestId('toolbar.addImages')).toBeVisible();
  await page.getByTestId('markup.photoInput').setInputFiles('example/public/samples/mossy-trees.jpg');
  await waitForPhotos(page, 2);
});

test('turns phone photos upright', async ({ page }) => {
  await openSample(page, 'mountain-hut-exif6.jpg');
  const photo = (await documentOf(page)).items[0];
  expect(photo?.type === 'image' && photo.content.pixelSize).toEqual({ width: 1080, height: 1440 });
  const box = await canvas(page).locator('svg.imk-content image').boundingBox();
  expect(box && box.height > box.width).toBe(true);
  await page.getByTestId('markup.done').click();
  await expect(page.getByTestId('result.size')).toContainText('1080 × 1440 px');
});

test('follows the features JSON', async ({ page }) => {
  await page.goto('./');
  await page
    .getByTestId('option.features')
    .fill('{ "shapes": { "enabled": false }, "lines": { "items": { "polyline": false } } }');
  await page.getByTestId('open.mountains-dusk.jpg').click();
  await waitForPhotos(page, 1);
  await expect(page.getByTestId('toolbar.shapes')).toHaveCount(0);
  await page.getByTestId('toolbar.arrow').click();
  await expect(page.getByTestId('menu.polyline')).toHaveCount(0);
  await expect(page.getByTestId('menu.curve')).toBeVisible();
});

test('speaks Japanese', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('option.locale').selectOption('ja');
  await page.getByTestId('open.waterfall.jpg').click();
  await waitForPhotos(page, 1);
  await expect(page.getByTestId('markup.done')).toHaveText('完了');
  await expect(page.getByTestId('toolbar.text')).toHaveAttribute('aria-label', 'テキスト');
});

test('opens style panels under their button, or as a sheet on phones', async ({ page, isMobile }) => {
  await page.goto('./?open=waterfall.jpg&demo=1&panel=fillColor');
  const panel = page.getByTestId('panel.fillColor');
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  if (isMobile) {
    await expect(panel).toHaveClass('imk-sheet');
    return;
  }
  const buttonBox = (await page.getByTestId('toolbar.fillColor').boundingBox())!;
  expect(panelBox.y).toBeGreaterThan(buttonBox.y + buttonBox.height);
  expect(panelBox.x).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
  expect(panelBox.x + panelBox.width).toBeGreaterThanOrEqual(buttonBox.x);
  // The scripted markup is there: an oval, an arrow, a label, a note and a highlight.
  expect((await page.evaluate(() => window.markupEditor?.getDocument()?.items.map((item) => item.type))) ?? []).toEqual(
    ['image', 'shape', 'line', 'text', 'text', 'stroke'],
  );
});
