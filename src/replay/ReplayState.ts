import type {
  BotPhase,
  FleetRowSnapshot,
  FocusedStatusSnapshot,
} from '../core/BotFleet';
import type { EnvUpdateSnapshot, UiStatusPayload } from '../ui/UiEventBus';
import type { SinkEvent } from '../shared/Sink';

type Row = {
  phase: BotPhase;
  online: boolean;
  modeLabel: string;
  lastError: string | null;
  pos: { x: number; y: number; z: number } | null;
  health: number | null;
  food: number | null;
  taskLine: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v === null) return null;
  if (typeof v !== 'object') return null;
  return v as Record<string, unknown>;
}

function readNum(o: Record<string, unknown>, k: string): number | null {
  const x = o[k];
  if (typeof x !== 'number' || Number.isNaN(x)) return null;
  return x;
}

function readPos(
  data: Record<string, unknown> | undefined,
): { x: number; y: number; z: number } | null {
  if (data === undefined) return null;
  const p = data['pos'];
  const pr = asRecord(p);
  if (pr === null) return null;
  const x = readNum(pr, 'x');
  const y = readNum(pr, 'y');
  const z = readNum(pr, 'z');
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function readString(
  data: Record<string, unknown> | undefined,
  k: string,
): string | null {
  if (data === undefined) return null;
  const v = data[k];
  if (typeof v !== 'string') return null;
  return v;
}

export class ReplayState {
  private readonly rows = new Map<string, Row>();
  private focusedId = '';
  private readonly envLog: EnvUpdateSnapshot[] = [];

  private defaultRow(): Row {
    return {
      phase: 'connecting',
      online: false,
      modeLabel: 'IdleMode',
      lastError: null,
      pos: null,
      health: null,
      food: null,
      taskLine: null,
    };
  }

  private touchBot(id: string): Row {
    let r = this.rows.get(id);
    if (r === undefined) {
      r = this.defaultRow();
      this.rows.set(id, r);
    }
    return r;
  }

  public applyEvent(ev: SinkEvent): void {
    const id = ev.botId;
    if (id !== undefined && id.length > 0) this.touchBot(id);

    const data = ev.data;
    const dr = asRecord(data);

    const t = ev.type;
    if (t === 'spawn') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      r.online = true;
      r.phase = 'running';
      return;
    }

    if (t === 'disconnect') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      r.online = false;
      r.phase = 'disconnected';
      return;
    }

    if (t === 'bot_error') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      const msg = dr === null ? null : readString(dr, 'msg');
      r.lastError = msg ?? 'error';
      return;
    }

    if (t === 'kicked') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      const reason = dr === null ? null : readString(dr, 'reason');
      r.lastError = reason ?? 'kicked';
      return;
    }

    if (t === 'position' || t === 'forced_move') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      const p = readPos(dr ?? undefined);
      if (p !== null) r.pos = p;
      return;
    }

    if (t === 'health') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      if (dr === null) return;
      const hp = readNum(dr, 'hp');
      const food = readNum(dr, 'food');
      if (hp !== null) r.health = hp;
      if (food !== null) r.food = food;
      return;
    }

    if (t === 'mode_switch') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      const to = dr === null ? null : readString(dr, 'to');
      if (to !== null) r.modeLabel = to;
      return;
    }

    if (t === 'mode_stop' || t === 'halt') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      r.modeLabel = 'IdleMode';
      return;
    }

    if (t === 'target_set') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      if (dr === null) return;
      const x = readNum(dr, 'x');
      const y = readNum(dr, 'y');
      const z = readNum(dr, 'z');
      if (x === null || y === null || z === null) return;
      r.taskLine = `nav (${x}, ${y}, ${z})`;
      return;
    }

    if (t === 'target_reached' || t === 'target_failed') {
      if (id === undefined) return;
      const r = this.touchBot(id);
      r.taskLine = null;
      return;
    }

    if (t === 'env_update') {
      if (id === undefined) return;
      if (dr === null) return;
      const x = readNum(dr, 'x');
      const y = readNum(dr, 'y');
      const z = readNum(dr, 'z');
      const blockName = readString(dr, 'blockName');
      const mcb = readString(dr, 'movementClassBefore');
      const mca = readString(dr, 'movementClassAfter');
      if (x === null || y === null || z === null) return;
      if (blockName === null || mcb === null || mca === null) return;
      const entry: EnvUpdateSnapshot = {
        ts: ev.ts,
        botId: id,
        x,
        y,
        z,
        blockName,
        movementClassBefore: mcb,
        movementClassAfter: mca,
      };
      const topTid = ev.trace_id;
      if (typeof topTid === 'string' && topTid.length > 0)
        entry.trace_id = topTid;
      this.envLog.push(entry);
      if (this.envLog.length > 500) {
        const drop = this.envLog.length - 500;
        this.envLog.splice(0, drop);
      }
      return;
    }
  }

  public onlineBotIds(): string[] {
    const out: string[] = [];
    for (const [bid, r] of this.rows) {
      if (r.online) out.push(bid);
    }
    return out.sort();
  }

  public allIds(): string[] {
    return [...this.rows.keys()].sort();
  }

  public setFocus(botId: string): boolean {
    if (!this.rows.has(botId)) return false;
    this.focusedId = botId;
    return true;
  }

  public forgetIfOffline(botId: string): boolean {
    const r = this.rows.get(botId);
    if (r === undefined) return false;
    if (r.online) return false;
    this.rows.delete(botId);
    if (this.focusedId === botId) {
      const next = this.allIds()[0];
      this.focusedId = next === undefined ? '' : next;
    }
    return true;
  }

  private formatPosLabel(
    p: { x: number; y: number; z: number } | null,
  ): string | null {
    if (p === null) return null;
    return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
  }

  public toPayload(homeXZ: { x: number; z: number } | null): UiStatusPayload {
    const ids = this.allIds();
    if (this.focusedId.length === 0 && ids.length > 0) this.focusedId = ids[0]!;

    const fleet: FleetRowSnapshot[] = [];
    for (const bid of ids) {
      const r = this.rows.get(bid)!;
      fleet.push({
        botId: bid,
        phase: r.phase,
        modeLabel: r.modeLabel,
        online: r.online,
        lastError: r.lastError,
        positionLabel: this.formatPosLabel(r.pos),
        mapX: r.pos === null ? null : r.pos.x,
        mapZ: r.pos === null ? null : r.pos.z,
      });
    }

    const fid = this.focusedId;
    let focused: FocusedStatusSnapshot | null = null;
    if (fid.length > 0) {
      const r = this.rows.get(fid);
      if (r !== undefined) {
        focused = {
          botId: fid,
          phase: r.phase,
          modeLabel: r.modeLabel,
          positionLabel: this.formatPosLabel(r.pos),
          lastError: r.lastError,
          online: r.online,
          health: r.health,
          food: r.food,
          telemetryLine: 'replay',
          taskLine: r.taskLine,
        };
      }
    }

    const envTail =
      this.envLog.length === 0 ? undefined : this.envLog.slice(-20);

    return { focused, fleet, focusedId: fid, homeXZ, envTail };
  }

  public exportSnapshot(): Record<string, unknown> {
    const rows: Record<string, unknown> = {};
    for (const [id, r] of this.rows) {
      rows[id] = {
        phase: r.phase,
        online: r.online,
        modeLabel: r.modeLabel,
        lastError: r.lastError,
        pos: r.pos,
        health: r.health,
        food: r.food,
        taskLine: r.taskLine,
      };
    }
    return {
      focusedId: this.focusedId,
      rows,
      envLog: this.envLog.slice(),
    };
  }

  public loadSnapshot(raw: Record<string, unknown>): void {
    this.rows.clear();
    this.envLog.length = 0;
    const fid = raw['focusedId'];
    this.focusedId = typeof fid === 'string' ? fid : '';
    const rowsRaw = raw['rows'];
    if (rowsRaw !== null && typeof rowsRaw === 'object') {
      for (const [id, v] of Object.entries(
        rowsRaw as Record<string, unknown>,
      )) {
        if (typeof v !== 'object' || v === null) continue;
        const o = v as Record<string, unknown>;
        const ph = o['phase'];
        const phase: BotPhase =
          ph === 'connecting' ||
          ph === 'spawned' ||
          ph === 'running' ||
          ph === 'disconnected'
            ? ph
            : 'connecting';
        const posRaw = o['pos'];
        let pos: { x: number; y: number; z: number } | null = null;
        if (posRaw !== null && typeof posRaw === 'object') {
          const pr = posRaw as Record<string, unknown>;
          const px = readNum(pr, 'x');
          const py = readNum(pr, 'y');
          const pz = readNum(pr, 'z');
          if (px !== null && py !== null && pz !== null)
            pos = { x: px, y: py, z: pz };
        }
        const hp = readNum(o, 'health');
        const fd = readNum(o, 'food');
        const ml = readString(o, 'modeLabel');
        const le = o['lastError'];
        const tl = o['taskLine'];
        const on = o['online'];
        this.rows.set(id, {
          phase,
          online: on === true,
          modeLabel: ml ?? 'IdleMode',
          lastError: typeof le === 'string' ? le : null,
          pos,
          health: hp,
          food: fd,
          taskLine: typeof tl === 'string' ? tl : null,
        });
      }
    }
    const env = raw['envLog'];
    if (!Array.isArray(env)) return;
    for (const e of env) {
      if (typeof e !== 'object' || e === null) continue;
      this.envLog.push(e as EnvUpdateSnapshot);
    }
  }
}
