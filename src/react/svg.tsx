import { memo, useMemo, type ReactElement } from 'react';
import type { Affine } from '../geometry/affine';
import { visualBounds } from '../geometry/item-geometry';
import { pathToSVG } from '../geometry/path';
import { insetRect } from '../geometry/rect';
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

/**
 * An empty document: what the editor shows while its photos load, and what stands in for the document of items that
 * do not depend on it, so their memoized views keep their output.
 */
export const EMPTY_DOCUMENT: MarkupDocument = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000000',
  kind: 'board',
  backgroundItemID: null,
  backgroundColor: '#FFFFFFFF',
  items: [],
};

/** Room around an item's visual bounds for the blur of its shadow (3 units down, deviation 4). */
const SHADOW_MARGIN = 12;

interface ItemProps {
  readonly item: MarkupItem;
  /** The document for lines (their bound ends follow other items), `EMPTY_DOCUMENT` for the rest. */
  readonly document: MarkupDocument;
  readonly env: DisplayEnvironment;
  readonly images: ReadonlyMap<string, string>;
  /** Prefix of the ids of shadow filters, unique to the canvas. */
  readonly idPrefix: string;
}

const ItemView = memo(function ItemView({ item, document, env, images, idPrefix }: ItemProps): ReactElement {
  const display = useMemo(() => displayItem(item, document, env), [item, document, env]);
  // The shadow region is given in canvas units: in bounding-box units a horizontal line, whose box has no height,
  // would have an empty region and not be drawn at all.
  const region = useMemo(
    () => (item.style.shadow ? insetRect(visualBounds(item, document), -SHADOW_MARGIN, -SHADOW_MARGIN) : null),
    [item, document],
  );
  const content = <Node node={display.content} images={images} />;
  if (!needsLayer(display)) return <g data-item-id={item.id}>{content}</g>;
  const filterID = `${idPrefix}-${item.id}`;
  return (
    <g
      data-item-id={item.id}
      opacity={display.opacity < 0.999 ? display.opacity : undefined}
      filter={region ? `url(#${filterID})` : undefined}
    >
      {region ? (
        <filter
          id={filterID}
          filterUnits="userSpaceOnUse"
          x={region.x}
          y={region.y}
          width={region.width}
          height={region.height}
        >
          <feDropShadow dx={0} dy={3} stdDeviation={4} floodColor="#000000" floodOpacity={0.3} />
        </filter>
      ) : null}
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
  idPrefix,
}: {
  readonly document: MarkupDocument;
  readonly hidden: readonly string[];
  readonly env: DisplayEnvironment;
  readonly images: ReadonlyMap<string, string>;
  readonly idPrefix: string;
}): ReactElement {
  const hiddenSet = new Set(hidden);
  return (
    <>
      {document.items.map((item) =>
        hiddenSet.has(item.id) ? null : (
          <ItemView
            key={item.id}
            item={item}
            document={item.type === 'line' ? document : EMPTY_DOCUMENT}
            env={env}
            images={images}
            idPrefix={idPrefix}
          />
        ),
      )}
    </>
  );
}
