import fs from 'node:fs';
import type { UiEventBus } from '../ui/UiEventBus';
import { wrap, type AsyncResult } from '../shared/result';
import { parseReplayJsonlLine, sinkEventToUiLogLine } from './replayJsonl';
import type { ReplayState } from './ReplayState';

export async function pumpReplayFile(
  path: string,
  bus: UiEventBus,
  state: ReplayState,
  pulse: () => void,
  onBadLine: (msg: string) => void,
): AsyncResult<number> {
  const [e, raw] = await wrap(fs.promises.readFile(path, 'utf8'));
  if (e !== null) return [e, null];
  if (raw === null) return [new Error('readFile returned null'), null];

  let n = 0;
  let bad = 0;
  let i = 0;
  for (const line of raw.split('\n')) {
    const [pe, ev] = parseReplayJsonlLine(line);
    if (pe !== null) {
      bad += 1;
      continue;
    }
    if (ev === null) continue;
    n += 1;
    bus.emitLog(sinkEventToUiLogLine(ev));
    state.applyEvent(ev);
    pulse();
    i += 1;
    if (i % 64 === 0) await new Promise<void>((r) => setImmediate(r));
  }

  if (bad > 0) onBadLine(`replay: skipped ${bad} bad line(s)`);
  return [null, n];
}
