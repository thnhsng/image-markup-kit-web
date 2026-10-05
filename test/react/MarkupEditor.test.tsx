import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARKUP_NAVIGATION_TEXTS,
  MarkupEditor,
  MarkupError,
  MarkupFeatures,
  SHAPE_TOOLS,
  createBoardDocument,
  createLineItem,
  createShapeItem,
  createTextItem,
  findItem,
  imageItems,
  itemStyle,
  DEFAULT_FONT,
  MarkupColors,
  type MarkupDocument,
  type MarkupEditorState,
  type MarkupResult,
  type MarkupEditorHandle,
  type MarkupEditorProps,
  type MarkupItem,
} from '../../src';
import { resolveNavigationTexts } from '../../src/react/strings';

vi.mock('../../src/render/render-markup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/render/render-markup')>();
  return { ...original, renderMarkup: vi.fn(), loadFonts: vi.fn(() => Promise.resolve()) };
});
const { renderMarkup } = await import('../../src/render/render-markup');
const renderMock = vi.mocked(renderMarkup);

const photo = { assetID: 'photo', pixelSize: { width: 1024, height: 768 } };
const P = (x: number, y: number) => ({ x, y });

function board(items: readonly MarkupItem[] = []): MarkupDocument {
  const document = createBoardDocument([photo]);
  return { ...document, items: [...document.items, ...items] };
}

function renderEditor(props: Partial<MarkupEditorProps> = {}) {
  const ref = createRef<MarkupEditorHandle>();
  const onDone = props.onDone ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const view = render(
    <MarkupEditor ref={ref} document={board()} assets={{}} {...props} onDone={onDone} onCancel={onCancel} />,
  );
  return { ...view, ref, onDone, onCancel };
}

/** A change, so Cancel asks before discarding. */
function draw(ref: { readonly current: MarkupEditorHandle | null }): void {
  act(() => ref.current?.debug.perform({ type: 'draw', tool: 'pen', points: [P(10, 10), P(60, 40), P(120, 30)] }));
}

/** jsdom has no layout: every element reports this size, so the canvas fits its document at a real zoom. */
function layout(width = 1024, height = 768): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  renderMock.mockReset();
  layout();
  // jsdom has no 2D canvas; the text measurer falls back to estimates without logging about it.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // Nor an image decoder: <img> never loads, so decoding fails right away instead of waiting forever.
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: () => Promise.reject(new Error('jsdom decodes no images')),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Port of NavigationTextsTests.
describe('navigation texts', () => {
  it('are English by default', () => {
    const { ref } = renderEditor();
    expect(screen.getByTestId('markup.cancel').textContent).toBe('Cancel');
    expect(screen.getByTestId('markup.done').textContent).toBe('Done');

    draw(ref);
    fireEvent.click(screen.getByTestId('markup.cancel'));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Discard changes?');
    expect(dialog.textContent).toContain('Your markup will not be saved.');
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Discard', 'Keep Editing']);
  });

  it('replace the buttons and the discard dialog', () => {
    const navigationTexts = {
      done: '保存',
      cancel: 'キャンセル',
      discardTitle: '変更を破棄しますか？',
      discardMessage: '編集内容は保存されません。',
      discard: '破棄',
      keepEditing: '編集を続ける',
    };
    const { ref } = renderEditor({ configuration: { navigationTexts } });
    expect(screen.getByTestId('markup.cancel').textContent).toBe('キャンセル');
    expect(screen.getByTestId('markup.done').textContent).toBe('保存');

    draw(ref);
    fireEvent.click(screen.getByTestId('markup.cancel'));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('変更を破棄しますか？');
    expect(dialog.textContent).toContain('編集内容は保存されません。');
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['破棄', '編集を続ける']);
    expect(buttons[0]?.className).toContain('destructive');
    expect(buttons[1]?.className).toContain('cancel');
  });

  it('match the built-in English strings', () => {
    const english = MARKUP_NAVIGATION_TEXTS.en;
    expect(english.done).toBe('Done');
    expect(english.cancel).toBe('Cancel');
    expect(resolveNavigationTexts()).toEqual(english);
  });
});

// Port of the editor tests of MarkupFeaturesTests.
describe('features in the editor UI', () => {
  it('shows only enabled toolbar items', () => {
    const features = MarkupFeatures.all
      .withGroup('shapes', false)
      .with('highlighter', false)
      .with('polyline', false)
      .with('curve', false)
      .with('fillColor', false)
      .with('arrange', false);
    renderEditor({ configuration: { features } });
    const toolbar = screen.getByTestId('markup.toolbar');
    expect(within(toolbar).queryByTestId('toolbar.shapes')).toBeNull();
    expect(within(toolbar).queryByTestId('toolbar.highlight')).toBeNull();
    expect(within(toolbar).queryByTestId('toolbar.fillColor')).toBeNull();
    expect(within(toolbar).queryByTestId('toolbar.arrange')).toBeNull();
    expect(within(toolbar).getByTestId('toolbar.sketch')).toBeDefined();
    expect(within(toolbar).getByTestId('toolbar.borderColor')).toBeDefined();
    // One line tool left: a plain button, no menu.
    expect(within(toolbar).getByTestId('toolbar.arrow').getAttribute('aria-haspopup')).toBeNull();
  });

  it('cannot select disabled tools', () => {
    const { ref } = renderEditor({ configuration: { features: MarkupFeatures.all.with('highlighter', false) } });
    const root = screen.getByTestId('markup.editor');
    fireEvent.keyDown(root, { key: 'h' });
    expect(ref.current?.getTool()).toBe('select');
    act(() => ref.current?.setTool('highlighter'));
    expect(ref.current?.getTool()).toBe('select');
    fireEvent.keyDown(root, { key: 'p' });
    expect(ref.current?.getTool()).toBe('pen');
    expect(screen.getByTestId('toolbar.sketch').getAttribute('aria-pressed')).toBe('true');
  });

  it('follows the features in the action bar and text editing', () => {
    const text = createTextItem('Hello', P(100, 100), { font: DEFAULT_FONT, color: MarkupColors.red });
    const features = MarkupFeatures.all.with('lock', false).with('editText', false);
    const { ref } = renderEditor({ document: board([text]), configuration: { features } });
    act(() => ref.current?.setSelectedItemIDs([text.id]));
    const bar = screen.getByTestId('markup.actionBar');
    expect(within(bar).queryByTestId('action.lock')).toBeNull();
    expect(within(bar).queryByTestId('action.editText')).toBeNull();
    expect(within(bar).getByTestId('action.delete')).toBeDefined();

    act(() => ref.current?.debug.beginEditingText(1));
    // Existing text cannot be edited.
    expect(screen.getByTestId('markup.textEditor').className).toContain('imk-text-editor-idle');
  });
});

describe('MarkupEditor', () => {
  it('renders in jsdom', () => {
    renderEditor({ className: 'editor' });
    expect(screen.getByTestId('markup.editor').className).toBe('imk-root editor');
  });
});

const rendering = {
  blob: new Blob(['exported'], { type: 'image/jpeg' }),
  pixelSize: { width: 1024, height: 768 },
  isClamped: false,
  exceedsMaxBytes: false,
  warnings: [],
};

/** A 3 × 2 JPEG header (enough for the metadata reader). */
function jpeg(): Blob {
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11];
  return new Blob([new Uint8Array([...bytes, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])], { type: 'image/jpeg' });
}

function tool(ref: { readonly current: MarkupEditorHandle | null }): string | undefined {
  return ref.current?.getTool();
}

describe('toolbar', () => {
  it('turns a menu with one entry into a plain button', () => {
    const features = SHAPE_TOOLS.filter((shape) => shape !== 'star').reduce(
      (current, shape) => current.with(shape, false),
      MarkupFeatures.all,
    );
    const { ref } = renderEditor({ configuration: { features } });
    const shapes = screen.getByTestId('toolbar.shapes');
    expect(shapes.getAttribute('aria-haspopup')).toBeNull();
    expect(shapes.getAttribute('aria-label')).toBe('Star');
    fireEvent.click(shapes);
    expect(tool(ref)).toBe('star');
    expect(shapes.getAttribute('aria-pressed')).toBe('true');
  });

  it('picks tools from menus', () => {
    const { ref } = renderEditor();
    fireEvent.click(screen.getByTestId('toolbar.shapes'));
    const menu = screen.getByTestId('menu.shapes');
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(11);
    fireEvent.click(screen.getByTestId('menu.star'));
    expect(tool(ref)).toBe('star');
    expect(screen.queryByTestId('menu.shapes')).toBeNull();
    fireEvent.click(screen.getByTestId('toolbar.shapes'));
    expect(screen.getByTestId('menu.star').getAttribute('aria-checked')).toBe('true');
    // Pressing the button again closes the menu.
    fireEvent.click(screen.getByTestId('toolbar.shapes'));
    expect(screen.queryByTestId('menu.shapes')).toBeNull();

    fireEvent.click(screen.getByTestId('toolbar.arrow'));
    fireEvent.click(screen.getByTestId('menu.curve'));
    expect(tool(ref)).toBe('curve');
    expect(screen.getByTestId('toolbar.arrow').getAttribute('aria-label')).toBe('Curve');

    // Escape closes a menu and goes no further (the editor would return to Select).
    fireEvent.click(screen.getByTestId('toolbar.arrange'));
    fireEvent.keyDown(screen.getByTestId('menu.arrange'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('menu.arrange'), { key: 'Escape' });
    expect(screen.queryByTestId('menu.arrange')).toBeNull();
    expect(tool(ref)).toBe('curve');
  });

  it('arranges the photos of a board and zooms to fit', () => {
    const second = { assetID: 'b', pixelSize: { width: 300, height: 400 } };
    const { ref } = renderEditor({ document: createBoardDocument([photo, second, photo]) });
    fireEvent.click(screen.getByTestId('toolbar.arrange'));
    fireEvent.click(screen.getByTestId('menu.column'));
    const frames = imageItems(ref.current!.getDocument()!).map((item) => item.content.box.frame);
    expect(frames.every((frame) => Math.abs(frame.width - 800) < 1e-9)).toBe(true);
    expect(screen.getByTestId('markup.undo').getAttribute('aria-label')).toBe('Undo Arrange');
    fireEvent.click(screen.getByTestId('toolbar.arrange'));
    fireEvent.click(screen.getByTestId('menu.zoomToFit'));
    expect(screen.queryByTestId('menu.arrange')).toBeNull();
  });
});

describe('panels', () => {
  it('edit the selection from a popover', () => {
    const rect = createShapeItem('rectangle', { x: 100, y: 100, width: 200, height: 120 }, itemStyle());
    const { ref } = renderEditor({ document: board([rect]) });
    act(() => ref.current?.setSelectedItemIDs([rect.id]));
    fireEvent.click(screen.getByTestId('toolbar.shapeStyle'));
    const panel = screen.getByTestId('panel.shapeStyle');
    expect(panel.className).toBe('imk-panel');
    fireEvent.change(within(panel).getByTestId('panel.lineWidth'), { target: { value: '12' } });
    fireEvent.change(within(panel).getByTestId('panel.lineWidth'), { target: { value: '14' } });
    fireEvent.pointerUp(within(panel).getByTestId('panel.lineWidth'));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Dashed' }));
    fireEvent.click(within(panel).getByRole('switch'));
    const style = () => findItem(ref.current!.getDocument()!, rect.id)!.style;
    expect(style()).toMatchObject({ lineWidth: 14, dash: 'dashed', shadow: true });
    // Arrowheads are for lines; corners for rectangles.
    expect(within(panel).queryByRole('radiogroup', { name: 'Arrowheads' })).toBeNull();
    expect(within(panel).getByRole('slider', { name: 'Corners' })).toBeDefined();
    // A whole slider drag is one undo step.
    act(() => ref.current?.undo());
    act(() => ref.current?.undo());
    act(() => ref.current?.undo());
    expect(style().lineWidth).toBe(rect.style.lineWidth);

    fireEvent.click(screen.getByTestId('toolbar.shapeStyle'));
    expect(screen.queryByTestId('panel.shapeStyle')).toBeNull();
  });

  it('offer "None" only where it makes sense', () => {
    const line = createLineItem(P(100, 400), P(400, 400), itemStyle());
    const rect = createShapeItem('rectangle', { x: 100, y: 100, width: 200, height: 120 }, itemStyle());
    const { ref } = renderEditor({ document: board([line, rect]) });
    act(() => ref.current?.setSelectedItemIDs([line.id]));
    expect((screen.getByTestId('toolbar.fillColor') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('toolbar.borderColor'));
    const border = screen.getByTestId('panel.borderColor');
    expect((within(border).getByTestId('panel.noColor') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(border).getByRole('button', { name: MarkupColors.blue }));
    expect(findItem(ref.current!.getDocument()!, line.id)!.style.strokeColor).toBe(MarkupColors.blue);

    act(() => ref.current?.setSelectedItemIDs([rect.id]));
    fireEvent.click(screen.getByTestId('toolbar.fillColor'));
    const fill = screen.getByTestId('panel.fillColor');
    fireEvent.click(within(fill).getByRole('button', { name: MarkupColors.yellow }));
    expect(findItem(ref.current!.getDocument()!, rect.id)!.style.fillColor).toBe(MarkupColors.yellow);
    fireEvent.click(within(fill).getByTestId('panel.noColor'));
    expect(findItem(ref.current!.getDocument()!, rect.id)!.style.fillColor).toBeNull();
    fireEvent.keyDown(fill, { key: 'Escape' });
    expect(screen.queryByTestId('panel.fillColor')).toBeNull();
    expect(ref.current?.getSelectedItemIDs()).toEqual([rect.id]);
  });

  it('edit text attributes', () => {
    const text = createTextItem('Hello', P(100, 100), { font: DEFAULT_FONT, color: MarkupColors.red });
    const { ref } = renderEditor({ document: board([text]) });
    act(() => ref.current?.setSelectedItemIDs([text.id]));
    fireEvent.click(screen.getByTestId('toolbar.textStyle'));
    const panel = screen.getByTestId('panel.textStyle');
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Font' }), { target: { value: 'hiraginoSans' } });
    fireEvent.change(within(panel).getByTestId('panel.fontSize'), { target: { value: '40' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Larger' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Bold' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Italic' }));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Center' }));
    fireEvent.click(within(panel).getByRole('button', { name: MarkupColors.blue }));
    const edited = findItem(ref.current!.getDocument()!, text.id);
    expect(edited?.type === 'text' && edited.content).toMatchObject({
      font: { family: 'hiraginoSans', size: 42, bold: !DEFAULT_FONT.bold, italic: true },
      alignment: 'center',
      color: MarkupColors.blue,
    });
  });

  it('become sheets in narrow editors', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    layout(400, 700);
    renderEditor();
    expect(screen.getByTestId('markup.editor').getAttribute('data-layout')).toBe('narrow');
    const toolbar = screen.getByTestId('markup.toolbar');
    expect(toolbar.className).toContain('imk-toolbar-bottom');
    expect(toolbar.querySelectorAll('.imk-toolbar-row')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('toolbar.shapeStyle'));
    expect(screen.getByTestId('panel.shapeStyle').className).toBe('imk-sheet');
  });
});

describe('text editing', () => {
  function tap(element: Element, x: number, y: number): void {
    fireEvent.pointerDown(element, { pointerId: 1, clientX: x, clientY: y, pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(element, { pointerId: 1, clientX: x, clientY: y, pointerType: 'touch', button: 0 });
  }

  it('only ends the edit when the canvas is tapped outside a new box', () => {
    const { ref } = renderEditor();
    act(() => ref.current?.setTool('text'));
    const canvas = screen.getByTestId('markup.canvas');
    tap(canvas, 600, 500);
    const textarea = screen.getByTestId('markup.textEditor') as HTMLTextAreaElement;
    expect(textarea.className).toBe('imk-text-editor');
    // The empty box goes away and no second box appears where the canvas was tapped.
    tap(canvas, 200, 200);
    expect(textarea.className).toContain('imk-text-editor-idle');
    expect(ref.current!.getDocument()!.items).toHaveLength(1);
    expect(tool(ref)).toBe('text');
    expect((screen.getByTestId('markup.undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('commits an edit and selects nothing else when the canvas is tapped in Select mode', () => {
    const text = createTextItem('Hello', P(100, 100), { font: DEFAULT_FONT, color: MarkupColors.red });
    const rect = createShapeItem('rectangle', { x: 400, y: 400, width: 200, height: 120 }, itemStyle());
    const { ref } = renderEditor({ document: board([text, rect]) });
    act(() => ref.current?.setSelectedItemIDs([text.id]));
    fireEvent.click(screen.getByTestId('action.editText'));
    const textarea = screen.getByTestId('markup.textEditor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello there' } });
    // A tap on the rectangle ends the edit, and the tap selects nothing.
    const screenPoint = (point: { x: number; y: number }) => {
      const transform = screen
        .getByTestId('markup.canvas')
        .querySelector('svg.imk-content > g')!
        .getAttribute('transform')!;
      const [zoom, , , , offsetX, offsetY] = transform.slice(7, -1).split(' ').map(Number) as number[];
      return { x: point.x * zoom! + offsetX!, y: point.y * zoom! + offsetY! };
    };
    const target = screenPoint(P(500, 460));
    tap(screen.getByTestId('markup.canvas'), target.x, target.y);
    expect(screen.getByTestId('markup.undo').getAttribute('aria-label')).toBe('Undo Edit Text');
    expect(ref.current?.getSelectedItemIDs()).toEqual([]);
  });

  it('types new text in place and commits it when the box loses focus', () => {
    const { ref } = renderEditor();
    act(() => ref.current?.setTool('text'));
    tap(screen.getByTestId('markup.canvas'), 600, 500);
    const textarea = screen.getByTestId('markup.textEditor') as HTMLTextAreaElement;
    expect(textarea.className).toBe('imk-text-editor');
    expect(document.activeElement).toBe(textarea);
    fireEvent.change(textarea, { target: { value: 'Summit 2,456 m' } });
    expect(textarea.value).toBe('Summit 2,456 m');
    // Keys typed in the box stay there: no shortcut deletes or undoes anything.
    fireEvent.keyDown(textarea, { key: 'Backspace' });
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true, ctrlKey: true });
    // IME composition: Enter and Escape belong to the input method.
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(textarea, { key: 'Escape', keyCode: 229 });
    expect(textarea.className).toBe('imk-text-editor');
    fireEvent.blur(textarea);
    expect(textarea.className).toContain('imk-text-editor-idle');
    expect(ref.current!.getDocument()!.items).toHaveLength(2);
    expect(screen.getByTestId('markup.undo').getAttribute('aria-label')).toBe('Undo Add Text');
    expect(tool(ref)).toBe('select');
  });

  it('ends with Escape inside the editor and uses the accessory bar', () => {
    const text = createTextItem('Hello', P(100, 100), { font: DEFAULT_FONT, color: MarkupColors.red });
    const onParentKeyDown = vi.fn();
    const ref = createRef<MarkupEditorHandle>();
    render(
      <div onKeyDown={onParentKeyDown}>
        <MarkupEditor ref={ref} document={board([text])} assets={{}} onDone={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    act(() => ref.current?.setSelectedItemIDs([text.id]));
    fireEvent.click(screen.getByTestId('action.editText'));
    const textarea = screen.getByTestId('markup.textEditor') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    const accessory = screen.getByTestId('markup.textAccessory');
    fireEvent.click(within(accessory).getByRole('button', { name: 'Larger' }));
    fireEvent.click(within(accessory).getByRole('button', { name: 'Bold' }));
    expect(within(accessory).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe(
      String(!DEFAULT_FONT.bold),
    );
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('markup.editor'));
    fireEvent.blur(textarea);
    const edited = findItem(ref.current!.getDocument()!, text.id);
    expect(edited?.type === 'text' && edited.content.font.size).toBe(Math.round(DEFAULT_FONT.size * 1.15));

    act(() => ref.current?.debug.beginEditingText(1));
    fireEvent.click(within(screen.getByTestId('markup.textAccessory')).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('markup.textAccessory')).toBeNull();
  });
});

describe('Done', () => {
  it('stays busy until onDone settles', async () => {
    renderMock.mockResolvedValue(rendering);
    let finish: () => void = () => undefined;
    const onDone = vi.fn<(result: MarkupResult) => Promise<void>>(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const { ref } = renderEditor({ onDone });
    draw(ref);
    fireEvent.click(screen.getByTestId('markup.done'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const root = screen.getByTestId('markup.editor');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('markup.exporting')).toBeDefined();
    expect((screen.getByTestId('markup.undo') as HTMLButtonElement).disabled).toBe(true);
    // Shortcuts do nothing meanwhile.
    fireEvent.keyDown(root, { key: 'z', metaKey: true });
    fireEvent.keyDown(root, { key: 'z', ctrlKey: true });
    expect(ref.current!.getDocument()!.items).toHaveLength(2);

    const result = onDone.mock.calls[0]![0];
    expect(result.blob).toBe(rendering.blob);
    expect(result.document.items).toHaveLength(2);
    expect(result.package).toBeNull();
    expect(result.assets).toEqual({});
    await act(async () => finish());
    expect(root.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByTestId('markup.done')).toBeDefined();
  });

  it('stays open and editable when onDone rejects', async () => {
    renderMock.mockResolvedValue(rendering);
    const onDone = vi.fn(() => Promise.reject(new Error('upload failed')));
    const onError = vi.fn();
    const { ref } = renderEditor({ onDone, onError });
    await act(async () => {
      await expect(ref.current!.done()).rejects.toThrow('upload failed');
    });
    expect(screen.getByTestId('markup.done')).toBeDefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports export failures', async () => {
    renderMock.mockRejectedValue(new MarkupError('canvasAllocationFailed', 'No canvas.'));
    const onError = vi.fn();
    renderEditor({ onError });
    fireEvent.click(screen.getByTestId('markup.done'));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].code).toBe('canvasAllocationFailed');
    expect(screen.getByRole('alert').textContent).toBe('Could not save the image.');
    renderMock.mockRejectedValue(new Error('boom'));
    fireEvent.click(screen.getByTestId('markup.done'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(onError.mock.calls[1]![0].code).toBe('exportFailed');
  });

  it('builds the editable package when asked', async () => {
    renderMock.mockResolvedValue(rendering);
    const onDone = vi.fn();
    const asset = new Blob(['photo'], { type: 'image/jpeg' });
    renderEditor({ onDone, assets: { photo: asset, unused: asset }, configuration: { includePackage: true } });
    fireEvent.click(screen.getByTestId('markup.done'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const result = onDone.mock.calls[0]![0] as MarkupResult;
    expect(Object.keys(result.package ?? {}).sort()).toEqual(['assets/photo', 'document.json', 'export.jpg']);
    expect(Object.keys(result.assets)).toEqual(['photo']);
  });
});

describe('cancel', () => {
  it('cancels right away without changes', () => {
    const { onCancel } = renderEditor();
    fireEvent.click(screen.getByTestId('markup.cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before discarding changes', () => {
    const { ref, onCancel } = renderEditor();
    draw(ref);
    fireEvent.click(screen.getByTestId('markup.cancel'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    act(() => ref.current?.cancel());
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByTestId('markup.cancel'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps its shortcuts from the host page', () => {
    const rect = createShapeItem('rectangle', { x: 100, y: 100, width: 200, height: 120 }, itemStyle());
    const onParentKeyDown = vi.fn();
    const ref = createRef<MarkupEditorHandle>();
    render(
      <div onKeyDown={onParentKeyDown}>
        <MarkupEditor ref={ref} document={board([rect])} assets={{}} onDone={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    act(() => ref.current?.setSelectedItemIDs([rect.id]));
    const root = screen.getByTestId('markup.editor');
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(ref.current?.getSelectedItemIDs()).toEqual([]);
    expect(onParentKeyDown).not.toHaveBeenCalled();
    // IME composition never triggers shortcuts.
    fireEvent.keyDown(root, { key: 'p', keyCode: 229 });
    expect(ref.current?.getTool()).toBe('select');
    fireEvent.keyDown(root, { key: 'q' });
    expect(onParentKeyDown).toHaveBeenCalledTimes(2);
  });
});

describe('lifecycle', () => {
  const styles = () => document.head.querySelectorAll('style[data-image-markup-kit]');

  it('shares one stylesheet and removes it with the last editor', () => {
    const first = render(
      <StrictMode>
        <MarkupEditor document={board()} assets={{}} onDone={vi.fn()} onCancel={vi.fn()} />
      </StrictMode>,
    );
    const second = render(
      <MarkupEditor
        document={board()}
        assets={{}}
        onDone={vi.fn()}
        onCancel={vi.fn()}
        configuration={{ styleNonce: 'abc' }}
      />,
    );
    expect(styles()).toHaveLength(1);
    first.unmount();
    expect(styles()).toHaveLength(1);
    second.unmount();
    expect(styles()).toHaveLength(0);
  });

  it('reports state changes', () => {
    const states: MarkupEditorState[] = [];
    const { ref } = renderEditor({ onStateChange: (state) => states.push(state) });
    act(() => ref.current?.setTool('pen'));
    act(() => ref.current?.setTool('pen'));
    expect(states.map((state) => state.tool)).toEqual(['select', 'pen']);
    expect(states[1]?.hasChanges).toBe(false);
    draw(ref);
    expect(states).toHaveLength(3);
    expect(states[2]).toMatchObject({ tool: 'pen', canUndo: true, hasChanges: true, isExporting: false });
  });

  it('reports invalid input', () => {
    const onError = vi.fn();
    render(<MarkupEditor onDone={vi.fn()} onCancel={vi.fn()} onError={onError} />);
    expect(onError.mock.calls[0]![0].code).toBe('invalidInput');
    expect(screen.getByRole('alert').textContent).toBe('Could not open the photos.');
    expect((screen.getByTestId('markup.done') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens photos given as files', async () => {
    const ref = createRef<MarkupEditorHandle>();
    render(<MarkupEditor ref={ref} image={jpeg()} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    await waitFor(() => expect(ref.current?.getDocument()).not.toBeNull());
    expect(ref.current?.getDocument()?.kind).toBe('image');
    expect(screen.getByRole('heading').textContent).toBe('Markup');
    cleanup();

    render(<MarkupEditor ref={ref} images={[jpeg(), jpeg()]} onDone={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(ref.current?.getDocument()).not.toBeNull());
    expect(imageItems(ref.current!.getDocument()!)).toHaveLength(2);
    expect(screen.getByRole('heading').textContent).toBe('Board');
  });

  it('reports photos it cannot open', async () => {
    const onError = vi.fn();
    render(<MarkupEditor image={new Blob(['not an image'])} onDone={vi.fn()} onCancel={vi.fn()} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].code).toBe('unreadableImage');
  });

  it('adds photos to a board from the file picker or the host', async () => {
    const { ref } = renderEditor();
    const input = screen.getByTestId('markup.photoInput') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByTestId('toolbar.addImages'));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File([jpeg()], 'summit.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(imageItems(ref.current!.getDocument()!)).toHaveLength(2));
    cleanup();

    const onAddImagesRequest = vi.fn(() => Promise.resolve([jpeg(), jpeg()]));
    const second = renderEditor({ configuration: { onAddImagesRequest } });
    fireEvent.click(screen.getByTestId('toolbar.addImages'));
    expect(onAddImagesRequest).toHaveBeenCalledWith('photoLibrary');
    await waitFor(() => expect(imageItems(second.ref.current!.getDocument()!)).toHaveLength(3));
  });
});

describe('canvas details', () => {
  it('gives shadows a region that also fits thin items', () => {
    const line = createLineItem(P(100, 400), P(500, 400), itemStyle({ shadow: true }));
    renderEditor({ document: board([line]) });
    const group = screen.getByTestId('markup.canvas').querySelector(`[data-item-id="${line.id}"]`)!;
    const filter = group.querySelector('filter')!;
    expect(group.getAttribute('filter')).toBe(`url(#${filter.id})`);
    expect(filter.getAttribute('filterUnits')).toBe('userSpaceOnUse');
    expect(Number(filter.getAttribute('height'))).toBeGreaterThan(20);
    expect(Number(filter.getAttribute('width'))).toBeGreaterThan(400);
  });

  it('closes popovers when the canvas is touched, but keeps sheets', () => {
    renderEditor();
    const canvas = screen.getByTestId('markup.canvas');
    fireEvent.click(screen.getByTestId('toolbar.shapeStyle'));
    expect(screen.getByTestId('panel.shapeStyle')).toBeDefined();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5, pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5, clientY: 5, pointerType: 'mouse', button: 0 });
    expect(screen.queryByTestId('panel.shapeStyle')).toBeNull();
    cleanup();

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    layout(400, 700);
    renderEditor();
    fireEvent.click(screen.getByTestId('toolbar.shapeStyle'));
    const narrowCanvas = screen.getByTestId('markup.canvas');
    fireEvent.pointerDown(narrowCanvas, { pointerId: 1, clientX: 5, clientY: 5, pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(narrowCanvas, { pointerId: 1, clientX: 5, clientY: 5, pointerType: 'touch', button: 0 });
    expect(screen.getByTestId('panel.shapeStyle')).toBeDefined();
  });

  it('zooms with trackpad pinches but leaves touch pinches to the pointers', () => {
    renderEditor();
    const canvas = screen.getByTestId('markup.canvas');
    const transform = () => canvas.querySelector('svg.imk-content > g')!.getAttribute('transform');
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 500, clientY: 400 });
      canvas.dispatchEvent(event);
      return event;
    };
    const before = transform();
    fireEvent.pointerDown(canvas, { pointerId: 7, clientX: 5, clientY: 5, pointerType: 'touch', button: 0 });
    gesture('gesturestart', 1);
    expect(gesture('gesturechange', 2).defaultPrevented).toBe(true);
    expect(transform()).toBe(before);
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 5, clientY: 5, pointerType: 'touch', button: 0 });
    act(() => {
      gesture('gesturestart', 1);
      gesture('gesturechange', 1.5);
    });
    expect(transform()).not.toBe(before);
  });
});
