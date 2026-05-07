# TUI Plan — Suggestions & Improvements

Scope: full redesign, with bugs and enhancements mixed.
Priorities: **P0** = must-fix / blocking, **P1** = strong UX win, **P2** = nice-to-have / future.

---

## Bugs

### B1 — Escape closes the app while the user is typing (P0)
`UIManager.ts:67` binds `escape` and `C-c` to quit. `escape` is a common cancel key inside textboxes — accidentally quitting the app mid-command kills the bot fleet. Drop `escape` from the global quit binding (keep `C-c`), and bind `escape` instead to "blur input / focus log pane" or to "clear current input line".

**Why:** Reversibility — quitting kills connections, status, logs. The cost of an accidental quit is high.

### B2 — `blessed.log.add()` is being called with a trailing `\n` (P1)
`UIManager.ts:76` does `this.logBox.add(\`...${text}\n\`)`. `blessed.log` already inserts a newline per `add()` call, so each entry is double-spaced. Drop the `\n`.

### B3 — Logger ANSI color codes leak into the file sink (P1)
`Logger.ts:62` writes `fullLine` to `sink.writeText` regardless of UI mode. When the UI is active, `fullLine` has no color codes — fine. But when the UI is *not* active (e.g. `bun run` during tests, CI, headless) and `uiLineSink === null`, the console path uses colors *only on the head* (`Logger.ts:59`) — also fine. So this is OK today, but fragile: any change that calls `write()` with pre-colored args will pollute the file. Add a `stripAnsi()` pass before `sink.writeText`, or build text once without colors and add ANSI only at the console boundary.

### B4 — Status pane re-renders entire content every 2s (P1)
`UIManager.ts:109` calls `setContent` + `screen.render()` on every tick (`BotFleet.startStatusTicker` → 2000 ms) plus on every `touchStatus` event. Causes visible flicker when many lines are present and wastes redraws when nothing changed. Diff against the last rendered string and skip `setContent` if equal; consider dropping the 2s ticker entirely and relying on event-driven `touchStatus` (already wired via `BotKernel`'s status callback).

### B5 — `alwaysScroll: true` defeats scrollback reading (P1)
`UIManager.ts:30`. As soon as a new log line arrives, the box jumps to the bottom — the user cannot read history while the bot is active. Track whether the user has scrolled up; only auto-scroll when they're at the bottom (mirrors how `tail -f` UIs handle this in `htop`, `lazygit`).

### B6 — Logger UI sink is set *after* `UIManager` construction (P2)
`main.ts:75-77` creates the screen first, then sets `setLoggerUiSink`. Anything logged in between (none today, but easy to introduce) prints raw to the now-blessed-controlled stdout and corrupts the screen. Move `setLoggerUiSink` into `UIManager`'s constructor, or invert: build the logger sink first, then attach the screen.

### B7 — Input keys collide with global key bindings (P2)
`screen.key([...])` fires regardless of focus. With `inputBox` focused, typing characters that overlap with screen-level keys (currently only `escape`/`C-c` — but B1 fix may add more) can conflict. Use `inputBox.on('keypress')` for input-only bindings and `screen.key` only for true globals (quit, help, panel cycling).

### B8 — `bots` command duplicates the status pane (P2)
`InputHandler.ts:107` writes a fleet listing to the log box, but the right-hand status pane already shows the same data. Either remove `bots` or have it pop a modal/overlay with richer detail (errors, mode params, last-step time).

### B9 — `markDisconnected` deletes the kernel (P1)
`BotFleet.ts:73`. Once disconnected, the kernel is gone — you can't view its last-known position, its final error, or re-attempt commands. Keep the kernel reference, mark the bot offline; only drop on explicit user action (`forget <id>`).

### B10 — `setFocus` rejects offline bots (P2)
`BotFleet.ts:90-95`. Combined with B9, once a bot disconnects there is no way to *inspect* its state via focus. Allow focus on offline bots so the status pane can show their final snapshot; gate command dispatch (not focus) on online status.

---

## Layout / Visual

### L1 — Add level-based colors to the log pane (P0)
`logBox` has `tags: false` and the `Logger` sends a fully formatted line with the level inside brackets. Switch to `tags: true` and have the logger emit blessed tags (`{red-fg}…{/red-fg}` for error, yellow for warn, grey for debug). Major readability win for free. Strip the tags before writing to `sink.writeText`.

**Why:** With multi-bot logs interleaved, errors disappear into the stream. Color is the single highest-leverage UX change.

### L2 — Replace status `box` with a `listtable` for the fleet (P1)
`UIManager.ts:41`. `blessed.listtable` gives column alignment, row highlight for the focused bot, keyboard navigation (`j`/`k`), and an obvious selection affordance. Columns: `id | on/off | phase | mode | x,y,z | last err`. Selecting a row should call `fleet.setFocus(id)`.

### L3 — Split focused-bot detail into its own pane (P2)
Currently focused detail and fleet list share one box. Stack them: top half is focused detail (positions, current mode params, last error, mining target, hp/food if surfaced), bottom half is fleet listtable. `blessed.layout` or two stacked boxes with `top: 0` / `top: '50%'`.

### L4 — Add a footer hint line (P1)
A 1-row status bar at the bottom (above input) that always shows: `focus: <id> | mode: <label> | bots: 3/5 online | <key hints: F1 help · Tab cycle · ^C quit>`. Removes the "what can I do" friction.

### L5 — Show the prompt prefix in the input box (P2)
Currently the input box is unlabeled context — typing `auto` is ambiguous about which bot it targets. Show `[focus: alice] >` as a live label on `inputBox` that updates with focus changes.

### L6 — Resize handling smoke test (P2)
`%` widths handle resize automatically, but verify that very narrow terminals (< 80 cols) don't truncate the fleet table catastrophically. Add a minimum-size warning panel that replaces the UI if `screen.width < 80` or `screen.height < 20`.

---

## Input / Commands

### I1 — Command history (up/down arrows) (P0)
`blessed.textbox` doesn't store history. Wrap `inputBox` with a ring buffer (last 100 entries) and bind `up` / `down` keypress to scroll through it. This is table-stakes for any REPL.

### I2 — Tab completion for commands and bot IDs (P1)
On `tab`, complete from the union of `{auto, guided, stop, ping, exit, focus, bots, @<botId>}` plus current bot IDs from `fleet.kernelIds()`. Cycle through matches on repeated tab.

### I3 — `@all` broadcast target (P1)
`InputHandler.parseTarget` only resolves `@<id>` or focused. Add `@all auto`, `@all stop`, etc., to broadcast to every online kernel. Critical when running 5+ bots — no one wants to type `@a stop; @b stop; @c stop`.

### I4 — `help` / `?` command (P1)
Surface the command list on demand instead of only on bad input (`InputHandler.ts:103`). Bind `F1` globally for the same effect; render as a centered overlay.

### I5 — Confirm `exit` when bots are mid-task (P1)
`InputHandler.ts:31` halts and quits immediately. If any bot is in a non-idle mode (mining, descending, fighting), prompt: `3 bots active — quit anyway? [y/N]`. Use `blessed.question`.

### I6 — Friendlier "no target" message (P2)
`InputHandler.ts:52` says "no bot resolved for command". Replace with explicit guidance: "no focused bot — use `focus <id>` or `@<id> <cmd>`. Online: alice, bob".

### I7 — Per-bot quick-focus shortcuts (P2)
Bind `Alt+1 … Alt+9` to focus the Nth bot in the fleet list. Faster than `focus <name>` when juggling.

### I8 — Filter the log pane by bot (P1)
With multi-bot fleets, one shared log is noisy. Toggle: `:filter @alice` shows only `alice` lines + null-bot system lines; `:filter off` clears. Implement by keeping the full log in memory and re-rendering the visible slice on filter change.

### I9 — Filter the log pane by level (P2)
`:level warn` hides info/debug. Same mechanism as I8. Nice when debugging without drowning in info.

---

## Multi-bot Features

### M1 — Per-bot log buffers (P1)
Currently `Logger` pushes every line through `uiLineSink` with a `botId` tag. The UI dumps them all to one box. Maintain per-bot ring buffers (e.g. last 1000 lines each) so that:
- I8 filtering becomes O(1).
- L3 focused-detail pane can show "last 10 log lines for this bot".
- A detached "follow" overlay can show one bot's stream while the main pane shows everyone.

Storage in `BotFleet` or a sibling `LogStore` class (favor the latter to keep `BotFleet` focused on lifecycle).

### M2 — Telemetry surfacing (P2)
`BotKernel` already wires `Telemetry`. Surface counters in the focused-detail pane: blocks mined, deaths, distance walked, mode-switches in the last minute. Pull from `Metrics` (`shared/Metrics.ts`).

### M3 — Tabs for per-bot views (P2)
`blessed.listbar` along the top with one tab per bot + an "all" tab. Switching tabs swaps the log pane between filtered views. Mouse-clickable tabs for users who don't want to memorize keys.

### M4 — Side-by-side small-multiples mode (P2)
Toggle (`F2`) that splits the log pane into N columns, one per online bot, each showing that bot's last ~20 lines. Useful for at-a-glance monitoring of a synchronized fleet.

### M5 — Mini-map / position overview (P2)
A small ASCII top-down view in a corner pane showing all bots' XZ positions relative to their home, refreshed at the same cadence as status. `blessed-contrib`'s `map` widget or hand-rolled.

---

## Architecture / Code Health

### A1 — Move screen ownership out of `UIManager` (P2)
Today `UIManager` owns `screen`, `logBox`, `statusBox`, `inputBox` directly. As panes multiply (L3, M3, M4, M5), it'll bloat. Split into a `ScreenHost` (owns `screen` + global keys) and pane classes (`LogPane`, `FleetPane`, `FocusedPane`, `InputPane`) each with a small surface.

### A2 — Use a typed event bus between fleet and UI (P2)
Currently `UIManager` is updated via two channels: log lines (`appendLogLine`) and status snapshots (`updateStatus`). As more views are added (M2 metrics, M5 positions) the signature grows. A small `EventBus` with typed events (`bot:log`, `bot:status`, `bot:metric`, `fleet:focus-changed`) decouples panes from `BotFleet`.

### A3 — Decouple Logger UI sink from a global (P2)
`Logger.ts:27` uses a module-level `uiLineSink`. Test isolation suffers. Pass a `LogTarget` to `Logger` instances or expose a `LoggerRegistry`.

### A4 — Stop polling status on a 2s timer (P1)
`BotFleet.startStatusTicker`. Position changes 20×/sec on a moving bot; 2s ticker is too coarse for "where is it now" yet wasteful when idle. Drop the timer; emit `touchStatus` from the bot's `move` / `physicTick` events (throttled to ~5 Hz). Falls out of B4.

### A5 — Render-loop throttling (P2)
After A4 + B4, calls to `screen.render()` could spike. Coalesce to one `render()` per tick via a `requestAnimationFrame`-style microtask flag. Same pattern blessed-contrib uses.

### A6 — Unit tests for `InputHandler` parsing (P1)
`parseTarget` and `parseCoords` are pure and easy to test. No coverage today. Add `tests/InputHandler.test.ts` with cases: `@alice auto`, `@alice`, `100 64 100`, `auto`, malformed.

---

## Future / Research

### F1 — Command palette (`Ctrl+K`) (P2)
Fuzzy-search over commands and bot IDs. Faster than typing for power users with many bots.

### F2 — Recordable command macros (P2)
`:save deposit-and-mine "auto; …"` then call it later with `:run deposit-and-mine`. Useful for repeated debug sequences.

### F3 — Web/HTTP companion (P2)
A `--web` flag that serves the same status data over HTTP + WebSocket. Lets you monitor the fleet from a browser when the terminal session is on a server. Reuses the per-bot log buffers from M1.

### F4 — Replay mode (P2)
Read a `logs/*.jsonl` file and replay events into the TUI for post-mortem analysis. Same panes, fed from disk instead of live bots.

---

## Suggested Order of Work

1. **B1** (escape quits) — safety
2. **L1** (log colors) + **B2** (double newline) — visible polish
3. **I1** (command history) + **I4** (help) — REPL basics
4. **B5** (scrollback guard) + **B4** (status diff) — make the panes usable during real runs
5. **L4** (footer hints) + **L2** (fleet listtable) — visual structure
6. **B9 / B10** (keep disconnected kernels) — observability
7. **I3** (`@all`) + **I8** (filter) + **M1** (per-bot buffers) — multi-bot story
8. **A4** (event-driven status) + **A5** (render coalescing) — perf cleanup
9. Everything else as appetite allows.

---

## Open Questions

- Do we want the TUI to be the only entrypoint, or keep a `--no-tui` headless mode for CI/scripts? (Affects B6, B3, A3.)
- Is there an upper bound on fleet size? (Affects whether L2 listtable is enough or whether M3/M4 multi-pane is required.)
- Should `exit` in single-bot mode skip the I5 confirmation? (Single-bot CLI users may find it annoying.)
- Are server-pushed chat messages something we want surfaced in the TUI as a separate channel, or folded into the log pane with a `chat` level?