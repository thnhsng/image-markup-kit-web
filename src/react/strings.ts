import type { SelectionAction } from '../editor/overlay';
import type { MarkupActionName } from '../editor/store';
import type { ShapeTool } from '../editor/tools';
import type { BoardArrangement } from '../geometry/board-layout';
import type { FontFamily } from '../model/types';

// Every user-facing string of the editor (Strings.swift), in English and Japanese. Hosts pick a locale and can
// replace any string.

export type MarkupLocale = 'en' | 'ja';

/** Titles of the header buttons and of the dialog Cancel shows when there are unsaved changes. */
export interface MarkupNavigationTexts {
  /** The button that exports the image and finishes. */
  readonly done: string;
  /** The button that leaves without saving. */
  readonly cancel: string;
  /** Title of the discard-changes dialog. */
  readonly discardTitle: string;
  /** Message of the discard-changes dialog. */
  readonly discardMessage: string;
  /** The dialog button that throws the changes away. */
  readonly discard: string;
  /** The dialog button that returns to the editor. */
  readonly keepEditing: string;
}

export interface MarkupStrings {
  // Header
  readonly undo: string;
  readonly redo: string;
  /** Undo button title with what it undoes, e.g. "Undo Move". */
  readonly undoAction: (action: string) => string;
  readonly redoAction: (action: string) => string;
  readonly titleImage: string;
  readonly titleBoard: string;
  readonly exporting: string;
  readonly exportFailed: string;
  readonly loading: string;
  readonly loadFailed: string;

  // Toolbar
  readonly toolbar: string;
  readonly toolSelect: string;
  readonly toolSketch: string;
  readonly toolHighlight: string;
  readonly toolShapes: string;
  readonly toolArrow: string;
  readonly toolPolyline: string;
  readonly toolCurve: string;
  readonly toolLines: string;
  readonly toolText: string;
  readonly toolNote: string;
  readonly toolEraser: string;
  readonly shapeStyle: string;
  readonly borderColor: string;
  readonly fillColor: string;
  readonly textStyle: string;
  readonly addImages: string;
  readonly photoLibrary: string;
  readonly camera: string;
  readonly arrange: string;
  readonly zoomToFit: string;
  readonly arrangements: Readonly<Record<BoardArrangement, string>>;
  readonly shapeNames: Readonly<Record<ShapeTool, string>>;

  // Selection action bar, and the undo steps
  readonly actions: Readonly<Record<SelectionAction, string>>;
  readonly undoActions: Readonly<Record<MarkupActionName, string>>;

  // Panels
  readonly close: string;
  readonly lineWidth: string;
  /** Line width label, e.g. "6 pt". */
  readonly points: (value: number) => string;
  readonly lineStyle: string;
  readonly solid: string;
  readonly dashed: string;
  readonly dotted: string;
  readonly arrowheads: string;
  readonly arrowheadsNone: string;
  readonly arrowheadsEnd: string;
  readonly arrowheadsStart: string;
  readonly arrowheadsBoth: string;
  readonly opacity: string;
  readonly cornerRadius: string;
  readonly shadow: string;
  readonly noColor: string;
  readonly customColor: string;
  readonly font: string;
  readonly fontSize: string;
  readonly smaller: string;
  readonly larger: string;
  readonly bold: string;
  readonly italic: string;
  readonly alignment: string;
  readonly alignLeft: string;
  readonly alignCenter: string;
  readonly alignRight: string;
  readonly textColor: string;
  readonly fontFamilyNames: Readonly<Record<FontFamily, string>>;
}

/** Replacements for some of the strings; the records can be partial too. */
export type MarkupStringOverrides = Partial<
  Omit<MarkupStrings, 'arrangements' | 'shapeNames' | 'actions' | 'undoActions' | 'fontFamilyNames'>
> & {
  readonly arrangements?: Partial<MarkupStrings['arrangements']>;
  readonly shapeNames?: Partial<MarkupStrings['shapeNames']>;
  readonly actions?: Partial<MarkupStrings['actions']>;
  readonly undoActions?: Partial<MarkupStrings['undoActions']>;
  readonly fontFamilyNames?: Partial<MarkupStrings['fontFamilyNames']>;
};

const NAVIGATION_EN: MarkupNavigationTexts = {
  done: 'Done',
  cancel: 'Cancel',
  discardTitle: 'Discard changes?',
  discardMessage: 'Your markup will not be saved.',
  discard: 'Discard',
  keepEditing: 'Keep Editing',
};

const NAVIGATION_JA: MarkupNavigationTexts = {
  done: '完了',
  cancel: 'キャンセル',
  discardTitle: '変更を破棄しますか？',
  discardMessage: 'マークアップは保存されません。',
  discard: '破棄',
  keepEditing: '編集を続ける',
};

const STRINGS_EN: MarkupStrings = {
  undo: 'Undo',
  redo: 'Redo',
  undoAction: (action) => `Undo ${action}`,
  redoAction: (action) => `Redo ${action}`,
  titleImage: 'Markup',
  titleBoard: 'Board',
  exporting: 'Exporting…',
  exportFailed: 'Could not save the image.',
  loading: 'Loading…',
  loadFailed: 'Could not open the photos.',

  toolbar: 'Markup Tools',
  toolSelect: 'Select',
  toolSketch: 'Sketch',
  toolHighlight: 'Highlight',
  toolShapes: 'Shapes',
  toolArrow: 'Arrow / Line',
  toolPolyline: 'Polyline',
  toolCurve: 'Curve',
  toolLines: 'Lines',
  toolText: 'Text',
  toolNote: 'Note',
  toolEraser: 'Eraser',
  shapeStyle: 'Shape Style',
  borderColor: 'Border Color',
  fillColor: 'Fill Color',
  textStyle: 'Text Style',
  addImages: 'Add Images',
  photoLibrary: 'Choose Photos',
  camera: 'Camera',
  arrange: 'Arrange',
  zoomToFit: 'Zoom to Fit',
  arrangements: { row: 'Row', column: 'Column', grid: 'Grid', tidy: 'Tidy Up' },
  shapeNames: {
    rectangle: 'Rectangle',
    roundedRectangle: 'Rounded Rectangle',
    oval: 'Oval',
    circle: 'Circle',
    square: 'Square',
    triangle: 'Triangle',
    diamond: 'Diamond',
    star: 'Star',
    pentagon: 'Pentagon',
    speechBubble: 'Speech Bubble',
    highlightBox: 'Highlight Box',
  },

  actions: {
    editText: 'Edit Text',
    duplicate: 'Duplicate',
    bringToFront: 'Bring to Front',
    sendToBack: 'Send to Back',
    lock: 'Lock',
    unlock: 'Unlock',
    delete: 'Delete',
    finishPath: 'Finish',
    closePath: 'Close Shape',
    openPath: 'Open Shape',
    deletePoint: 'Delete Point',
  },
  undoActions: {
    add: 'Add',
    delete: 'Delete',
    duplicate: 'Duplicate',
    bringToFront: 'Bring to Front',
    sendToBack: 'Send to Back',
    lock: 'Lock',
    unlock: 'Unlock',
    style: 'Change Style',
    move: 'Move',
    resize: 'Resize',
    rotate: 'Rotate',
    draw: 'Draw',
    highlight: 'Highlight',
    addShape: 'Add Shape',
    addArrow: 'Add Arrow',
    moveEndpoint: 'Move Endpoint',
    addPolyline: 'Add Polyline',
    addCurve: 'Add Curve',
    addPoint: 'Add Point',
    movePoint: 'Move Point',
    deletePoint: 'Delete Point',
    closeShape: 'Close Shape',
    openShape: 'Open Shape',
    addText: 'Add Text',
    editText: 'Edit Text',
    erase: 'Erase',
    arrange: 'Arrange',
    addImages: 'Add Images',
  },

  close: 'Close',
  lineWidth: 'Line Width',
  points: (value) => `${value} pt`,
  lineStyle: 'Line Style',
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  arrowheads: 'Arrowheads',
  arrowheadsNone: 'No Arrowheads',
  arrowheadsEnd: 'Arrow at End',
  arrowheadsStart: 'Arrow at Start',
  arrowheadsBoth: 'Arrows at Both Ends',
  opacity: 'Opacity',
  cornerRadius: 'Corners',
  shadow: 'Shadow',
  noColor: 'None',
  customColor: 'Custom…',
  font: 'Font',
  fontSize: 'Size',
  smaller: 'Smaller',
  larger: 'Larger',
  bold: 'Bold',
  italic: 'Italic',
  alignment: 'Alignment',
  alignLeft: 'Align Left',
  alignCenter: 'Center',
  alignRight: 'Align Right',
  textColor: 'Text Color',
  fontFamilyNames: {
    system: 'System',
    rounded: 'Rounded',
    serif: 'Serif',
    monospaced: 'Mono',
    hiraginoSans: 'Hiragino Sans',
    hiraginoMincho: 'Hiragino Mincho',
  },
};

const STRINGS_JA: MarkupStrings = {
  undo: '取り消す',
  redo: 'やり直す',
  undoAction: (action) => `${action}を取り消す`,
  redoAction: (action) => `${action}をやり直す`,
  titleImage: 'マークアップ',
  titleBoard: 'ボード',
  exporting: '書き出し中…',
  exportFailed: '画像を保存できませんでした。',
  loading: '読み込み中…',
  loadFailed: '写真を開けませんでした。',

  toolbar: 'マークアップツール',
  toolSelect: '選択',
  toolSketch: 'スケッチ',
  toolHighlight: 'ハイライト',
  toolShapes: '図形',
  toolArrow: '矢印 / 線',
  toolPolyline: '折れ線',
  toolCurve: '曲線',
  toolLines: '線',
  toolText: 'テキスト',
  toolNote: 'メモ',
  toolEraser: '消しゴム',
  shapeStyle: '図形のスタイル',
  borderColor: '枠線の色',
  fillColor: '塗りつぶしの色',
  textStyle: 'テキストのスタイル',
  addImages: '画像を追加',
  photoLibrary: '写真を選択',
  camera: 'カメラ',
  arrange: '整列',
  zoomToFit: '全体を表示',
  arrangements: { row: '横に並べる', column: '縦に並べる', grid: 'グリッド', tidy: '整頓' },
  shapeNames: {
    rectangle: '長方形',
    roundedRectangle: '角丸長方形',
    oval: '楕円',
    circle: '円',
    square: '正方形',
    triangle: '三角形',
    diamond: 'ひし形',
    star: '星',
    pentagon: '五角形',
    speechBubble: '吹き出し',
    highlightBox: 'ハイライトボックス',
  },

  actions: {
    editText: 'テキストを編集',
    duplicate: '複製',
    bringToFront: '最前面へ',
    sendToBack: '最背面へ',
    lock: 'ロック',
    unlock: 'ロック解除',
    delete: '削除',
    finishPath: '完了',
    closePath: '図形を閉じる',
    openPath: '図形を開く',
    deletePoint: '点を削除',
  },
  undoActions: {
    add: '追加',
    delete: '削除',
    duplicate: '複製',
    bringToFront: '最前面へ移動',
    sendToBack: '最背面へ移動',
    lock: 'ロック',
    unlock: 'ロック解除',
    style: 'スタイルの変更',
    move: '移動',
    resize: 'サイズ変更',
    rotate: '回転',
    draw: '描画',
    highlight: 'ハイライト',
    addShape: '図形の追加',
    addArrow: '矢印の追加',
    moveEndpoint: '端点の移動',
    addPolyline: '折れ線の追加',
    addCurve: '曲線の追加',
    addPoint: '点の追加',
    movePoint: '点の移動',
    deletePoint: '点の削除',
    closeShape: '図形を閉じる',
    openShape: '図形を開く',
    addText: 'テキストの追加',
    editText: 'テキストの編集',
    erase: '消去',
    arrange: '整列',
    addImages: '画像の追加',
  },

  close: '閉じる',
  lineWidth: '線の太さ',
  points: (value) => `${value} pt`,
  lineStyle: '線の種類',
  solid: '実線',
  dashed: '破線',
  dotted: '点線',
  arrowheads: '矢印',
  arrowheadsNone: '矢印なし',
  arrowheadsEnd: '終点に矢印',
  arrowheadsStart: '始点に矢印',
  arrowheadsBoth: '両端に矢印',
  opacity: '不透明度',
  cornerRadius: '角の丸み',
  shadow: '影',
  noColor: 'なし',
  customColor: 'カスタム…',
  font: 'フォント',
  fontSize: 'サイズ',
  smaller: '小さく',
  larger: '大きく',
  bold: '太字',
  italic: '斜体',
  alignment: '配置',
  alignLeft: '左揃え',
  alignCenter: '中央揃え',
  alignRight: '右揃え',
  textColor: '文字の色',
  fontFamilyNames: {
    system: 'システム',
    rounded: 'ラウンド',
    serif: 'セリフ',
    monospaced: '等幅',
    hiraginoSans: 'ゴシック',
    hiraginoMincho: '明朝',
  },
};

/** The built-in strings of each locale. */
export const MARKUP_STRINGS: Readonly<Record<MarkupLocale, MarkupStrings>> = { en: STRINGS_EN, ja: STRINGS_JA };

/** The built-in header and discard-dialog texts of each locale. */
export const MARKUP_NAVIGATION_TEXTS: Readonly<Record<MarkupLocale, MarkupNavigationTexts>> = {
  en: NAVIGATION_EN,
  ja: NAVIGATION_JA,
};

/** The strings of `locale` with `overrides` applied. */
export function resolveStrings(locale: MarkupLocale = 'en', overrides: MarkupStringOverrides = {}): MarkupStrings {
  const base = MARKUP_STRINGS[locale] ?? STRINGS_EN;
  return {
    ...base,
    ...overrides,
    arrangements: { ...base.arrangements, ...overrides.arrangements },
    shapeNames: { ...base.shapeNames, ...overrides.shapeNames },
    actions: { ...base.actions, ...overrides.actions },
    undoActions: { ...base.undoActions, ...overrides.undoActions },
    fontFamilyNames: { ...base.fontFamilyNames, ...overrides.fontFamilyNames },
  };
}

/** The navigation texts of `locale` with `overrides` applied. */
export function resolveNavigationTexts(
  locale: MarkupLocale = 'en',
  overrides: Partial<MarkupNavigationTexts> = {},
): MarkupNavigationTexts {
  return { ...(MARKUP_NAVIGATION_TEXTS[locale] ?? NAVIGATION_EN), ...overrides };
}
