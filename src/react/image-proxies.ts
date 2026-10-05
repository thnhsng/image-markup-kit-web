import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { decodeImage } from '../image/decode';
import { encodeCanvas, readImageMetadata, type MarkupAssets } from '../image/import';
import { imageItems } from '../model/document';
import type { MarkupDocument } from '../model/types';

// Photos on screen are drawn from smaller copies, decoded once (CanvasView's display images): 4096 px in image
// mode, 2048 px on boards, 1536 px on boards with more than 8 photos. The originals stay untouched for the export.

/** Longest side of the on-screen copies of a document's photos. */
export function displayImageMaxPixel(document: MarkupDocument): number {
  if (document.kind !== 'board') return 4096;
  return imageItems(document).length > 8 ? 1536 : 2048;
}

function canCreateURLs(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

const KEEPS_ALPHA = /^image\/(png|gif|webp|avif)$/;

/** An object URL of the photo at most `maxPixel` on its longest side, upright. */
async function createDisplayURL(blob: Blob, maxPixel: number, signal: AbortSignal): Promise<string> {
  const metadata = await readImageMetadata(blob);
  const { width, height } = metadata.pixelSize;
  const decoded = await decodeImage(blob, {
    maxPixelSize: maxPixel,
    orientation: metadata.orientation,
    pixelCount: width * height,
    signal,
  });
  try {
    const source = decoded.source;
    const isCanvas =
      (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas);
    // Already small and upright: the original bytes display as they are.
    if (!isCanvas) return URL.createObjectURL(blob);
    const type = KEEPS_ALPHA.test(blob.type) ? 'image/png' : 'image/jpeg';
    return URL.createObjectURL(await encodeCanvas(source, type, 0.92));
  } finally {
    decoded.close();
  }
}

/**
 * Display URLs by asset ID. A photo keeps its previous copy until a copy of a new size is ready; photos that are
 * missing, or that the browser cannot decode (e.g. HEIC outside Safari), never get one and stay gray boxes.
 */
class ImageProxyStore {
  private readonly urls = new Map<string, { readonly url: string; readonly maxPixel: number }>();
  private readonly pending = new Map<string, AbortController>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ReadonlyMap<string, string> = new Map();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReadonlyMap<string, string> => this.snapshot;

  sync(assetIDs: readonly string[], assets: MarkupAssets, maxPixel: number): void {
    if (!canCreateURLs()) return;
    const needed = new Set(assetIDs);
    let changed = false;
    for (const [assetID, entry] of this.urls) {
      if (needed.has(assetID)) continue;
      URL.revokeObjectURL(entry.url);
      this.urls.delete(assetID);
      changed = true;
    }
    for (const [key, controller] of this.pending) {
      const [assetID, size] = key.split('#');
      if (needed.has(assetID ?? '') && Number(size) === maxPixel) continue;
      controller.abort();
      this.pending.delete(key);
    }
    for (const assetID of needed) {
      const blob = assets[assetID];
      const key = `${assetID}#${maxPixel}`;
      if (!blob || this.urls.get(assetID)?.maxPixel === maxPixel || this.pending.has(key)) continue;
      const controller = new AbortController();
      this.pending.set(key, controller);
      createDisplayURL(blob, maxPixel, controller.signal).then(
        (url) => {
          if (controller.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          this.pending.delete(key);
          const previous = this.urls.get(assetID);
          if (previous) URL.revokeObjectURL(previous.url);
          this.urls.set(assetID, { url, maxPixel });
          this.publish();
        },
        () => {
          if (this.pending.get(key) === controller) this.pending.delete(key);
        },
      );
    }
    if (changed) this.publish();
  }

  dispose(): void {
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    for (const entry of this.urls.values()) URL.revokeObjectURL(entry.url);
    const hadURLs = this.urls.size > 0;
    this.urls.clear();
    if (hadURLs) this.publish();
  }

  private publish(): void {
    this.snapshot = new Map([...this.urls].map(([assetID, entry]) => [assetID, entry.url]));
    for (const listener of [...this.listeners]) listener();
  }
}

/** Object URLs of the on-screen copies of the document's photos, by asset ID, as they become ready. */
export function useImageProxies(document: MarkupDocument, assets: MarkupAssets): ReadonlyMap<string, string> {
  const [store] = useState(() => new ImageProxyStore());
  const maxPixel = displayImageMaxPixel(document);
  const key = useMemo(
    () => [...new Set(imageItems(document).map((item) => item.content.assetID))].sort().join('\n'),
    [document],
  );
  useEffect(() => {
    store.sync(key ? key.split('\n') : [], assets, maxPixel);
  }, [store, key, assets, maxPixel]);
  useEffect(() => () => store.dispose(), [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
