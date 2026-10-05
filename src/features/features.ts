import { stringifySwiftJSON, type JSONValue } from '../codec/swift-json';
import type { MarkupTool } from '../editor/tools';

/** Groups of editor features, as they appear in the toolbar and the selection action bar. */
export type MarkupFeatureGroup = 'draw' | 'shapes' | 'lines' | 'text' | 'eraser' | 'style' | 'board' | 'actions';

/** One feature that can be turned off. The names are the ones used in the JSON configuration. */
export type MarkupFeature =
  | 'pen'
  | 'highlighter'
  | 'rectangle'
  | 'roundedRectangle'
  | 'oval'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'pentagon'
  | 'speechBubble'
  | 'highlightBox'
  | 'arrow'
  | 'polyline'
  | 'curve'
  | 'text'
  | 'note'
  | 'eraser'
  | 'shapeStyle'
  | 'borderColor'
  | 'fillColor'
  | 'textStyle'
  | 'photoLibrary'
  | 'camera'
  | 'arrange'
  | 'editText'
  | 'duplicate'
  | 'bringToFront'
  | 'sendToBack'
  | 'lock'
  | 'delete';

const GROUPS: Readonly<Record<MarkupFeatureGroup, readonly MarkupFeature[]>> = {
  draw: ['pen', 'highlighter'],
  shapes: [
    'rectangle',
    'roundedRectangle',
    'oval',
    'circle',
    'square',
    'triangle',
    'diamond',
    'star',
    'pentagon',
    'speechBubble',
    'highlightBox',
  ],
  lines: ['arrow', 'polyline', 'curve'],
  text: ['text', 'note'],
  eraser: ['eraser'],
  style: ['shapeStyle', 'borderColor', 'fillColor', 'textStyle'],
  board: ['photoLibrary', 'camera', 'arrange'],
  actions: ['editText', 'duplicate', 'bringToFront', 'sendToBack', 'lock', 'delete'],
};

/** Every group, in toolbar order. */
export const MARKUP_FEATURE_GROUPS: readonly MarkupFeatureGroup[] = [
  'draw',
  'shapes',
  'lines',
  'text',
  'eraser',
  'style',
  'board',
  'actions',
];

/** Every feature, grouped in toolbar order. */
export const MARKUP_FEATURES: readonly MarkupFeature[] = MARKUP_FEATURE_GROUPS.flatMap((group) => GROUPS[group]);

const GROUP_OF = new Map<string, MarkupFeatureGroup>(
  MARKUP_FEATURE_GROUPS.flatMap((group) => GROUPS[group].map((feature) => [feature, group] as const)),
);

/** The features of a group. */
export function featuresOfGroup(group: MarkupFeatureGroup): readonly MarkupFeature[] {
  return GROUPS[group];
}

/** The group a feature belongs to. */
export function featureGroup(feature: MarkupFeature): MarkupFeatureGroup {
  return GROUP_OF.get(feature) as MarkupFeatureGroup;
}

function isGroup(name: string): name is MarkupFeatureGroup {
  return Object.prototype.hasOwnProperty.call(GROUPS, name);
}

/** A configuration that names something that does not exist, or has a value of the wrong type. */
export class MarkupFeaturesError extends Error {
  /** `unknownKey`: a group, item or key that does not exist; `invalidValue`: a value of the wrong type. */
  readonly kind: 'unknownKey' | 'invalidValue';
  /** Where the problem is, e.g. `"shapes.items.hexagon"`; empty for the configuration itself. */
  readonly path: string;

  constructor(kind: 'unknownKey' | 'invalidValue', path: string) {
    super(MarkupFeaturesError.describe(kind, path));
    this.name = 'MarkupFeaturesError';
    this.kind = kind;
    this.path = path;
  }

  private static describe(kind: 'unknownKey' | 'invalidValue', path: string): string {
    if (kind === 'unknownKey') return `Unknown key "${path}" in the markup features configuration.`;
    if (path === '') return 'The markup features configuration must be a JSON object.';
    const expected = path.endsWith('.items') || !path.includes('.') ? 'an object' : 'true or false';
    return `"${path}" in the markup features configuration must be ${expected}.`;
  }
}

type JSONObject = { readonly [key: string]: unknown };

function isObject(value: unknown): value is JSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Which tools, style buttons, board functions and selection actions the editor offers. Everything is on by default;
 * a feature is available when both it and its group are enabled. Select, undo/redo, zoom and the point editing of
 * polylines and curves are always available.
 *
 * Usually read from the same JSON file the iOS app ships:
 *
 *     { "draw": { "enabled": true, "items": { "pen": true, "highlighter": false } },
 *       "shapes": { "enabled": false },
 *       "lines": { "items": { "curve": false } } }
 *
 * Missing groups and items are enabled. Unknown names are errors (usually typos); keys starting with "_" are ignored
 * and can hold comments. Values are immutable: `with` and `withGroup` return changed copies.
 */
export class MarkupFeatures {
  /** Everything enabled. */
  static readonly all: MarkupFeatures = new MarkupFeatures(new Set(), new Set());

  private readonly offGroups: ReadonlySet<MarkupFeatureGroup>;
  private readonly offFeatures: ReadonlySet<MarkupFeature>;

  private constructor(disabledGroups: ReadonlySet<MarkupFeatureGroup>, disabledFeatures: ReadonlySet<MarkupFeature>) {
    this.offGroups = disabledGroups;
    this.offFeatures = disabledFeatures;
  }

  /** Reads a configuration (JSON text or the parsed value); throws `MarkupFeaturesError`. */
  static fromJSON(json: string | object): MarkupFeatures {
    let root: unknown = json;
    if (typeof json === 'string') {
      try {
        root = JSON.parse(json);
      } catch {
        throw new MarkupFeaturesError('invalidValue', '');
      }
    }
    if (!isObject(root)) throw new MarkupFeaturesError('invalidValue', '');
    const groups = new Set<MarkupFeatureGroup>();
    const features = new Set<MarkupFeature>();
    for (const groupName of Object.keys(root)) {
      if (groupName.startsWith('_')) continue;
      if (!isGroup(groupName)) throw new MarkupFeaturesError('unknownKey', groupName);
      const settings = root[groupName];
      if (!isObject(settings)) throw new MarkupFeaturesError('invalidValue', groupName);
      for (const key of Object.keys(settings)) {
        if (key.startsWith('_')) continue;
        if (key === 'enabled') {
          const enabled = settings[key];
          if (typeof enabled !== 'boolean') throw new MarkupFeaturesError('invalidValue', `${groupName}.enabled`);
          if (enabled) groups.delete(groupName);
          else groups.add(groupName);
        } else if (key === 'items') {
          const items = settings[key];
          if (!isObject(items)) throw new MarkupFeaturesError('invalidValue', `${groupName}.items`);
          for (const itemName of Object.keys(items)) {
            if (itemName.startsWith('_')) continue;
            const path = `${groupName}.items.${itemName}`;
            const feature = itemName as MarkupFeature;
            if (GROUP_OF.get(itemName) !== groupName) throw new MarkupFeaturesError('unknownKey', path);
            const enabled = items[itemName];
            if (typeof enabled !== 'boolean') throw new MarkupFeaturesError('invalidValue', path);
            if (enabled) features.delete(feature);
            else features.add(feature);
          }
        } else {
          throw new MarkupFeaturesError('unknownKey', `${groupName}.${key}`);
        }
      }
    }
    return new MarkupFeatures(groups, features);
  }

  /** Groups turned off as a whole. */
  get disabledGroups(): ReadonlySet<MarkupFeatureGroup> {
    return this.offGroups;
  }

  /** Features turned off one by one. */
  get disabledFeatures(): ReadonlySet<MarkupFeature> {
    return this.offFeatures;
  }

  isEnabled(feature: MarkupFeature): boolean {
    return !this.offGroups.has(featureGroup(feature)) && !this.offFeatures.has(feature);
  }

  /** Whether any feature of the group is available. */
  isGroupEnabled(group: MarkupFeatureGroup): boolean {
    return GROUPS[group].some((feature) => this.isEnabled(feature));
  }

  /** Whether the editor offers `tool` (Select always). */
  allows(tool: MarkupTool): boolean {
    return tool === 'select' || this.isEnabled(tool);
  }

  /** A copy with one feature turned on or off. */
  with(feature: MarkupFeature, enabled: boolean): MarkupFeatures {
    const features = new Set(this.offFeatures);
    if (enabled) features.delete(feature);
    else features.add(feature);
    return new MarkupFeatures(this.offGroups, features);
  }

  /** A copy with a whole group turned on or off. Features turned off one by one stay off. */
  withGroup(group: MarkupFeatureGroup, enabled: boolean): MarkupFeatures {
    const groups = new Set(this.offGroups);
    if (enabled) groups.delete(group);
    else groups.add(group);
    return new MarkupFeatures(groups, this.offFeatures);
  }

  equals(other: MarkupFeatures): boolean {
    const same = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
      a.size === b.size && [...a].every((value) => b.has(value));
    return same(this.offGroups, other.offGroups) && same(this.offFeatures, other.offFeatures);
  }

  /** Every group and item with its current value: a complete template for a configuration file. */
  toJSON(): { [group: string]: { enabled: boolean; items: { [feature: string]: boolean } } } {
    const result: { [group: string]: { enabled: boolean; items: { [feature: string]: boolean } } } = {};
    for (const group of MARKUP_FEATURE_GROUPS) {
      const items: { [feature: string]: boolean } = {};
      for (const feature of GROUPS[group]) items[feature] = !this.offFeatures.has(feature);
      result[group] = { enabled: !this.offGroups.has(group), items };
    }
    return result;
  }

  /** The template as text, byte for byte like the Swift package's `jsonData()`. */
  toJSONString(): string {
    return stringifySwiftJSON(this.toJSON() as JSONValue);
  }
}
