import type { AsyncResult, Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import { Node, type NodeKey } from './Node';
import { Heuristic } from './Heuristic';
import {
  NeighborGenerator,
  type ExpandOpts,
  type Neighbor,
} from './NeighborGenerator';
import type { NavigationAction } from '../movement/Actions';
import type { World } from '../world/World';
import type { EdgeMemory } from '../recovery/EdgeMemory';
import { Collision } from '../world/Collision';
import { OpenHeap } from './OpenHeap';
import { debugLog } from '../../shared/debugLog';

export type PlanResult = {
  path: NavigationAction[];
  nodesExpanded: number;
  cost: number;
  partial: boolean;
};

export type AStarTelemetry = {
  searchStart: (data: Record<string, unknown>) => void;
  searchEnd: (data: Record<string, unknown>) => void;
  nodeExpand: (data: Record<string, unknown>) => void;
  pathSelected: (data: Record<string, unknown>) => void;
  candidateGenerated: (data: Record<string, unknown>) => void;
  candidateRejected: (data: Record<string, unknown>) => void;
};

export type AStarSearchOptions = {
  maxExpansions?: number;
  heuristicWeight?: number;
  yieldEvery?: number;
  yieldImpl?: () => Promise<void>;
};

const noopTelemetry: AStarTelemetry = {
  searchStart: (): void => {},
  searchEnd: (): void => {},
  nodeExpand: (): void => {},
  pathSelected: (): void => {},
  candidateGenerated: (): void => {},
  candidateRejected: (): void => {},
};

type CameFrom = { parent: NodeKey; via: NavigationAction };

export class AStar {
  public static async search(
    world: World,
    start: Node,
    goal: Node,
    edgeMemory: EdgeMemory,
    gameTick: number,
    runId: string,
    telemetry: AStarTelemetry = noopTelemetry,
    tickNow?: () => number,
    expandOpts?: ExpandOpts,
    searchOpts?: AStarSearchOptions,
  ): AsyncResult<PlanResult> {
    if (!Collision.canStandAt(world, start))
      return fail(new Error('start_not_standable'));
    if (!Collision.canStandAt(world, goal))
      return fail(new Error('goal_not_standable'));

    const tickStart = tickNow !== undefined ? tickNow() : gameTick;
    const durationTicks = (): number => {
      const tickEnd = tickNow !== undefined ? tickNow() : gameTick;
      const d = tickEnd - tickStart;
      if (d < 0) return 0;
      return d;
    };

    const maxExpansions = searchOpts?.maxExpansions ?? Infinity;
    const hWeight = searchOpts?.heuristicWeight ?? 1;
    const yieldEvery = searchOpts?.yieldEvery ?? 0;
    const yieldImpl = searchOpts?.yieldImpl;

    telemetry.searchStart({
      start: start.key,
      goal: goal.key,
      tick: tickStart,
      runId,
    });

    let actionSeq = 0;
    const nextActionId = (_kind: string, _from: Node, _to: Node): string => {
      actionSeq += 1;
      return `${runId}:${actionSeq}`;
    };

    const gScore = new Map<NodeKey, number>();
    const fScore = new Map<NodeKey, number>();
    const cameFrom = new Map<NodeKey, CameFrom>();
    const heap = new OpenHeap();
    const closed = new Set<NodeKey>();
    let heapSeq = 0;
    const nextHeapSeq = (): number => {
      heapSeq += 1;
      return heapSeq;
    };

    gScore.set(start.key, 0);
    const startH = Heuristic.estimate(start, goal);
    const startF = startH * hWeight;
    fScore.set(start.key, startF);
    heap.push({ key: start.key, f: startF, g: 0, seq: nextHeapSeq() });

    let expanded = 0;
    let staleSkipped = 0;

    const yieldToEventLoop = (): Promise<void> => {
      if (yieldImpl !== undefined) return yieldImpl();
      return new Promise<void>((resolve): void => {
        setImmediate((): void => {
          resolve();
        });
      });
    };

    let bestPartialKey: NodeKey | null = null;
    let bestPartialH = Infinity;

    while (heap.size > 0) {
      if (expanded >= maxExpansions) {
        // #region agent log
        debugLog('AStar.ts:budgetExhausted', 'budget hit', { expanded, bestPartialKey, bestPartialH, startKey: start.key, isNull: bestPartialKey === null, isStart: bestPartialKey === start.key }, 'H12');
        // #endregion
        if (bestPartialKey !== null && bestPartialKey !== start.key) {
          const partialG = gScore.get(bestPartialKey) ?? 0;
          const pathOp = AStar.reconstruct(cameFrom, start.key, bestPartialKey);
          // #region agent log
          debugLog('AStar.ts:partialExtract', 'reconstruct result', { bestPartialKey, partialG, err: pathOp[0]?.message ?? null, pathLen: pathOp[1]?.length ?? -1 }, 'H12');
          // #endregion
          if (pathOp[0] === null && pathOp[1] !== null) {
            telemetry.searchEnd({
              status: 'partial',
              reason: 'expansion_budget',
              expanded,
              staleSkipped,
              cost: partialG,
              durationTicks: durationTicks(),
            });
            return ok({
              path: pathOp[1],
              nodesExpanded: expanded,
              cost: partialG,
              partial: true,
            });
          }
        }

        telemetry.searchEnd({
          status: 'fail',
          reason: 'expansion_budget',
          expanded,
          staleSkipped,
          cost: null,
          durationTicks: durationTicks(),
        });
        return fail(new Error('no_path_budget'));
      }

      const entry = heap.popMin();
      if (entry === null) break;

      const currentKey = entry.key;
      if (closed.has(currentKey)) continue;

      const currentG = gScore.get(currentKey);
      if (currentG === undefined) return fail(new Error('astar_g'));
      if (entry.g > currentG) {
        staleSkipped += 1;
        continue;
      }

      closed.add(currentKey);

      const currentNodeOp = Node.fromKey(currentKey);
      if (currentNodeOp[0] !== null) return [currentNodeOp[0], null];
      const currentNode = currentNodeOp[1];
      if (currentNode === null) return fail(new Error('astar_node'));

      expanded += 1;
      const currentH = Heuristic.estimate(currentNode, goal);
      const currentF = fScore.get(currentKey);
      telemetry.nodeExpand({
        node: currentKey,
        g: currentG,
        f: currentF ?? currentH + currentG,
      });

      if (currentH < bestPartialH) {
        bestPartialH = currentH;
        bestPartialKey = currentKey;
      }

      if (currentNode.footEquals(goal)) {
        const pathOp = AStar.reconstruct(cameFrom, start.key, currentKey);
        if (pathOp[0] !== null) return [pathOp[0], null];
        const path = pathOp[1];
        if (path === null) return fail(new Error('astar_path'));
        telemetry.pathSelected({
          actions: path.map((a): Record<string, unknown> => a.toTelemetry()),
          totalCost: currentG,
        });
        telemetry.searchEnd({
          status: 'ok',
          expanded,
          staleSkipped,
          cost: currentG,
          durationTicks: durationTicks(),
        });
        return ok({ path, nodesExpanded: expanded, cost: currentG, partial: false });
      }

      const candidateHook = (
        name: 'candidate_generated' | 'candidate_rejected',
        data: Record<string, unknown>,
      ): void => {
        if (name === 'candidate_generated') {
          telemetry.candidateGenerated(data);
          return;
        }
        telemetry.candidateRejected(data);
      };

      const neighborsOp = NeighborGenerator.expand(
        world,
        currentNode,
        nextActionId,
        candidateHook,
        expandOpts,
      );
      if (neighborsOp[0] !== null) return [neighborsOp[0], null];
      const neighbors = neighborsOp[1];
      if (neighbors === null) return fail(new Error('astar_neighbors'));

      for (const n of neighbors) {
        AStar.relaxEdge(
          edgeMemory,
          cameFrom,
          fScore,
          gScore,
          heap,
          nextHeapSeq,
          closed,
          goal,
          gameTick,
          currentKey,
          currentG,
          n,
          hWeight,
        );
      }

      if (yieldEvery > 0 && expanded % yieldEvery === 0) {
        await yieldToEventLoop();
      }
    }

    telemetry.searchEnd({
      status: 'fail',
      expanded,
      staleSkipped,
      cost: null,
      durationTicks: durationTicks(),
    });
    return fail(new Error('no_path'));
  }

  private static relaxEdge(
    edgeMemory: EdgeMemory,
    cameFrom: Map<NodeKey, CameFrom>,
    fScore: Map<NodeKey, number>,
    gScore: Map<NodeKey, number>,
    heap: OpenHeap,
    nextHeapSeq: () => number,
    closed: Set<NodeKey>,
    goal: Node,
    gameTick: number,
    fromKey: NodeKey,
    fromG: number,
    neighbor: Neighbor,
    hWeight: number,
  ): void {
    const nk = neighbor.to.key;
    if (closed.has(nk)) return;
    const step = edgeMemory.costWithMemory(
      fromKey,
      nk,
      neighbor.action.kind,
      neighbor.edgeCost,
      gameTick,
    );
    const tentativeG = fromG + step;
    const prevG = gScore.get(nk);
    if (prevG !== undefined) {
      if (tentativeG >= prevG) return;
    }
    cameFrom.set(nk, { parent: fromKey, via: neighbor.action });
    gScore.set(nk, tentativeG);
    const h = Heuristic.estimate(neighbor.to, goal);
    const f = tentativeG + h * hWeight;
    fScore.set(nk, f);
    heap.push({ key: nk, f, g: tentativeG, seq: nextHeapSeq() });
  }

  private static reconstruct(
    cameFrom: Map<NodeKey, CameFrom>,
    startKey: NodeKey,
    goalKey: NodeKey,
  ): Result<NavigationAction[]> {
    const rev: NavigationAction[] = [];
    let cursor: NodeKey | null = goalKey;
    let guard = 0;
    while (cursor !== startKey) {
      guard += 1;
      if (guard > 10_000) return fail(new Error('astar_reconstruct_guard'));

      const step = cameFrom.get(cursor);
      if (step === undefined) return fail(new Error('astar_reconstruct_break'));

      rev.push(step.via);
      cursor = step.parent;
    }

    rev.reverse();
    return ok(rev);
  }
}
