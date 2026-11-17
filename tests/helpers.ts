import type { Arrow, Dir, Level, Vec3 } from '../src/core/types';

export function arrow(id: number, cells: number[][], dir: Dir): Arrow {
  return { id, cells: cells.map((c) => [c[0], c[1], c[2]] as Vec3), dir };
}

export function level(size: number[], arrows: Arrow[]): Level {
  return { id: 'test', size: [size[0], size[1], size[2]], arrows };
}
