import { memo, useMemo, type ReactElement } from 'react';
import type { Affine } from '../geometry/affine';
import { pathToSVG } from '../geometry/path';
import type { MarkupDocument, MarkupItem } from '../model/types';
import { cssColor } from '../render/canvas-backend';
import {
  IMAGE_PLACEHOLDER,
  displayItem,
  needsLayer,
  type DisplayEnvironment,
  type DisplayNode,
} from '../render/display-list';

// Draws display lists as SVG (the on-screen counterpart of the canvas exporter): one <g> per item, in canvas units.

function matrix(transform: Affine): string {
  return `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.tx} ${transform.ty})`;
}

function Node({
  node,
  images,
}: {
  readonly node: DisplayNode;
  readonly images: ReadonlyMap<string, string>;
}): ReactElement | null {
  switch (node.kind) {
    case 'group':
      return (
        <g transform={node.transform ? matrix(node.transform) : undefined}>
          {node.children.map((child, index) => (
            <Node key={index} node={child} images={images} />
          ))}
        </g>
      );
    case 'path': {
      const stroke = node.stroke;
      return (
        <path
          d={pathToSVG(node.path)}
          fill={node.fill ? cssColor(node.fill) : 'none'}
          stroke={stroke ? cssColor(stroke.color) : undefined}
          strokeWidth={stroke ? stroke.width : undefined}
          strokeLinejoin={stroke ? stroke.join : undefined}
          strokeLinecap={stroke ? stroke.cap : undefined}
          strokeMiterlimit={stroke ? stroke.miterLimit : undefined}
          strokeDasharray={stroke?.dash ? stroke.dash.join(' ') : undefined}
        />
      );
    }
    case 'text':
      return (
        <g fill={cssColor(node.color)} style={{ font: node.font }}>
          {node.lines.map((line, index) => (
            <text key={index} x={line.x} y={line.baseline} xmlSpace="preserve" style={{ whiteSpace: 'pre' }}>
              {line.text}
            </text>
          ))}
        </g>
      );
    case 'image': {
      const url = images.get(node.assetID);
      return url ? (
        <image href={url} x={0} y={0} width={node.width} height={node.height} preserveAspectRatio="xMidYMid slice" />
      ) : (
        <rect x={0} y={0} width={node.width} height={node.height} fill={cssColor(IMAGE_PLACEHOLDER)} />
      );
    }
  }
}

/** Stands in for the document of items that do not depend on it, so their memoized views keep their output. */
const NO_DOCUMENT: MarkupDocument = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000000',
  kind: 'board',
  backgroundItemID: null,
  backgroundColor: '#FFFFFFFF',
  items: [],
};

interface ItemProps {
  readonly item: MarkupItem;
  /** The document for lines (their bound ends follow other items), `NO_DOCUMENT` for the rest. */
  readonly document: MarkupDocument;
  readonly env: DisplayEnvironment;
  readonly images: ReadonlyMap<string, string>;
  readonly shadowFilter: string;
}

const ItemView = memo(function ItemView({ item, document, env, images, shadowFilter }: ItemProps): ReactElement {
  const display = useMemo(() => displayItem(item, document, env), [item, document, env]);
  const content = <Node node={display.content} images={images} />;
  if (!needsLayer(display)) return <g data-item-id={item.id}>{content}</g>;
  return (
    <g
      data-item-id={item.id}
      opacity={display.opacity < 0.999 ? display.opacity : undefined}
      filter={display.shadow ? `url(#${shadowFilter})` : undefined}
    >
      {content}
    </g>
  );
});

/** The items of a document, bottom to top, minus the hidden ones. */
export function ItemsLayer({
  document,
  hidden,
  env,
  images,
  shadowFilter,
}: {
  readonly document: MarkupDocument;
  readonly hidden: readonly string[];
  readonly env: DisplayEnvironment;
  readonly images: ReadonlyMap<string, string>;
  readonly shadowFilter: string;
}): ReactElement {
  const hiddenSet = new Set(hidden);
  return (
    <>
      {document.items.map((item) =>
        hiddenSet.has(item.id) ? null : (
          <ItemView
            key={item.id}
            item={item}
            document={item.type === 'line' ? document : NO_DOCUMENT}
            env={env}
            images={images}
            shadowFilter={shadowFilter}
          />
        ),
      )}
    </>
  );
}
