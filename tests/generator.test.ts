import { describe, expect, it } from 'vitest';
import { decodeLevel, encodeLevel } from '../src/core/codec';
import { apply, createGame, validateLevel } from '../src/core/engine';
import { endlessLevel, generateForDifficulty, paramsForDifficulty } from '../src/core/endless';
import { fillRatio, generateLevel, type GenParams } from '../src/core/generator';
import { keyOf } from '../src/core/grid';
import { hashSeed, Rng } from '../src/core/rng';
import { buildShape, SHAPES } from '../src/core/shapes';
import { analyze, verifyOrder } from '../src/core/solver';

const base: GenParams = {
  shape: 'cube',
  size: 4,
  minLen: 2,
  maxLen: 6,
  twistiness: 0.7,
  density: 0.9,
  interlock: 0.6,
  seed: 1,
};

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const seq = (seed: number) =>
      Array.from(
        { length: 8 },
        (
          (r) => () =>
            r.next()
        )(new Rng(seed)),
      );
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
    expect(seq(7).every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('hashSeed is stable and order-sensitive', () => {
    expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
    expect(hashSeed('a', 1)).not.toBe(hashSeed(1, 'a'));
    expect(hashSeed('ab')).not.toBe(hashSeed('a', 'b'));
  });

  it('range and shuffle stay in bounds and keep elements', () => {
    const r = new Rng(5);
    for (let i = 0; i < 200; i++) {
      const v = r.range(2, 5);
      expect(v >= 2 && v <= 5).toBe(true);
    }
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('shapes', () => {
  it('every shape builds at every supported size, normalised and unique', () => {
    for (const def of SHAPES) {
      for (let n = def.minSize; n <= def.maxSize; n++) {
        const s = buildShape(def.id, n);
        expect(s.cells.length).toBeGreaterThanOrEqual(4);
        expect(new Set(s.cells.map((c) => keyOf(s.size, c))).size).toBe(s.cells.length);
        for (let axis = 0; axis < 3; axis++) {
          const vals = s.cells.map((c) => c[axis]);
          expect(Math.min(...vals)).toBe(0);
          expect(Math.max(...vals)).toBe(s.size[axis] - 1);
        }
      }
    }
  });

  it('has the expected cell counts', () => {
    expect(buildShape('square', 5).cells.length).toBe(25);
    expect(buildShape('cube', 3).cells.length).toBe(27);
    expect(buildShape('hollow', 5).cells.length).toBe(125 - 27);
    expect(buildShape('pyramid', 5).cells.length).toBe(25 + 9 + 1);
    expect(buildShape('stairs', 4).cells.length).toBe(10 * 3);
    expect(buildShape('cross', 5).cells.length).toBe(81);
    expect(buildShape('square', 5).size).toEqual([5, 5, 1]);
  });

  it('the donut has a hole', () => {
    const s = buildShape('donut', 7);
    expect(s.cells.some((c) => c[0] === 3 && c[2] === 3)).toBe(false);
  });
});

describe('generator', () => {
  it('always produces valid, solvable levels (property test across seeds and shapes)', () => {
    let count = 0;
    for (const def of SHAPES) {
      for (let i = 0; i < 40; i++) {
        const rng = new Rng(hashSeed('prop', def.id, i));
        const minLen = rng.range(2, 4);
        const level = generateLevel({
          shape: def.id,
          size: rng.range(def.minSize, def.maxSize),
          minLen,
          maxLen: minLen + rng.range(0, 6),
          twistiness: rng.next(),
          density: rng.float(0.3, 1),
          interlock: rng.next(),
          seed: hashSeed('seed', def.id, i),
        });
        expect(validateLevel(level)).toEqual([]);
        const a = analyze(level);
        expect(a.solvable).toBe(true);
        expect(verifyOrder(level, a.order)).toBe(true);
        expect(level.arrows.length).toBeGreaterThan(0);
        count++;
      }
    }
    expect(count).toBe(SHAPES.length * 40);
  });

  it('generated levels can be played to a win through the engine', () => {
    const level = generateLevel(base);
    let state = createGame(level);
    for (const id of analyze(level).order) state = apply(state, { type: 'tap', arrowId: id }).state;
    expect(state.status).toBe('won');
    expect(state.hearts).toBe(3);
  });

  it('is deterministic: same (seed, params) gives the identical level', () => {
    expect(generateLevel(base)).toEqual(generateLevel({ ...base }));
    expect(generateLevel(base)).not.toEqual(generateLevel({ ...base, seed: 2 }));
  });

  it('keeps arrows inside the shape and respects the length cap', () => {
    const level = generateLevel({ ...base, shape: 'donut', size: 7, maxLen: 5 });
    const shape = buildShape('donut', 7);
    const inside = new Set(shape.cells.map((c) => keyOf(shape.size, c)));
    for (const a of level.arrows) {
      expect(a.cells.length).toBeGreaterThanOrEqual(2);
      expect(a.cells.length).toBeLessThanOrEqual(5);
      for (const c of a.cells) expect(inside.has(keyOf(level.size, c))).toBe(true);
    }
  });

  it('flat shapes only get in-plane arrows', () => {
    for (let seed = 0; seed < 20; seed++) {
      const level = generateLevel({ ...base, shape: 'square', size: 5, seed });
      expect(level.size[2]).toBe(1);
      expect(level.arrows.every((a) => a.dir < 4)).toBe(true);
    }
  });

  it('reaches high density when asked', () => {
    const ratios = [1, 2, 3, 4, 5].map((seed) =>
      fillRatio(generateLevel({ ...base, density: 1, seed })),
    );
    expect(Math.min(...ratios)).toBeGreaterThan(0.8);
    expect(fillRatio(generateLevel({ ...base, density: 0.4 }))).toBeLessThan(0.6);
  });

  it('more twistiness means more turns', () => {
    const turns = (twistiness: number) => {
      let t = 0;
      for (let seed = 0; seed < 10; seed++) {
        for (const a of generateLevel({ ...base, size: 5, twistiness, seed }).arrows) {
          for (let i = 2; i < a.cells.length; i++) {
            const p = a.cells[i - 2];
            const q = a.cells[i];
            if ([0, 1, 2].filter((k) => p[k] !== q[k]).length > 1) t++;
          }
        }
      }
      return t;
    };
    expect(turns(0.95)).toBeGreaterThan(turns(0.05) * 1.5);
  });
});

describe('difficulty-targeted generation', () => {
  it('is reproducible from (target, seed)', () => {
    expect(generateForDifficulty(40, 99).level).toEqual(generateForDifficulty(40, 99).level);
    expect(paramsForDifficulty(40, 99)).toEqual(paramsForDifficulty(40, 99));
    expect(endlessLevel(5, 3)).toEqual(endlessLevel(5, 3));
  });

  it('tracks the target: harder targets give harder levels', () => {
    const avg = (target: number) =>
      [1, 2, 3, 4, 5, 6].reduce(
        (s, seed) => s + generateForDifficulty(target, seed).analysis.score,
        0,
      ) / 6;
    const easy = avg(10);
    const mid = avg(45);
    const hard = avg(80);
    expect(easy).toBeLessThan(mid);
    expect(mid).toBeLessThan(hard);
    expect(Math.abs(mid - 45)).toBeLessThan(12);
  });

  it('endless levels are always solvable', () => {
    for (let stage = 0; stage < 25; stage++) {
      const level = endlessLevel(123, stage);
      expect(validateLevel(level)).toEqual([]);
      expect(analyze(level).solvable).toBe(true);
    }
  });
});

describe('codec', () => {
  it('round-trips levels exactly', () => {
    const level = { ...generateLevel(base), name: 'Cube', difficulty: 12.5 };
    expect(decodeLevel(JSON.parse(JSON.stringify(encodeLevel(level))))).toEqual(level);
  });
});
