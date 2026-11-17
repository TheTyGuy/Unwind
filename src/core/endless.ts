/** On-the-fly generation aimed at a difficulty target (endless mode, races). */
import { generateLevel, type GenParams } from './generator';
import { hashSeed, Rng } from './rng';
import { analyze, type Analysis } from './solver';
import type { Level } from './types';

interface Tier {
  /** Upper difficulty bound this tier is used for. */
  upTo: number;
  shapes: [string, number][];
}

const TIERS: Tier[] = [
  {
    upTo: 12,
    shapes: [
      ['square', 3],
      ['square', 4],
    ],
  },
  {
    upTo: 24,
    shapes: [
      ['square', 5],
      ['square', 6],
      ['cube', 3],
      ['heart', 2],
    ],
  },
  {
    upTo: 38,
    shapes: [
      ['cube', 3],
      ['stairs', 4],
      ['pyramid', 5],
      ['cross', 4],
      ['square', 7],
      ['hollow', 4],
    ],
  },
  {
    upTo: 52,
    shapes: [
      ['cube', 4],
      ['pyramid', 6],
      ['donut', 6],
      ['stairs', 5],
      ['duck', 1],
      ['diamond', 5],
    ],
  },
  {
    upTo: 68,
    shapes: [
      ['cube', 4],
      ['cube', 5],
      ['hollow', 5],
      ['cross', 5],
      ['donut', 7],
      ['duck', 1],
      ['pyramid', 7],
    ],
  },
  {
    upTo: 101,
    shapes: [
      ['cube', 5],
      ['cube', 6],
      ['hollow', 6],
      ['cross', 7],
      ['diamond', 7],
      ['stairs', 6],
    ],
  },
];

/** Deterministically derive generator params that tend to land near `target`. */
export function paramsForDifficulty(target: number, seed: number): GenParams {
  const rng = new Rng(hashSeed('params', seed));
  const t = Math.max(0, Math.min(100, target));
  const tier = TIERS.find((x) => t < x.upTo) ?? TIERS[TIERS.length - 1];
  const [shape, size] = rng.pick(tier.shapes);
  const k = t / 100;
  const minLen = 2 + Math.round(k * 1.5 * rng.next());
  return {
    shape,
    size,
    minLen,
    maxLen: minLen + 2 + rng.int(3) + Math.round(k * 3),
    twistiness: 0.35 + 0.5 * rng.next(),
    density: 0.55 + 0.4 * Math.min(1, k * 1.4) + 0.05 * rng.next(),
    interlock: Math.min(1, 0.15 + k * 0.9 + 0.2 * (rng.next() - 0.5)),
    seed,
  };
}

export interface Scored {
  level: Level;
  params: GenParams;
  analysis: Analysis;
}

export function generateScored(params: GenParams): Scored {
  const level = generateLevel(params);
  const analysis = analyze(level);
  level.difficulty = analysis.score;
  return { level, params, analysis };
}

/**
 * Generate `attempts` candidates from (target, seed) and return the one whose
 * solver score lands closest to the target. Same inputs, same level.
 */
export function generateForDifficulty(target: number, seed: number, attempts = 10): Scored {
  let best: Scored | null = null;
  for (let i = 0; i < attempts; i++) {
    const cand = generateScored(paramsForDifficulty(target, hashSeed('endless', seed, i)));
    if (cand.level.arrows.length < 2) continue;
    if (!best || Math.abs(cand.analysis.score - target) < Math.abs(best.analysis.score - target))
      best = cand;
    if (Math.abs(best.analysis.score - target) < 2) break;
  }
  if (!best)
    best = generateScored({
      shape: 'square',
      size: 4,
      minLen: 2,
      maxLen: 4,
      twistiness: 0.5,
      density: 0.8,
      seed,
    });
  return best;
}

/** Difficulty target for the nth endless stage (0-based): ramps, then plateaus. */
export function endlessTarget(stage: number): number {
  return Math.min(92, 10 + stage * 3.5);
}

export function endlessLevel(runSeed: number, stage: number): Level {
  const { level } = generateForDifficulty(endlessTarget(stage), hashSeed('run', runSeed, stage));
  return { ...level, id: `endless-${runSeed}-${stage}`, name: `Endless ${stage + 1}` };
}
