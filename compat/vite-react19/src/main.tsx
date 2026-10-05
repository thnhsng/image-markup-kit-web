import { createRoot } from 'react-dom/client';
import { MarkupEditor, VERSION, parseHexColor } from 'image-markup-kit';

createRoot(document.getElementById('root')!).render(
  <div>
    <p>
      image-markup-kit {VERSION} {parseHexColor('#FF3B30')}
    </p>
    <MarkupEditor className="editor" />
  </div>,
);
