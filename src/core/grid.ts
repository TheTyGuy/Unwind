import { DIRS, type Arrow, type Dir, type Level, type Vec3 } from './types';

export function cellKey(size: Vec3, x: number, y: number, z: number): number {
  return x + size[0] * (y + size[1] * z);
}

export function keyOf(size: Vec3, c: Vec3): number {
  return cellKey(size, c[0], c[1], c[2]);
}

export function cellFromKey(size: Vec3, key: number): Vec3 {
  const x = key % size[0];
  const rest = (key - x) / size[0];
  const y = rest % size[1];
  return [x, y, (rest - y) / size[1]];
}

export function inBounds(size: Vec3, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
}

export function volume(size: Vec3): number {
  return size[0] * size[1] * size[2];
}

export function headOf(arrow: Arrow): Vec3 {
  return arrow.cells[arrow.cells.length - 1];
}

/** Cells from just past `from` in direction `dir` out to the edge of the grid. */
export function rayCells(size: Vec3, from: Vec3, dir: Dir): Vec3[] {
  const d = DIRS[dir];
  const out: Vec3[] = [];
  let x = from[0] + d[0];
  let y = from[1] + d[1];
  let z = from[2] + d[2];
  while (inBounds(size, x, y, z)) {
    out.push([x, y, z]);
    x += d[0];
    y += d[1];
    z += d[2];
  }
  return out;
}

/** Map of cell key -> arrow id for every arrow not in `removed`. */
export function buildOccupancy(level: Level, removed?: ReadonlySet<number>): Int32Array {
  const occ = new Int32Array(volume(level.size)).fill(-1);
  for (const arrow of level.arrows) {
    if (removed?.has(arrow.id)) continue;
    for (const c of arrow.cells) occ[keyOf(level.size, c)] = arrow.id;
  }
  return occ;
}

export interface Blocker {
  id: number;
  /** Empty cells between the head and this blocker's first cell in the ray. */
  gap: number;
}

/** Unique arrows sitting in `arrow`'s exit ray, nearest first. */
export function findBlockers(level: Level, occ: Int32Array, arrow: Arrow): Blocker[] {
  const ray = rayCells(level.size, headOf(arrow), arrow.dir);
  const seen = new Set<number>();
  const out: Blocker[] = [];
  for (let i = 0; i < ray.length; i++) {
    const id = occ[keyOf(level.size, ray[i])];
    if (id >= 0 && !seen.has(id)) {
      seen.add(id);
      out.push({ id, gap: i });
    }
  }
  return out;
}

/** Number of cells the head travels before leaving the grid. */
export function rayLength(size: Vec3, arrow: Arrow): number {
  return rayCells(size, headOf(arrow), arrow.dir).length;
}

export function isAdjacent(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;
}
