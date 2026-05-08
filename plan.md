# Navigation fix: inadmissible A* heuristic for water nodes

## Problem

The bot cannot move when starting in water. The navigator fails with `goal_unsnappable` on the first 1-2 attempts (chunks not loaded yet — self-resolves), then fails with `no_path_budget` on all subsequent attempts (A* exhausts 20,000 node expansions without finding a path).

### Root cause

`src/navigation/planner/Heuristic.ts` applies a `3x` multiplier to horizontal distance when the current node has `movementClass === 'water'`:

```ts
if (a.movementClass === 'water') return horizontal * 3 + vertical;
```

This is **inadmissible** — it overestimates the true minimum cost whenever the optimal path involves swimming to the surface and then walking on ground.

### Concrete example from the logs

- Bot at `(1, 63, -8)` in water, goal at `(9, 74, 99)` on ground.
- Heuristic estimates: `115 * 3 + 11 * 2 = 367`.
- Actual optimal cost ≈ `152` (swim up ~2 blocks at cost 4, walk ~115 ground blocks at cost 115, jump_up 11 blocks at cost 33).
- Overestimate ratio: **2.4x**.

### Why this kills the search

1. Water nodes get f ≈ 367 (g=0 + h=367).
2. The bot can stand on the ocean surface (ground node above water passes `canStandAt` because `belowClass === 'water'`). These surface nodes get f ≈ 137 (g=2 + h=135).
3. A* always expands the lowest-f node, so it floods the entire ocean surface with ground exploration (thousands of nodes, all with f ≈ 130-140) before ever expanding a water node (f ≈ 367).
4. The 20,000 expansion budget is exhausted exploring ground dead-ends on the water surface.

## Fix

### Changed file: `src/navigation/planner/Heuristic.ts`

Remove the water-specific branch. Use one admissible heuristic for all nodes:

```ts
return dx + dz + dy * VERTICAL_WEIGHT;
```

This is a valid lower bound for every move type:
- Ground walk: cost 1 per step, heuristic 1 per step (tight).
- Water walk: cost 3 per step (1 + 2 aquatic bump), heuristic 1 per step (admissible).
- Jump up: cost 3, heuristic 1 + 2 = 3 (tight).
- Swim up/down: cost 2, heuristic 2 (tight).

The higher actual cost of water movement naturally biases A* toward ground paths via edge costs — no heuristic inflation needed.

### Changed file: `tests/navigation/heuristic-and-node.test.ts`

Update the `'water node scales horizontal component'` test to assert that water and ground nodes produce the same heuristic value:

```ts
test('water node uses same admissible heuristic as ground', () => {
  const a = new Node(0, 0, 0, new Set(), 'water');
  const b = new Node(2, 1, 0);
  const ground = new Node(0, 0, 0, new Set(), 'ground');
  expect(Heuristic.estimate(a, b)).toBe(Heuristic.estimate(ground, b));
  expect(Heuristic.estimate(a, b)).toBe(2 + 1 * 2);
});
```

## Verification

All 84 tests pass after the change.

## Notes

- The `goal_unsnappable` failure on the first 1-2 attempts is a separate timing issue (chunks around the distant goal aren't loaded yet). The existing retry loop handles it. No code change needed for that.
- `VERTICAL_WEIGHT = 2` slightly overestimates for multi-block drops (drop 3 costs 4, heuristic estimates 6), but this pre-existed and doesn't cause search failures in practice since drops go downward and the overestimate is small per-edge.
