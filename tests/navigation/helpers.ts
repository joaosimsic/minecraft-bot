import type { Bot } from 'mineflayer';
import { Logger } from '../../src/shared/Logger';
import { NavigationRecorder } from '../../src/navigation/telemetry/Recorder';
import type { WorldCell } from '../../src/navigation/world/World';

export function mockBot(
  x: number,
  y: number,
  z: number,
  vel?: { x: number; y: number; z: number },
): Bot {
  return {
    entity: {
      position: { x: x + 0.3, y, z: z + 0.4 },
      velocity: vel ?? { x: 0, y: 0, z: 0 },
    },
  } as Bot;
}

export const THIN_FLOOR: WorldCell = {
  blocksBody: false,
  topSupportStand: true,
};

export class CaptureRecorder extends NavigationRecorder {
  public readonly frames: Array<{
    type: string;
    data?: Record<string, unknown>;
  }> = [];

  public constructor(scope = 'capture') {
    super(new Logger('navigation', scope), scope, null);
  }
  public override emit(type: string, data?: Record<string, unknown>): void {
    this.frames.push({ type, data });
    super.emit(type, data);
  }
}
