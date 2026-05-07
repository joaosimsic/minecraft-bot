import type { MovementClass, World, WorldCell } from '../world/World';
import { emptyAirCell, solidGroundCell } from '../world/Collision';

export class FixtureWorld implements World {
  public snapshotGeneration = 1;
  private readonly cells = new Map<string, WorldCell>();
  public readonly closedDoors = new Set<string>();
  private readonly hostileFeet = new Set<string>();
  private readonly waterFeet = new Set<string>();

  public addHostileFoot(x: number, y: number, z: number): void {
    this.hostileFeet.add(FixtureWorld.k(x, y, z));
  }

  public markWaterFoot(x: number, y: number, z: number): void {
    this.waterFeet.add(FixtureWorld.k(x, y, z));
  }

  public footMovementClass(x: number, y: number, z: number): MovementClass {
    if (this.waterFeet.has(FixtureWorld.k(x, y, z))) return 'water';
    return 'ground';
  }

  public hostileOccupiesCell(x: number, y: number, z: number): boolean {
    return this.hostileFeet.has(FixtureWorld.k(x, y, z));
  }

  public hostileOccupiesFootCell(x: number, y: number, z: number): boolean {
    if (this.hostileOccupiesCell(x, y, z)) return true;
    if (this.hostileOccupiesCell(x, y + 1, z)) return true;
    return false;
  }

  public static k(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  public putCell(x: number, y: number, z: number, c: WorldCell): void {
    this.cells.set(FixtureWorld.k(x, y, z), c);
  }

  public addClosedDoor(x: number, y: number, z: number): void {
    this.closedDoors.add(FixtureWorld.k(x, y, z));

    this.putCell(x, y, z, { blocksBody: true, topSupportStand: false });
  }

  public platformXZ(
    y: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
  ): void {
    let x = x0;

    while (x <= x1) {
      let z = z0;

      while (z <= z1) {
        this.putCell(x, y, z, solidGroundCell());
        this.putCell(x, y + 1, z, emptyAirCell());
        this.putCell(x, y + 2, z, emptyAirCell());
        z += 1;
      }

      x += 1;
    }
  }

  public cell(x: number, y: number, z: number): WorldCell {
    const hit = this.cells.get(FixtureWorld.k(x, y, z));
    if (hit !== undefined) return hit;

    return emptyAirCell();
  }

  public closedDoorAt(x: number, y: number, z: number): boolean {
    return this.closedDoors.has(FixtureWorld.k(x, y, z));
  }

  public bumpSnapshot(): void {
    this.snapshotGeneration += 1;
  }
}
