import { useState, type ReactElement, type ReactNode } from 'react';
import type { PanelKind, ToolbarState } from '../editor/controller';
import {
  isLineTool,
  isShapeTool,
  LINE_TOOLS,
  SHAPE_TOOLS,
  type LineTool,
  type MarkupTool,
  type ShapeTool,
} from '../editor/tools';
import type { MarkupFeatures } from '../features/features';
import { Icon, LineToolIcon, LineWeightIcon, ShapeIcon, Swatch, type IconName } from './icons';
import type { MarkupStrings } from './strings';

// The markup toolbar, modelled on macOS Preview (MarkupToolbar.swift): tools, board actions, then style buttons.
// One row on top in wide editors; two rows at the bottom in narrow ones (tools, then styles and board actions).
// Only what the features allow is shown, and a menu left with one entry becomes a plain button for it.

export type ToolbarMenuKind = 'shapes' | 'lines' | 'addImages' | 'arrange';
export type AddImageSource = 'photoLibrary' | 'camera';

export interface ToolbarProps {
  readonly state: ToolbarState;
  readonly features: MarkupFeatures;
  readonly strings: MarkupStrings;
  readonly placement: 'top' | 'bottom';
  readonly isBoard: boolean;
  readonly cameraAvailable: boolean;
  /** The open menu, to mark its button. */
  readonly openMenu: ToolbarMenuKind | null;
  readonly openPanel: PanelKind | null;
  readonly disabled: boolean;
  readonly onSelectTool: (tool: MarkupTool) => void;
  readonly onOpenMenu: (kind: ToolbarMenuKind, button: HTMLElement) => void;
  readonly onTogglePanel: (kind: PanelKind, button: HTMLElement) => void;
  readonly onAddImages: (source: AddImageSource) => void;
}

/** Shape tools the features allow, in menu order. */
export function shapeEntries(features: MarkupFeatures): ShapeTool[] {
  return SHAPE_TOOLS.filter((tool) => features.isEnabled(tool));
}

/** Line tools the features allow, in menu order. */
export function lineEntries(features: MarkupFeatures): LineTool[] {
  return LINE_TOOLS.filter((tool) => features.allows(tool));
}

/** Photo sources of the Add Images button. */
export function addImageSources(features: MarkupFeatures, cameraAvailable: boolean): AddImageSource[] {
  const sources: AddImageSource[] = [];
  if (features.isEnabled('photoLibrary')) sources.push('photoLibrary');
  if (features.isEnabled('camera') && cameraAvailable) sources.push('camera');
  return sources;
}

interface ButtonSpec {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly selected?: boolean;
  readonly menu?: ToolbarMenuKind;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly onPress: (button: HTMLElement) => void;
}

function ToolbarButton({ spec, disabled }: { readonly spec: ButtonSpec; readonly disabled: boolean }): ReactElement {
  const isMenu = spec.menu !== undefined;
  return (
    <button
      type="button"
      className={`imk-icon-button${spec.selected ? ' imk-selected' : ''}`}
      data-testid={`toolbar.${spec.key}`}
      aria-label={spec.label}
      title={spec.label}
      aria-pressed={isMenu || spec.selected === undefined ? undefined : spec.selected}
      aria-haspopup={isMenu ? 'menu' : undefined}
      aria-expanded={isMenu ? spec.expanded === true : undefined}
      disabled={disabled || spec.disabled === true}
      onClick={(event) => spec.onPress(event.currentTarget)}
    >
      {spec.icon}
      {isMenu ? <span className="imk-menu-indicator" aria-hidden="true" /> : null}
    </button>
  );
}

const TOOL_BUTTONS: readonly { readonly key: string; readonly tool: MarkupTool; readonly icon: IconName }[] = [
  { key: 'select', tool: 'select', icon: 'select' },
  { key: 'sketch', tool: 'pen', icon: 'sketch' },
  { key: 'highlight', tool: 'highlighter', icon: 'highlight' },
];

const TEXT_BUTTONS: readonly { readonly key: string; readonly tool: MarkupTool; readonly icon: IconName }[] = [
  { key: 'text', tool: 'text', icon: 'text' },
  { key: 'note', tool: 'note', icon: 'note' },
  { key: 'eraser', tool: 'eraser', icon: 'eraser' },
];

export function Toolbar(props: ToolbarProps): ReactElement {
  const { state, features, strings, placement, isBoard, cameraAvailable, openMenu, openPanel } = props;
  const shapes = shapeEntries(features);
  const lines = lineEntries(features);
  // The Shapes and Arrow buttons show the shape and line tool used last.
  const [lastShape, setLastShape] = useState<ShapeTool>(shapes[0] ?? 'rectangle');
  const [lastLine, setLastLine] = useState<LineTool>(lines[0] ?? 'arrow');
  if (isShapeTool(state.tool) && state.tool !== lastShape) setLastShape(state.tool);
  if (isLineTool(state.tool) && state.tool !== lastLine) setLastLine(state.tool);

  const toolButton = (key: string, tool: MarkupTool, label: string, icon: ReactNode): ButtonSpec => ({
    key,
    label,
    icon,
    selected: state.tool === tool,
    onPress: () => props.onSelectTool(tool),
  });
  const toolLabels: Readonly<Record<string, string>> = {
    select: strings.toolSelect,
    sketch: strings.toolSketch,
    highlight: strings.toolHighlight,
    text: strings.toolText,
    note: strings.toolNote,
    eraser: strings.toolEraser,
  };

  const tools: ButtonSpec[] = [];
  for (const { key, tool, icon } of TOOL_BUTTONS) {
    if (features.allows(tool)) tools.push(toolButton(key, tool, toolLabels[key] ?? key, <Icon name={icon} />));
  }
  const onlyShape = shapes.length === 1 ? shapes[0] : undefined;
  if (onlyShape) {
    tools.push(toolButton('shapes', onlyShape, strings.shapeNames[onlyShape], <ShapeIcon tool={onlyShape} />));
  } else if (shapes.length > 1) {
    tools.push({
      key: 'shapes',
      label: strings.toolShapes,
      icon: <ShapeIcon tool={lastShape} />,
      selected: isShapeTool(state.tool),
      menu: 'shapes',
      expanded: openMenu === 'shapes',
      onPress: (button) => props.onOpenMenu('shapes', button),
    });
  }
  const onlyLine = lines.length === 1 ? lines[0] : undefined;
  const lineLabel = (tool: LineTool) =>
    tool === 'polyline' ? strings.toolPolyline : tool === 'curve' ? strings.toolCurve : strings.toolArrow;
  if (onlyLine) {
    tools.push(toolButton('arrow', onlyLine, lineLabel(onlyLine), <LineToolIcon tool={onlyLine} />));
  } else if (lines.length > 1) {
    tools.push({
      key: 'arrow',
      label: lineLabel(lastLine),
      icon: <LineToolIcon tool={lastLine} />,
      selected: isLineTool(state.tool),
      menu: 'lines',
      expanded: openMenu === 'lines',
      onPress: (button) => props.onOpenMenu('lines', button),
    });
  }
  for (const { key, tool, icon } of TEXT_BUTTONS) {
    if (features.allows(tool)) tools.push(toolButton(key, tool, toolLabels[key] ?? key, <Icon name={icon} />));
  }

  const board: ButtonSpec[] = [];
  if (isBoard) {
    const sources = addImageSources(features, cameraAvailable);
    const onlySource = sources.length === 1 ? sources[0] : undefined;
    if (onlySource) {
      board.push({
        key: 'addImages',
        label: strings.addImages,
        icon: <Icon name="addImages" />,
        onPress: () => props.onAddImages(onlySource),
      });
    } else if (sources.length > 1) {
      board.push({
        key: 'addImages',
        label: strings.addImages,
        icon: <Icon name="addImages" />,
        menu: 'addImages',
        expanded: openMenu === 'addImages',
        onPress: (button) => props.onOpenMenu('addImages', button),
      });
    }
    if (features.isEnabled('arrange')) {
      board.push({
        key: 'arrange',
        label: strings.arrange,
        icon: <Icon name="arrange" />,
        menu: 'arrange',
        expanded: openMenu === 'arrange',
        onPress: (button) => props.onOpenMenu('arrange', button),
      });
    }
  }

  const styles: ButtonSpec[] = [];
  const panel = (kind: PanelKind, label: string, icon: ReactNode, enabled: boolean): ButtonSpec => ({
    key: kind,
    label,
    icon,
    selected: openPanel === kind,
    disabled: !enabled,
    onPress: (button) => props.onTogglePanel(kind, button),
  });
  if (features.isEnabled('shapeStyle')) styles.push(panel('shapeStyle', strings.shapeStyle, <LineWeightIcon />, true));
  if (features.isEnabled('borderColor')) {
    styles.push(
      panel(
        'borderColor',
        strings.borderColor,
        <Swatch color={state.strokeColor} filled={false} />,
        state.strokeEnabled,
      ),
    );
  }
  if (features.isEnabled('fillColor')) {
    styles.push(panel('fillColor', strings.fillColor, <Swatch color={state.fillColor} filled />, state.fillEnabled));
  }
  if (features.isEnabled('textStyle')) {
    styles.push(panel('textStyle', strings.textStyle, <Icon name="textStyle" />, state.textEnabled));
  }

  const render = (specs: readonly ButtonSpec[]) =>
    specs.map((spec) => <ToolbarButton key={spec.key} spec={spec} disabled={props.disabled} />);
  const divider = (key: string) => <span key={key} className="imk-toolbar-divider" aria-hidden="true" />;

  if (placement === 'top') {
    return (
      <div
        className="imk-toolbar imk-toolbar-top"
        role="toolbar"
        aria-label={strings.toolbar}
        data-testid="markup.toolbar"
      >
        <div className="imk-toolbar-row">
          {render(tools)}
          {board.length > 0 ? [divider('board'), ...render(board)] : null}
          <span className="imk-toolbar-spacer" />
          {render(styles)}
        </div>
      </div>
    );
  }
  // One row when the features leave no style buttons or board actions.
  const second = [
    ...render(styles),
    ...(board.length > 0 && styles.length > 0 ? [divider('board')] : []),
    ...render(board),
  ];
  return (
    <div
      className="imk-toolbar imk-toolbar-bottom"
      role="toolbar"
      aria-label={strings.toolbar}
      data-testid="markup.toolbar"
    >
      <div className="imk-toolbar-row">{render(tools)}</div>
      {second.length > 0 ? <div className="imk-toolbar-row">{second}</div> : null}
    </div>
  );
}
