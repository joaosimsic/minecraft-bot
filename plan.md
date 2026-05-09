# Physics Desync Fix Plan — ViaProxy Beta 1.7.3 Compatibility

## Overview

Bot runs Mineflayer 1.20.4 client, connects to Beta 1.7.3 server via ViaProxy. Version mismatch causes:
- **Problem:** Prismarine-Physics (1.20.4) calculates complex hitboxes for stairs, slabs, redstone wire. Movement packets fail Beta 1.7.3 validation (simpler collision model).
- **Symptom:** `pre_foot_mismatch`, `goal_unsnappable` navigation errors.
- **Root:** Pathfinder attempts sub-block movements legal in 1.20.4 but illegal in b1.7.3.

**Solution:** Runtime patch blocks to use simplified collision boxes matching b1.7.3 expectations.

## Implementation Strategy

### Location
Hook into `bot.inject_allowed` event in `BotRunner` (where bot instantiated).

### Timing
Patch registry immediately after bot init, before pathfinding starts. Ensures all navigation calcs use simplified geometry.

### Mechanism
Modify `bot.registry.blocksByName` entries directly:
- Set complex blocks' `boundingBox` to `'block'` (standard 1×1×1 solid).
- Set non-solid blocks' `boundingBox` to `'empty'` (no collision).

## Block Registry Patching

### Stairs & Slabs
Blocks: `cobblestone_stairs`, `oak_stairs`, `stone_stairs`, `stone_slab`, etc.

```typescript
const stairBlocks = [
  'cobblestone_stairs', 'oak_stairs', 'stone_stairs', 'oak_slab', 'stone_slab'
  // ... add all variants
];

stairBlocks.forEach(name => {
  const block = bot.registry.blocksByName[name];
  if (block) {
    block.boundingBox = 'block';
  }
});
```

### Redstone Wire
Block: `redstone_wire`

```typescript
const redstoneWire = bot.registry.blocksByName['redstone_wire'];
if (redstoneWire) {
  redstoneWire.boundingBox = 'empty';
}
```

Rationale: Redstone wire has no collision in b1.7.3; prevent false horizontal blocks.

## Expected Outcome

Simplified collision geometry aligns pathfinder expectations with b1.7.3 server validation. Pathfinder no longer attempts illegal sub-block steps, movement packets pass validation. Navigation stack stabilizes.

Result: `pre_foot_mismatch`, `goal_unsnappable` errors resolve. Bot navigates reliably on retro server.

## Next Steps

1. Identify all affected blocks (stairs, slabs, non-solids).
2. Implement patch in `BotRunner.inject_allowed` handler.
3. Test navigation on b1.7.3 server.
4. Monitor telemetry for desync errors (should reach zero).