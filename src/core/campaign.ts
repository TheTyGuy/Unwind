/** Campaign curation: pick a smooth difficulty curve out of scored candidates. */
import type { Scored } from './endless';

export interface CurateOptions {
  count: number;
  /** Shapes allowed in the first few levels, by slot index upper bound. */
  intro?: { upTo: number; shapes: string[] }[];
}

/** Difficulty target for slot i of n: gentle start, steady climb. */
export function curveTarget(i: number, n: number, lo: number, hi: number): number {
  const t = n <= 1 ? 0 : i / (n - 1);
  return lo + (hi - lo) * Math.pow(t, 0.85);
}

export function curate(candidates: Scored[], opts: CurateOptions): Scored[] {
  const pool = candidates.filter((c) => c.analysis.solvable && c.level.arrows.length >= 3);
  const scores = pool.map((c) => c.analysis.score).sort((a, b) => a - b);
  const lo = scores[0];
  const hi = scores[Math.floor((scores.length - 1) * 0.995)];
  const used = new Set<Scored>();
  const picked: Scored[] = [];
  const shapeUse = new Map<string, number>();

  for (let i = 0; i < opts.count; i++) {
    const target = curveTarget(i, opts.count, lo, hi);
    const intro = opts.intro?.find((x) => i < x.upTo);
    let best: Scored | null = null;
    let bestCost = Infinity;
    for (const c of pool) {
      if (used.has(c)) continue;
      const shape = c.level.shape!.id;
      if (intro && !intro.shapes.includes(shape)) continue;
      let cost = Math.abs(c.analysis.score - target);
      // Variety: avoid repeating recent shapes and over-using any single one.
      const key = `${shape}`;
      if (picked[i - 1]?.level.shape!.id === shape) cost += 12;
      if (picked[i - 2]?.level.shape!.id === shape) cost += 5;
      if (!intro) cost += (shapeUse.get(key) ?? 0) * 0.8;
      // Never step down much from the previous level.
      const prev = picked[i - 1]?.analysis.score ?? 0;
      if (c.analysis.score < prev - 1.5) cost += (prev - c.analysis.score) * 3;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (!best) break;
    used.add(best);
    picked.push(best);
    const s = best.level.shape!.id;
    shapeUse.set(s, (shapeUse.get(s) ?? 0) + 1);
  }
  return picked;
}
