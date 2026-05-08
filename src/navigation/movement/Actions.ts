import type { NodeKey } from '../planner/Node';

export const ACTION_KINDS = [
  'walk',
  'jump_up',
  'drop_down',
  'interact',
  'swim_up',
  'swim_down',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type NavigationAction =
  | WalkAction
  | JumpUpAction
  | DropDownAction
  | InteractAction
  | SwimUpAction
  | SwimDownAction;

export class WalkAction {
  public readonly kind = 'walk' as const;

  public constructor(
    public readonly actionId: string,
    public readonly from: NodeKey,
    public readonly to: NodeKey,
    public readonly dx: -1 | 0 | 1,
    public readonly dz: -1 | 0 | 1,
  ) {}

  public toTelemetry(): Record<string, unknown> {
    return {
      action_id: this.actionId,
      kind: this.kind,
      from_node: this.from,
      to_node: this.to,
      dx: this.dx,
      dz: this.dz,
    };
  }
}

export class JumpUpAction {
  public readonly kind = 'jump_up' as const;

  public constructor(
    public readonly actionId: string,
    public readonly from: NodeKey,
    public readonly to: NodeKey,
    public readonly dx: -1 | 0 | 1,
    public readonly dz: -1 | 0 | 1,
  ) {}

  public toTelemetry(): Record<string, unknown> {
    return {
      action_id: this.actionId,
      kind: this.kind,
      from_node: this.from,
      to_node: this.to,
      dx: this.dx,
      dz: this.dz,
    };
  }
}

export class DropDownAction {
  public readonly kind = 'drop_down' as const;

  public constructor(
    public readonly actionId: string,
    public readonly from: NodeKey,
    public readonly to: NodeKey,
    public readonly dx: -1 | 0 | 1,
    public readonly dz: -1 | 0 | 1,
    public readonly deltaY: number,
  ) {}

  public toTelemetry(): Record<string, unknown> {
    return {
      action_id: this.actionId,
      kind: this.kind,
      from_node: this.from,
      to_node: this.to,
      delta_y: this.deltaY,
      dx: this.dx,
      dz: this.dz,
    };
  }
}

export class InteractAction {
  public readonly kind = 'interact' as const;

  public constructor(
    public readonly actionId: string,
    public readonly from: NodeKey,
    public readonly to: NodeKey,
    public readonly targetX: number,
    public readonly targetY: number,
    public readonly targetZ: number,
  ) {}

  public toTelemetry(): Record<string, unknown> {
    return {
      action_id: this.actionId,
      kind: this.kind,
      from_node: this.from,
      to_node: this.to,
      target: { x: this.targetX, y: this.targetY, z: this.targetZ },
    };
  }
}

export class SwimUpAction {
  public readonly kind = 'swim_up' as const;

  public constructor(
    public readonly actionId: string,
    public readonly from: NodeKey,
    public readonly to: NodeKey,
  ) {}

  public toTelemetry(): Record<string, unknown> {
    return {
      action_id: this.actionId,
      kind: this.kind,
      from_node: this.from,
      to_node: this.to,
    };
  }
}

export class SwimDownAction {
  public readonly kind = 'swim_down' as const;

  public constructor(
    public readonly actionId: string,
    public readonly from: NodeKey,
    public readonly to: NodeKey,
  ) {}

  public toTelemetry(): Record<string, unknown> {
    return {
      action_id: this.actionId,
      kind: this.kind,
      from_node: this.from,
      to_node: this.to,
    };
  }
}

export function actionToTelemetry(
  action: NavigationAction,
): Record<string, unknown> {
  return action.toTelemetry();
}
