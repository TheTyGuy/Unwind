/**
 * Solver + difficulty analysis.
 *
 * Removing an arrow only ever frees cells, so the game is monotone: a level is
 * solvable exactly when the "is blocked by" graph has no cycle, and greedily
 * removing any free arrow is always safe. The challenge for the player is
 * finding a free arrow among many blocked ones, which is what we measure.
 */
import { buildOccupancy, findBlockers } from './grid';
import type { GameState, Level } from './types';

export interface Analysis {
  solvable: boolean;
  /** One valid removal order (empty if unsolvable). */
  order: number[];
  arrows: number;
  /** Longest chain A blocks B blocks C..., counted in arrows. */
  depth: number;
  /** Mean number of free arrows per step of a greedy playthrough. */
  avgFree: number;
  /** Mean of free / remaining per step (1 = everything is always free). */
  freeRatio: number;
  /** Blocked arrows summed over every step: the wrong taps on offer. */
  trapTaps: number;
  /** Mean blocked arrows per step. */
  avgTraps: number;
  /** Share of traps whose nearest blocker is not touching the head (harder to spot). */
  sneakyRatio: number;
  /** Combined difficulty, 0 (trivial) .. 100 (brutal). */
  score: number;
}

/** For each arrow index, the ids of all arrows in its exit ray with everything present. */
export function blockerGraph(level: Level): number[][] {
  const occ = buildOccupancy(level);
  return level.arrows.map((a) => findBlockers(level, occ, a).map((b) => b.id));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function analyze(level: Level): Analysis {
  const n = level.arrows.length;
  const index = new Map(level.arrows.map((a, i) => [a.id, i]));
  const occAll = buildOccupancy(level);
  const blockers = level.arrows.map((a) => findBlockers(level, occAll, a));

  // Kahn-style peel in rounds. Rounds == longest dependency chain.
  const pending = blockers.map((b) => b.length);
  const blocks: number[][] = level.arrows.map(() => []);
  blockers.forEach((list, i) => list.forEach((b) => blocks[index.get(b.id)!].push(i)));
  const round = new Array<number>(n).fill(0);
  let frontier = pending.flatMap((p, i) => (p === 0 ? [i] : []));
  let done = 0;
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const next: number[] = [];
    for (const i of frontier) {
      round[i] = depth;
      done++;
      for (const j of blocks[i]) if (--pending[j] === 0) next.push(j);
    }
    frontier = next;
  }
  const solvable = done === n;

  // Greedy playthrough (lowest free index first) to sample what the player sees.
  const order: number[] = [];
  let sumFree = 0;
  let sumRatio = 0;
  let trapTaps = 0;
  let sneaky = 0;
  if (solvable) {
    const left = blockers.map((b) => b.length);
    const gone = new Array<boolean>(n).fill(false);
    for (let step = 0; step < n; step++) {
      const remaining = n - step;
      let free = 0;
      let pick = -1;
      for (let i = 0; i < n; i++) {
        if (gone[i]) continue;
        if (left[i] === 0) {
          free++;
          if (pick < 0) pick = i;
        } else {
          trapTaps++;
          const nearest = blockers[i].find((b) => !gone[index.get(b.id)!]);
          if (nearest && nearest.gap > 0) sneaky++;
        }
      }
      sumFree += free;
      sumRatio += free / remaining;
      gone[pick] = true;
      order.push(level.arrows[pick].id);
      for (const j of blocks[pick]) left[j]--;
    }
  }

  const avgFree = n ? sumFree / n : 0;
  const freeRatio = n ? sumRatio / n : 1;
  const avgTraps = n ? trapTaps / n : 0;
  const sneakyRatio = trapTaps ? sneaky / trapTaps : 0;

  const score = solvable
    ? 100 *
      (0.25 * clamp01((n - 3) / 37) +
        0.3 * clamp01((1 - freeRatio) / 0.75) +
        0.25 * clamp01((depth - 1) / 11) +
        0.2 * clamp01(avgTraps / 14) * (0.6 + 0.4 * sneakyRatio))
    : 0;

  return {
    solvable,
    order,
    arrows: n,
    depth: solvable ? depth : 0,
    avgFree,
    freeRatio,
    trapTaps,
    avgTraps,
    sneakyRatio,
    score: Math.round(score * 10) / 10,
  };
}

export function isSolvable(level: Level): boolean {
  return analyze(level).solvable;
}

/**
 * A currently-free arrow to suggest, or null if none. Prefers the free arrow
 * that unblocks the most others so hints keep the player moving.
 */
export function hint(state: GameState): number | null {
  const removed = new Set(state.removed);
  const occ = buildOccupancy(state.level, removed);
  const unblocks = new Map<number, number>();
  const free: number[] = [];
  for (const a of state.level.arrows) {
    if (removed.has(a.id)) continue;
    const b = findBlockers(state.level, occ, a);
    if (b.length === 0) free.push(a.id);
    else if (b.length === 1) unblocks.set(b[0].id, (unblocks.get(b[0].id) ?? 0) + 1);
  }
  if (free.length === 0) return null;
  let best = free[0];
  for (const id of free) if ((unblocks.get(id) ?? 0) > (unblocks.get(best) ?? 0)) best = id;
  return best;
}

/** Replays `order` through the rules and reports whether it clears the level. */
export function verifyOrder(level: Level, order: readonly number[]): boolean {
  const removed = new Set<number>();
  for (const id of order) {
    const arrow = level.arrows.find((a) => a.id === id);
    if (!arrow || removed.has(id)) return false;
    if (findBlockers(level, buildOccupancy(level, removed), arrow).length > 0) return false;
    removed.add(id);
  }
  return removed.size === level.arrows.length;
}
