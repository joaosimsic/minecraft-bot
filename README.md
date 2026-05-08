# minecraft-bot (`beta-bot`)

Fleet of Mineflayer bots driven from a Blessed terminal dashboard: automate strip‑mining (`auto`), steer bots with waypoint targets (`guided`), optional JSONL replay, and an optional web companion. See **[Observability](#observability)** for logs, `trace_id` correlation, OTLP traces and metrics, navigation diagnostics, and the live dashboard.

## Requirements

- [Bun](https://bun.sh/) (runtime used by this repo)
- A reachable Minecraft/Java server compatible with [`mineflayer`](https://github.com/PrismarineJS/mineflayer)
- **Java 17+ on `PATH`** when using [ViaProxy](https://github.com/ViaVersion/ViaProxy) (beta/alpha/classic targets)

## Install

```bash
bun install
```

Copy [.env.example](.env.example) to `.env` and adjust variables. Startup validates env vars with Zod and exits if anything required is invalid.

## Run

```bash
bun run s
```

Equivalent: `bun src/main.ts`. The UI opens in the terminal; use **F1** for in-app help (**Ctrl+C** to quit).

**Multi-bot**: set `BOT_USERS` to a comma-separated list (e.g. `Miner1,Miner2`). If unset, a single `BOT_USER` is used.

**Replay (read-only)**: set `REPLAY_JSONL` to a path of a JSONL replay file. The same UI runs without connecting bots; replay drives status from stored events. Loading streams the file once (no full-file string), builds a timestamp index and periodic checkpoints for O(1) timestamp lookup plus bounded replay from the nearest checkpoint. Recent `env_update` lines (block‑driven movement class changes near the bot, with optional `trace_id`) appear in the status payload as `envTail` so the web panel can show them alongside movement.

**Web dashboard**: enable with `WEB_COMPANION=1` or `--web` (and optional `--web-port`). See [Observability](#observability) for what the page shows (grid, traces, heatmap, replay seek, and how it ties to JSONL and OTLP).

**Tests**:

```bash
bun test
```

## Observability

Telemetry is split into **local** output (terminal UI + structured JSONL under `LOG_DIR`), **correlation** (`trace_id` for each `Navigator.walkTo`), and **optional remote** export (OTLP/HTTP **JSON** traces and metrics to a collector such as Jaeger, Grafana Tempo, or an OpenTelemetry-compatible backend).

### Local logs and JSONL

[`Logger`](src/shared/Logger.ts) is the main logging API: human-readable lines go to the console and text log files; structured **events** go through [`Sink`](src/shared/Sink.ts) as **JSONL** (one JSON object per line). Rows include `ts`, `type`, optional `scope`, optional `botId`, optional `data`, and—when emitted during an active navigator walk—optional **`trace_id`**.

Useful event families for debugging movement and planning include `search_start`, `search_end`, `movement_fail`, `movement_complete`, `heuristic_trap`, `env_update`, `path_selected`, and `REPLAN`. High-volume per-expansion lines (`node_expand`, `candidate_*`) are emitted when **`NAV_TRACE=1`** (see env tables).

### Trace correlation (`trace_id`)

[`traceContext.ts`](src/shared/traceContext.ts) assigns a UUID in Node **`AsyncLocalStorage`** for each `Navigator.walkTo`. [`Logger.event`](src/shared/Logger.ts) and [`Logger.decision`](src/shared/Logger.ts) attach `getTraceId()` to JSONL when present so you can filter one walk across `navigation`, `movement_fail`, `env_update`, and related types. Fleet-wide analysis uses **`botId`** together with **`trace_id`**.

### In-process metrics (before OTLP)

[`Metrics`](src/shared/Metrics.ts) holds counters (for example `blocks.dug`, `distance_walked`, walk outcomes), a bounded **position trail**, and **rolling counter samples** for sliding-window deltas. [`Telemetry`](src/core/Telemetry.ts) records movement-related events and periodic **summary** lines to JSONL. The same counters feed the OTLP metrics exporter; nothing is sent remotely until `TELEMETRY_ENDPOINT` is set.

### Remote OTLP traces (`debugLog`)

[`debugLog`](src/shared/debugLog.ts) is **not** the same as `Logger`. When **`TELEMETRY_ENDPOINT`** is set, selected call sites emit **OTLP JSON trace** spans with `POST` to `{TELEMETRY_ENDPOINT}/v1/traces` (Jaeger-compatible OTLP HTTP). Payloads include `location`, `message`, `hypothesis_id`, and a JSON attribute for arbitrary data; the wire trace id aligns with the in-process `trace_id` when one is active. Optional **`TELEMETRY_SESSION_ID`** is sent as span metadata (`session.id`) when set.

Use **`debugLog`** for **targeted spans in a trace UI** without growing JSONL volume on every tick. If the endpoint is unset, `debugLog` is a no-op. Idle bots may produce **no** Jaeger traffic until a path that calls `debugLog` runs.

### Remote OTLP metrics

[`MetricsExporter`](src/shared/MetricsExporter.ts) posts **OTLP JSON metrics** to `{TELEMETRY_ENDPOINT}/v1/metrics` on a timer controlled by **`TELEMETRY_METRICS_EXPORT_MS`** (default 30s, minimum 5s).

Every export uses **resource** attributes **`service.name`** (from `TELEMETRY_SERVICE_NAME`) and **`bot_id`** (the bot username) so backends can split multi-bot fleets. Datapoints include a string attribute **`mode`** (`auto` or `guided`).

| OTLP metric name | Source / meaning |
| --- | --- |
| `bot.blocks_dug_per_minute` | Gauge: `blocks.dug` delta over the last **60s** |
| `bot.horizontal_distance_per_minute` | Gauge: `distance_walked` delta over the last **60s** (blocks per minute) |
| `bot.blocks_dug_total` | Cumulative sum (`blocks.dug`) |
| `bot.distance_walked_total` | Cumulative sum (`distance_walked`) |
| `bot.uptime_seconds` | Cumulative uptime since `Metrics` construction |

Export uses the same tuple-style error handling as elsewhere: failures do **not** crash the bot.

### Navigation diagnostics in JSONL and the web

- **`NAV_TRACE=1`**: extra JSONL (`node_expand`, `candidate_generated`, `candidate_rejected`) and **web** overlays for the planned path and rejected candidate cells (`nav_trace` messages).
- **`movement_fail`**: may include a compact **`world_snapshot`** (`v:1`, anchor foot block, `palette` + `i` for 27 cells) built only from the **in-memory** [`BotWorld`](src/navigation/world/BotWorld.ts) cache (unknown cells use token `u`—no blocking world queries on the failure path). The web companion can show the latest snapshot payload.
- **`heuristic_trap`**: JSONL (and optional `debugLog`) when, for a completed A\* search, `expanded / max(1, Manhattan(start, goal))` exceeds **`NAV_HEURISTIC_TRAP_THRESHOLD`** (default **50**). Manhattan is `|dx|+|dy|+|dz|` between planner start and goal nodes.
- **Expansion heatmap**: [`NavigationRecorder`](src/navigation/telemetry/Recorder.ts) aggregates expanded nodes per world `(x,z)` for the active search and sends **`nav_heatmap`** / **`nav_heatmap_clear`** to the web companion, scoped by **`trace_id`** so prior walks do not paint stale heat.

### Web companion (visual observability)

With **`WEB_COMPANION=1`** or **`--web`**, the HTTP + WebSocket dashboard shows fleet rows, focus summary, live logs, the **16×16 movement-class grid**, optional path and reject overlays when **`NAV_TRACE=1`**, the **heatmap** and **failure snapshot** panels when companion messages arrive, and **`world_grid`** messages can include **`trace_id`** for alignment with other overlays.

In **`REPLAY_JSONL`** mode, the UI replays JSONL from disk (streaming index + checkpoints); the scrub control sends **`replay_seek`** with `tsMs` over the WebSocket so status and grid can align to a chosen time.

Server → browser messages use JSON with a **`type`** field, including `snapshot`, `status`, `log`, `world_grid`, `nav_trace`, `nav_heatmap`, `nav_heatmap_clear`, `movement_fail`, and `replay_ready`. The browser may send **`replay_seek`** `{ "type": "replay_seek", "tsMs": <number> }` during replay.

### OTLP collectors (Jaeger example)

Set **`TELEMETRY_ENDPOINT`** to the OTLP **HTTP base URL with no path** (for example `http://127.0.0.1:4318`). The app appends `/v1/traces` and `/v1/metrics` exactly once each; pasting a URL that already ends with `/v1/traces` is normalized—see [`tests/debugLog.test.ts`](tests/debugLog.test.ts).

With [Jaeger all-in-one](https://www.jaegertracing.io/docs/latest/getting-started/), **4318** is the OTLP HTTP ingest port; open **http://127.0.0.1:16686/** for the UI. A browser **GET** to `http://127.0.0.1:4318/` often returns **404**; that is expected.

From this repo root:

```bash
docker compose up -d
```

Or Docker alone:

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
```

### Code map

| Module | Role |
| --- | --- |
| [`src/shared/Logger.ts`](src/shared/Logger.ts) | Text + structured JSONL; optional `trace_id` |
| [`src/shared/Sink.ts`](src/shared/Sink.ts) | JSONL sink under `LOG_DIR` |
| [`src/shared/traceContext.ts`](src/shared/traceContext.ts) | Per-walk `trace_id` |
| [`src/shared/debugLog.ts`](src/shared/debugLog.ts) | OTLP **traces** when `TELEMETRY_ENDPOINT` is set |
| [`src/shared/MetricsExporter.ts`](src/shared/MetricsExporter.ts) | OTLP **metrics** when `TELEMETRY_ENDPOINT` is set |
| [`src/shared/Metrics.ts`](src/shared/Metrics.ts) | Counters, trail, window samples |
| [`src/core/Telemetry.ts`](src/core/Telemetry.ts) | Bot sampling and summaries to JSONL |
| [`src/navigation/telemetry/Recorder.ts`](src/navigation/telemetry/Recorder.ts) | Navigation JSONL + companion heatmap / heuristic trap |
| [`src/web/WebCompanion.ts`](src/web/WebCompanion.ts) | Dashboard + WebSocket |
| [`src/main.ts`](src/main.ts) | Wires replay seek handler to the web companion in `REPLAY_JSONL` mode |

**Environment variables** for `LOG_*`, `TELEMETRY_*`, `NAV_*`, `REPLAY_JSONL`, and `WEB_*` are listed in the tables below.

## Environment variables

Connection and identity:

| Variable    | Meaning                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `HOST`      | Server hostname or IP                                                                                         |
| `PORT`      | Server port                                                                                                   |
| `VERSION`   | Protocol version Mineflayer uses toward the wire (often `b1.7.3` or `1.20.4` when ViaProxy fronts the server) |
| `BOT_USER`  | Username when only one bot                                                                                    |
| `BOT_USERS` | Optional comma-separated usernames for a fleet                                                                |
| `AUTH`      | `offline`, `microsoft`, or `mojang`                                                                           |

Behavior:

| Variable                        | Meaning                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `MODE`                          | `auto` — strip‑mine loop · `guided` — walk toward targets / env goal · applied on spawn |
| `TARGET_Y`                      | Strip‑mine horizon in `auto`                                                            |
| `START_X`, `START_Y`, `START_Z` | Optional “home”: all three define spawn home; omit all to use first spawn position      |
| `GOAL_X`, `GOAL_Y`, `GOAL_Z`    | Optional default guided waypoint when none is set manually                              |

Logs and telemetry:

| Variable                                                | Meaning                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_DIR`                                               | Writable directory for structured logs (text + JSONL events)                                                                                                                        |
| `LOG_SAMPLE_MS`, `LOG_STATS_MS`, `LOG_TRAIL_MIN_BLOCKS` | Sampling and trail thresholds                                                                                                                                                       |
| `TELEMETRY_ENDPOINT`                                    | Optional OTLP HTTP base URL (e.g. `http://127.0.0.1:4318` for Jaeger); when set, internal `debugLog` spans are `POST`ed to `{base}/v1/traces` as JSON, and in-process metrics export posts to `{base}/v1/metrics` on a timer. When unset, neither is sent. |
| `TELEMETRY_METRICS_EXPORT_MS`                           | Interval for OTLP JSON metrics export (default `30000`, minimum `5000`) when `TELEMETRY_ENDPOINT` is set                                                                               |
| `TELEMETRY_SESSION_ID`                                  | Optional string stored as a span attribute (`session.id`)                                                                                                                           |
| `TELEMETRY_SERVICE_NAME`                                | OpenTelemetry `service.name` (default `minecraft-bot`); metrics use the same resource attribute plus `bot_id`                                                                       |

Navigator:

| Variable                                                             | Meaning                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NAV_DIAGONAL`                                                       | `0`/`1` — allow diagonal stepping when `1`                                                             |
| `NAV_TRACE`                                                          | `0`/`1` — when `1`, extra navigation JSONL events and web companion path / rejected‑node overlays      |
| `NAV_MAX_EXPANSIONS`                                                 | A\* expansion cap before partial / budget failure                                                      |
| `NAV_HEURISTIC_WEIGHT`                                               | Weighted A\* heuristic multiplier                                                                      |
| `NAV_HEURISTIC_TRAP_THRESHOLD`                                       | Log `heuristic_trap` when `expansions / max(1, Manhattan(start,goal))` exceeds this value (default `50`) |
| `NAV_YIELD_EVERY`                                                    | Yield to the event loop every _n_ expansions (`0` = yield via default `setImmediate` only when needed) |
| `NAV_EDGE_MEMORY_FILE`                                               | Optional path for edge-crossing memory persistence                                                     |
| `NAV_EDGE_MEMORY_MAX_ENTRIES`, `NAV_EDGE_MEMORY_SAVE_EVERY_FAILURES` | Memory file caps and save cadence                                                                      |

Proxy (see below):

| Variable           | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `DISABLE_PROXY`    | `true`/`false`/`1`/`0` — skip ViaProxy entirely                           |
| `FORCE_PROXY`      | `true`/`false`/`1`/`0` — run ViaProxy even if the heuristic would skip it |
| `VIAPROXY_PORT`    | Local bind port for the proxy                                             |
| `VIAPROXY_VERSION` | ViaProxy jar release tag to download/use                                  |
| `CLIENT_VERSION`   | Protocol version Mineflayer speaks to the **local** proxy (e.g. `1.20.4`) |

Optional:

| Variable                                | Meaning                                                          |
| --------------------------------------- | ---------------------------------------------------------------- |
| `REPLAY_JSONL`                          | If set: replay-only mode (path to JSONL). Loads via a streaming pass with a timestamp index and checkpoints for seek; the web companion shows a scrub control when `--web` is enabled. |
| `WEB_BIND`, `WEB_PORT`, `WEB_COMPANION` | Web companion bind address, port, and toggle (`WEB_COMPANION=1`) |

JSONL may include **`env_update`** (movement-class change near the bot within an 8-block Chebyshev radius, with block name and before/after class). Replay and live status expose a short tail as **`envTail`** for the web panel—see [Observability](#observability) → Web companion.

Bool-like env vars for the proxy (`DISABLE_PROXY`, `FORCE_PROXY`) accept `true`, `false`, `1`, or `0`.

## ViaProxy (beta / alpha / classic)

Mainline Minecraft data stacks do not always ship antique protocol definitions. When `VERSION` looks like beta, alpha, or classic (heuristic on strings such as `b1.7.3`), this project can start ViaProxy locally, download its jar under `.viaproxy/` if missing, and connect Mineflayer to `127.0.0.1:VIAPROXY_PORT` with `CLIENT_VERSION` while ViaProxy forwards to `HOST:PORT` at `VERSION`.

Tune behavior with **`DISABLE_PROXY`** and **`FORCE_PROXY`** (not legacy `USE_*` flags). Forcing the proxy implies a JVM on `PATH`.

## Commands (summarized)

Typing at the bottom of the UI (**Up/Down** history, **Tab** completes where applicable, **Ctrl+K** command palette):

- **Modes**: `auto`, `guided`, `stop`
- **Position**: `<x> <y> <z>` — guided target for the focused bot(s)
- **Fleet**: `focus <id>` or `use <id>`, `@<id> <cmd>`, `@all <cmd>`, `forget <id>` (disconnected rows only), `bots`, `ping`
- **UI / logs**: `help`, `?`, `:filter @id` / `:filter off`, `:level debug|info|warn|error|off`
- **Macros**: `:save <name> "step; step"` · `:run <name>` · `:macros` · `:unsave <name>`
- **Exit**: `exit` — confirms if bots are busy

Replay mode behaves the same UI-wise but bots are simulated from the replay file only.

## How it fits together

- [`src/main.ts`](src/main.ts) — ViaProxy orchestration when needed, sinks, fleet wiring, replay branch, UI and optional web companion
- [`src/core/BotFleet.ts`](src/core/BotFleet.ts) / [`BotKernel.ts`](src/core/BotKernel.ts) — one kernel per Mineflayer instance, coordinated status; kernel wires **Telemetry**, **Metrics**, and **MetricsExporter** (OTLP metrics when configured)
- [`src/core/InputHandler.ts`](src/core/InputHandler.ts) — parses commands, macros, and multi-bot routing
- [`src/modes/AutoMode.ts`](src/modes/AutoMode.ts) / [`GuidedMode.ts`](src/modes/GuidedMode.ts) — automation vs player-directed walking
- [`src/skills/`](src/skills/) — mining, navigation, combat, lava, lighting, crafting, chests, doors
- [`src/infra/ViaProxy.ts`](src/infra/ViaProxy.ts) — Java proxy lifecycle
- [`src/ui/`](src/ui/), [`src/UIManager.ts`](src/UIManager.ts) — Blessed panes and event bus
- [`src/web/WebCompanion.ts`](src/web/WebCompanion.ts) — optional HTTP + WebSocket dashboard (logs, status, worldview grid, heatmap, failure snapshots, `replay_seek`, `nav_trace` when `NAV_TRACE=1`)
- [`src/shared/traceContext.ts`](src/shared/traceContext.ts) — per‑`walkTo` trace id via `AsyncLocalStorage`
- [`src/shared/Logger.ts`](src/shared/Logger.ts) / [`Sink.ts`](src/shared/Sink.ts) — structured JSONL including optional `trace_id`
- [`src/shared/debugLog.ts`](src/shared/debugLog.ts) — optional OTLP **trace** JSON when `TELEMETRY_ENDPOINT` is set
- [`src/shared/MetricsExporter.ts`](src/shared/MetricsExporter.ts) — optional OTLP **metrics** JSON on a timer
- [`src/replay/`](src/replay/) — streaming JSONL replay, timestamp index, checkpoints, and **ReplayDrive** seek for the web UI

When every bot has disconnected, the runner shuts down the UI and exits.

## License / package

Package name in `package.json` remains `beta-bot`; treat this repository as the **minecraft-bot** workspace.
