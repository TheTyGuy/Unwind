import { describe, expect, it } from 'vitest';
import campaignData from '../src/data/campaign.json';
import { curate, curveTarget } from '../src/core/campaign';
import { decodeLevel, type EncodedLevel } from '../src/core/codec';
import { apply, createGame, validateLevel } from '../src/core/engine';
import { generateScored } from '../src/core/endless';
import { analyze, blockerGraph, hint, isSolvable, verifyOrder } from '../src/core/solver';
import { arrow, level } from './helpers';

/** 6x1x1 chain: 0 -> 1 -> 2, each pointing +X at the next. Only 2 is free. */
const chain = () =>
  level(
    [6, 1, 1],
    [
      arrow(
        0,
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        0,
      ),
      arrow(
        1,
        [
          [2, 0, 0],
          [3, 0, 0],
        ],
        0,
      ),
      arrow(
        2,
        [
          [4, 0, 0],
          [5, 0, 0],
        ],
        0,
      ),
    ],
  );

/** Two arrows facing each other: a deadlock. */
const deadlock = () =>
  level(
    [4, 1, 1],
    [
      arrow(
        0,
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        0,
      ),
      arrow(
        1,
        [
          [3, 0, 0],
          [2, 0, 0],
        ],
        1,
      ),
    ],
  );

/** Four independent arrows all pointing out. */
const allFree = () =>
  level(
    [2, 4, 1],
    [0, 1, 2, 3].map((y) =>
      arrow(
        y,
        [
          [0, y, 0],
          [1, y, 0],
        ],
        0,
      ),
    ),
  );

/** 3-cycle in 3D: each head points at the next arrow's body. */
const cycle3 = () =>
  level(
    [3, 3, 2],
    [
      arrow(
        0,
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        2,
      ), // head (1,0,0) points +Y, hits (1,1,0)
      arrow(
        1,
        [
          [1, 2, 0],
          [1, 1, 0],
        ],
        0,
      ), // head (1,1,0) points +X, hits (2,1,0)
      arrow(
        2,
        [
          [2, 1, 0],
          [2, 0, 0],
        ],
        1,
      ), // head (2,0,0) points -X, hits (1,0,0)
    ],
  );

describe('solver on hand-made levels', () => {
  it('solves a chain in the only possible order', () => {
    const a = analyze(chain());
    expect(a.solvable).toBe(true);
    expect(a.order).toEqual([2, 1, 0]);
    expect(a.depth).toBe(3);
    expect(a.arrows).toBe(3);
    // Steps see 1 free of 3, 1 of 2, 1 of 1.
    expect(a.avgFree).toBe(1);
    expect(a.freeRatio).toBeCloseTo((1 / 3 + 1 / 2 + 1) / 3);
    expect(a.trapTaps).toBe(3);
  });

  it('blockerGraph lists every arrow in the ray, nearest first', () => {
    expect(blockerGraph(chain())).toEqual([[1, 2], [2], []]);
  });

  it('detects deadlocks and cycles as unsolvable', () => {
    expect(validateLevel(deadlock())).toEqual([]);
    expect(isSolvable(deadlock())).toBe(false);
    expect(analyze(deadlock()).order).toEqual([]);
    expect(analyze(deadlock()).score).toBe(0);
    expect(validateLevel(cycle3())).toEqual([]);
    expect(isSolvable(cycle3())).toBe(false);
  });

  it('breaking a cycle makes it solvable', () => {
    const l = cycle3();
    l.arrows[2] = arrow(
      2,
      [
        [2, 1, 0],
        [2, 0, 0],
      ],
      0,
    ); // now points +X, out of the grid
    const a = analyze(l);
    expect(a.solvable).toBe(true);
    expect(a.order).toEqual([2, 1, 0]);
  });

  it('scores an all-free level as trivial with no traps', () => {
    const a = analyze(allFree());
    expect(a).toMatchObject({ solvable: true, depth: 1, freeRatio: 1, trapTaps: 0, avgFree: 2.5 });
    expect(a.score).toBeLessThan(5);
  });

  it('counts sneaky traps: blockers that are not touching the head', () => {
    const far = level(
      [6, 1, 1],
      [
        arrow(
          0,
          [
            [0, 0, 0],
            [1, 0, 0],
          ],
          0,
        ),
        arrow(
          1,
          [
            [5, 0, 0],
            [4, 0, 0],
          ],
          2,
        ),
      ],
    );
    expect(analyze(far).sneakyRatio).toBe(1);
    expect(analyze(chain()).sneakyRatio).toBe(0);
  });

  it('ranks a deep chain above an all-free level of the same size', () => {
    const free3 = level(
      [2, 3, 1],
      [0, 1, 2].map((y) =>
        arrow(
          y,
          [
            [0, y, 0],
            [1, y, 0],
          ],
          0,
        ),
      ),
    );
    expect(analyze(chain()).score).toBeGreaterThan(analyze(free3).score);
  });

  it('verifyOrder rejects wrong, short or repeated orders', () => {
    expect(verifyOrder(chain(), [2, 1, 0])).toBe(true);
    expect(verifyOrder(chain(), [0, 1, 2])).toBe(false);
    expect(verifyOrder(chain(), [2, 1])).toBe(false);
    expect(verifyOrder(chain(), [2, 2, 1, 0])).toBe(false);
  });

  it('handles an empty level', () => {
    expect(analyze(level([2, 2, 2], []))).toMatchObject({ solvable: true, arrows: 0, order: [] });
  });
});

describe('hint', () => {
  it('always returns a currently-free arrow until the level is cleared', () => {
    let state = createGame(chain());
    const taken: number[] = [];
    for (let id = hint(state); id !== null; id = hint(state)) {
      const r = apply(state, { type: 'tap', arrowId: id });
      expect(r.events[0].type).toBe('arrowEscaped');
      state = r.state;
      taken.push(id);
    }
    expect(taken).toEqual([2, 1, 0]);
    expect(state.status).toBe('won');
  });

  it('returns null when stuck', () => {
    expect(hint(createGame(deadlock()))).toBeNull();
  });
});

describe('campaign', () => {
  const levels = (campaignData.levels as EncodedLevel[]).map(decodeLevel);

  it('ships about 60 valid, solvable levels', () => {
    expect(levels.length).toBeGreaterThanOrEqual(55);
    for (const l of levels) {
      expect(validateLevel(l)).toEqual([]);
      expect(isSolvable(l)).toBe(true);
    }
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length);
  });

  it('starts flat and easy, ends hard, with a smooth curve', () => {
    const scores = levels.map((l) => analyze(l).score);
    expect(levels.slice(0, 4).every((l) => l.size[2] === 1)).toBe(true);
    expect(scores[0]).toBeLessThan(10);
    expect(scores.at(-1)!).toBeGreaterThan(60);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i] - scores[i - 1]).toBeGreaterThan(-4);
      expect(scores[i] - scores[i - 1]).toBeLessThan(10);
    }
    expect(scores).toEqual(levels.map((l) => l.difficulty));
  });

  it('uses a variety of shapes', () => {
    expect(new Set(levels.map((l) => l.shape!.id)).size).toBeGreaterThanOrEqual(8);
  });

  it('curate picks an increasing curve from a candidate pool', () => {
    const pool = Array.from({ length: 150 }, (_, i) =>
      generateScored({
        shape: i % 2 ? 'cube' : 'square',
        size: 3 + (i % 3),
        minLen: 2,
        maxLen: 5,
        twistiness: 0.6,
        density: 0.4 + (i % 7) * 0.1,
        interlock: (i % 10) / 10,
        seed: i,
      }),
    );
    const picked = curate(pool, { count: 12, intro: [{ upTo: 3, shapes: ['square'] }] });
    expect(picked.length).toBe(12);
    expect(picked.slice(0, 3).every((p) => p.level.shape!.id === 'square')).toBe(true);
    expect(picked.at(-1)!.analysis.score).toBeGreaterThan(picked[0].analysis.score + 15);
    expect(curveTarget(0, 10, 5, 80)).toBe(5);
    expect(curveTarget(9, 10, 5, 80)).toBe(80);
  });
});
