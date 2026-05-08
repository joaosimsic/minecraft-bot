import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import type { UiEventBus } from '../ui/UiEventBus';
import type { AsyncResult } from '../shared/result';
import { parseReplayJsonlLine, sinkEventToUiLogLine } from './replayJsonl';
import type { ReplayState } from './ReplayState';

export type ReplayLineIndex = {
  tsMs: number;
  offset: number;
  lineIndex: number;
};

export type ReplayCheckpointRow = {
  afterLineIndex: number;
  nextOffset: number;
  snapshot: Record<string, unknown>;
};

export type ReplayPumpResult = {
  count: number;
  index: ReplayLineIndex[];
  checkpoints: ReplayCheckpointRow[];
};

const CP_EVERY = 500;

export async function pumpReplayFile(
  path: string,
  bus: UiEventBus,
  state: ReplayState,
  pulse: () => void,
  onBadLine: (msg: string) => void,
): AsyncResult<ReplayPumpResult> {
  const index: ReplayLineIndex[] = [];
  const checkpoints: ReplayCheckpointRow[] = [
    {
      afterLineIndex: -1,
      nextOffset: 0,
      snapshot: state.exportSnapshot(),
    },
  ];

  const rs = createReadStream(path, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

  let bytePos = 0;
  let eventIdx = -1;
  let bad = 0;
  let n = 0;

  for await (const line of rl) {
    const lineStart = bytePos;
    bytePos += Buffer.byteLength(line, 'utf8') + 1;
    const [pe, ev] = parseReplayJsonlLine(line);
    if (pe !== null) {
      bad += 1;
      continue;
    }
    if (ev === null) continue;
    eventIdx += 1;
    const tsMs = Date.parse(ev.ts);
    const tsSafe = Number.isFinite(tsMs) ? tsMs : 0;
    index.push({ tsMs: tsSafe, offset: lineStart, lineIndex: eventIdx });
    bus.emitLog(sinkEventToUiLogLine(ev));
    state.applyEvent(ev);
    pulse();
    n += 1;
    if ((eventIdx + 1) % CP_EVERY === 0) {
      checkpoints.push({
        afterLineIndex: eventIdx,
        nextOffset: bytePos,
        snapshot: state.exportSnapshot(),
      });
    }
    if (n % 64 === 0) await new Promise<void>((r) => setImmediate(r));
  }

  if (bad > 0) onBadLine(`replay: skipped ${bad} bad line(s)`);
  return [null, { count: n, index, checkpoints }];
}
