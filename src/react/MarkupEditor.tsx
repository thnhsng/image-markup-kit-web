import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { EditorController, type PanelKind } from '../editor/controller';
import { createDebugDriver, type MarkupDebugDriver } from '../editor/debug';
import { isApplePlatform } from '../editor/keyboard';
import type { MarkupTool } from '../editor/tools';
import { MarkupFeatures } from '../features/features';
import { BOARD_ARRANGEMENTS, type BoardArrangement } from '../geometry/board-layout';
import { importImages, type MarkupAssets, type MarkupImageInput } from '../image/import';
import { createBoardDocument } from '../model/board';
import { imageItems } from '../model/document';
import { isMarkupError, MarkupError } from '../model/errors';
import { createImageDocument } from '../model/factories';
import type { FontSpec, MarkupDocument, Size, StyleDefaults, UUIDString } from '../model/types';
import { createMarkupPackage, type MarkupPackageFiles } from '../package/package';
import type { MarkupExportOptions } from '../render/export-planner';
import { loadFonts, renderMarkup, type MarkupWarning } from '../render/render-markup';
import type { FontStacks } from '../text/font-stacks';
import { createCanvasTextMeasurer, type TextMeasurer } from '../text/measurer';
import { ActionBar } from './ActionBar';
import { Canvas } from './Canvas';
import { DiscardDialog, Header } from './Header';
import { Icon, LineToolIcon, ShapeIcon } from './icons';
import { useImageProxies } from './image-proxies';
import { anchorFor, Menu, type Anchor, type MenuEntry, type RootSize } from './Menu';
import { PanelHost } from './Panels';
import { EMPTY_DOCUMENT } from './svg';
import {
  resolveNavigationTexts,
  resolveStrings,
  type MarkupLocale,
  type MarkupNavigationTexts,
  type MarkupStringOverrides,
  type MarkupStrings,
} from './strings';
import { themeVariables, useStylesheet, type MarkupTheme } from './styles';
import { TextEditor } from './TextEditor';
import {
  addImageSources,
  lineEntries,
  shapeEntries,
  Toolbar,
  type AddImageSource,
  type ToolbarMenuKind,
} from './Toolbar';

// The editor (MarkupEditorViewController.swift): header, toolbar, canvas, panels and the export on Done. Like the
// Swift editor it never closes itself: the host unmounts it from `onDone` or `onCancel`.

/**
 * Editor options. `features`, `styleDefaults` and `fontStacks` are read once, when the editor opens; the others apply
 * as they change.
 */
export interface MarkupEditorConfiguration {
  /** Header title; "Markup" or "Board" by default. */
  readonly title?: string;
  readonly exportOptions?: MarkupExportOptions;
  readonly styleDefaults?: StyleDefaults;
  /** Tools, style buttons, board functions and selection actions to offer. Everything by default. */
  readonly features?: MarkupFeatures;
  /** The texts of Done, Cancel and the discard dialog, on top of the locale's. */
  readonly navigationTexts?: Partial<MarkupNavigationTexts>;
  /** Language of the built-in strings. English by default. */
  readonly locale?: MarkupLocale;
  /** Replacements for any other string. */
  readonly strings?: MarkupStringOverrides;
  /** Fonts for each font family (the defaults cover Apple platforms, Windows, Android and Linux). */
  readonly fontStacks?: FontStacks;
  /** Done also builds the editable package: `document.json`, the photos and the export. */
  readonly includePackage?: boolean;
  /** Shows the built-in header with Cancel, the title, Undo, Redo and Done. On by default. */
  readonly showHeader?: boolean;
  /** Nonce for the editor's <style> element, for pages with a strict Content Security Policy. */
  readonly styleNonce?: string;
  readonly theme?: Partial<MarkupTheme>;
  /**
   * Called by the board's Add Images button instead of the built-in file picker. Resolve with the photos to add, or
   * with null to add nothing.
   */
  readonly onAddImagesRequest?: (source: AddImageSource) => Promise<readonly MarkupImageInput[] | null>;
}

/** What Done hands back. */
export interface MarkupResult {
  /** The flattened image (JPEG by default). */
  readonly blob: Blob;
  readonly pixelSize: Size;
  /** True when the pixel limits reduced the natural resolution. */
  readonly isClamped: boolean;
  /** True when a JPEG with `maxBytes` is still larger than that. */
  readonly exceedsMaxBytes: boolean;
  /** Photos drawn as gray boxes (missing, or not decodable by this browser). */
  readonly warnings: readonly MarkupWarning[];
  /** Editable data: open it again with the `document` and `assets` props. */
  readonly document: MarkupDocument;
  /** The original bytes of the photos the document uses. */
  readonly assets: MarkupAssets;
  /** The editable package, when `includePackage` is set. */
  readonly package: MarkupPackageFiles | null;
}

/** The editor state reported to `onStateChange`. */
export interface MarkupEditorState {
  readonly tool: MarkupTool;
  readonly selectedItemIDs: readonly UUIDString[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Cancel would ask before discarding. */
  readonly hasChanges: boolean;
  readonly isExporting: boolean;
  readonly isEditingText: boolean;
}

/** Controls the editor from the host (the `ref` of `MarkupEditor`). */
export interface MarkupEditorHandle {
  /** The document as currently edited (null while the photos load). */
  getDocument(): MarkupDocument | null;
  getTool(): MarkupTool;
  /** Tools turned off in the features are ignored. */
  setTool(tool: MarkupTool): void;
  getSelectedItemIDs(): readonly UUIDString[];
  setSelectedItemIDs(ids: readonly UUIDString[]): void;
  undo(): void;
  redo(): void;
  zoomToFit(): void;
  arrange(arrangement: BoardArrangement): void;
  /** Same as tapping Done: resolves after `onDone` settles, rejects when the export or `onDone` fails. */
  done(): Promise<void>;
  /** Same as tapping Cancel: asks first when there are unsaved changes. */
  cancel(): void;
  /** Scripted gestures for tests and screenshots. */
  readonly debug: MarkupDebugDriver;
}

export interface MarkupEditorProps {
  /** One photo to annotate (image mode). */
  readonly image?: MarkupImageInput;
  /** Photos for a board, side by side in this order. */
  readonly images?: readonly MarkupImageInput[];
  /** A document to edit again, with the photos it uses in `assets`. */
  readonly document?: MarkupDocument;
  readonly assets?: MarkupAssets;
  readonly configuration?: MarkupEditorConfiguration;
  /**
   * Done: the export and the editable data. Return a Promise to keep the editor busy until it settles; when it
   * rejects, the editor stays open and editable.
   */
  readonly onDone: (result: MarkupResult) => void | Promise<unknown>;
  /** Cancel (after the discard dialog, when there were changes). */
  readonly onCancel: () => void;
  /** Photos that could not be opened, and exports that failed. */
  readonly onError?: (error: MarkupError) => void;
  readonly onStateChange?: (state: MarkupEditorState) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly controller: EditorController; readonly assets: MarkupAssets }
  | { readonly status: 'failed'; readonly error: MarkupError };

interface Session {
  readonly features: MarkupFeatures;
  readonly fontStacks: FontStacks | undefined;
  readonly measurer: TextMeasurer & { clear(): void };
  readonly defaults: StyleDefaults | undefined;
}

const WIDE_LAYOUT = 700;
const NO_DEBUG: MarkupDebugDriver = {
  perform: () => undefined,
  beginEditingText: () => undefined,
  typeText: () => undefined,
  presentPanel: () => undefined,
  arrange: () => undefined,
  setFill: () => undefined,
  zoomToFit: () => undefined,
};
const NO_ASSETS: MarkupAssets = {};

function inputCount(props: MarkupEditorProps): number {
  return (props.image !== undefined ? 1 : 0) + (props.images !== undefined ? 1 : 0) + (props.document ? 1 : 0);
}

function openDocument(document: MarkupDocument, assets: MarkupAssets, session: Session): Load {
  const controller = new EditorController(document, {
    features: session.features,
    defaults: session.defaults,
    measurer: session.measurer,
  });
  return { status: 'ready', controller, assets };
}

function initialLoad(props: MarkupEditorProps, session: Session): Load {
  if (inputCount(props) !== 1) {
    return {
      status: 'failed',
      error: new MarkupError('invalidInput', 'Give the editor exactly one of image, images or document.'),
    };
  }
  if (props.document) return openDocument(props.document, props.assets ?? {}, session);
  return { status: 'loading' };
}

/** Assets of the photos the document uses. */
function referencedAssets(document: MarkupDocument, assets: MarkupAssets): MarkupAssets {
  const result: Record<string, Blob> = {};
  for (const item of imageItems(document)) {
    const blob = assets[item.content.assetID];
    if (blob) result[item.content.assetID] = blob;
  }
  return result;
}

function documentFonts(document: MarkupDocument, defaults: StyleDefaults): FontSpec[] {
  return [
    defaults.textFont,
    defaults.noteFont,
    ...document.items.flatMap((item) => (item.type === 'text' ? [item.content.font] : [])),
  ];
}

/** A ref that always holds the latest value (for callbacks the host passes anew on every render). */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

const noSubscription = () => () => undefined;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof matchMedia !== 'function') return () => undefined;
      const list = matchMedia(query);
      list.addEventListener?.('change', listener);
      return () => list.removeEventListener?.('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}

function sameState(a: MarkupEditorState | null, b: MarkupEditorState): boolean {
  return (
    a !== null &&
    a.tool === b.tool &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.hasChanges === b.hasChanges &&
    a.isExporting === b.isExporting &&
    a.isEditingText === b.isEditingText &&
    a.selectedItemIDs.length === b.selectedItemIDs.length &&
    a.selectedItemIDs.every((id, index) => id === b.selectedItemIDs[index])
  );
}

function asMarkupError(error: unknown, code: 'unreadableImage' | 'exportFailed', message: string): MarkupError {
  return isMarkupError(error) ? error : new MarkupError(code, message, { detail: error });
}

function menuTitle(kind: ToolbarMenuKind, strings: MarkupStrings): string {
  switch (kind) {
    case 'shapes':
      return strings.toolShapes;
    case 'lines':
      return strings.toolLines;
    case 'addImages':
      return strings.addImages;
    case 'arrange':
      return strings.arrange;
  }
}

const ARRANGE_ICONS = {
  row: 'arrangeRow',
  column: 'arrangeColumn',
  grid: 'arrangeGrid',
  tidy: 'arrangeTidy',
} as const;

function menuEntries(
  kind: ToolbarMenuKind,
  tool: MarkupTool,
  features: MarkupFeatures,
  strings: MarkupStrings,
  cameraAvailable: boolean,
): MenuEntry[] {
  switch (kind) {
    case 'shapes':
      return shapeEntries(features).map((shape) => ({
        key: shape,
        label: strings.shapeNames[shape],
        icon: <ShapeIcon tool={shape} />,
        checked: tool === shape,
        testID: `menu.${shape}`,
      }));
    case 'lines':
      return lineEntries(features).map((line) => ({
        key: line,
        label: line === 'polyline' ? strings.toolPolyline : line === 'curve' ? strings.toolCurve : strings.toolArrow,
        icon: <LineToolIcon tool={line} />,
        checked: tool === line,
        testID: `menu.${line}`,
      }));
    case 'addImages':
      return addImageSources(features, cameraAvailable).map((source) => ({
        key: source,
        label: source === 'camera' ? strings.camera : strings.photoLibrary,
        icon: <Icon name={source === 'camera' ? 'camera' : 'photoLibrary'} />,
        testID: `menu.${source}`,
      }));
    case 'arrange':
      return [
        ...BOARD_ARRANGEMENTS.map((arrangement) => ({
          key: arrangement,
          label: strings.arrangements[arrangement],
          icon: <Icon name={ARRANGE_ICONS[arrangement]} />,
          testID: `menu.${arrangement}`,
        })),
        {
          key: 'zoomToFit',
          label: strings.zoomToFit,
          icon: <Icon name="zoomToFit" />,
          testID: 'menu.zoomToFit',
          separated: true,
        },
      ];
  }
}

/**
 * The markup editor: annotate one photo (`image`), lay out several on a board (`images`), or edit a document again
 * (`document` and `assets`). It fills its container, so give the container a size.
 */
export const MarkupEditor = forwardRef<MarkupEditorHandle, MarkupEditorProps>(function MarkupEditor(props, ref) {
  const configuration = props.configuration ?? {};
  const [session] = useState<Session>(() => ({
    features: configuration.features ?? MarkupFeatures.all,
    fontStacks: configuration.fontStacks,
    measurer: createCanvasTextMeasurer(configuration.fontStacks),
    defaults: configuration.styleDefaults,
  }));
  const [load, setLoad] = useState<Load>(() => initialLoad(props, session));
  const [initialInputs] = useState(() => ({ image: props.image, images: props.images }));
  const controller = load.status === 'ready' ? load.controller : null;
  const assets = load.status === 'ready' ? load.assets : null;

  const strings: MarkupStrings = useMemo(
    () => resolveStrings(configuration.locale, configuration.strings),
    [configuration.locale, configuration.strings],
  );
  const texts = useMemo(
    () => resolveNavigationTexts(configuration.locale, configuration.navigationTexts),
    [configuration.locale, configuration.navigationTexts],
  );
  const onDone = useLatest(props.onDone);
  const onCancel = useLatest(props.onCancel);
  const onError = useLatest(props.onError);
  const onStateChange = useLatest(props.onStateChange);
  const onAddImagesRequest = useLatest(configuration.onAddImagesRequest);
  const exportOptions = useLatest(configuration.exportOptions);
  const includePackage = useLatest(configuration.includePackage === true);

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const textEditor = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const exporting = useRef<Promise<void> | null>(null);
  const reported = useRef<MarkupEditorState | null>(null);

  const [rootSize, setRootSize] = useState<RootSize>({ width: 0, height: 0 });
  const [menu, setMenu] = useState<{ readonly kind: ToolbarMenuKind; readonly anchor: Anchor } | null>(null);
  const [panelAnchor, setPanelAnchor] = useState<Anchor | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [fontEpoch, setFontEpoch] = useState(0);
  const cameraAvailable = useMediaQuery('(pointer: coarse)');

  useStylesheet(root, configuration.styleNonce);

  const subscribe = useMemo(
    () => (controller ? (listener: () => void) => controller.subscribe(listener) : noSubscription),
    [controller],
  );
  const version = useSyncExternalStore(
    subscribe,
    () => controller?.version ?? -1,
    () => controller?.version ?? -1,
  );

  // Photos given as images: import them (read their size and orientation), then open the document.
  useEffect(() => {
    if (load.status !== 'loading') return undefined;
    const abort = new AbortController();
    const { image, images } = initialInputs;
    const inputs = images ?? (image !== undefined ? [image] : []);
    importImages(inputs, { signal: abort.signal }).then(
      ({ sources, assets: imported }) => {
        if (abort.signal.aborted) return;
        const first = sources[0];
        const document = images !== undefined || !first ? createBoardDocument(sources) : createImageDocument(first);
        setLoad(openDocument(document, imported, session));
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        const markupError = asMarkupError(error, 'unreadableImage', 'The photos could not be opened.');
        setLoad({ status: 'failed', error: markupError });
        onError.current?.(markupError);
      },
    );
    return () => abort.abort();
  }, [load.status, initialInputs, session, onError]);

  // An invalid combination of inputs is reported once.
  const initialError = load.status === 'failed' ? load.error : null;
  useEffect(() => {
    if (initialError?.code === 'invalidInput') onError.current?.(initialError);
  }, [initialError, onError]);

  // Measure text with the real fonts once they are loaded (where the browser can load fonts at all).
  useEffect(() => {
    const fonts = root.current?.ownerDocument.fonts;
    if (!controller || !fonts || typeof fonts.load !== 'function') return undefined;
    let cancelled = false;
    void loadFonts(documentFonts(controller.store.document, controller.store.defaults), session.fontStacks).then(() => {
      if (cancelled) return;
      session.measurer.clear();
      setFontEpoch((epoch) => epoch + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [controller, session]);

  // Wide editors get the toolbar on top, narrow ones at the bottom.
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setRootSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // On phones, keep the box being edited above the on-screen keyboard.
  useEffect(() => {
    const visual = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!controller || !visual) return undefined;
    const update = () => {
      const area = stage.current?.getBoundingClientRect();
      if (!area) return;
      controller.setKeyboardInset(area.bottom - (visual.offsetTop + visual.height));
    };
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    return () => {
      visual.removeEventListener('resize', update);
      visual.removeEventListener('scroll', update);
    };
  }, [controller]);

  // Report state changes to the host.
  useEffect(() => {
    if (!controller) return;
    const store = controller.store;
    const state: MarkupEditorState = {
      tool: store.tool,
      selectedItemIDs: store.selection,
      canUndo: store.canUndo,
      canRedo: store.canRedo,
      hasChanges: store.hasChanges,
      isExporting: controller.isExporting,
      isEditingText: controller.isEditingText(),
    };
    if (sameState(reported.current, state)) return;
    reported.current = state;
    onStateChange.current?.(state);
  }, [controller, version, onStateChange]);

  // The error banner goes away after a while.
  useEffect(() => {
    if (banner === null) return undefined;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  const done = useCallback((): Promise<void> => {
    if (!controller || !assets) {
      return Promise.reject(new MarkupError('invalidInput', 'The editor has no document yet.'));
    }
    if (exporting.current) return exporting.current;
    const run = async (): Promise<void> => {
      controller.prepareForExport();
      setMenu(null);
      setBanner(null);
      controller.setExporting(true);
      try {
        const document = controller.store.document;
        const used = referencedAssets(document, assets);
        let result: MarkupResult;
        try {
          const rendering = await renderMarkup(document, assets, {
            ...exportOptions.current,
            fontStacks: session.fontStacks,
            measurer: session.measurer,
          });
          const files = includePackage.current ? await createMarkupPackage(document, used, rendering.blob) : null;
          result = {
            blob: rendering.blob,
            pixelSize: rendering.pixelSize,
            isClamped: rendering.isClamped,
            exceedsMaxBytes: rendering.exceedsMaxBytes,
            warnings: rendering.warnings,
            document,
            assets: used,
            package: files,
          };
        } catch (error) {
          const markupError = asMarkupError(error, 'exportFailed', 'The image could not be exported.');
          onError.current?.(markupError);
          setBanner(strings.exportFailed);
          throw markupError;
        }
        await onDone.current(result);
      } finally {
        controller.setExporting(false);
        exporting.current = null;
      }
    };
    exporting.current = run();
    return exporting.current;
  }, [controller, assets, session, strings, exportOptions, includePackage, onDone, onError]);

  const cancel = useCallback(() => {
    if (controller?.isExporting) return;
    setMenu(null);
    if (controller?.prepareForCancel()) setDiscardOpen(true);
    else onCancel.current();
  }, [controller, onCancel]);

  const addImages = useCallback(
    async (inputs: readonly MarkupImageInput[]) => {
      if (!controller || inputs.length === 0) return;
      try {
        const imported = await importImages(inputs);
        setLoad((current) =>
          current.status === 'ready' ? { ...current, assets: { ...current.assets, ...imported.assets } } : current,
        );
        controller.addImages(imported.sources);
      } catch (error) {
        onError.current?.(asMarkupError(error, 'unreadableImage', 'The photos could not be opened.'));
        setBanner(strings.loadFailed);
      }
    },
    [controller, onError, strings],
  );

  const requestImages = (source: AddImageSource) => {
    const request = onAddImagesRequest.current;
    if (request) {
      request(source).then(
        (inputs) => (inputs ? addImages(inputs) : undefined),
        (error: unknown) => onError.current?.(asMarkupError(error, 'unreadableImage', 'No photos were added.')),
      );
      return;
    }
    (source === 'camera' ? cameraInput : fileInput).current?.click();
  };

  const selectMenuEntry = (kind: ToolbarMenuKind, key: string) => {
    if (!controller) return;
    switch (kind) {
      case 'shapes':
      case 'lines':
        controller.selectTool(key as MarkupTool);
        return;
      case 'addImages':
        requestImages(key as AddImageSource);
        return;
      case 'arrange':
        if (key === 'zoomToFit') controller.zoomToFit();
        else controller.arrange(key as BoardArrangement);
        return;
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      getDocument: () => controller?.store.document ?? null,
      getTool: () => controller?.store.tool ?? 'select',
      setTool: (tool) => controller?.selectTool(tool),
      getSelectedItemIDs: () => controller?.store.selection ?? [],
      setSelectedItemIDs: (ids) => controller?.store.select(ids),
      undo: () => controller?.undo(),
      redo: () => controller?.redo(),
      zoomToFit: () => controller?.zoomToFit(),
      arrange: (arrangement) => controller?.arrange(arrangement),
      done,
      cancel,
      debug: controller ? createDebugDriver(controller) : NO_DEBUG,
    }),
    [controller, done, cancel],
  );

  // A new environment after the fonts load makes every item lay its text out again.
  const env = useMemo(
    () => ({ measurer: session.measurer, fontStacks: session.fontStacks, fontEpoch }),
    [session, fontEpoch],
  );
  const images = useImageProxies(controller?.store.displayed ?? EMPTY_DOCUMENT, assets ?? NO_ASSETS);

  const wide = rootSize.width === 0 || rootSize.width >= WIDE_LAYOUT;
  const busy = controller?.isExporting === true;
  const store = controller?.store;
  const isBoard = store ? store.document.kind === 'board' : props.images !== undefined;
  const title = configuration.title ?? (isBoard ? strings.titleBoard : strings.titleImage);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!controller || discardOpen) return;
    const target = event.target as HTMLElement;
    const inputType = target.tagName === 'INPUT' ? (target as HTMLInputElement).type : null;
    const typing =
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable ||
      (inputType !== null && inputType !== 'range' && inputType !== 'checkbox');
    if (typing && event.key !== 'Escape') return;
    const handled = controller.handleKey(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      },
      isApplePlatform(),
    );
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const openMenu = (kind: ToolbarMenuKind, button: HTMLElement) => {
    const element = root.current;
    if (!element || !controller) return;
    controller.dismissPanel();
    setMenu(menu?.kind === kind ? null : { kind, anchor: anchorFor(button, element, !wide) });
  };
  const togglePanel = (kind: PanelKind, button: HTMLElement) => {
    const element = root.current;
    if (!element || !controller) return;
    setMenu(null);
    setPanelAnchor(anchorFor(button, element, !wide));
    controller.togglePanel(kind);
  };

  const toolbar =
    controller && store ? (
      <Toolbar
        state={controller.toolbarState}
        features={session.features}
        strings={strings}
        placement={wide ? 'top' : 'bottom'}
        isBoard={isBoard}
        cameraAvailable={cameraAvailable}
        openMenu={menu?.kind ?? null}
        openPanel={controller.openPanel}
        disabled={busy}
        onSelectTool={(tool) => controller.selectTool(tool)}
        onOpenMenu={openMenu}
        onTogglePanel={togglePanel}
        onAddImages={requestImages}
      />
    ) : null;

  const undoName = store?.undoActionName;
  const redoName = store?.redoActionName;
  const rootStyle = { ...themeVariables(configuration.theme), ...props.style } as CSSProperties;
  const onFiles = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void addImages(files);
  };

  return (
    <div
      ref={root}
      className={props.className ? `imk-root ${props.className}` : 'imk-root'}
      style={rootStyle}
      data-testid="markup.editor"
      data-layout={wide ? 'wide' : 'narrow'}
      tabIndex={-1}
      lang={configuration.locale ?? 'en'}
      aria-busy={busy}
      onKeyDown={onKeyDown}
    >
      {configuration.showHeader !== false ? (
        <Header
          title={title}
          texts={texts}
          strings={strings}
          undoTitle={undoName ? strings.undoAction(strings.undoActions[undoName]) : strings.undo}
          redoTitle={redoName ? strings.redoAction(strings.undoActions[redoName]) : strings.redo}
          canUndo={store?.canUndo ?? false}
          canRedo={store?.canRedo ?? false}
          busy={busy}
          ready={controller !== null}
          onCancel={cancel}
          onUndo={() => controller?.undo()}
          onRedo={() => controller?.redo()}
          onDone={() => void done().catch(() => undefined)}
        />
      ) : null}
      {wide ? toolbar : null}
      <div ref={stage} className="imk-stage">
        {controller ? (
          <Canvas
            controller={controller}
            version={version}
            env={env}
            images={images}
            onCanvasPointerDown={() => {
              setMenu(null);
              // Popovers close when the canvas is touched; sheets of narrow editors stay, like on iOS.
              if (wide) controller.dismissPanel();
              root.current?.focus({ preventScroll: true });
            }}
            textEditorRef={textEditor}
          />
        ) : (
          <div className="imk-canvas" data-testid="markup.canvas">
            <div className="imk-status" role={load.status === 'failed' ? 'alert' : 'status'}>
              {load.status === 'failed' ? (
                strings.loadFailed
              ) : (
                <>
                  <span className="imk-spinner">
                    <Icon name="spinner" />
                  </span>
                  {strings.loading}
                </>
              )}
            </div>
          </div>
        )}
        {controller ? <ActionBar controller={controller} strings={strings} textEditorRef={textEditor} /> : null}
        {controller ? (
          <TextEditor
            controller={controller}
            strings={strings}
            doneTitle={texts.done}
            fontStacks={session.fontStacks}
            textEditorRef={textEditor}
            onEscape={() => root.current?.focus({ preventScroll: true })}
          />
        ) : null}
      </div>
      {wide ? null : toolbar}
      {controller && controller.openPanel ? (
        <PanelHost
          controller={controller}
          strings={strings}
          kind={controller.openPanel}
          anchor={panelAnchor}
          root={rootSize}
          sheet={!wide}
          onClose={() => {
            controller.dismissPanel();
            root.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      {controller && menu ? (
        <Menu
          title={menuTitle(menu.kind, strings)}
          entries={menuEntries(menu.kind, controller.store.tool, session.features, strings, cameraAvailable)}
          anchor={menu.anchor}
          root={rootSize}
          testID={`menu.${menu.kind}`}
          onSelect={(key) => selectMenuEntry(menu.kind, key)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {discardOpen ? (
        <DiscardDialog
          texts={texts}
          onDiscard={() => {
            setDiscardOpen(false);
            onCancel.current();
          }}
          onKeepEditing={() => {
            setDiscardOpen(false);
            root.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      {banner !== null ? (
        <div className="imk-error-banner" role="alert" onClick={() => setBanner(null)}>
          {banner}
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        tabIndex={-1}
        data-testid="markup.photoInput"
        onChange={(event) => onFiles(event.currentTarget)}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        tabIndex={-1}
        data-testid="markup.cameraInput"
        onChange={(event) => onFiles(event.currentTarget)}
      />
    </div>
  );
});
