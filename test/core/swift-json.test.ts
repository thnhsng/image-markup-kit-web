import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { escapeSwiftString, formatSwiftNumber, stringifySwiftJSON, type JSONValue } from '../../src/codec/swift-json';
import { isMarkupError } from '../../src';

// Fixtures in test/fixtures/edge are Foundation's own output (tools/swift/json-edge-cases.swift).
function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/edge/${name}.json`, import.meta.url), 'utf8');
}

describe('stringifySwiftJSON', () => {
  for (const name of ['numbers', 'strings', 'containers', 'keys']) {
    it(`writes ${name} byte for byte like JSONEncoder`, () => {
      const expected = fixture(name);
      expect(stringifySwiftJSON(JSON.parse(expected) as JSONValue)).toBe(expected);
    });
  }

  it('leaves out members whose value is undefined', () => {
    expect(stringifySwiftJSON({ b: 1, a: undefined } as unknown as JSONValue)).toBe('{\n  "b" : 1\n}');
  });
});

describe('formatSwiftNumber', () => {
  it('uses exponent notation below 1e-4 and above 2^53', () => {
    expect(formatSwiftNumber(0.0001)).toBe('0.0001');
    expect(formatSwiftNumber(0.00009999)).toBe('9.999e-05');
    expect(formatSwiftNumber(2 ** 53)).toBe('9007199254740992');
    expect(formatSwiftNumber(2 ** 53 + 2)).toBe('9.007199254740994e+15');
    expect(formatSwiftNumber(-0)).toBe('-0');
    expect(formatSwiftNumber(1e100)).toBe('1e+100');
  });

  it('rejects non-finite numbers like JSONEncoder', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => formatSwiftNumber(value)).toThrow();
      try {
        formatSwiftNumber(value);
      } catch (error) {
        expect(isMarkupError(error) && error.code).toBe('invalidDocument');
      }
    }
  });
});

describe('escapeSwiftString', () => {
  it('replaces lone surrogates, which UTF-8 cannot carry', () => {
    expect(escapeSwiftString('a\uD800b')).toBe('"a�b"');
    expect(escapeSwiftString('\uDC00')).toBe('"�"');
    expect(escapeSwiftString('😀')).toBe('"😀"');
  });
});
