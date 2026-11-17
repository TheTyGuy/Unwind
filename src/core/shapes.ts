/**
 * Shapes are data: each definition turns a size `n` into a list of voxels.
 * To add a shape, append a ShapeDef to SHAPES (or call registerShape).
 */
import type { Vec3 } from './types';

export interface ShapeDef {
  id: string;
  name: string;
  minSize: number;
  maxSize: number;
  /** Raw voxels for size n. They are normalised to the origin afterwards. */
  build(n: number): Vec3[];
}

export interface BuiltShape {
  id: string;
  n: number;
  cells: Vec3[];
  /** Tight bounding box, used as the level grid. */
  size: Vec3;
}

function box(
  sx: number,
  sy: number,
  sz: number,
  keep: (x: number, y: number, z: number) => boolean = () => true,
): Vec3[] {
  const out: Vec3[] = [];
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) if (keep(x, y, z)) out.push([x, y, z]);
  return out;
}

/**
 * Parse voxel art. `layers` go bottom (y=0) to top; each layer is rows of
 * text, one row per z, one character per x. Any non-'.' character is solid.
 */
export function voxelArt(layers: string[][]): Vec3[] {
  const out: Vec3[] = [];
  layers.forEach((rows, y) =>
    rows.forEach((row, z) => {
      for (let x = 0; x < row.length; x++)
        if (row[x] !== '.' && row[x] !== ' ') out.push([x, y, z]);
    }),
  );
  return out;
}

const DUCK = voxelArt([
  ['.....', '.###.', '.###.', '.###.', '.###.', '.....', '.....'],
  ['.###.', '#####', '#####', '#####', '#####', '.###.', '.....'],
  ['..#..', '.###.', '.###.', '.###.', '.###.', '.###.', '.....'],
  ['.....', '.....', '.....', '.###.', '.###.', '.###.', '.###.'],
  ['.....', '.....', '.....', '.###.', '.###.', '.###.', '.....'],
]);

const HEART_ROWS = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

export const SHAPES: ShapeDef[] = [
  { id: 'square', name: 'Flat square', minSize: 3, maxSize: 8, build: (n) => box(n, n, 1) },
  { id: 'cube', name: 'Cube', minSize: 3, maxSize: 6, build: (n) => box(n, n, n) },
  {
    id: 'pyramid',
    name: 'Pyramid',
    minSize: 4,
    maxSize: 7,
    build: (n) =>
      box(n, Math.ceil(n / 2), n, (x, y, z) => x >= y && x < n - y && z >= y && z < n - y),
  },
  {
    id: 'stairs',
    name: 'Stairs',
    minSize: 3,
    maxSize: 6,
    build: (n) => box(n, n, Math.max(2, n - 1), (x, y) => y <= x),
  },
  {
    id: 'hollow',
    name: 'Hollow cube',
    minSize: 4,
    maxSize: 6,
    build: (n) => box(n, n, n, (x, y, z) => ![x, y, z].every((v) => v > 0 && v < n - 1)),
  },
  {
    id: 'donut',
    name: 'Donut',
    minSize: 5,
    maxSize: 8,
    build: (n) => {
      const c = (n - 1) / 2;
      const h = n >= 6 ? 3 : 2;
      const rIn = n * 0.2;
      const rOut = n * 0.5 - 0.05 + (n % 2 === 0 ? 0.1 : 0);
      return box(n, h, n, (x, y, z) => {
        const r = Math.hypot(x - c, z - c);
        // Top and bottom rings are slightly thinner so the profile reads as round.
        const pinch = h === 3 && y !== 1 ? 0.45 : 0;
        return r >= rIn + pinch && r <= rOut - pinch;
      });
    },
  },
  {
    id: 'cross',
    name: 'Plus',
    minSize: 4,
    maxSize: 7,
    build: (n) => {
      const m = n < 6 ? 1 : 2;
      const mid = (v: number) => (v >= m && v < n - m ? 1 : 0);
      return box(n, n, n, (x, y, z) => mid(x) + mid(y) + mid(z) >= 2);
    },
  },
  {
    id: 'diamond',
    name: 'Diamond',
    minSize: 5,
    maxSize: 7,
    build: (n) => {
      const c = (n - 1) / 2;
      return box(
        n,
        n,
        n,
        (x, y, z) =>
          Math.abs(x - c) + Math.abs(y - c) + Math.abs(z - c) <= c + (n % 2 === 0 ? 1 : 0.5),
      );
    },
  },
  {
    id: 'heart',
    name: 'Heart',
    minSize: 2,
    maxSize: 3,
    // Size is the thickness; rows are flipped so the point faces down.
    build: (n) =>
      box(7, HEART_ROWS.length, n, (x, y) => HEART_ROWS[HEART_ROWS.length - 1 - y][x] === '#'),
  },
  { id: 'duck', name: 'Rubber duck', minSize: 1, maxSize: 1, build: () => DUCK },
];

const registry = new Map(SHAPES.map((s) => [s.id, s]));

export function registerShape(def: ShapeDef): void {
  registry.set(def.id, def);
  if (!SHAPES.includes(def)) SHAPES.push(def);
}

export function getShape(id: string): ShapeDef {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown shape "${id}"`);
  return def;
}

const cache = new Map<string, BuiltShape>();

/** Build a shape, clamp the size to its supported range, and shift it to the origin. */
export function buildShape(id: string, n: number): BuiltShape {
  const def = getShape(id);
  const size = Math.max(def.minSize, Math.min(def.maxSize, Math.round(n)));
  const key = `${id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = def.build(size);
  if (raw.length === 0) throw new Error(`Shape "${id}" is empty at size ${size}`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of raw)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], c[i]);
      max[i] = Math.max(max[i], c[i]);
    }
  const cells = raw.map((c): Vec3 => [c[0] - min[0], c[1] - min[1], c[2] - min[2]]);
  const built: BuiltShape = {
    id,
    n: size,
    cells,
    size: [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1],
  };
  cache.set(key, built);
  return built;
}
