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
.grid{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:900px){.grid{grid-template-columns:1fr 1fr}}
.panel{border:1px solid #30363d;border-radius:6px;padding:10px;background:#10161d}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:4px 6px;text-align:left;border-bottom:1px solid #21262d}
.on{color:#3fb950}.off{color:#f85149}
#log{white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;font-size:12px;line-height:1.35}
#meta{font-size:12px;color:#8b949e;margin-bottom:8px}
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
<div id="log"></div>
</div>
<script>
(() => {
  const fleetBody = document.querySelector('#fleet tbody');
  const focusedEl = document.getElementById('focused');
  const logEl = document.getElementById('log');
  const wsEl = document.getElementById('ws');
  let lines = [];

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
  private lastStatus: UiStatusPayload | null = null;
  private readonly logRing: UiLogLine[] = [];

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
    this.unsubLog = uLog;
    this.unsubStatus = uSt;
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
          message(): void {},
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
    const copy = new Set(this.sockets);
    for (const w of copy) w.close();

    if (this.server !== null) {
      this.server.stop();
      this.server = null;
    }
    this.lastStatus = null;
    this.logRing.length = 0;
    this.sockets.clear();
  }
}
