import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import type { MovementClass, World, WorldCell } from './World';
import { emptyAirCell, solidGroundCell } from './Collision';
import { debugLog } from '../../shared/debugLog';

const FLUID_RE = /water|lava|flowing_/;

interface BlockWithProps extends Block {
  properties?: Record<string, string | boolean>;
}

type BlockProps = { half?: string; open?: string | boolean };

const DOOR_RE = /door/i;

export type EnvMovementDelta = {
  x: number;
  y: number;
  z: number;
  blockName: string;
  movementClassBefore: MovementClass;
  movementClassAfter: MovementClass;
};

export type BotWorldEnvOpts = {
  onMovementClassDelta?: (d: EnvMovementDelta) => void;
};

export class BotWorld implements World {
  private readonly cache = new Map<string, WorldCell>();
  private readonly closedDoorCache = new Map<string, boolean>();
  private readonly hostileCache = new Map<string, boolean>();

  public constructor(
    private readonly bot: Bot,
    private readonly envOpts?: BotWorldEnvOpts,
  ) {
    const bump = (): void => {
      this.cache.clear();
      this.closedDoorCache.clear();
      this.hostileCache.clear();
    };

    bot.on('blockUpdate', (oldBlock: Block | null, newBlock: Block | null) => {
      const pos = BotWorld.blockEventPos(oldBlock, newBlock);
      if (pos === null) {
        bump();
        return;
      }

      const ent = bot.entity;
      if (ent === undefined) {
        bump();
        return;
      }

      const ex = Math.floor(ent.position.x);
      const ey = Math.floor(ent.position.y);
      const ez = Math.floor(ent.position.z);
      if (BotWorld.chebyshev(pos.x, pos.y, pos.z, ex, ey, ez) > 8) {
        bump();
        return;
      }

      const hook = this.envOpts?.onMovementClassDelta;
      const rx = pos.x;
      const ry = pos.y;
      const rz = pos.z;
      const nameSrc = newBlock ?? oldBlock;
      const blockName = nameSrc === null ? 'air' : nameSrc.name;

      if (hook !== undefined) {
        const affected = [
          { x: rx, y: ry, z: rz },
          { x: rx, y: ry + 1, z: rz },
        ];
        for (const f of affected) {
          if (BotWorld.chebyshev(f.x, f.y, f.z, ex, ey, ez) > 8) continue;
          const mcOld = BotWorld.footMovementClassResolved(
            bot,
            rx,
            ry,
            rz,
            oldBlock,
            newBlock,
            'old',
            f.x,
            f.y,
            f.z,
          );
          const mcNew = BotWorld.footMovementClassResolved(
            bot,
            rx,
            ry,
            rz,
            oldBlock,
            newBlock,
            'new',
            f.x,
            f.y,
            f.z,
          );
          if (mcOld === mcNew) continue;
          hook({
            x: f.x,
            y: f.y,
            z: f.z,
            blockName,
            movementClassBefore: mcOld,
            movementClassAfter: mcNew,
          });
        }
      }

      bump();
    });
  }

  public cell(x: number, y: number, z: number): WorldCell {
    const key = BotWorld.posKey(x, y, z);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const b = this.bot.blockAt(new Vec3(x, y, z));
    const c = BotWorld.classifyBlock(b);
    this.cache.set(key, c);
    return c;
  }

  private footMcLogCount = 0;

  public footMovementClass(x: number, y: number, z: number): MovementClass {
    const r = BotWorld.footMovementClassAt(
      (ix, iy, iz): Block | null => this.bot.blockAt(new Vec3(ix, iy, iz)),
      x,
      y,
      z,
    );
    if (this.footMcLogCount < 5) {
      this.footMcLogCount += 1;
      const b = this.bot.blockAt(new Vec3(x, y, z));
      debugLog(
        'BotWorld.ts:footMovementClass',
        'mc query',
        {
          x,
          y,
          z,
          blockName: b?.name ?? 'NULL',
          bb: b?.boundingBox ?? 'NULL',
          result: r,
        },
        'H9',
      );
    }
    return r;
  }

  public static footMovementClassAt(
    blockAt: (ix: number, iy: number, iz: number) => Block | null,
    x: number,
    y: number,
    z: number,
  ): MovementClass {
    const b = blockAt(x, y, z);
    if (b === null) return 'ground';
    if (FLUID_RE.test(b.name)) return 'water';
    if (b.name === 'air' || b.boundingBox === 'empty') {
      const below = blockAt(x, y - 1, z);
      if (below !== null && FLUID_RE.test(below.name)) return 'water';
    }
    return 'ground';
  }

  public hostileOccupiesCell(ix: number, iy: number, iz: number): boolean {
    const key = BotWorld.posKey(ix, iy, iz);
    const hit = this.hostileCache.get(key);
    if (hit !== undefined) return hit;

    let found = false;
    for (const entity of Object.values(this.bot.entities) as Entity[]) {
      if (entity === undefined) continue;
      if (entity.id === this.bot.entity.id) continue;
      if (!BotWorld.isHostileEntity(entity)) continue;
      if (!BotWorld.entityBlocksCell(entity, ix, iy, iz)) continue;
      found = true;
      break;
    }

    this.hostileCache.set(key, found);
    return found;
  }

  public hostileOccupiesFootCell(ix: number, iy: number, iz: number): boolean {
    if (this.hostileOccupiesCell(ix, iy, iz)) return true;
    if (this.hostileOccupiesCell(ix, iy + 1, iz)) return true;
    return false;
  }

  public closedDoorAt(x: number, y: number, z: number): boolean {
    const key = BotWorld.posKey(x, y, z);
    const hit = this.closedDoorCache.get(key);
    if (hit !== undefined) return hit;

    const b = this.bot.blockAt(new Vec3(x, y, z));
    const v = BotWorld.isClosedDoorBlock(b);
    this.closedDoorCache.set(key, v);
    return v;
  }

  private static chebyshev(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    const dz = Math.abs(az - bz);
    return Math.max(dx, dy, dz);
  }

  private static blockEventPos(
    oldBlock: Block | null,
    newBlock: Block | null,
  ): { x: number; y: number; z: number } | null {
    const b = newBlock ?? oldBlock;
    if (b === null) return null;
    return { x: b.position.x, y: b.position.y, z: b.position.z };
  }

  private static blockAtPhased(
    bot: Bot,
    rx: number,
    ry: number,
    rz: number,
    oldBlock: Block | null,
    newBlock: Block | null,
    phase: 'old' | 'new',
    ix: number,
    iy: number,
    iz: number,
  ): Block | null {
    if (ix === rx && iy === ry && iz === rz) {
      return phase === 'old' ? oldBlock : newBlock;
    }
    return bot.blockAt(new Vec3(ix, iy, iz));
  }

  private static footMovementClassResolved(
    bot: Bot,
    rx: number,
    ry: number,
    rz: number,
    oldBlock: Block | null,
    newBlock: Block | null,
    phase: 'old' | 'new',
    fx: number,
    fy: number,
    fz: number,
  ): MovementClass {
    const resolve = (ix: number, iy: number, iz: number): Block | null =>
      BotWorld.blockAtPhased(
        bot,
        rx,
        ry,
        rz,
        oldBlock,
        newBlock,
        phase,
        ix,
        iy,
        iz,
      );
    return BotWorld.footMovementClassAt(resolve, fx, fy, fz);
  }

  private static posKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private static blockProps(block: Block): BlockProps | undefined {
    const raw = block as BlockWithProps;
    return raw.properties as BlockProps | undefined;
  }

  private static isClosedDoorBlock(block: Block | null): boolean {
    if (block === null) return false;
    if (!DOOR_RE.test(block.name)) return false;
    const p = BotWorld.blockProps(block);
    if (p === undefined) return true;
    if (p.half === 'upper') return false;
    if (p.open === 'true' || p.open === true) return false;
    return true;
  }

  private static classifyBlock(block: Block | null): WorldCell {
    if (block === null) return emptyAirCell();
    if (block.boundingBox === 'empty') return emptyAirCell();
    if (DOOR_RE.test(block.name)) {
      const p = BotWorld.blockProps(block);
      const open = p?.open === 'true' || p?.open === true;
      if (open) return emptyAirCell();
      return { blocksBody: true, topSupportStand: false };
    }
    if (block.diggable === false && block.name !== 'air') {
      return solidGroundCell();
    }
    if (FLUID_RE.test(block.name)) {
      return emptyAirCell();
    }
    if (block.name === 'air') return emptyAirCell();
    return solidGroundCell();
  }

  private static isHostileEntity(entity: Entity): boolean {
    if (entity.type === 'hostile') return true;
    if (entity.kind === 'hostile') return true;
    return false;
  }

  private static entityBlocksCell(
    entity: Entity,
    ix: number,
    iy: number,
    iz: number,
  ): boolean {
    const w = entity.width > 0 ? entity.width : 0.6;
    const px = entity.position.x;
    const pz = entity.position.z;
    const minX = Math.floor(px - w / 2);
    const maxX = Math.ceil(px + w / 2) - 1;
    const minZ = Math.floor(pz - w / 2);
    const maxZ = Math.ceil(pz + w / 2) - 1;
    if (ix < minX) return false;
    if (ix > maxX) return false;
    if (iz < minZ) return false;
    if (iz > maxZ) return false;
    const by = Math.floor(entity.position.y);
    if (by !== iy) return false;
    return true;
  }
}
