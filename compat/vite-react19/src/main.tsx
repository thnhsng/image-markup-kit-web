import { createRoot } from 'react-dom/client';
import { MarkupEditor, VERSION, createBoardDocument, parseHexColor } from 'image-markup-kit';

createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100vh' }}>
    <p>
      image-markup-kit {VERSION} {parseHexColor('#FF3B30')}
    </p>
    <MarkupEditor
      className="editor"
      document={createBoardDocument()}
      assets={{}}
      onDone={(result) => console.log(result.pixelSize)}
      onCancel={() => undefined}
    />
  </div>,
);
