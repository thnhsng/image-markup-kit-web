import type { ReactElement, RefObject } from 'react';
import type { EditorController } from '../editor/controller';
import { actionBarOrigin, type SelectionAction } from '../editor/overlay';
import { Icon, PathIcon, type IconName } from './icons';
import type { MarkupStrings } from './strings';

// The floating bar of actions above the selection (SelectionActionBar.swift). Hidden during gestures.

const ICONS: Partial<Readonly<Record<SelectionAction, IconName>>> = {
  editText: 'editText',
  duplicate: 'duplicate',
  bringToFront: 'bringToFront',
  sendToBack: 'sendToBack',
  lock: 'lock',
  unlock: 'unlock',
  delete: 'delete',
  finishPath: 'finishPath',
  deletePoint: 'deletePoint',
};

function ActionIcon({ action }: { readonly action: SelectionAction }): ReactElement {
  if (action === 'closePath') return <PathIcon closed />;
  if (action === 'openPath') return <PathIcon closed={false} />;
  return <Icon name={ICONS[action] ?? 'finishPath'} />;
}

export function ActionBar({
  controller,
  strings,
  textEditorRef,
}: {
  readonly controller: EditorController;
  readonly strings: MarkupStrings;
  readonly textEditorRef: RefObject<HTMLTextAreaElement>;
}): ReactElement | null {
  const overlay = controller.overlay;
  if (!overlay || controller.isInteracting || controller.isExporting) return null;
  const origin = actionBarOrigin(overlay, controller.viewport.size);
  if (!origin) return null;
  return (
    <div
      className="imk-action-bar"
      role="toolbar"
      aria-label={strings.toolSelect}
      data-testid="markup.actionBar"
      style={{ left: origin.x, top: origin.y }}
    >
      {overlay.actions.map((action) => (
        <button
          key={action}
          type="button"
          className={`imk-icon-button${action === 'delete' ? ' imk-action-danger' : ''}${
            action === 'finishPath' ? ' imk-action-accent' : ''
          }`}
          aria-label={strings.actions[action]}
          title={strings.actions[action]}
          data-testid={`action.${action}`}
          onClick={() => {
            controller.performAction(action);
            // Inside the click, so phones show the keyboard.
            if (controller.isEditingText()) textEditorRef.current?.focus({ preventScroll: true });
          }}
        >
          <ActionIcon action={action} />
        </button>
      ))}
    </div>
  );
}
