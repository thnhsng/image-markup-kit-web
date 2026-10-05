import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { Icon } from './icons';

// Pop-up menus of the toolbar (UIMenu): a list of entries under (or above) their button, inside the editor root.
// Arrow keys move between entries, Escape and a press outside close it.

export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Single-selection menus mark the current entry. */
  readonly checked?: boolean;
  readonly testID?: string;
  /** Draws a separator above the entry. */
  readonly separated?: boolean;
}

/** Where a menu or panel opens: its button, in coordinates of the editor root. */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Open above the button (bottom toolbar) instead of below it. */
  readonly above: boolean;
}

export function anchorFor(button: HTMLElement, root: HTMLElement, above: boolean): Anchor {
  const buttonRect = button.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    x: buttonRect.left - rootRect.left,
    y: buttonRect.top - rootRect.top,
    width: buttonRect.width,
    height: buttonRect.height,
    above,
  };
}

export interface RootSize {
  readonly width: number;
  readonly height: number;
}

/** Position of a pop-up of `width` next to its anchor, kept inside the editor root. */
export function popupPosition(
  anchor: Anchor,
  width: number,
  root: RootSize,
): { left: number; top?: number; bottom?: number } {
  const left = Math.min(Math.max(anchor.x + anchor.width / 2 - width / 2, 8), Math.max(root.width - width - 8, 8));
  return anchor.above ? { left, bottom: root.height - anchor.y + 6 } : { left, top: anchor.y + anchor.height + 6 };
}

export function Menu({
  title,
  entries,
  anchor,
  root,
  testID,
  onSelect,
  onClose,
}: {
  readonly title: string;
  readonly entries: readonly MenuEntry[];
  readonly anchor: Anchor;
  readonly root: RootSize;
  readonly testID?: string;
  /** An entry was chosen (the menu closes first). */
  readonly onSelect: (key: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
    const checked = list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    const index = items.findIndex((item) => item === item.ownerDocument.activeElement);
    let next: number | null = null;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  const position = popupPosition(anchor, 240, root);
  const single = entries.some((entry) => entry.checked !== undefined);
  return (
    <>
      <div
        className="imk-menu-backdrop"
        style={{ position: 'absolute', inset: 0, zIndex: 9 }}
        onPointerDown={onClose}
      />
      <div
        ref={list}
        className="imk-menu"
        role="menu"
        aria-label={title}
        data-testid={testID}
        style={{ ...position, width: 240 }}
        onKeyDown={onKeyDown}
      >
        <div className="imk-menu-title" aria-hidden="true">
          {title}
        </div>
        {entries.map((entry) => (
          <div key={entry.key}>
            {entry.separated ? <div className="imk-menu-separator" role="separator" /> : null}
            <button
              type="button"
              className="imk-menu-item"
              role={single ? 'menuitemradio' : 'menuitem'}
              aria-checked={single ? entry.checked === true : undefined}
              data-testid={entry.testID}
              onClick={() => {
                onClose();
                onSelect(entry.key);
              }}
            >
              {entry.icon}
              <span className="imk-menu-item-label">{entry.label}</span>
              {single ? (
                <span className="imk-menu-check" aria-hidden="true">
                  <Icon name="finishPath" size={16} />
                </span>
              ) : null}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
