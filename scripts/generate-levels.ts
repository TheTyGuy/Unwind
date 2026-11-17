/**
 * npm run generate-levels [-- --per 300 --count 60 --seed 2026]
 *
 * Generates a few hundred candidates per shape, scores each with the solver,
 * and writes a curated campaign with a smooth difficulty curve to
 * src/data/campaign.json. Fully deterministic for a given --seed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curate } from '../src/core/campaign';
import { encodeLevel } from '../src/core/codec';
import { validateLevel } from '../src/core/engine';
import { generateScored, type Scored } from '../src/core/endless';
import { hashSeed, Rng } from '../src/core/rng';
import { getShape, SHAPES } from '../src/core/shapes';
import { verifyOrder } from '../src/core/solver';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const PER_SHAPE = flag('per', 300);
const COUNT = flag('count', 60);
const SEED = flag('seed', 2026);

const candidates: Scored[] = [];
const started = Date.now();

for (const def of SHAPES) {
  const rng = new Rng(hashSeed('campaign', SEED, def.id));
  let kept = 0;
  for (let i = 0; i < PER_SHAPE; i++) {
    const minLen = rng.range(2, 3);
    const cand = generateScored({
      shape: def.id,
      size: rng.range(def.minSize, def.maxSize),
      minLen,
      maxLen: minLen + rng.range(1, 6),
      twistiness: rng.float(0.25, 0.95),
      density: rng.float(0.5, 1),
      interlock: rng.next(),
      seed: hashSeed('level', SEED, def.id, i),
    });
    const problems = validateLevel(cand.level);
    if (problems.length > 0) throw new Error(`Invalid level ${cand.level.id}: ${problems[0]}`);
    if (!cand.analysis.solvable || !verifyOrder(cand.level, cand.analysis.order)) {
      throw new Error(`Generator produced an unsolvable level: ${cand.level.id}`);
    }
    candidates.push(cand);
    kept++;
  }
  const scores = candidates.slice(-kept).map((c) => c.analysis.score);
  console.log(
    `${def.name.padEnd(12)} ${String(kept).padStart(4)} candidates  difficulty ${Math.min(...scores).toFixed(0)}..${Math.max(...scores).toFixed(0)}`,
  );
}

const campaign = curate(candidates, {
  count: COUNT,
  intro: [
    { upTo: 5, shapes: ['square'] },
    { upTo: 9, shapes: ['square', 'heart', 'cube', 'stairs'] },
  ],
});

console.log(`\n #  level                     arrows depth free%  score`);
campaign.forEach((c, i) => {
  const a = c.analysis;
  console.log(
    `${String(i + 1).padStart(2)}  ${`${getShape(c.level.shape!.id).name} ${c.level.size.join('x')}`.padEnd(26)}` +
      `${String(a.arrows).padStart(5)} ${String(a.depth).padStart(5)} ${(a.freeRatio * 100).toFixed(0).padStart(5)} ${a.score.toFixed(1).padStart(6)}`,
  );
});

const out = {
  version: 1,
  seed: SEED,
  levels: campaign.map((c, i) =>
    encodeLevel({ ...c.level, id: `c${i + 1}`, name: getShape(c.level.shape!.id).name }),
  ),
};
const file = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/campaign.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out) + '\n');
console.log(
  `\nWrote ${campaign.length} levels from ${candidates.length} candidates to src/data/campaign.json in ${Date.now() - started}ms`,
);
