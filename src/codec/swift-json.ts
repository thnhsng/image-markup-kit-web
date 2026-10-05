import { MarkupError } from '../model/errors';

/** A JSON value as `JSON.parse` returns it. */
export type JSONValue = null | boolean | number | string | readonly JSONValue[] | { readonly [key: string]: JSONValue };

const MAX_PLAIN_MAGNITUDE = 2 ** 53;
const MIN_PLAIN_MAGNITUDE = 1e-4;

/**
 * A number the way Foundation's JSONEncoder writes a Double: shortest round-trip digits, no trailing `.0`, `-0` for
 * negative zero, and exponent notation (`1e-05`, `1.5e+16`) below 1e-4 or above 2^53.
 */
export function formatSwiftNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new MarkupError('invalidDocument', `${value} cannot be written to JSON`);
  }
  if (Object.is(value, -0)) return '-0';
  const magnitude = Math.abs(value);
  if (magnitude > MAX_PLAIN_MAGNITUDE || (magnitude !== 0 && magnitude < MIN_PLAIN_MAGNITUDE)) {
    const [mantissa = '', exponent = ''] = value.toExponential().split('e');
    const sign = exponent.startsWith('-') ? '-' : '+';
    return `${mantissa}e${sign}${exponent.replace(/^[+-]/, '').padStart(2, '0')}`;
  }
  return String(value);
}

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '/': '\\/',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

// eslint-disable-next-line no-control-regex -- JSON requires escaping the C0 control characters.
const NEEDS_ESCAPE = /["\\/\u0000-\u001F]/g;

/**
 * Replaces lone UTF-16 surrogates with U+FFFD: they cannot be written as UTF-8, and Swift strings cannot hold them.
 * (No regex lookbehind: Safari before 16.4 rejects it.)
 */
function wellFormed(text: string): string {
  const replacement = String.fromCharCode(0xfffd);
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += text.slice(index, index + 2);
        index += 1;
      } else {
        result += replacement;
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      result += replacement;
    } else {
      result += text.charAt(index);
    }
  }
  return result;
}

/** A string the way Foundation's JSONEncoder writes it: `\/`, short escapes, `\u00xx` for other controls. */
export function escapeSwiftString(text: string): string {
  const escaped = wellFormed(text).replace(
    NEEDS_ESCAPE,
    (character) => SHORT_ESCAPES[character] ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `"${escaped}"`;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(value: JSONValue, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return formatSwiftNumber(value);
  if (typeof value === 'string') return escapeSwiftString(value);
  const inner = `${indent}  `;
  if (isArray(value)) {
    if (value.length === 0) return `[\n\n${indent}]`;
    return `[\n${value.map((element) => inner + write(element, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort(compareKeys);
  if (keys.length === 0) return `{\n\n${indent}}`;
  const members = keys.map((key) => `${inner}${escapeSwiftString(key)} : ${write(value[key] as JSONValue, inner)}`);
  return `{\n${members.join(',\n')}\n${indent}}`;
}

function isArray(value: JSONValue): value is readonly JSONValue[] {
  return Array.isArray(value);
}

/**
 * Serializes like Foundation's `JSONEncoder` with `[.prettyPrinted, .sortedKeys]`: two-space indent, `"key" : value`,
 * keys in code-unit order, every array element on its own line, empty containers as `[\n\n]`, no trailing newline.
 * Object members whose value is `undefined` are left out.
 */
export function stringifySwiftJSON(value: JSONValue): string {
  return write(value, '');
}
