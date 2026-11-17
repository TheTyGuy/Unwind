/** Compact JSON encoding for levels (cells stored as grid indices). */
import { cellFromKey, keyOf } from './grid';
import type { Dir, Level, Vec3 } from './types';

export interface EncodedLevel {
  id: string;
  n?: string;
  s: [number, number, number];
  sh?: [string, number];
  seed?: number;
  d?: number;
  /** One entry per arrow: [dir, ...cell indices tail -> head]. */
  a: number[][];
}

export function encodeLevel(level: Level): EncodedLevel {
  const out: EncodedLevel = {
    id: level.id,
    s: [level.size[0], level.size[1], level.size[2]],
    a: level.arrows.map((arrow) => [arrow.dir, ...arrow.cells.map((c) => keyOf(level.size, c))]),
  };
  if (level.name !== undefined) out.n = level.name;
  if (level.shape) out.sh = [level.shape.id, level.shape.size];
  if (level.seed !== undefined) out.seed = level.seed;
  if (level.difficulty !== undefined) out.d = level.difficulty;
  return out;
}

export function decodeLevel(enc: EncodedLevel): Level {
  const size: Vec3 = [enc.s[0], enc.s[1], enc.s[2]];
  const level: Level = {
    id: enc.id,
    size,
    arrows: enc.a.map((row, id) => ({
      id,
      dir: row[0] as Dir,
      cells: row.slice(1).map((k) => cellFromKey(size, k)),
    })),
  };
  if (enc.n !== undefined) level.name = enc.n;
  if (enc.sh) level.shape = { id: enc.sh[0], size: enc.sh[1] };
  if (enc.seed !== undefined) level.seed = enc.seed;
  if (enc.d !== undefined) level.difficulty = enc.d;
  return level;
}
