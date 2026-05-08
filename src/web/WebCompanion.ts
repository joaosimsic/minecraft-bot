import type { UiLogLine } from '../shared/Logger';
import type { UiEventBus, UiStatusPayload } from '../ui/UiEventBus';

const LOG_CAP = 500;

const emptyStatus = (): UiStatusPayload => ({
  focused: null,
  fleet: [],
  focusedId: '',
  homeXZ: null,
});

function parseLogsLimit(search: URLSearchParams): number {
  const raw = search.get('limit');
  if (raw === null) return 500;
  const n = Number(raw);
  if (!Number.isInteger(n)) return 500;
  if (n < 1) return 1;
  if (n > 2000) return 2000;
  return n;
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>minecraft-bot</title>
<style>
body{font-family:ui-monospace,monospace;margin:0;padding:12px;background:#0b0f14;color:#e6edf3}
h1{font-size:16px;margin:0 0 12px}
h2{font-size:13px;margin:0 0 8px;color:#8b949e;font-weight:600}
.grid{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:900px){.grid{grid-template-columns:1fr 1fr}}
.panel{border:1px solid #30363d;border-radius:6px;padding:10px;background:#10161d}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:4px 6px;text-align:left;border-bottom:1px solid #21262d}
.on{color:#3fb950}.off{color:#f85149}
#log{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;font-size:12px;line-height:1.35}
#meta{font-size:12px;color:#8b949e;margin-bottom:8px}
#worldCanvas{display:block;border:1px solid #30363d;border-radius:4px;background:#161b22;image-rendering:pixelated}
#envList{font-size:11px;color:#8b949e;max-height:120px;overflow:auto;margin-top:8px}
.legend{font-size:11px;color:#8b949e;margin-top:6px}
</style>
</head>
<body>
<h1>fleet</h1>
<div id="meta">ws: <span id="ws">…</span></div>
<div class="grid">
<div class="panel">
<table id="fleet"><thead><tr><th>id</th><th>on</th><th>phase</th><th>mode</th><th>pos</th><th>err</th></tr></thead><tbody></tbody></table>
</div>
<div class="panel">
<div id="focused">no focus</div>
</div>
</div>
<div class="panel" style="margin-top:12px">
<h2>worldview (movement class)</h2>
<canvas id="worldCanvas" width="256" height="256"></canvas>
<div class="legend">green=ground blue=water · magenta=path · red=rejected · orange=search heat</div>
<div id="replayPanel" style="display:none;margin-top:10px;font-size:12px">
<label>replay scrub <input type="range" id="replayScrub" style="width:220px;vertical-align:middle"/> <button type="button" id="replaySeekBtn">seek to time</button></label>
</div>
<div id="failSnap" style="display:none;font-size:11px;margin-top:8px;color:#8b949e;white-space:pre-wrap;word-break:break-word"></div>
<div id="envList"></div>
</div>
<div class="panel" style="margin-top:12px">
<div id="log"></div>
</div>
<script>
(() => {
  const fleetBody = document.querySelector('#fleet tbody');
  const focusedEl = document.getElementById('focused');
  const logEl = document.getElementById('log');
  const wsEl = document.getElementById('ws');
  const canvas = document.getElementById('worldCanvas');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  const envListEl = document.getElementById('envList');
  let lines = [];
  let gridState = { ax: 0, ay: 0, az: 0, side: 16, cells: [] };
  let pathCells = [];
  let rejectCells = [];

  let heatCells = [];
  let heatTrace = '';

  function parseNodeXZ(key) {
    if (!key) return null;
    const base = String(key).split('|')[0];
    const parts = base.split(',');
    if (parts.length < 3) return null;
    const x = Number(parts[0]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x: x, z: z };
  }

  function toGridXZ(wx, wz) {
    const dx = wx - gridState.ax;
    const dz = wz - gridState.az;
    if (dx < -8 || dx > 7 || dz < -8 || dz > 7) return null;
    return { gx: dx + 8, gz: dz + 8 };
  }

  function drawWorld() {
    if (!ctx || !canvas) return;
    const side = gridState.side || 16;
    const cw = canvas.width / side;
    const ch = canvas.height / side;
    const cells = gridState.cells || [];
    for (let gz = 0; gz < side; gz++) {
      for (let gx = 0; gx < side; gx++) {
        const idx = gz * side + gx;
        const c = cells[idx] === 'w' ? '#1f6feb' : '#238636';
        ctx.fillStyle = c;
        ctx.fillRect(gx * cw, gz * ch, cw + 0.5, ch + 0.5);
      }
    }
    ctx.fillStyle = 'rgba(255, 140, 0, 0.35)';
    for (const h of heatCells) {
      const hx = h && typeof h.x === 'number' ? h.x : null;
      const hz = h && typeof h.z === 'number' ? h.z : null;
      const hn = h && typeof h.n === 'number' ? h.n : 0;
      if (hx === null || hz === null) continue;
      const g = toGridXZ(hx, hz);
      if (!g) continue;
      const a = Math.min(0.65, 0.12 + Math.log1p(hn) * 0.07);
      ctx.fillStyle = 'rgba(255, 140, 0, ' + String(a) + ')';
      if (g.gx < 0 || g.gz < 0 || g.gx >= side || g.gz >= side) continue;
      ctx.fillRect(g.gx * cw, g.gz * ch, cw + 0.5, ch + 0.5);
    }
    ctx.fillStyle = 'rgba(219, 97, 162, 0.55)';
    for (const p of pathCells) {
      if (p.gx < 0 || p.gz < 0 || p.gx >= side || p.gz >= side) continue;
      ctx.fillRect(p.gx * cw, p.gz * ch, cw + 0.5, ch + 0.5);
    }
    ctx.fillStyle = 'rgba(248, 81, 73, 0.65)';
    for (const p of rejectCells) {
      if (p.gx < 0 || p.gz < 0 || p.gx >= side || p.gz >= side) continue;
      ctx.fillRect(p.gx * cw + cw * 0.25, p.gz * ch + ch * 0.25, cw * 0.5, ch * 0.5);
    }
  }

  function applyNavHeatmapClear(msg) {
    if (!msg || msg.type !== 'nav_heatmap_clear') return;
    heatCells = [];
    if (msg.trace_id) heatTrace = String(msg.trace_id);
    drawWorld();
  }

  function applyNavHeatmap(msg) {
    if (!msg || msg.type !== 'nav_heatmap') return;
    if (msg.trace_id && heatTrace && String(msg.trace_id) !== heatTrace) return;
    heatCells = Array.isArray(msg.cells) ? msg.cells : [];
    drawWorld();
  }

  function applyMovementFail(msg) {
    if (!msg || msg.type !== 'movement_fail') return;
    const el = document.getElementById('failSnap');
    if (!el) return;
    const pl = msg.payload || {};
    const snap = pl.world_snapshot;
    if (!snap) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.textContent = 'failure snapshot v' + String(snap.v) + ' @' + snap.ax + ',' + snap.ay + ',' + snap.az + ' palette=' + JSON.stringify(snap.palette) + ' i=' + JSON.stringify(snap.i);
  }

  function applyReplayReady(msg) {
    if (!msg || msg.type !== 'replay_ready') return;
    const panel = document.getElementById('replayPanel');
    const scrub = document.getElementById('replayScrub');
    if (!panel || !scrub) return;
    panel.style.display = 'block';
    scrub.min = String(msg.minTs || 0);
    scrub.max = String(msg.maxTs || 0);
    scrub.value = String(msg.maxTs || 0);
  }

  function wireReplaySeek(socket) {
    const btn = document.getElementById('replaySeekBtn');
    if (!btn || !socket) return;
    btn.addEventListener('click', function () {
      const scrub = document.getElementById('replayScrub');
      const v = scrub ? Number(scrub.value) : 0;
      socket.send(JSON.stringify({ type: 'replay_seek', tsMs: v }));
    });
  }

  function applyNavTrace(msg) {
    if (!msg || msg.type !== 'nav_trace') return;
    const nk = msg.navKind;
    const data = msg.data || {};
    if (nk === 'path_selected') {
      rejectCells = [];
      heatCells = [];
      const actions = data.actions;
      pathCells = [];
      if (Array.isArray(actions)) {
        for (const a of actions) {
          const to = a && a.to_node ? parseNodeXZ(String(a.to_node)) : null;
          if (!to) continue;
          const g = toGridXZ(to.x, to.z);
          if (g) pathCells.push(g);
        }
      }
      drawWorld();
      return;
    }
    if (nk === 'candidate_rejected') {
      const toK = data.to ? parseNodeXZ(String(data.to)) : null;
      if (!toK) return;
      const g = toGridXZ(toK.x, toK.z);
      if (g) {
        rejectCells.push(g);
        if (rejectCells.length > 400) rejectCells = rejectCells.slice(-400);
      }
      drawWorld();
    }
  }

  function applyWorldGrid(msg) {
    if (!msg || msg.type !== 'world_grid') return;
    gridState = {
      ax: Number(msg.anchorX) || 0,
      ay: Number(msg.anchorY) || 0,
      az: Number(msg.anchorZ) || 0,
      side: Number(msg.side) || 16,
      cells: Array.isArray(msg.cells) ? msg.cells : [],
    };
    pathCells = [];
    rejectCells = [];
    heatCells = [];
    drawWorld();
  }

  function row(on, cols) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      td.textContent = c.text;
      if (c.cls) td.className = c.cls;
      tr.appendChild(td);
    }
    return tr;
  }

  function fmtFocus(f) {
    if (!f) return 'no focus';
    const parts = [];
    parts.push(String(f.botId));
    parts.push(String(f.phase));
    parts.push(String(f.modeLabel));
    if (f.positionLabel) parts.push(String(f.positionLabel));
    parts.push(f.online ? 'online' : 'offline');
    parts.push('hp=' + String(f.health));
    parts.push('food=' + String(f.food));
    if (f.lastError) parts.push('err=' + String(f.lastError));
    if (f.telemetryLine) parts.push(String(f.telemetryLine));
    if (f.taskLine) parts.push(String(f.taskLine));
    return parts.filter((s)=>s.length>0).join(' | ');
  }

  function renderEnvTail(p) {
    if (!envListEl) return;
    envListEl.textContent = '';
    const tail = p && p.envTail ? p.envTail : [];
    if (tail.length === 0) {
      envListEl.textContent = 'no env_update in replay tail';
      return;
    }
    for (const e of tail) {
      const row = document.createElement('div');
      const tid = e.trace_id ? ' trace=' + String(e.trace_id).slice(0, 8) : '';
      row.textContent = String(e.ts).slice(11, 23) + ' ' + String(e.botId) + ' @' + e.x + ',' + e.y + ',' + e.z + ' ' + String(e.blockName) + ' ' + String(e.movementClassBefore) + '→' + String(e.movementClassAfter) + tid;
      envListEl.appendChild(row);
    }
  }

  function applyStatus(p) {
    if (!fleetBody || !focusedEl) return;
    fleetBody.textContent = '';
    for (const r of (p && p.fleet) ? p.fleet : []) {
      const id = String(r.botId);
      const on = !!r.online;
      const cols = [
        { text: id, cls: '' },
        { text: on ? 'on' : 'off', cls: on ? 'on' : 'off' },
        { text: String(r.phase), cls: '' },
        { text: String(r.modeLabel), cls: '' },
        { text: r.positionLabel === null ? '' : String(r.positionLabel), cls: '' },
        { text: r.lastError === null ? '' : String(r.lastError), cls: '' },
      ];
      fleetBody.appendChild(row(on, cols));
    }
    const f = p ? p.focused : null;
    focusedEl.textContent = fmtFocus(f);
    renderEnvTail(p);
  }

  function pushLogLine(line) {
    lines.push(line);
    if (lines.length > 900) lines = lines.slice(lines.length - 900);
    if (!logEl) return;
    const ts = line.ts ? String(line.ts) : '';
    const lvl = line.level ? String(line.level) : '';
    const id = line.botId === null ? 'sys' : String(line.botId);
    const t = line.text !== undefined ? String(line.text) : '';
    const span = document.createElement('div');
    span.textContent = ts + ' [' + lvl + '] [' + id + '] ' + t;
    logEl.appendChild(span);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function hydrateSnapshot(msg) {
    if (msg && msg.status) applyStatus(msg.status);
    if (!msg || !msg.logs) return;
    if (logEl) logEl.textContent = '';
    lines = [];
    for (const l of msg.logs) pushLogLine(l);
  }

  fetch('/api/status').then(function (r) { return r.json(); }).then(applyStatus);

  var scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  var url = scheme + '://' + window.location.host + '/ws';
  var socket = new WebSocket(url);
  wireReplaySeek(socket);
  if (wsEl) wsEl.textContent = url;
  socket.onopen = function () {
    if (wsEl) wsEl.textContent = 'open — ' + url;
  };
  socket.onclose = function () {
    if (wsEl) wsEl.textContent = 'closed';
  };
  socket.onerror = function () {
    if (wsEl) wsEl.textContent = 'error';
  };
  socket.onmessage = function (ev) {
    var raw = typeof ev.data === 'string' ? ev.data : '';
    var msg = null;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || !msg.type) return;
    if (msg.type === 'snapshot') hydrateSnapshot(msg);
    if (msg.type === 'status') applyStatus(msg.payload);
    if (msg.type === 'log') pushLogLine(msg.line);
    if (msg.type === 'world_grid') applyWorldGrid(msg);
    if (msg.type === 'nav_trace') applyNavTrace(msg);
    if (msg.type === 'nav_heatmap') applyNavHeatmap(msg);
    if (msg.type === 'nav_heatmap_clear') applyNavHeatmapClear(msg);
    if (msg.type === 'movement_fail') applyMovementFail(msg);
    if (msg.type === 'replay_ready') applyReplayReady(msg);
  };
})();
</script>
</body>
</html>`;
}

type WsData = undefined;

export class WebCompanion {
  private server: Bun.Server<WsData> | null = null;
  private readonly sockets = new Set<Bun.ServerWebSocket<WsData>>();
  private unsubLog: (() => void) | null = null;
  private unsubStatus: (() => void) | null = null;
  private unsubCompanion: (() => void) | null = null;
  private lastStatus: UiStatusPayload | null = null;
  private readonly logRing: UiLogLine[] = [];
  private onClientWsText: ((text: string) => void) | null = null;

  public setClientWsHandler(handler: ((text: string) => void) | null): void {
    this.onClientWsText = handler;
  }

  private pushLine(line: UiLogLine): void {
    this.logRing.push(line);
    if (this.logRing.length > LOG_CAP) {
      const drop = this.logRing.length - LOG_CAP;
      this.logRing.splice(0, drop);
    }
  }

  private recentLogs(limit: number): UiLogLine[] {
    if (this.logRing.length <= limit) return [...this.logRing];
    const start = this.logRing.length - limit;
    return this.logRing.slice(start);
  }

  private snapshotPacket(logLimit: number): Record<string, unknown> {
    return {
      type: 'snapshot',
      status: this.lastStatus ?? emptyStatus(),
      logs: this.recentLogs(logLimit),
    };
  }

  private broadcast(msg: Record<string, unknown>): void {
    const s = JSON.stringify(msg);
    for (const w of this.sockets) w.send(s);
  }

  private handleFetch(
    req: Request,
    server: Bun.Server<WsData>,
  ): Response | undefined {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded)
        return new Response('ws upgrade rejected', {
          status: 500,
        });
      return undefined;
    }

    if (url.pathname === '/api/status')
      return new Response(JSON.stringify(this.lastStatus ?? emptyStatus()), {
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url.pathname === '/api/logs')
      return new Response(
        JSON.stringify({
          lines: this.recentLogs(parseLogsLimit(url.searchParams)),
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
        },
      );

    if (url.pathname === '/' || url.pathname === '')
      return new Response(dashboardHtml(), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });

    return new Response('not found', {
      status: 404,
    });
  }

  private onWsOpen(ws: Bun.ServerWebSocket<WsData>): void {
    this.sockets.add(ws);
    const snap = JSON.stringify(this.snapshotPacket(500));
    ws.send(snap);
  }

  private onWsClose(ws: Bun.ServerWebSocket<WsData>): void {
    this.sockets.delete(ws);
  }

  private wireBus(bus: UiEventBus): void {
    const uLog = bus.onLog((line): void => {
      this.pushLine(line);
      this.broadcast({
        type: 'log',
        line,
      });
    });
    const uSt = bus.onStatus((payload): void => {
      this.lastStatus = payload;
      this.broadcast({
        type: 'status',
        payload,
      });
    });
    const uCo = bus.onCompanion((msg): void => {
      this.broadcast(msg);
    });
    this.unsubLog = uLog;
    this.unsubStatus = uSt;
    this.unsubCompanion = uCo;
  }

  public start(
    hostname: string,
    port: number,
    bus: UiEventBus,
  ): [Error | null] {
    this.wireBus(bus);
    let server: Bun.Server<WsData>;
    try {
      server = Bun.serve<WsData>({
        hostname,
        port,
        fetch: (req: Request, srv: Bun.Server<WsData>): Response | undefined =>
          this.handleFetch(req, srv),
        websocket: {
          open: (ws: Bun.ServerWebSocket<WsData>): void => this.onWsOpen(ws),
          close: (ws: Bun.ServerWebSocket<WsData>): void => this.onWsClose(ws),
          message: (
            _ws: Bun.ServerWebSocket<WsData>,
            msg: string | Buffer,
          ): void => {
            const t =
              typeof msg === 'string' ? msg : Buffer.from(msg).toString('utf8');
            if (this.onClientWsText !== null) this.onClientWsText(t);
          },
        },
      });
    } catch (e) {
      if (this.unsubLog !== null) {
        this.unsubLog();
        this.unsubLog = null;
      }
      if (this.unsubStatus !== null) {
        this.unsubStatus();
        this.unsubStatus = null;
      }
      if (this.unsubCompanion !== null) {
        this.unsubCompanion();
        this.unsubCompanion = null;
      }

      const err = e instanceof Error ? e : new Error(String(e));
      return [err];
    }

    this.server = server;

    return [null];
  }

  public stop(): void {
    if (this.unsubLog !== null) {
      this.unsubLog();
      this.unsubLog = null;
    }
    if (this.unsubStatus !== null) {
      this.unsubStatus();
      this.unsubStatus = null;
    }
    if (this.unsubCompanion !== null) {
      this.unsubCompanion();
      this.unsubCompanion = null;
    }
    const copy = new Set(this.sockets);
    for (const w of copy) w.close();

    if (this.server !== null) {
      this.server.stop();
      this.server = null;
    }
    this.lastStatus = null;
    this.logRing.length = 0;
    this.sockets.clear();
    this.onClientWsText = null;
  }
}
