import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import type { UiEventBus } from '../ui/UiEventBus';
import type { AsyncResult } from '../shared/result';
import { parseReplayJsonlLine, sinkEventToUiLogLine } from './replayJsonl';
import type { ReplayState } from './ReplayState';
import type { ReplayCheckpointRow, ReplayLineIndex } from './pumpReplayFile';

export class ReplayDrive {
  public constructor(
    private readonly path: string,
    private readonly bus: UiEventBus,
    private readonly state: ReplayState,
    private readonly pulse: () => void,
    private readonly index: ReplayLineIndex[],
    private readonly checkpoints: ReplayCheckpointRow[],
  ) {}

  public timelineBounds(): { minTs: number; maxTs: number } {
    if (this.index.length === 0) return { minTs: 0, maxTs: 0 };
    const minTs = this.index[0]!.tsMs;
    const maxTs = this.index[this.index.length - 1]!.tsMs;
    return { minTs, maxTs };
  }

  private largestCheckpointBelow(targetLine: number): ReplayCheckpointRow {
    let best = this.checkpoints[0]!;
    for (const c of this.checkpoints) {
      if (c.afterLineIndex < targetLine) best = c;
    }
    return best;
  }

  private eventLineForTs(tsMs: number): number {
    if (this.index.length === 0) return -1;
    let lo = 0;
    let hi = this.index.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.index[mid]!.tsMs;
      if (v <= tsMs) {
        best = mid;
        lo = mid + 1;
        continue;
      }
      hi = mid - 1;
    }
    if (best < 0) return -1;
    return this.index[best]!.lineIndex;
  }

  public async seekToTsMs(tsMs: number): AsyncResult<number> {
    const targetLine = this.eventLineForTs(tsMs);
    if (targetLine < 0) {
      const init = this.checkpoints[0]!;
      this.state.loadSnapshot(init.snapshot as Record<string, unknown>);
      this.pulse();
      return [null, 0];
    }

    const direct = this.checkpoints.find(
      (c): boolean => c.afterLineIndex === targetLine,
    );
    if (direct !== undefined) {
      this.state.loadSnapshot(direct.snapshot as Record<string, unknown>);
      this.pulse();
      return [null, 0];
    }

    const cp = this.largestCheckpointBelow(targetLine);
    this.state.loadSnapshot(cp.snapshot as Record<string, unknown>);

    const rs = createReadStream(this.path, {
      encoding: 'utf8',
      start: cp.nextOffset,
    });
    const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

    let idx = cp.afterLineIndex + 1;
    let applied = 0;

    for await (const line of rl) {
      const [pe, ev] = parseReplayJsonlLine(line);
      if (pe !== null) continue;
      if (ev === null) continue;
      if (idx > targetLine) break;
      this.bus.emitLog(sinkEventToUiLogLine(ev));
      this.state.applyEvent(ev);
      this.pulse();
      applied += 1;
      if (idx === targetLine) break;
      idx += 1;
    }

    return [null, applied];
  }
}
