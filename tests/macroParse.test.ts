import { describe, expect, test } from 'bun:test';
import {
  parseRunMacroLine,
  parseSaveMacroLine,
  splitMacroSteps,
} from '../src/core/macroParse';

describe('parseSaveMacroLine', (): void => {
  test('parses name and semicolon body', (): void => {
    const [err, p] = parseSaveMacroLine(':save mine-it "auto; stop"');
    expect(err).toBeNull();
    if (p === null) return;
    expect(p.name).toBe('mine-it');
    expect(p.body).toBe('auto; stop');
  });

  test('rejects missing quote', (): void => {
    const [err] = parseSaveMacroLine(':save x auto');
    expect(err).not.toBeNull();
  });

  test('allows escaped quote inside string', (): void => {
    const [err, p] = parseSaveMacroLine(':save q "\\"hi\\"; stop"');
    expect(err).toBeNull();
    if (p === null) return;
    expect(p.body).toBe('"hi"; stop');
  });

  test('rejects trailing junk after closing quote', (): void => {
    const [err] = parseSaveMacroLine(':save x "a" b');
    expect(err).not.toBeNull();
  });
});

describe('parseRunMacroLine', (): void => {
  test('parses name', (): void => {
    const [err, n] = parseRunMacroLine(':run foo-bar');
    expect(err).toBeNull();
    expect(n).toBe('foo-bar');
  });

  test('rejects invalid name', (): void => {
    const [err] = parseRunMacroLine(':run foo bar');
    expect(err).not.toBeNull();
  });
});

describe('splitMacroSteps', (): void => {
  test('trims and drops empties', (): void => {
    expect(splitMacroSteps(' a ; ; b ')).toEqual(['a', 'b']);
  });
});
