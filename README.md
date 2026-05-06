# beta-bot

Minecraft auto-miner bot. Strip-mines at target Y, seals lava, fights mobs, crafts replacement tools, places torches, deposits to chests, walks home after death.

## Install

```bash
bun install
```

## Run

```bash
bun run index.ts
```

## Config (env)

- `MC_HOST` — server host (default `localhost`)
- `MC_PORT` — server port (default `25565`)
- `MC_USER` — bot username (default `Miner`)
- `MC_VERSION` — protocol version (default `b1.7.3`)
- `TARGET_Y` — mining Y level (default `12`)
- `START_X` / `START_Y` / `START_Z` — optional home coords. Bot walks here on every spawn. All three required. Unset → first spawn pos = home.
- `USE_VIAPROXY` — `true`/`false` to override auto-detect.
- `VIAPROXY_PORT` — local proxy port (default `25568`)
- `VIAPROXY_VERSION` — jar release tag (default `3.4.11`)
- `CLIENT_VERSION` — version mineflayer talks to ViaProxy with (default `1.20.4`)

## Beta 1.7.3 support (auto via ViaProxy)

Mainline `mineflayer` + `minecraft-data` does not ship beta 1.7.3 data. The bot solves this by auto-starting [ViaProxy](https://github.com/ViaVersion/ViaProxy) — a Java proxy that translates a modern protocol to b1.7.3 on the wire.

When `MC_VERSION` looks like beta/alpha/classic (`b1.7.3`, `a1.2.6`, etc.) the bot will:
1. Check `java -version` is on PATH (needs JRE 17+).
2. Download `ViaProxy-<version>.jar` to `.viaproxy/` if absent.
3. Spawn `java -jar ViaProxy.jar cli --bind-address 0.0.0.0:25568 --target-address $MC_HOST:$MC_PORT --target-version $MC_VERSION`.
4. Wait for the proxy port to open.
5. Connect mineflayer to `127.0.0.1:25568` using `CLIENT_VERSION` (default `1.20.4`).

Override with `USE_VIAPROXY=true|false`. Customize jar version with `VIAPROXY_VERSION`, port with `VIAPROXY_PORT`, mineflayer client version with `CLIENT_VERSION`.

## Architecture

- `index.ts` — bot creation, main loop, event wiring
- `src/state.ts` — shared state (home pos, target Y)
- `src/mine.ts` — strip-mine + descent
- `src/lava.ts` — seal lava with cobble/dirt
- `src/combat.ts` — hostile detection + attack
- `src/craft.ts` — planks/sticks/pickaxe/sword/torch
- `src/chest.ts` — find/place chest, deposit
- `src/lighting.ts` — torch placement
- `src/recovery.ts` — walk back to home after death
- `src/util.ts`, `src/log.ts` — helpers

## Loop

1. Maintain: fight mobs, seal lava, ensure tools, ensure torches
2. Descend to `TARGET_Y` if above
3. Deposit if inventory full (find/place chest)
4. Strip-mine 8 blocks forward; place torch every 8

On death → `bot.on('spawn')` walks back to remembered home.
