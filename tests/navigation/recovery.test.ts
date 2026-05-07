import { describe, expect, test } from 'bun:test';
import { EdgeMemory } from '../../src/navigation/recovery/EdgeMemory';
import { Recovery } from '../../src/navigation/recovery/Recovery';
import { CaptureRecorder } from './helpers';

describe('Recovery budgets', () => {
  test('transient replan exhausts separately from verified failures', () => {
    const rec = new CaptureRecorder('t_recovery');
    const r = new Recovery(14, 6, new EdgeMemory(), rec);
    let n = 0;
    while (n < 6) {
      const [e] = r.consumeTransientReplan('pre', { x: 0, y: 0, z: 0 });
      expect(e).toBeNull();
      n += 1;
    }
    const [fail] = r.consumeTransientReplan('pre', { x: 0, y: 0, z: 0 });
    expect(fail?.message).toBe('transient_replan_budget');
    expect(r.canReplan()).toBe(true);
  });

  test('replen budget rejects after exhaustion', () => {
    const rec = new CaptureRecorder('t_recovery2');
    const r = new Recovery(1, 6, new EdgeMemory(), rec);
    expect(r.consumeReplan('a', { x: 0, y: 0, z: 0 })[0]).toBeNull();
    expect(r.consumeReplan('b', { x: 0, y: 0, z: 0 })[0]?.message).toBe(
      'replan_budget',
    );
  });
});
