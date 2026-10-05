import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { VERSION } from '../version';

// The editor's stylesheet: one <style> element per document (or shadow root), shared by every editor in it and
// removed with the last one. Every class starts with `imk-`; colors come from CSS variables on the editor root, so
// hosts theme the editor without touching its CSS.

/** Colors and fonts of the editor; each one sets a CSS variable on the editor root. */
export interface MarkupTheme {
  /** Buttons, the selection and the active tool (iOS system blue by default). */
  readonly accent: string;
  /** The background of selected toolbar buttons. */
  readonly accentSoft: string;
  /** Header, toolbar, panels, menus and the action bar. */
  readonly surface: string;
  /** Around the photo in image mode, and the track of segmented controls. */
  readonly canvas: string;
  /** Buttons and highlighted menu entries inside panels. */
  readonly fill: string;
  readonly text: string;
  readonly secondaryText: string;
  readonly disabled: string;
  readonly separator: string;
  /** Delete buttons and the "none" slash of color swatches. */
  readonly danger: string;
  /** The item a line end will attach to. */
  readonly success: string;
  /** The font of the editor's own controls. */
  readonly font: string;
}

export const DEFAULT_THEME: MarkupTheme = {
  accent: '#007AFF',
  accentSoft: 'rgba(0, 122, 255, 0.18)',
  surface: '#FFFFFF',
  canvas: '#F2F2F7',
  fill: '#E5E5EA',
  text: '#000000',
  secondaryText: 'rgba(60, 60, 67, 0.6)',
  disabled: 'rgba(60, 60, 67, 0.3)',
  separator: 'rgba(60, 60, 67, 0.29)',
  danger: '#FF3B30',
  success: '#34C759',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif',
};

const VARIABLES: Readonly<Record<keyof MarkupTheme, string>> = {
  accent: '--imk-accent',
  accentSoft: '--imk-accent-soft',
  surface: '--imk-surface',
  canvas: '--imk-canvas',
  fill: '--imk-fill',
  text: '--imk-text',
  secondaryText: '--imk-secondary-text',
  disabled: '--imk-disabled',
  separator: '--imk-separator',
  danger: '--imk-danger',
  success: '--imk-success',
  font: '--imk-font',
};

/** The CSS variables of a theme, for the root's `style`. */
export function themeVariables(theme: Partial<MarkupTheme> = {}): Record<string, string> {
  const merged = { ...DEFAULT_THEME, ...theme };
  const variables: Record<string, string> = {};
  for (const key of Object.keys(VARIABLES) as (keyof MarkupTheme)[]) variables[VARIABLES[key]] = merged[key];
  return variables;
}

export const STYLESHEET = `
.imk-root {
  position: relative; display: flex; flex-direction: column; box-sizing: border-box;
  width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; outline: none;
  background: var(--imk-surface); color: var(--imk-text);
  font: 15px/1.3 var(--imk-font); -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent;
}
:where(.imk-root) *, :where(.imk-root) *::before, :where(.imk-root) *::after { box-sizing: border-box; }
:where(.imk-root) button { font: inherit; color: inherit; margin: 0; }
.imk-root button:focus-visible, .imk-root input:focus-visible, .imk-root select:focus-visible {
  outline: 2px solid var(--imk-accent); outline-offset: 1px;
}
.imk-root[aria-busy="true"] { cursor: progress; }
.imk-icon { display: block; flex: none; }
.imk-swatch { display: block; flex: none; }
.imk-visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.imk-header {
  flex: none; display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 4px;
  background: var(--imk-surface); border-bottom: 1px solid var(--imk-separator);
}
.imk-header-title {
  flex: 1 1 auto; min-width: 0; text-align: center; font-size: 17px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.imk-header-side { flex: 1 1 0; display: flex; align-items: center; gap: 2px; min-width: max-content; }
.imk-header-side-end { justify-content: flex-end; }
.imk-text-button {
  height: 44px; min-width: 44px; padding: 0 10px; border: 0; border-radius: 8px; background: none;
  color: var(--imk-accent); font-size: 17px; cursor: pointer; white-space: nowrap;
}
.imk-text-button:disabled { color: var(--imk-disabled); cursor: default; }
.imk-text-button-strong { font-weight: 600; }
.imk-spinner { animation: imk-spin 0.9s linear infinite; }
@keyframes imk-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .imk-spinner { animation-duration: 3s; } }

.imk-icon-button {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  color: var(--imk-text);
}
.imk-icon-button[aria-pressed="true"], .imk-icon-button.imk-selected {
  background: var(--imk-accent-soft); color: var(--imk-accent);
}
.imk-icon-button:disabled { color: var(--imk-disabled); cursor: default; }
.imk-icon-button:disabled .imk-swatch { opacity: 0.4; }
.imk-menu-indicator { position: absolute; right: 3px; bottom: 3px; width: 0; height: 0;
  border-left: 4px solid transparent; border-top: 4px solid currentColor; opacity: 0.55; }

.imk-toolbar { flex: none; background: var(--imk-surface); overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; overscroll-behavior-x: contain; }
.imk-toolbar::-webkit-scrollbar { display: none; }
.imk-toolbar-top { border-bottom: 1px solid var(--imk-separator); }
.imk-toolbar-bottom { border-top: 1px solid var(--imk-separator); padding-bottom: env(safe-area-inset-bottom, 0px); }
.imk-toolbar-row { display: flex; align-items: center; gap: 2px; height: 50px; padding: 0 8px; min-width: max-content; }
.imk-toolbar-bottom .imk-toolbar-row { justify-content: center; }
.imk-toolbar-spacer { flex: 1 0 12px; }
.imk-toolbar-divider { flex: none; width: 1px; height: 24px; margin: 0 4px; background: var(--imk-separator); }

.imk-stage { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.imk-canvas {
  position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--imk-canvas);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none;
}
.imk-canvas[data-tool="select"] { cursor: default; }
.imk-canvas:not([data-tool="select"]) { cursor: crosshair; }
.imk-content, .imk-overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.imk-overlay { pointer-events: none; overflow: visible; }
.imk-status {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: var(--imk-secondary-text); text-align: center; padding: 16px;
}

.imk-action-bar {
  position: absolute; z-index: 2; display: flex; align-items: center; gap: 2px; padding: 2px 6px; height: 44px;
  border-radius: 22px; background: var(--imk-surface); box-shadow: 0 2px 16px rgba(0, 0, 0, 0.18);
}
.imk-action-bar .imk-icon-button { width: 40px; height: 40px; border-radius: 20px; }
.imk-action-danger { color: var(--imk-danger); }
.imk-action-accent { color: var(--imk-accent); }

.imk-text-editor {
  position: absolute; z-index: 1; margin: 0; border-style: solid; resize: none; overflow: hidden; outline: none;
  background: transparent; color: inherit; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal;
  line-break: strict; transform-origin: center; -webkit-user-select: text; user-select: text; touch-action: auto;
  scrollbar-width: none;
}
.imk-text-editor-idle {
  left: 0 !important; top: 0 !important; width: 1px !important; height: 1px !important; opacity: 0 !important;
  pointer-events: none; border: 0 !important; padding: 0 !important;
}
.imk-accessory {
  position: absolute; z-index: 3; display: flex; align-items: center; gap: 2px; padding: 2px 4px; height: 44px;
  border-radius: 12px; background: var(--imk-surface); box-shadow: 0 2px 16px rgba(0, 0, 0, 0.18);
}

.imk-menu {
  position: absolute; z-index: 10; min-width: 220px; max-width: calc(100% - 16px); max-height: calc(100% - 16px);
  overflow-y: auto; padding: 6px 0; border-radius: 12px; background: var(--imk-surface);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.22), 0 0 0 0.5px var(--imk-separator);
}
.imk-menu-title { padding: 6px 16px 4px; font-size: 13px; color: var(--imk-secondary-text); }
.imk-menu-item {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 6px 16px; border: 0;
  background: none; text-align: start; cursor: pointer; color: var(--imk-text);
}
.imk-menu-item:hover, .imk-menu-item:focus-visible { background: var(--imk-fill); outline: none; }
.imk-menu-item-label { flex: 1 1 auto; }
.imk-menu-check { width: 16px; color: var(--imk-accent); visibility: hidden; }
.imk-menu-item[aria-checked="true"] .imk-menu-check { visibility: visible; }
.imk-menu-separator { height: 1px; margin: 6px 0; background: var(--imk-separator); }

.imk-panel {
  position: absolute; z-index: 10; width: 320px; max-width: calc(100% - 16px); max-height: min(560px, calc(100% - 16px));
  overflow-y: auto; padding: 18px; border-radius: 13px; background: var(--imk-surface);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.22), 0 0 0 0.5px var(--imk-separator); overscroll-behavior: contain;
}
.imk-sheet {
  position: absolute; z-index: 10; left: 0; right: 0; bottom: 0; max-height: 55%; overflow-y: auto;
  padding: 8px 18px calc(18px + env(safe-area-inset-bottom, 0px)); border-radius: 13px 13px 0 0;
  background: var(--imk-surface); box-shadow: 0 -2px 24px rgba(0, 0, 0, 0.2); overscroll-behavior: contain;
}
.imk-panel:focus, .imk-sheet:focus, .imk-menu:focus { outline: none; }
.imk-grabber { width: 36px; height: 5px; margin: 0 auto 10px; border-radius: 3px; background: var(--imk-separator); }
.imk-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.imk-panel-title { font-size: 17px; font-weight: 600; }
.imk-panel-close { width: 32px; height: 32px; border-radius: 16px; background: var(--imk-fill); }
.imk-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.imk-row:last-child { margin-bottom: 0; }
.imk-row-label { font-size: 15px; color: var(--imk-secondary-text); }
.imk-inline { display: flex; align-items: center; gap: 10px; }
.imk-grow { flex: 1 1 auto; min-width: 0; }
.imk-value { min-width: 48px; text-align: end; font-variant-numeric: tabular-nums; }
.imk-slider { width: 100%; height: 28px; margin: 0; accent-color: var(--imk-accent); }
.imk-segmented { display: flex; padding: 2px; border-radius: 9px; background: var(--imk-fill); }
.imk-segment {
  flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 6px;
  border: 0; border-radius: 7px; background: transparent; cursor: pointer; font-size: 13px;
}
.imk-segment[aria-checked="true"] { background: var(--imk-surface); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15); }
.imk-toggle {
  display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 36px; padding: 0 10px;
  border: 0; border-radius: 8px; background: var(--imk-fill); cursor: pointer;
}
.imk-toggle[aria-pressed="true"] { background: var(--imk-accent); color: #FFFFFF; }
.imk-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px; }
.imk-switch { width: 22px; height: 22px; margin: 0; accent-color: var(--imk-accent); }
.imk-select {
  width: 100%; min-height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: var(--imk-fill);
  color: var(--imk-text); font: inherit;
}
.imk-swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.imk-swatches-text { grid-template-columns: repeat(8, 1fr); gap: 8px; }
.imk-swatch-button {
  display: flex; align-items: center; justify-content: center; height: 44px; padding: 0;
  border: 3px solid transparent; border-radius: 8px; background: none; cursor: pointer;
}
.imk-swatches-text .imk-swatch-button { height: 36px; min-width: 0; border-radius: 6px; }
.imk-swatches-text .imk-swatch { width: 100%; max-width: 32px; height: auto; }
.imk-swatch-button[aria-pressed="true"] { border-color: var(--imk-accent); }
.imk-swatch-button:disabled { opacity: 0.35; cursor: default; }
.imk-custom-color {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px;
  margin-top: 14px; border-radius: 8px; background: var(--imk-fill); cursor: pointer; overflow: hidden;
}
.imk-custom-color input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; }

.imk-dialog-backdrop {
  position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(0, 0, 0, 0.2);
}
.imk-dialog {
  width: 270px; max-width: 100%; overflow: hidden; border-radius: 14px; background: var(--imk-surface);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25); text-align: center;
}
.imk-dialog-body { padding: 18px 16px; }
.imk-dialog-title { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
.imk-dialog-message { margin: 0; font-size: 13px; }
.imk-dialog-buttons { display: flex; border-top: 1px solid var(--imk-separator); }
.imk-dialog-button {
  flex: 1 1 0; min-height: 44px; border: 0; background: none; cursor: pointer; color: var(--imk-accent);
  font-size: 17px;
}
.imk-dialog-button + .imk-dialog-button { border-left: 1px solid var(--imk-separator); }
.imk-dialog-button-destructive { color: var(--imk-danger); }
.imk-dialog-button-cancel { font-weight: 600; }
.imk-error-banner {
  position: absolute; left: 50%; bottom: 16px; z-index: 15; transform: translateX(-50%); max-width: calc(100% - 32px);
  padding: 10px 14px; border-radius: 10px; background: var(--imk-text); color: var(--imk-surface);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.18); font-size: 14px;
}
`;

interface Injected {
  readonly element: HTMLStyleElement;
  count: number;
}

const injected = new WeakMap<Node, Injected>();

/** Adds the stylesheet next to `root` (its document head, or its shadow root) while the editor is mounted. */
export function useStylesheet(root: RefObject<HTMLElement>, nonce: string | undefined): void {
  // Before the first paint in browsers; on servers, where layout effects only warn, there is nothing to style.
  const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useBrowserLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const owner = element.getRootNode();
    const host: Node | null =
      typeof ShadowRoot !== 'undefined' && owner instanceof ShadowRoot ? owner : (element.ownerDocument?.head ?? null);
    if (!host) return undefined;
    let entry = injected.get(host);
    if (!entry) {
      const style = element.ownerDocument.createElement('style');
      style.setAttribute('data-image-markup-kit', VERSION);
      if (nonce) style.nonce = nonce;
      style.textContent = STYLESHEET;
      host.appendChild(style);
      entry = { element: style, count: 0 };
      injected.set(host, entry);
    }
    entry.count += 1;
    const current = entry;
    return () => {
      current.count -= 1;
      if (current.count === 0) {
        current.element.remove();
        injected.delete(host);
      }
    };
  }, [root, nonce]);
}
