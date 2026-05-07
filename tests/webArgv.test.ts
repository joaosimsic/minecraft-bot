import { expect, test } from 'bun:test';
import { parseWebArgv } from '../src/web/webArgv';

test('parseWebArgv > flags disable by default', () => {
  const r = parseWebArgv([]);
  expect(r.enable).toBe(false);
  expect(r.port).toBe(null);
});

test('parseWebArgv > parses --web', () => {
  const r = parseWebArgv(['x', '--web', 'y']);
  expect(r.enable).toBe(true);
});

test('parseWebArgv > parses --web-port', () => {
  const r = parseWebArgv(['--web-port=9099']);
  expect(r.port).toBe(9099);
});

test('parseWebArgv > rejects bad port strings', () => {
  expect(parseWebArgv(['--web-port=']).port).toBe(null);
  expect(parseWebArgv(['--web-port=0']).port).toBe(null);
  expect(parseWebArgv(['--web-port=x']).port).toBe(null);
  expect(parseWebArgv(['--web-port=70000']).port).toBe(null);
});
