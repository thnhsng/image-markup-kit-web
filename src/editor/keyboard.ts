import type { MarkupFeatures } from '../features/features';
import type { MarkupTool } from './tools';

// Keyboard shortcuts (the iPad hardware keyboard commands of the Swift package). ⌘ on Apple platforms, Ctrl
// elsewhere; Ctrl+Y also redoes. Shortcuts are off while text is being edited.

export type KeyCommand =
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'zoomToFit' }
  | { readonly type: 'escape' }
  | { readonly type: 'duplicate' }
  | { readonly type: 'delete' }
  | { readonly type: 'tool'; readonly tool: MarkupTool };

export interface KeyInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** IME composition in progress (also keyCode 229): never a shortcut. */
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

const TOOL_KEYS: Readonly<Record<string, MarkupTool>> = {
  v: 'select',
  p: 'pen',
  h: 'highlighter',
  a: 'arrow',
  l: 'polyline',
  c: 'curve',
  t: 'text',
  n: 'note',
  e: 'eraser',
};

/** The command for a key press, or null. `apple`: ⌘ is the command key (macOS, iOS), otherwise Ctrl is. */
export function keyCommand(input: KeyInput, features: MarkupFeatures, apple: boolean): KeyCommand | null {
  if (input.isComposing || input.keyCode === 229) return null;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const command = apple ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
  if (command && !input.altKey) {
    if (key === 'z') return input.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y' && !apple && !input.shiftKey) return { type: 'redo' };
    if (key === '0' && !input.shiftKey) return { type: 'zoomToFit' };
    if (key === 'd' && !input.shiftKey && features.isEnabled('duplicate')) return { type: 'duplicate' };
    return null;
  }
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if (key === 'Escape') return { type: 'escape' };
  if ((key === 'Delete' || key === 'Backspace') && features.isEnabled('delete')) return { type: 'delete' };
  if (input.shiftKey) return null;
  const tool = TOOL_KEYS[key];
  return tool && features.allows(tool) ? { type: 'tool', tool } : null;
}

/** Whether ⌘ (not Ctrl) is the command key on this platform. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';
  return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X/.test(navigator.userAgent);
}
