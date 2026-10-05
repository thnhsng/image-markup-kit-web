import { createRef } from 'react';
import { MarkupEditor, VERSION, createBoardDocument, parseHexColor } from 'image-markup-kit';
import type { MarkupEditorHandle, MarkupEditorProps, MarkupResult, RGBAHex } from 'image-markup-kit';

const red: RGBAHex | null = parseHexColor('#FF3B30');
const handle = createRef<MarkupEditorHandle>();
const props: MarkupEditorProps = {
  document: createBoardDocument(),
  assets: {},
  className: 'editor',
  configuration: { locale: 'ja', navigationTexts: { done: 'Save' } },
  onDone: async (result: MarkupResult) => {
    await result.blob.arrayBuffer();
  },
  onCancel: () => undefined,
};

export default function App() {
  return (
    <div style={{ height: 600 }}>
      <p>
        image-markup-kit {VERSION} {red}
      </p>
      <MarkupEditor ref={handle} {...props} />
    </div>
  );
}
