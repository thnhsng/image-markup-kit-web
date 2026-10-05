import { useId, type KeyboardEvent, type ReactElement } from 'react';
import { Icon } from './icons';
import type { MarkupNavigationTexts, MarkupStrings } from './strings';

// The navigation bar (Cancel, title, Undo, Redo, Done) and the dialog Cancel shows when there are unsaved changes.

export function Header({
  title,
  texts,
  strings,
  undoTitle,
  redoTitle,
  canUndo,
  canRedo,
  busy,
  ready,
  onCancel,
  onUndo,
  onRedo,
  onDone,
}: {
  readonly title: string;
  readonly texts: MarkupNavigationTexts;
  readonly strings: MarkupStrings;
  readonly undoTitle: string;
  readonly redoTitle: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Exporting: Done turns into a spinner and the buttons are off. */
  readonly busy: boolean;
  /** False while the photos load (or when they could not be opened): Done is off. */
  readonly ready: boolean;
  readonly onCancel: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onDone: () => void;
}): ReactElement {
  return (
    <div className="imk-header" data-testid="markup.header">
      <div className="imk-header-side">
        <button
          type="button"
          className="imk-text-button"
          data-testid="markup.cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {texts.cancel}
        </button>
      </div>
      <div className="imk-header-title" role="heading" aria-level={2}>
        {title}
      </div>
      <div className="imk-header-side imk-header-side-end">
        <button
          type="button"
          className="imk-icon-button"
          data-testid="markup.undo"
          aria-label={undoTitle}
          title={undoTitle}
          disabled={!canUndo || busy}
          onClick={onUndo}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="imk-icon-button"
          data-testid="markup.redo"
          aria-label={redoTitle}
          title={redoTitle}
          disabled={!canRedo || busy}
          onClick={onRedo}
        >
          <Icon name="redo" />
        </button>
        {busy ? (
          <span className="imk-icon-button" role="status" aria-label={strings.exporting} data-testid="markup.exporting">
            <span className="imk-spinner">
              <Icon name="spinner" />
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="imk-text-button imk-text-button-strong"
            data-testid="markup.done"
            disabled={!ready}
            onClick={onDone}
          >
            {texts.done}
          </button>
        )}
      </div>
    </div>
  );
}

export function DiscardDialog({
  texts,
  onDiscard,
  onKeepEditing,
}: {
  readonly texts: MarkupNavigationTexts;
  readonly onDiscard: () => void;
  readonly onKeepEditing: () => void;
}): ReactElement {
  const titleID = useId();
  const messageID = useId();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onKeepEditing();
  };
  return (
    <div
      className="imk-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onKeepEditing();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="imk-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleID}
        aria-describedby={messageID}
        data-testid="markup.discardDialog"
      >
        <div className="imk-dialog-body">
          <h2 className="imk-dialog-title" id={titleID}>
            {texts.discardTitle}
          </h2>
          <p className="imk-dialog-message" id={messageID}>
            {texts.discardMessage}
          </p>
        </div>
        <div className="imk-dialog-buttons">
          <button type="button" className="imk-dialog-button imk-dialog-button-destructive" onClick={onDiscard}>
            {texts.discard}
          </button>
          <button
            type="button"
            className="imk-dialog-button imk-dialog-button-cancel"
            // The safe choice takes the focus, as the cancel action of an alert does.
            autoFocus
            onClick={onKeepEditing}
          >
            {texts.keepEditing}
          </button>
        </div>
      </div>
    </div>
  );
}
