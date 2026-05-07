import { describe, expect, test } from 'bun:test';
import { Vec3 } from 'vec3';
import {
  parseCoords,
  parseTargetKernels,
  type FleetParseView,
} from '../src/core/inputParse';
import type { BotKernel } from '../src/core/BotKernel';

function mockKernel(id: string): BotKernel {
  return { botId: id } as BotKernel;
}

class MockFleet implements FleetParseView {
  public readonly byId = new Map<string, BotKernel>();
  public focused: BotKernel | null = null;

  public resolveKernel(spec: string): BotKernel | null {
    const direct = this.byId.get(spec);
    if (direct !== undefined) return direct;
    const lower = spec.toLowerCase();
    for (const [k, v] of this.byId) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  public focusedKernel(): BotKernel | null {
    return this.focused;
  }

  public onlineKernels(): BotKernel[] {
    const out: BotKernel[] = [];
    for (const k of this.byId.values()) out.push(k);
    return out;
  }
}

describe('parseCoords', () => {
  test('parses three integers', () => {
    const v = parseCoords(['10', '64', '-3']);
    expect(v).toEqual(new Vec3(10, 64, -3));
  });

  test('rejects short input', () => {
    expect(parseCoords(['1', '2'])).toBeNull();
  });

  test('rejects NaN', () => {
    expect(parseCoords(['a', '1', '2'])).toBeNull();
  });
});

describe('parseTargetKernels', () => {
  test('@alice auto', () => {
    const f = new MockFleet();
    const a = mockKernel('alice');
    f.byId.set('alice', a);
    const { kernels, rest } = parseTargetKernels(f, '@alice auto');
    expect(kernels).toEqual([a]);
    expect(rest).toBe('auto');
  });

  test('@alice', () => {
    const f = new MockFleet();
    const a = mockKernel('alice');
    f.byId.set('alice', a);
    const { kernels, rest } = parseTargetKernels(f, '@alice');
    expect(kernels).toEqual([a]);
    expect(rest).toBe('');
  });

  test('auto with focus', () => {
    const f = new MockFleet();
    const b = mockKernel('bob');
    f.byId.set('bob', b);
    f.focused = b;
    const { kernels, rest } = parseTargetKernels(f, 'auto');
    expect(kernels).toEqual([b]);
    expect(rest).toBe('auto');
  });

  test('no focus', () => {
    const f = new MockFleet();
    const { kernels } = parseTargetKernels(f, 'auto');
    expect(kernels).toEqual([]);
  });

  test('@all uses online kernels', () => {
    const f = new MockFleet();
    const a = mockKernel('a');
    const b = mockKernel('b');
    f.byId.set('a', a);
    f.byId.set('b', b);
    const { kernels, rest } = parseTargetKernels(f, '@all stop');
    expect(new Set(kernels)).toEqual(new Set([a, b]));
    expect(rest).toBe('stop');
  });
});
