import type { Vec2 } from '../core/types';

export interface SpatialItem { id: number; pos: Vec2 }

/** Lightweight broad-phase index for the top-down X/Z arena. */
export class SpatialHash<T extends SpatialItem> {
  private readonly cells = new Map<string, T[]>();

  constructor(readonly cellSize = 3.2) {}

  clear(): void { this.cells.clear(); }

  rebuild(items: readonly T[]): void {
    this.cells.clear();
    items.forEach((item) => this.insert(item));
  }

  insert(item: T): void {
    const key = this.key(this.cell(item.pos.x), this.cell(item.pos.z));
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(item); else this.cells.set(key, [item]);
  }

  query(pos: Vec2, radius: number): T[] {
    const result: T[] = [];
    const minX = this.cell(pos.x - radius); const maxX = this.cell(pos.x + radius);
    const minZ = this.cell(pos.z - radius); const maxZ = this.cell(pos.z + radius);
    const radiusSq = radius * radius;
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        this.cells.get(this.key(x, z))?.forEach((item) => {
          const dx = item.pos.x - pos.x; const dz = item.pos.z - pos.z;
          if (dx * dx + dz * dz <= radiusSq) result.push(item);
        });
      }
    }
    return result;
  }

  nearest(pos: Vec2, radius: number, predicate: (item: T) => boolean = () => true): T | undefined {
    let nearest: T | undefined; let bestSq = radius * radius;
    this.query(pos, radius).forEach((item) => {
      if (!predicate(item)) return;
      const dx = item.pos.x - pos.x; const dz = item.pos.z - pos.z; const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= bestSq) { bestSq = distanceSq; nearest = item; }
    });
    return nearest;
  }

  private cell(value: number): number { return Math.floor(value / this.cellSize); }
  private key(x: number, z: number): string { return `${x}:${z}`; }
}
