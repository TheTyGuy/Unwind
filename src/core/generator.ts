/**
 * Backwards level generator.
 *
 * Arrows are placed one at a time. Each new arrow must have a clear exit ray
 * given everything already placed, so it could leave first. Replaying the
 * placement order in reverse is therefore always a valid solution, and every
 * generated level is solvable by construction.
 */
import { inBounds, keyOf, volume } from './grid';
import { Rng } from './rng';
import { buildShape } from './shapes';
import { ALL_DIRS, DIRS, type Arrow, type Dir, type Level, type Vec3 } from './types';

export interface GenParams {
  shape: string;
  /** Shape size parameter (edge length for most shapes). */
  size: number;
  minLen: number;
  maxLen: number;
  /** 0..1: chance to turn at each step while growing a body. */
  twistiness: number;
  /** 0..1: target fraction of shape cells covered by arrows. */
  density: number;
  seed: number;
  /**
   * 0..1: how hard to push for arrows that cross other arrows' exit rays.
   * Higher values give deeper dependency chains (harder levels).
   */
  interlock?: number;
}

const CANDIDATES = 6;
const MAX_FAILS = 40;

interface Candidate {
  cells: Vec3[];
  dir: Dir;
  score: number;
}

export function generateLevel(params: GenParams): Level {
  const shape = buildShape(params.shape, params.size);
  const size = shape.size;
  const rng = new Rng(params.seed);
  const interlock = params.interlock ?? 0.5;
  const minLen = Math.max(2, Math.min(params.minLen, params.maxLen));
  const maxLen = Math.max(minLen, params.maxLen);

  const total = volume(size);
  const inShape = new Uint8Array(total);
  for (const c of shape.cells) inShape[keyOf(size, c)] = 1;
  const occ = new Uint8Array(total);
  /** How many placed arrows' exit rays pass through each cell. */
  const rayCount = new Uint16Array(total);

  // A flat grid only gets in-plane arrows; out-of-plane ones would be trivially free.
  const dirs = ALL_DIRS.filter((d) => size[d >> 1] > 1);

  const placed: { cells: Vec3[]; dir: Dir }[] = [];
  let filled = 0;
  let fails = 0;
  const target = Math.min(1, Math.max(0, params.density)) * shape.cells.length;

  const isOpen = (x: number, y: number, z: number) => {
    if (!inBounds(size, x, y, z)) return false;
    const k = x + size[0] * (y + size[1] * z);
    return inShape[k] === 1 && occ[k] === 0;
  };

  const tryGrow = (): Candidate | null => {
    const empties = shape.cells.filter((c) => occ[keyOf(size, c)] === 0);
    if (empties.length < 2) return null;
    const head = rng.pick(empties);

    // Choose a head direction with a clear ray, favouring long rays through
    // still-empty shape cells: those can be crossed by later arrows.
    const options: { dir: Dir; weight: number }[] = [];
    for (const d of dirs) {
      const v = DIRS[d];
      let x = head[0] + v[0];
      let y = head[1] + v[1];
      let z = head[2] + v[2];
      let clear = true;
      let open = 0;
      while (inBounds(size, x, y, z)) {
        const k = x + size[0] * (y + size[1] * z);
        if (occ[k]) {
          clear = false;
          break;
        }
        if (inShape[k]) open++;
        x += v[0];
        y += v[1];
        z += v[2];
      }
      if (clear) options.push({ dir: d, weight: 1 + interlock * 3 * open });
    }
    if (options.length === 0) return null;
    let roll = rng.next() * options.reduce((s, o) => s + o.weight, 0);
    let dir = options[0].dir;
    for (const o of options) {
      roll -= o.weight;
      if (roll <= 0) {
        dir = o.dir;
        break;
      }
    }

    // The body may not sit in its own exit ray.
    const v = DIRS[dir];
    const own = new Set<number>([keyOf(size, head)]);
    const ownRay = new Set<number>();
    for (let x = head[0] + v[0], y = head[1] + v[1], z = head[2] + v[2]; inBounds(size, x, y, z);) {
      ownRay.add(x + size[0] * (y + size[1] * z));
      x += v[0];
      y += v[1];
      z += v[2];
    }

    // Grow from the head back towards the tail as a self-avoiding walk.
    const want = rng.range(minLen, maxLen);
    const body: Vec3[] = [head];
    let cur = head;
    let travel = -1;
    let turns = 0;
    while (body.length < want) {
      const steps: Dir[] = [];
      for (const d of dirs) {
        const s = DIRS[d];
        const nx = cur[0] + s[0];
        const ny = cur[1] + s[1];
        const nz = cur[2] + s[2];
        if (!isOpen(nx, ny, nz)) continue;
        const k = nx + size[0] * (ny + size[1] * nz);
        if (own.has(k) || ownRay.has(k)) continue;
        steps.push(d);
      }
      if (steps.length === 0) break;
      const straight = steps.includes(travel as Dir);
      const turnSteps = steps.filter((d) => d !== travel);
      let step: Dir;
      if (travel < 0) step = rng.pick(steps);
      else if (turnSteps.length > 0 && (!straight || rng.chance(params.twistiness)))
        step = rng.pick(turnSteps);
      else step = travel as Dir;
      if (travel >= 0 && step !== travel) turns++;
      travel = step;
      const s = DIRS[step];
      cur = [cur[0] + s[0], cur[1] + s[1], cur[2] + s[2]];
      own.add(keyOf(size, cur));
      body.push(cur);
    }
    if (body.length < 2) return null;

    let crossings = 0;
    for (const c of body) if (rayCount[keyOf(size, c)] > 0) crossings++;
    const score =
      body.length + turns * 1.5 * params.twistiness + crossings * 4 * interlock + rng.next() * 0.5;
    return { cells: body.reverse(), dir, score };
  };

  while (filled < target && fails < MAX_FAILS) {
    let best: Candidate | null = null;
    for (let i = 0; i < CANDIDATES; i++) {
      const cand = tryGrow();
      if (cand && (!best || cand.score > best.score)) best = cand;
    }
    if (!best) {
      fails++;
      continue;
    }
    fails = 0;
    for (const c of best.cells) occ[keyOf(size, c)] = 1;
    filled += best.cells.length;
    const head = best.cells[best.cells.length - 1];
    const v = DIRS[best.dir];
    for (let x = head[0] + v[0], y = head[1] + v[1], z = head[2] + v[2]; inBounds(size, x, y, z);) {
      rayCount[x + size[0] * (y + size[1] * z)]++;
      x += v[0];
      y += v[1];
      z += v[2];
    }
    placed.push({ cells: best.cells, dir: best.dir });
  }

  // Shuffle so ids don't leak the solution order.
  rng.shuffle(placed);
  const arrows: Arrow[] = placed.map((p, id) => ({ id, cells: p.cells, dir: p.dir }));
  return {
    id: `${shape.id}-${shape.n}-${params.seed}`,
    size,
    arrows,
    shape: { id: shape.id, size: shape.n },
    seed: params.seed,
  };
}

/** Fraction of the level's shape cells covered by arrows. */
export function fillRatio(level: Level): number {
  const cells = level.arrows.reduce((s, a) => s + a.cells.length, 0);
  const total = level.shape
    ? buildShape(level.shape.id, level.shape.size).cells.length
    : volume(level.size);
  return cells / total;
}
