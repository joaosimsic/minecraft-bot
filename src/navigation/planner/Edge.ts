import type { NodeKey } from './Node';
import type { ActionKind } from '../movement/Actions';

export class SearchEdge {
  public constructor(
    public readonly fromKey: NodeKey,
    public readonly toKey: NodeKey,
    public readonly actionKind: ActionKind,
    public readonly baseCost: number,
  ) {}

  public static stableId(
    fromKey: NodeKey,
    toKey: NodeKey,
    actionKind: ActionKind,
  ): string {
    return `${fromKey}|${actionKind}|${toKey}`;
  }

  public get id(): string {
    return SearchEdge.stableId(this.fromKey, this.toKey, this.actionKind);
  }

  public toJSON(): Record<string, unknown> {
    return {
      from: this.fromKey,
      to: this.toKey,
      kind: this.actionKind,
      base_cost: this.baseCost,
    };
  }
}
