import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKUP_FEATURES, MarkupFeatures, MarkupFeaturesError, featureGroup, featuresOfGroup } from '../../src';

function features(json: string): MarkupFeatures {
  return MarkupFeatures.fromJSON(json);
}

function errorOf(run: () => unknown): MarkupFeaturesError {
  try {
    run();
  } catch (error) {
    if (error instanceof MarkupFeaturesError) return error;
    throw error;
  }
  throw new Error('expected a MarkupFeaturesError');
}

const fixture = (name: string) => readFileSync(new URL(`../fixtures/swift/${name}`, import.meta.url), 'utf8');

// Port of MarkupFeaturesTests (configuration file part).
describe('MarkupFeatures', () => {
  it('turns groups and items off', () => {
    const config = features(`{
      "_comment": "ignored",
      "shapes": { "enabled": false, "items": { "star": true } },
      "draw": { "items": { "highlighter": false } },
      "lines": { "enabled": true }
    }`);
    expect(config.isEnabled('star')).toBe(false);
    expect(config.isGroupEnabled('shapes')).toBe(false);
    expect(config.isEnabled('highlighter')).toBe(false);
    expect(config.isEnabled('pen')).toBe(true);
    expect(config.isEnabled('curve')).toBe(true);
    expect(config.isEnabled('delete')).toBe(true);
    expect(config.isGroupEnabled('draw')).toBe(true);
  });

  it('turns a group with every item off off', () => {
    expect(features('{ "text": { "items": { "text": false, "note": false } } }').isGroupEnabled('text')).toBe(false);
  });

  it('reports unknown names and wrong types', () => {
    const cases: Array<[string, 'unknownKey' | 'invalidValue', string]> = [
      ['{ "shape": { "enabled": false } }', 'unknownKey', 'shape'],
      ['{ "draw": { "items": { "hightlighter": false } } }', 'unknownKey', 'draw.items.hightlighter'],
      ['{ "draw": { "items": { "star": false } } }', 'unknownKey', 'draw.items.star'],
      ['{ "draw": { "tools": { "pen": false } } }', 'unknownKey', 'draw.tools'],
      ['{ "draw": { "enabled": "no" } }', 'invalidValue', 'draw.enabled'],
      ['{ "shapes": false }', 'invalidValue', 'shapes'],
      ['{ "lines": { "items": { "curve": 0 } } }', 'invalidValue', 'lines.items.curve'],
      ['{ "lines": { "items": [] } }', 'invalidValue', 'lines.items'],
      ['{ "lines": null }', 'invalidValue', 'lines'],
    ];
    for (const [json, kind, path] of cases) {
      const error = errorOf(() => features(json));
      expect([error.kind, error.path]).toEqual([kind, path]);
    }
    expect(errorOf(() => features('{ "shapes": false }')).message).toBe(
      '"shapes" in the markup features configuration must be an object.',
    );
    expect(errorOf(() => features('{ "draw": { "enabled": "no" } }')).message).toBe(
      '"draw.enabled" in the markup features configuration must be true or false.',
    );
    expect(errorOf(() => features('{ "shape": {} }')).message).toBe(
      'Unknown key "shape" in the markup features configuration.',
    );
    expect(errorOf(() => features('[]')).path).toBe('');
    expect(errorOf(() => features('{')).path).toBe('');
  });

  it('writes a complete template that reads back, byte for byte like Swift', () => {
    const config = MarkupFeatures.all.withGroup('board', false).with('curve', false);
    const json = config.toJSONString();
    for (const feature of MARKUP_FEATURES) expect(json).toContain(`"${feature}"`);
    expect(MarkupFeatures.fromJSON(json).equals(config)).toBe(true);
    expect(json).toBe(fixture('features-board-curve-off.json'));
    expect(MarkupFeatures.all.toJSONString()).toBe(fixture('features-all.json'));
    expect(MarkupFeatures.fromJSON(fixture('features-all.json')).equals(MarkupFeatures.all)).toBe(true);
  });

  it('maps tools to their feature', () => {
    let config = MarkupFeatures.all.with('circle', false);
    expect(config.allows('circle')).toBe(false);
    expect(config.allows('oval')).toBe(true);
    config = config.withGroup('draw', false);
    expect(config.allows('pen')).toBe(false);
    expect(config.allows('select')).toBe(true);
  });

  it('keeps items turned off one by one when their group comes back', () => {
    const config = MarkupFeatures.all.with('pen', false).withGroup('draw', false).withGroup('draw', true);
    expect(config.isEnabled('pen')).toBe(false);
    expect(config.isEnabled('highlighter')).toBe(true);
  });

  it('is immutable', () => {
    const changed = MarkupFeatures.all.with('pen', false);
    expect(MarkupFeatures.all.isEnabled('pen')).toBe(true);
    expect(changed.disabledFeatures.has('pen')).toBe(true);
  });

  it('lists groups and features in toolbar order', () => {
    expect(featuresOfGroup('lines')).toEqual(['arrow', 'polyline', 'curve']);
    expect(featureGroup('highlightBox')).toBe('shapes');
    expect(MARKUP_FEATURES).toHaveLength(32);
  });
});
