# minecraft-bot (`beta-bot`)

Fleet of Mineflayer bots driven from a Blessed terminal dashboard: automate strip‑mining (`auto`), steer bots with waypoint targets (`guided`), optional JSONL replay, and an optional web companion for logs, fleet status, and a live movement‑class “worldview” with optional path overlays. JSONL events can carry a per‑walk `trace_id` for correlation, and optional OTLP‑style export targets a collector such as Jaeger when configured.

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

**Replay (read-only)**: set `REPLAY_JSONL` to a path of a JSONL replay file. The same UI runs without connecting bots; replay drives status from stored events. Recent `env_update` lines (block‑driven movement class changes near the bot, with optional `trace_id`) appear in the status payload as `envTail` so the web panel can show them alongside movement.

**Web dashboard**: enable with `WEB_COMPANION=1` (defaults: `WEB_BIND`, `WEB_PORT`) or CLI flags `--web` and optional `--web-port=<n>`. The page shows fleet rows, focus summary, a **16×16 top‑down grid** of movement class (ground vs water) around the focused bot (refreshed on focus change or when the bot enters a new horizontal block step), live logs over WebSocket, and—when `NAV_TRACE=1`—path and rejected‑candidate overlays from navigation telemetry.

**Tests**:

```bash
bun test
```

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
| `TELEMETRY_ENDPOINT`                                    | Optional OTLP HTTP base URL (e.g. `http://127.0.0.1:4318` for Jaeger); when set, internal `debugLog` spans are `POST`ed to `{base}/v1/traces` as JSON. When unset, nothing is sent. |
| `TELEMETRY_SESSION_ID`                                  | Optional string stored as a span attribute (`session.id`)                                                                                                                           |
| `TELEMETRY_SERVICE_NAME`                                | OpenTelemetry `service.name` (default `minecraft-bot`)                                                                                                                              |

### Jaeger and OTLP HTTP

`TELEMETRY_ENDPOINT` must be set (for example `http://127.0.0.1:4318`) or the bot sends nothing. Use the OTLP **HTTP** base URL **without** a path; the process posts to `{TELEMETRY_ENDPOINT}/v1/traces`.

With [Jaeger all-in-one](https://www.jaegertracing.io/docs/latest/getting-started/), port **4318** is the OTLP HTTP **ingest** endpoint. A normal browser visit to `http://127.0.0.1:4318/` is not the Jaeger UI and will look empty or error. Open **http://127.0.0.1:16686/** for the search UI.

Example with Docker Compose (from this repo root):

```bash
docker compose up -d
```

Or with Docker alone:

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
```

Only a few internal `debugLog` call sites emit spans (navigation diagnostics). Steady-state idle play may produce no Jaeger traffic until something hits those paths.

**If you see 404:** Port **4318** only accepts **POST** `…/v1/traces` (OTLP). A **GET** to `http://127.0.0.1:4318/` in a browser usually returns **404**; that is expected. Open **http://127.0.0.1:16686/** for the UI. Set `TELEMETRY_ENDPOINT` to the base only (e.g. `http://127.0.0.1:4318`), not `…/v1/traces/v1/traces` — the app appends `/v1/traces` once.

Navigator:

| Variable                                                             | Meaning                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NAV_DIAGONAL`                                                       | `0`/`1` — allow diagonal stepping when `1`                                                             |
| `NAV_TRACE`                                                          | `0`/`1` — when `1`, extra navigation JSONL events and web companion path / rejected‑node overlays      |
| `NAV_MAX_EXPANSIONS`                                                 | A\* expansion cap before partial / budget failure                                                      |
| `NAV_HEURISTIC_WEIGHT`                                               | Weighted A\* heuristic multiplier                                                                      |
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
| `REPLAY_JSONL`                          | If set: replay-only mode (path to JSONL)                         |
| `WEB_BIND`, `WEB_PORT`, `WEB_COMPANION` | Web companion bind address, port, and toggle (`WEB_COMPANION=1`) |

### Trace correlation (`trace_id`)

Each `Navigator.walkTo` call runs under Node `AsyncLocalStorage` with a fresh UUID. `Logger.event` / `Logger.decision` attach that id as a top‑level `trace_id` field on JSONL sink rows when present, so you can filter one walk’s `navigation`, `path_selected`, `env_update`, and related lines together. Multi‑bot runs stay separable with `botId` plus `trace_id`.

### JSONL replay and `env_update`

Recorded JSONL may include `env_update` events (movement class change near the controlled entity, within an 8‑block Chebyshev radius, with block name and before/after class). Replay ingestion keeps a short tail for the web status payload. Lines may include `trace_id` when they were emitted during a traced navigator walk.

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
- [`src/core/BotFleet.ts`](src/core/BotFleet.ts) / [`BotKernel.ts`](src/core/BotKernel.ts) — one kernel per Mineflayer instance, coordinated status
- [`src/core/InputHandler.ts`](src/core/InputHandler.ts) — parses commands, macros, and multi-bot routing
- [`src/modes/AutoMode.ts`](src/modes/AutoMode.ts) / [`GuidedMode.ts`](src/modes/GuidedMode.ts) — automation vs player-directed walking
- [`src/skills/`](src/skills/) — mining, navigation, combat, lava, lighting, crafting, chests, doors
- [`src/infra/ViaProxy.ts`](src/infra/ViaProxy.ts) — Java proxy lifecycle
- [`src/ui/`](src/ui/), [`src/UIManager.ts`](src/UIManager.ts) — Blessed panes and event bus
- [`src/web/WebCompanion.ts`](src/web/WebCompanion.ts) — optional HTTP + WebSocket dashboard (logs, status, worldview grid, `nav_trace` when `NAV_TRACE=1`)
- [`src/shared/traceContext.ts`](src/shared/traceContext.ts) — per‑`walkTo` trace id via `AsyncLocalStorage`
- [`src/shared/Logger.ts`](src/shared/Logger.ts) / [`Sink.ts`](src/shared/Sink.ts) — structured JSONL including optional `trace_id`
- [`src/shared/debugLog.ts`](src/shared/debugLog.ts) — optional OTLP JSON export when `TELEMETRY_ENDPOINT` is set
- [`src/replay/`](src/replay/) — JSONL replay pumping and bridge

When every bot has disconnected, the runner shuts down the UI and exits.

## License / package

Package name in `package.json` remains `beta-bot`; treat this repository as the **minecraft-bot** workspace.
