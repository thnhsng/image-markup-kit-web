import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { EditorController, PanelKind } from '../editor/controller';
import { isShapeTool, shapeOfTool } from '../editor/tools';
import { colorComponents, MARKUP_PALETTE, MarkupColors, rgba, type RGBAHex } from '../model/color';
import { modelEquals } from '../model/document';
import type { ArrowHead, DashStyle, FontFamily, ShapeKind, TextAlignment } from '../model/types';
import { swiftRound } from '../model/swift-math';
import { Icon, Swatch, type IconName } from './icons';
import { popupPosition, type Anchor, type RootSize } from './Menu';
import type { MarkupStrings } from './strings';

// The style panels (StylePanels.swift): Shape Style, Border Color, Fill Color and Text Style. They edit the selection,
// or the defaults of the active tool when nothing is selected. Wide editors show them as popovers under their
// button; narrow ones as a sheet at the bottom.

const PANEL_WIDTH = 320;
const CORNER_SHAPES: readonly ShapeKind[] = ['rectangle', 'roundedRectangle', 'highlightBox', 'speechBubble'];
const DASHES: readonly DashStyle[] = ['solid', 'dashed', 'dotted'];
const HEADS: readonly (readonly [ArrowHead, ArrowHead, IconName])[] = [
  ['none', 'none', 'headsNone'],
  ['none', 'arrow', 'headsEnd'],
  ['arrow', 'none', 'headsStart'],
  ['arrow', 'arrow', 'headsBoth'],
];
const ALIGNMENTS: readonly (readonly [TextAlignment, IconName])[] = [
  ['left', 'alignLeft'],
  ['center', 'alignCenter'],
  ['right', 'alignRight'],
];
const FAMILIES: readonly FontFamily[] = ['system', 'rounded', 'serif', 'monospaced', 'hiraginoSans', 'hiraginoMincho'];
const TEXT_COLORS: readonly RGBAHex[] = [
  MarkupColors.black,
  MarkupColors.white,
  MarkupColors.red,
  MarkupColors.orange,
  MarkupColors.yellow,
  MarkupColors.green,
  MarkupColors.blue,
  MarkupColors.purple,
];

interface PanelProps {
  readonly controller: EditorController;
  readonly strings: MarkupStrings;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="imk-row">
      <span className="imk-row-label">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string; readonly content: ReactNode }[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="imk-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          className="imk-segment"
          aria-label={option.label}
          title={option.label}
          aria-checked={modelEquals(option.value, value)}
          onClick={() => onChange(option.value)}
        >
          {option.content}
        </button>
      ))}
    </div>
  );
}

/** A range input that coalesces one drag into one undo step. */
function Slider({
  label,
  min,
  max,
  step,
  value,
  testID,
  onChange,
  onEnd,
}: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly testID?: string;
  readonly onChange: (value: number) => void;
  readonly onEnd: () => void;
}): ReactElement {
  return (
    <input
      type="range"
      className="imk-slider"
      aria-label={label}
      data-testid={testID}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      onPointerUp={onEnd}
      onKeyUp={onEnd}
      onBlur={onEnd}
    />
  );
}

function ShapeStylePanel({ controller, strings }: PanelProps): ReactElement {
  const store = controller.store;
  const style = store.currentStyle;
  const item = store.selectedItem;
  const tool = store.tool;
  // Closed polylines and curves have no ends, so no arrowheads.
  const isLineContext = item
    ? item.type === 'line' && !item.content.isClosed
    : tool === 'arrow' || tool === 'polyline' || tool === 'curve';
  let showsCorners: boolean;
  if (item) showsCorners = (item.type === 'shape' && CORNER_SHAPES.includes(item.content.kind)) || item.type === 'text';
  else if (isShapeTool(tool)) showsCorners = CORNER_SHAPES.includes(shapeOfTool(tool).kind);
  else showsCorners = tool === 'note';
  const heads = store.currentArrowHeads;
  const end = () => store.endCoalescing();
  const width = swiftRound(style.lineWidth);
  return (
    <>
      <Row label={strings.lineWidth}>
        <div className="imk-inline">
          <span className="imk-grow">
            <Slider
              label={strings.lineWidth}
              testID="panel.lineWidth"
              min={1}
              max={40}
              step={1}
              value={Math.min(Math.max(width, 1), 40)}
              onChange={(value) => store.updateStyle((current) => ({ ...current, lineWidth: value }), 'lineWidth')}
              onEnd={end}
            />
          </span>
          <span className="imk-value">{strings.points(width)}</span>
        </div>
      </Row>
      <Row label={strings.lineStyle}>
        <Segmented
          label={strings.lineStyle}
          value={style.dash}
          options={DASHES.map((dash) => ({ value: dash, label: strings[dash], content: strings[dash] }))}
          onChange={(dash) => store.updateStyle((current) => ({ ...current, dash }))}
        />
      </Row>
      {isLineContext ? (
        <Row label={strings.arrowheads}>
          <Segmented
            label={strings.arrowheads}
            value={[heads.start, heads.end] as const}
            options={HEADS.map(([start, endHead, icon]) => ({
              value: [start, endHead] as const,
              label:
                icon === 'headsNone'
                  ? strings.arrowheadsNone
                  : icon === 'headsEnd'
                    ? strings.arrowheadsEnd
                    : icon === 'headsStart'
                      ? strings.arrowheadsStart
                      : strings.arrowheadsBoth,
              content: <Icon name={icon} size={20} />,
            }))}
            onChange={([start, endHead]) => store.updateArrowHeads(start, endHead)}
          />
        </Row>
      ) : null}
      <Row label={strings.opacity}>
        <div className="imk-inline">
          <Icon name="opacity" size={20} />
          <span className="imk-grow">
            <Slider
              label={strings.opacity}
              min={0.1}
              max={1}
              step={0.01}
              value={Math.min(Math.max(style.opacity, 0.1), 1)}
              onChange={(value) => store.updateStyle((current) => ({ ...current, opacity: value }), 'opacity')}
              onEnd={end}
            />
          </span>
        </div>
      </Row>
      {showsCorners ? (
        <Row label={strings.cornerRadius}>
          <Slider
            label={strings.cornerRadius}
            min={0}
            max={60}
            step={1}
            value={Math.min(Math.max(swiftRound(style.cornerRadius), 0), 60)}
            onChange={(value) => store.updateStyle((current) => ({ ...current, cornerRadius: value }), 'cornerRadius')}
            onEnd={end}
          />
        </Row>
      ) : null}
      <label className="imk-switch-row">
        <span className="imk-row-label">{strings.shadow}</span>
        <input
          type="checkbox"
          role="switch"
          className="imk-switch"
          checked={style.shadow}
          onChange={(event) => {
            const shadow = event.currentTarget.checked;
            store.updateStyle((current) => ({ ...current, shadow }));
          }}
        />
      </label>
    </>
  );
}

function hexOf(color: RGBAHex): string {
  return color.slice(0, 7).toLowerCase();
}

function ColorPanel({ controller, strings, fill }: PanelProps & { readonly fill: boolean }): ReactElement {
  const store = controller.store;
  const style = store.currentStyle;
  const current = fill ? style.fillColor : style.strokeColor;
  // Lines, strokes and plain text need their color: "None" only where it makes sense.
  let allowsNone: boolean;
  const item = store.selectedItem;
  if (fill) allowsNone = true;
  else if (item) allowsNone = item.type === 'shape' || item.type === 'image' || item.type === 'text';
  else allowsNone = isShapeTool(store.tool) || ['text', 'note', 'select'].includes(store.tool);

  const apply = (color: RGBAHex | null, coalescingKey?: string) => {
    if (fill) {
      store.updateStyle((value) => ({ ...value, fillColor: color }), coalescingKey);
    } else {
      store.updateStyle(
        (value) => ({
          ...value,
          strokeColor: color,
          lineWidth: color !== null && value.lineWidth <= 0 ? 4 : value.lineWidth,
        }),
        coalescingKey,
      );
    }
  };
  const colors: (RGBAHex | null)[] = [null, ...MARKUP_PALETTE];
  return (
    <>
      <div className="imk-swatches" role="group" aria-label={fill ? strings.fillColor : strings.borderColor}>
        {colors.map((color) => (
          <button
            key={color ?? 'none'}
            type="button"
            className="imk-swatch-button"
            aria-label={color ?? strings.noColor}
            title={color ?? strings.noColor}
            aria-pressed={color === current}
            disabled={color === null && !allowsNone}
            data-testid={color === null ? 'panel.noColor' : undefined}
            onClick={() => apply(color)}
          >
            <Swatch color={color} filled size={40} />
          </button>
        ))}
      </div>
      <label className="imk-custom-color">
        <Icon name="customColor" size={20} />
        <span>{strings.customColor}</span>
        <input
          type="color"
          aria-label={strings.customColor}
          value={current ? hexOf(current) : '#ff3b30'}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const parsed = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
            if (!parsed) return;
            const alpha = current ? colorComponents(current).alpha : 1;
            const [, r, g, b] = parsed;
            apply(
              rgba(parseInt(r ?? '0', 16) / 255, parseInt(g ?? '0', 16) / 255, parseInt(b ?? '0', 16) / 255, alpha),
              'colorPicker',
            );
          }}
          onBlur={() => store.endCoalescing()}
        />
      </label>
    </>
  );
}

function TextStylePanel({ controller, strings }: PanelProps): ReactElement {
  const store = controller.store;
  const content = store.currentTextContent;
  const font = content.font;
  const end = () => store.endCoalescing();
  const size = swiftRound(font.size);
  const setSize = (value: number) =>
    store.updateText((current) => ({ ...current, font: { ...current.font, size: value } }), 'fontSize');
  return (
    <>
      <Row label={strings.font}>
        <select
          className="imk-select"
          aria-label={strings.font}
          value={font.family}
          onChange={(event) => {
            const family = event.currentTarget.value as FontFamily;
            store.updateText((current) => ({ ...current, font: { ...current.font, family } }));
          }}
        >
          {FAMILIES.map((family) => (
            <option key={family} value={family}>
              {strings.fontFamilyNames[family]}
            </option>
          ))}
        </select>
      </Row>
      <Row label={strings.fontSize}>
        <div className="imk-inline">
          <span className="imk-grow">
            <Slider
              label={strings.fontSize}
              testID="panel.fontSize"
              min={8}
              max={200}
              step={1}
              value={Math.min(Math.max(size, 8), 200)}
              onChange={setSize}
              onEnd={end}
            />
          </span>
          <span className="imk-value">{size}</span>
          <button
            type="button"
            className="imk-toggle"
            aria-label={strings.smaller}
            title={strings.smaller}
            disabled={font.size <= 8}
            onClick={() => setSize(Math.max(8, font.size - 2))}
          >
            <Icon name="minus" size={18} />
          </button>
          <button
            type="button"
            className="imk-toggle"
            aria-label={strings.larger}
            title={strings.larger}
            disabled={font.size >= 400}
            onClick={() => setSize(Math.min(400, font.size + 2))}
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
      </Row>
      <Row label={strings.alignment}>
        <div className="imk-inline">
          <button
            type="button"
            className="imk-toggle"
            aria-label={strings.bold}
            title={strings.bold}
            aria-pressed={font.bold}
            onClick={() =>
              store.updateText((current) => ({ ...current, font: { ...current.font, bold: !current.font.bold } }))
            }
          >
            <Icon name="bold" size={18} />
          </button>
          <button
            type="button"
            className="imk-toggle"
            aria-label={strings.italic}
            title={strings.italic}
            aria-pressed={font.italic}
            onClick={() =>
              store.updateText((current) => ({ ...current, font: { ...current.font, italic: !current.font.italic } }))
            }
          >
            <Icon name="italic" size={18} />
          </button>
          <span className="imk-grow">
            <Segmented
              label={strings.alignment}
              value={content.alignment}
              options={ALIGNMENTS.map(([alignment, icon]) => ({
                value: alignment,
                label:
                  alignment === 'left'
                    ? strings.alignLeft
                    : alignment === 'center'
                      ? strings.alignCenter
                      : strings.alignRight,
                content: <Icon name={icon} size={18} />,
              }))}
              onChange={(alignment) => store.updateText((current) => ({ ...current, alignment }))}
            />
          </span>
        </div>
      </Row>
      <Row label={strings.textColor}>
        <div className="imk-swatches imk-swatches-text" role="group" aria-label={strings.textColor}>
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="imk-swatch-button"
              aria-label={color}
              title={color}
              aria-pressed={color === content.color}
              onClick={() => store.updateText((current) => ({ ...current, color }))}
            >
              <Swatch color={color} filled size={32} />
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}

const TITLES: Readonly<Record<PanelKind, keyof MarkupStrings>> = {
  shapeStyle: 'shapeStyle',
  borderColor: 'borderColor',
  fillColor: 'fillColor',
  textStyle: 'textStyle',
};

/** The open panel: a popover under its toolbar button, or a sheet at the bottom of narrow editors. */
export function PanelHost({
  controller,
  strings,
  kind,
  anchor,
  root,
  sheet,
  onClose,
}: PanelProps & {
  readonly kind: PanelKind;
  readonly anchor: Anchor | null;
  readonly root: RootSize;
  readonly sheet: boolean;
  readonly onClose: () => void;
}): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    element.current?.focus({ preventScroll: true });
  }, [kind]);
  const title = strings[TITLES[kind]] as string;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  let body: ReactElement;
  switch (kind) {
    case 'shapeStyle':
      body = <ShapeStylePanel controller={controller} strings={strings} />;
      break;
    case 'borderColor':
    case 'fillColor':
      body = <ColorPanel controller={controller} strings={strings} fill={kind === 'fillColor'} />;
      break;
    case 'textStyle':
      body = <TextStylePanel controller={controller} strings={strings} />;
      break;
  }
  const position = !sheet && anchor ? popupPosition(anchor, PANEL_WIDTH, root) : null;
  return (
    <div
      ref={element}
      className={sheet ? 'imk-sheet' : 'imk-panel'}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-testid={`panel.${kind}`}
      style={position ?? undefined}
      onKeyDown={onKeyDown}
    >
      {sheet ? <div className="imk-grabber" aria-hidden="true" /> : null}
      <div className="imk-panel-header">
        <span className="imk-panel-title">{title}</span>
        <button
          type="button"
          className="imk-icon-button imk-panel-close"
          aria-label={strings.close}
          title={strings.close}
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {body}
    </div>
  );
}
