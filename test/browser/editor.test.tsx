import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  MarkupEditor,
  readImageMetadata,
  type MarkupEditorHandle,
  type MarkupEditorProps,
  type MarkupResult,
} from '../../src';
import { canvasOf, encode } from './support';

// The editor in real engines: photos decode into on-screen copies, pointers draw, the text box takes the focus, the
// wheel zooms and Done exports a real JPEG.

// React state updates in these tests are wrapped in act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(props: Partial<MarkupEditorProps>, width = 1024, height = 768) {
  await page.viewport(width, height);
  container = document.createElement('div');
  container.style.cssText = `position: fixed; left: 0; top: 0; width: ${width}px; height: ${height}px;`;
  document.body.append(container);
  root = createRoot(container);
  const ref = createRef<MarkupEditorHandle>();
  const onDone = vi.fn<(result: MarkupResult) => void>();
  await act(async () => {
    root?.render(<MarkupEditor ref={ref} onDone={onDone} onCancel={() => undefined} {...props} />);
  });
  await vi.waitFor(() => expect(ref.current?.getDocument()).not.toBeNull(), { timeout: 5000 });
  return { ref, onDone, element: container };
}

/** A landscape photo: sky over a field, with a sun. */
async function landscape(width = 1600, height = 1200): Promise<Blob> {
  return encode(
    canvasOf(width, height, (context) => {
      context.fillStyle = '#8EC5FC';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#5DA130';
      context.fillRect(0, height * 0.6, width, height * 0.4);
      context.fillStyle = '#FFD23F';
      context.beginPath();
      context.arc(width * 0.75, height * 0.25, height * 0.1, 0, Math.PI * 2);
      context.fill();
    }),
  );
}

function pointer(element: Element, type: string, x: number, y: number, id = 1): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: id,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y,
    }),
  );
}

describe('MarkupEditor in a browser', () => {
  it('shows the photo, draws, edits text and exports', async () => {
    const { ref, onDone, element } = await mount({ image: await landscape() });
    const canvas = element.querySelector('[data-testid="markup.canvas"]') as HTMLElement;

    // The on-screen copy of the photo replaces the gray placeholder.
    await vi.waitFor(() => expect(canvas.querySelector('image')?.getAttribute('href')).toMatch(/^blob:/), {
      timeout: 5000,
    });

    // A rectangle dragged out with the mouse.
    await act(async () => ref.current?.setTool('rectangle'));
    await act(async () => {
      pointer(canvas, 'pointerdown', 200, 200);
      for (let step = 1; step <= 5; step += 1) pointer(canvas, 'pointermove', 200 + step * 40, 200 + step * 25);
      pointer(canvas, 'pointerup', 400, 325);
    });
    const document1 = ref.current!.getDocument()!;
    expect(document1.items).toHaveLength(2);
    expect(document1.items[1]?.type).toBe('shape');
    expect(ref.current?.getTool()).toBe('select');

    // A text box: tapping with the Text tool focuses the text box at once.
    await act(async () => ref.current?.setTool('text'));
    await act(async () => {
      pointer(canvas, 'pointerdown', 600, 600);
      pointer(canvas, 'pointerup', 600, 600);
    });
    const textarea = element.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    await act(async () => {
      await userEvent.fill(textarea, 'Summit 2,456 m');
    });
    await act(async () => textarea.blur());
    const text = ref.current!.getDocument()!.items[2];
    expect(text?.type === 'text' && text.content.text).toBe('Summit 2,456 m');

    // Ctrl + wheel zooms in around the pointer.
    const before = canvas.querySelector('svg.imk-content > g')?.getAttribute('transform');
    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -120,
          clientX: 512,
          clientY: 400,
        }),
      );
    });
    expect(canvas.querySelector('svg.imk-content > g')?.getAttribute('transform')).not.toBe(before);
    await act(async () => ref.current?.zoomToFit());
    await act(async () => ref.current?.setSelectedItemIDs([document1.items[1]!.id]));

    await page.screenshot({ path: '../../.cache/screenshots/editor-image.png', element });

    await act(async () => {
      await ref.current?.done();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = onDone.mock.calls[0]![0];
    expect(result.blob.type).toBe('image/jpeg');
    expect(result.pixelSize).toEqual({ width: 1600, height: 1200 });
    const metadata = await readImageMetadata(result.blob);
    expect(metadata.pixelSize).toEqual({ width: 1600, height: 1200 });
    expect(result.document.items).toHaveLength(3);
  });

  it('lays out a board in a narrow editor', async () => {
    const photos = await Promise.all([landscape(1200, 900), landscape(900, 1200), landscape(1200, 900)]);
    const { ref, element } = await mount({ images: photos }, 390, 760);
    expect(element.querySelector('[data-testid="markup.editor"]')?.getAttribute('data-layout')).toBe('narrow');
    await vi.waitFor(() => expect(element.querySelectorAll('image')).toHaveLength(3), { timeout: 5000 });
    await act(async () => ref.current?.arrange('grid'));
    await act(async () => ref.current?.debug.perform({ type: 'taps', tool: 'oval', points: [{ x: 300, y: 300 }] }));
    await act(async () => ref.current?.debug.presentPanel('shapeStyle'));
    await page.screenshot({ path: '../../.cache/screenshots/editor-board-narrow.png', element });
    expect(element.querySelector('.imk-sheet')).not.toBeNull();
  });
});
