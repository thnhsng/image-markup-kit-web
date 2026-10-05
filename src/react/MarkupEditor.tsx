import type { CSSProperties, ReactElement } from 'react';

/** Placeholder until the editor lands; it lets the packaging checks exercise a React component end to end. */
export interface MarkupEditorProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function MarkupEditor(props: MarkupEditorProps): ReactElement {
  return <div className={props.className} style={props.style} data-testid="markup.editor" />;
}
