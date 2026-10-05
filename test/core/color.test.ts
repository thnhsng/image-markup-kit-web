import { describe, expect, it } from 'vitest';
import { parseHexColor } from '../../src';

describe('parseHexColor', () => {
  it('reads 8 and 6 hex digits', () => {
    expect(parseHexColor('#FF000080')).toBe('#FF000080');
    expect(parseHexColor('00FF00')).toBe('#00FF00FF');
    expect(parseHexColor('#ffcc004d')).toBe('#FFCC004D');
  });

  it('rejects other lengths and non-hex text', () => {
    expect(parseHexColor('#12')).toBeNull();
    expect(parseHexColor('#1234567')).toBeNull();
    expect(parseHexColor('#GG0000')).toBeNull();
    expect(parseHexColor('#FF 000')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });

  it('trims whitespace and newlines like Foundation', () => {
    expect(parseHexColor(' \n#00FF00\t')).toBe('#00FF00FF');
    expect(parseHexColor('\u0085#00FF00\u2028')).toBe('#00FF00FF');
    expect(parseHexColor('\uFEFF#00FF00')).toBeNull();
  });

  it('accepts a sign the way UInt64(_:radix:) does', () => {
    expect(parseHexColor('+FFFFF')).toBe('#0FFFFFFF');
    expect(parseHexColor('-00000')).toBe('#000000FF');
    expect(parseHexColor('-00001')).toBeNull();
  });
});
