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

export class BotWorld implements World {
  private readonly cache = new Map<string, WorldCell>();
  private readonly closedDoorCache = new Map<string, boolean>();
  private readonly hostileCache = new Map<string, boolean>();

  public constructor(private readonly bot: Bot) {
    const bump = (): void => {
      this.cache.clear();
      this.closedDoorCache.clear();
      this.hostileCache.clear();
    };

    bot.on(
      'blockUpdate',
      (_oldBlock: Block | null, _newBlock: Block | null) => {
        void _oldBlock;
        void _newBlock;
        bump();
      },
    );
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
    const b = this.bot.blockAt(new Vec3(x, y, z));
    if (b === null) return 'ground';
    if (FLUID_RE.test(b.name)) return 'water';
    if (b.name === 'air' || b.boundingBox === 'empty') {
      const below = this.bot.blockAt(new Vec3(x, y - 1, z));
      if (below !== null && FLUID_RE.test(below.name)) return 'water';
    }
    // #region agent log
    if (this.footMcLogCount < 5) {
      this.footMcLogCount += 1;
      debugLog('BotWorld.ts:footMovementClass', 'mc query', { x, y, z, blockName: b.name, bb: b.boundingBox, result: 'ground' }, 'H9');
    }
    // #endregion
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
