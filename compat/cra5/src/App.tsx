import { MarkupEditor, VERSION, parseHexColor } from 'image-markup-kit';
import type { MarkupEditorProps, RGBAHex } from 'image-markup-kit';

const red: RGBAHex | null = parseHexColor('#FF3B30');
const props: MarkupEditorProps = { className: 'editor' };

export default function App() {
  return (
    <div>
      <p>
        image-markup-kit {VERSION} {red}
      </p>
      <MarkupEditor {...props} />
    </div>
  );
}
