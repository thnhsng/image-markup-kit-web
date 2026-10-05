// Uses every export, so a declaration TypeScript 4.9 cannot read fails this check.
import { MarkupEditor, VERSION, parseHexColor } from 'image-markup-kit';
import type { MarkupEditorProps, RGBAHex } from 'image-markup-kit';

const version: string = VERSION;
const color: RGBAHex | null = parseHexColor('#FF3B30');
const props: MarkupEditorProps = { className: 'editor', style: { width: 100 } };
export const element = <MarkupEditor {...props} />;
export { version, color };
