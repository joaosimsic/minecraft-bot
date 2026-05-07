import { describe, expect, test } from 'bun:test';
import { Metrics } from '../src/shared/Metrics';

describe('Metrics counter window', () => {
  test('windowCounterDelta subtracts last ingested sample', () => {
    const m = new Metrics();
    m.inc('blocks.dug', 5);
    m.ingestSampleForWindow();
    m.inc('blocks.dug', 3);
    const w = m.windowCounterDelta(['blocks.dug'], 60_000);
    expect(w['blocks.dug']).toBe(3);
  });
});
