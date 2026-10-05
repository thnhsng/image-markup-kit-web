import type { CSSProperties, KeyboardEvent, ReactElement, RefObject } from 'react';
import type { EditorController } from '../editor/controller';
import { cssColor } from '../render/canvas-backend';
import { resolveFontStack, type FontStacks } from '../text/font-stacks';
import { lineMetrics } from '../text/metrics';
import { Icon } from './icons';
import type { MarkupStrings } from './strings';

// Text is typed in place in a textarea laid over the box (TextEditingController.swift): font, padding and border
// scaled by the zoom, edited unrotated. The textarea stays mounted so a tap can focus it right away, which is what
// makes phones show their keyboard.

const ACCESSORY_HEIGHT = 44;
const ACCESSORY_WIDTH = 4 * 44 + 3 * 2 + 8 + 30;

export function TextEditor({
  controller,
  strings,
  doneTitle,
  fontStacks,
  textEditorRef,
  onEscape,
}: {
  readonly controller: EditorController;
  readonly strings: MarkupStrings;
  /** The title of the accessory bar's Done button. */
  readonly doneTitle: string;
  readonly fontStacks: FontStacks | undefined;
  readonly textEditorRef: RefObject<HTMLTextAreaElement>;
  /** Escape in the text box: the editor takes the focus back (which ends the edit). */
  readonly onEscape: () => void;
}): ReactElement {
  const session = controller.textEditing;
  const content = controller.editingContent;
  const style = controller.editingStyle;
  const frame = controller.editingFrame;
  const editing = session !== null && content !== null && style !== null && frame !== null;
  let css: CSSProperties | undefined;
  if (editing) {
    const zoom = controller.viewport.zoom;
    const stroke = style.strokeColor !== null && style.lineWidth > 0 ? style.strokeColor : null;
    const stack = resolveFontStack(content.font.family, fontStacks);
    css = {
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      fontFamily: stack.family,
      fontWeight: content.font.bold ? stack.boldWeight : stack.regularWeight,
      fontStyle: content.font.italic ? 'italic' : 'normal',
      fontSize: Math.max(content.font.size, 1) * zoom,
      lineHeight: `${lineMetrics(content.font).lineHeight * zoom}px`,
      color: cssColor(content.color),
      textAlign: content.alignment,
      padding: content.padding * zoom,
      // Auto-width text never wraps while typing: the box grows instead.
      whiteSpace: content.fixedWidth === null ? 'pre' : 'pre-wrap',
      background: style.fillColor !== null ? cssColor(style.fillColor) : 'rgba(255, 255, 255, 0.35)',
      borderWidth: 0,
      borderRadius: Math.min(style.cornerRadius * zoom, frame.height / 2),
      boxShadow: stroke
        ? `inset 0 0 0 ${style.lineWidth * zoom}px ${cssColor(stroke)}`
        : 'inset 0 0 0 1px var(--imk-accent)',
      opacity: Math.max(style.opacity, 0.3),
    };
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };

  return (
    <>
      <textarea
        ref={textEditorRef}
        className={editing ? 'imk-text-editor' : 'imk-text-editor imk-text-editor-idle'}
        data-testid="markup.textEditor"
        aria-label={strings.toolText}
        aria-hidden={editing ? undefined : true}
        tabIndex={editing ? 0 : -1}
        value={session?.text ?? ''}
        rows={1}
        spellCheck
        style={css}
        onChange={(event) => controller.setEditingText(event.currentTarget.value)}
        onBlur={() => controller.endTextEditing()}
        onKeyDown={onKeyDown}
      />
      {editing ? (
        <Accessory
          controller={controller}
          strings={strings}
          doneTitle={doneTitle}
          bold={content.font.bold}
          textEditorRef={textEditorRef}
          frame={frame}
        />
      ) : null}
    </>
  );
}

/** A−, A+, B and Done, above the box (the bar iOS shows above the keyboard). */
function Accessory({
  controller,
  strings,
  doneTitle,
  bold,
  textEditorRef,
  frame,
}: {
  readonly controller: EditorController;
  readonly strings: MarkupStrings;
  readonly doneTitle: string;
  readonly bold: boolean;
  readonly textEditorRef: RefObject<HTMLTextAreaElement>;
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}): ReactElement {
  const size = controller.viewport.size;
  const visibleHeight = size.height - controller.viewport.keyboardInset;
  let top = frame.y - ACCESSORY_HEIGHT - 8;
  if (top < 8) top = frame.y + frame.height + 8;
  top = Math.min(Math.max(top, 8), Math.max(visibleHeight - ACCESSORY_HEIGHT - 8, 8));
  const left = Math.min(
    Math.max(frame.x + frame.width / 2 - ACCESSORY_WIDTH / 2, 8),
    Math.max(size.width - ACCESSORY_WIDTH - 8, 8),
  );
  // Buttons must not take the focus from the text box. The focus moves on the (compatibility) mouse down, also after a
  // tap; preventing the pointer down instead would cancel the tap's click in WebKit.
  const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();
  return (
    <div
      className="imk-accessory"
      role="toolbar"
      aria-label={strings.textStyle}
      data-testid="markup.textAccessory"
      style={{ left, top }}
      onMouseDown={keepFocus}
    >
      <button
        type="button"
        className="imk-icon-button"
        aria-label={strings.smaller}
        title={strings.smaller}
        onClick={() => controller.adjustEditingFontSize(false)}
      >
        <Icon name="smaller" />
      </button>
      <button
        type="button"
        className="imk-icon-button"
        aria-label={strings.larger}
        title={strings.larger}
        onClick={() => controller.adjustEditingFontSize(true)}
      >
        <Icon name="larger" />
      </button>
      <button
        type="button"
        className="imk-icon-button"
        aria-label={strings.bold}
        aria-pressed={bold}
        title={strings.bold}
        onClick={() => controller.toggleEditingBold()}
      >
        <Icon name="bold" />
      </button>
      <button
        type="button"
        className="imk-text-button imk-text-button-strong"
        onClick={() => {
          const textarea = textEditorRef.current;
          if (textarea && textarea.ownerDocument.activeElement === textarea) textarea.blur();
          else controller.endTextEditing();
        }}
      >
        {doneTitle}
      </button>
    </div>
  );
}
