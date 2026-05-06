import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import mcData from 'minecraft-data';
import { Logger } from './Logger';
import { Utils } from './Utils';

const CRAFTING_BLOCKS = new Set(['crafting_table', 'workbench']);
const PLANK_NAMES     = new Set(['planks', 'wood', 'oak_planks']);

export class Craft {
  private readonly log = new Logger('Craft');
  private readonly mc: ReturnType<typeof mcData>;

  constructor(private readonly bot: Bot) {
    this.mc = mcData(bot.version);
  }

  public findCraftingTable(range = 16): Block | null {
    return this.bot.findBlock({
      matching: (b) =>
        b !== null && CRAFTING_BLOCKS.has(b.name),
      maxDistance: range,
    });
  }

  private itemId(name: string): number | null {
    const it = this.mc.itemsByName[name];
    return it ? it.id : null;
  }

  private async doCraft(
    name: string,
    count: number,
    table: Block | null,
  ): Promise<boolean> {
    const id = this.itemId(name);
    if (id == null) {
      this.log.warn('unknown item', name);
      return Promise.resolve(false);
    }
    const recipes = this.bot.recipesFor(id, null, count, table);
    if (!recipes.length) {
      this.log.warn('no recipe for', name, table ? '(table)' : '(2x2)');
      return Promise.resolve(false);
    }
    return this.bot
      .craft(recipes[0]!, count, table ?? undefined)
      .then((): boolean => {
        this.log.info('made', count, name);
        return true;
      })
      .catch((e: Error) => {
        this.log.warn('failed', name, e.message);
        return false;
      });
  }

  public async ensurePlanks(want: number): Promise<boolean> {
    const have = Utils.countItem(
      this.bot,
      (n) => PLANK_NAMES.has(n),
    );
    if (have >= want) return true;

    const logItem = Utils.findItem(
      this.bot,
      (n) => n === 'log' || n === 'wood' || n.endsWith('_log'),
    );
    if (!logItem) return false;

    const need = Math.min(Math.ceil((want - have) / 4), logItem.count);
    await this.doCraft('planks', need, null);
    return (
      Utils.countItem(this.bot, (n) => n === 'planks' || n === 'oak_planks') >=
      want
    );
  }

  public async ensureSticks(want: number): Promise<boolean> {
    if (Utils.countItem(this.bot, (n) => n === 'stick') >= want) return true;
    await this.ensurePlanks(2);
    await this.doCraft('stick', Math.ceil(want / 4), null);
    return Utils.countItem(this.bot, (n) => n === 'stick') >= want;
  }

  public async ensureCraftingTable(): Promise<Block | null> {
    const table = this.findCraftingTable(8);
    if (table) return table;

    const existing = Utils.findItem(
      this.bot,
      (n) => CRAFTING_BLOCKS.has(n),
    );
    if (!existing) {
      await this.ensurePlanks(4);
      await this.doCraft('crafting_table', 1, null);
    }

    const have = Utils.findItem(
      this.bot,
      (n) => CRAFTING_BLOCKS.has(n),
    );
    if (!have) return null;

    const ref = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!ref) return null;

    return this.bot
      .equip(have, 'hand')
      .then(() => this.bot.placeBlock(ref, new Vec3(0, 1, 0)))
      .then(() => Utils.sleep(300))
      .then(() => this.findCraftingTable(4))
      .catch((e: Error) => {
        this.log.warn('place failed', e.message);
        return null;
      });
  }

  public async craftPickaxe(): Promise<boolean> {
    if (this.bot.inventory.items().find((i) => i.name.includes('pickaxe')))
      return true;

    const table = await this.ensureCraftingTable();
    if (!table) return false;

    await this.ensureSticks(2);
    if (Utils.countItem(this.bot, (n) => n === 'cobblestone') >= 3) {
      if (await this.doCraft('stone_pickaxe', 1, table)) return true;
    }
    await this.ensurePlanks(3);
    return this.doCraft('wooden_pickaxe', 1, table);
  }

  public async craftSword(): Promise<boolean> {
    if (this.bot.inventory.items().find((i) => i.name.includes('sword')))
      return true;

    const table = await this.ensureCraftingTable();
    if (!table) return false;

    await this.ensureSticks(1);
    if (Utils.countItem(this.bot, (n) => n === 'cobblestone') >= 2) {
      if (await this.doCraft('stone_sword', 1, table)) return true;
    }
    await this.ensurePlanks(2);
    return this.doCraft('wooden_sword', 1, table);
  }

  public async craftTorches(want = 16): Promise<boolean> {
    if (Utils.countItem(this.bot, (n) => n === 'torch') >= want) return true;
    if (Utils.countItem(this.bot, (n) => n === 'coal') < 1) {
      this.log.warn('no coal');
      return false;
    }
    await this.ensureSticks(1);
    return this.doCraft('torch', Math.min(want, 16), null);
  }

  public async ensureTools(): Promise<void> {
    const pick = this.bot.inventory
      .items()
      .find((i) => i.name.includes('pickaxe'));
    if (!pick || Utils.pickaxeTier(pick.name) < 1) await this.craftPickaxe();
    if (!this.bot.inventory.items().find((i) => i.name.includes('sword')))
      await this.craftSword();
  }
}

