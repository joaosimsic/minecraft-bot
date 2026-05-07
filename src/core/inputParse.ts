import { Vec3 } from 'vec3';
import type { BotKernel } from './BotKernel';

export type FleetParseView = {
  resolveKernel(spec: string): BotKernel | null;
  focusedKernel(): BotKernel | null;
  onlineKernels(): BotKernel[];
};

export function parseCoords(parts: string[]): Vec3 | null {
  if (parts.length < 3) return null;

  const a = parts[0];
  const b = parts[1];
  const c = parts[2];
  if (a === undefined || b === undefined || c === undefined) return null;

  const x = Number(a);
  const y = Number(b);
  const z = Number(c);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;

  return new Vec3(x, y, z);
}

export function parseTargetKernels(
  fleet: FleetParseView,
  line: string,
): { kernels: BotKernel[]; rest: string } {
  if (line.startsWith('@')) {
    const space = line.indexOf(' ');
    const idPart = space === -1 ? line.slice(1) : line.slice(1, space);
    const rest = space === -1 ? '' : line.slice(space + 1);
    if (idPart === 'all') return { kernels: fleet.onlineKernels(), rest };
    const k = fleet.resolveKernel(idPart);
    if (k === null) return { kernels: [], rest };
    return { kernels: [k], rest };
  }

  const k = fleet.focusedKernel();
  if (k === null) return { kernels: [], rest: line };
  return { kernels: [k], rest: line };
}
