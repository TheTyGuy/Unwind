import { describe, expect, it } from 'vitest';
import {
  apply,
  blockersOf,
  createGame,
  freeArrows,
  starsFor,
  validateLevel,
} from '../src/core/engine';
import { rayCells } from '../src/core/grid';
import { DIRS, type Dir, type GameState } from '../src/core/types';
import { arrow, level } from './helpers';

/** Flat 4x1x1 strip: A points +X at B; B points +X to the exit. */
const strip = () =>
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
          [2, 0, 0],
          [3, 0, 0],
        ],
        0,
      ),
    ],
  );

const tap = (s: GameState, arrowId: number) => apply(s, { type: 'tap', arrowId });

describe('engine rules', () => {
  it('lets a free arrow escape and reports remaining count', () => {
    const r = tap(createGame(strip()), 1);
    expect(r.events).toEqual([{ type: 'arrowEscaped', arrowId: 1, remaining: 1 }]);
    expect(r.state.removed).toEqual([1]);
    expect(r.state.hearts).toBe(3);
  });

  it('blocks an arrow whose ray is occupied and costs a heart', () => {
    const r = tap(createGame(strip()), 0);
    expect(r.events).toEqual([
      { type: 'arrowBlocked', arrowId: 0, blockerId: 1, gap: 0, blockers: [1] },
      { type: 'heartLost', hearts: 2 },
    ]);
    expect(r.state.removed).toEqual([]);
    expect(r.state.mistakes).toBe(1);
  });

  it('wins when every arrow is removed in a valid order', () => {
    let s = createGame(strip());
    s = tap(s, 1).state;
    const r = tap(s, 0);
    expect(r.state.status).toBe('won');
    expect(r.events.at(-1)).toEqual({ type: 'levelWon', stars: 3, mistakes: 0 });
  });

  it('loses when hearts run out, then rejects further taps', () => {
    let s = createGame(strip());
    s = tap(s, 0).state;
    s = tap(s, 0).state;
    const r = tap(s, 0);
    expect(r.state.status).toBe('lost');
    expect(r.events.map((e) => e.type)).toEqual(['arrowBlocked', 'heartLost', 'levelLost']);
    expect(tap(r.state, 1).events).toEqual([{ type: 'rejected', reason: 'not-playing' }]);
  });

  it('awards stars by mistakes', () => {
    expect([0, 1, 2, 5].map(starsFor)).toEqual([3, 2, 1, 1]);
    let s = createGame(strip());
    s = tap(s, 0).state;
    s = tap(s, 1).state;
    expect(tap(s, 0).events.at(-1)).toEqual({ type: 'levelWon', stars: 2, mistakes: 1 });
  });

  it('rejects unknown and already-removed arrows without changing state', () => {
    const s = tap(createGame(strip()), 1).state;
    expect(tap(s, 1)).toEqual({
      state: s,
      events: [{ type: 'rejected', reason: 'already-removed' }],
    });
    expect(tap(s, 99).events).toEqual([{ type: 'rejected', reason: 'unknown-arrow' }]);
  });

  it('never mutates the input state', () => {
    const s = createGame(strip());
    const frozen = JSON.stringify(s);
    tap(s, 0);
    tap(s, 1);
    apply(s, { type: 'undo' });
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('is deterministic and state survives a JSON round trip', () => {
    const a = tap(tap(createGame(strip()), 0).state, 1);
    const b = tap(JSON.parse(JSON.stringify(tap(createGame(strip()), 0).state)), 1);
    expect(b).toEqual(a);
  });

  it('echoes the player tag for multiplayer', () => {
    const r = apply(createGame(strip()), { type: 'tap', arrowId: 1, player: 2 });
    expect(r.events[0]).toMatchObject({ type: 'arrowEscaped', player: 2 });
  });

  it('a body does not block its own slide: only the head ray matters', () => {
    // U-shaped snake whose head points away from everything.
    const l = level(
      [3, 2, 1],
      [
        arrow(
          0,
          [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
            [2, 1, 0],
            [1, 1, 0],
          ],
          2,
        ),
      ],
    );
    expect(validateLevel(l)).toEqual([]);
    expect(tap(createGame(l), 0).state.status).toBe('won');
  });

  it('checks the whole ray out to the grid edge, not just the next cell', () => {
    const l = level(
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
          1,
        ),
      ],
    );
    const r = tap(createGame(l), 0);
    expect(r.events[0]).toMatchObject({ type: 'arrowBlocked', blockerId: 1, gap: 2 });
  });
});

describe('undo', () => {
  it('restores an escaped arrow and uses a charge', () => {
    const s = tap(createGame(strip()), 1).state;
    const r = apply(s, { type: 'undo' });
    expect(r.state.removed).toEqual([]);
    expect(r.state.undosLeft).toBe(2);
    expect(r.events[0]).toMatchObject({ type: 'undone', entry: { type: 'escape', arrowId: 1 } });
  });

  it('gives the heart back after a blocked tap but keeps the mistake', () => {
    const s = tap(createGame(strip()), 0).state;
    const r = apply(s, { type: 'undo' });
    expect(r.state.hearts).toBe(3);
    expect(r.state.mistakes).toBe(1);
  });

  it('is limited and rejects when nothing to undo', () => {
    expect(apply(createGame(strip()), { type: 'undo' }).events).toEqual([
      { type: 'rejected', reason: 'no-undo' },
    ]);
    let s = createGame(strip(), { undos: 1 });
    s = tap(s, 0).state;
    s = apply(s, { type: 'undo' }).state;
    s = tap(s, 0).state;
    expect(apply(s, { type: 'undo' }).events[0]).toMatchObject({ reason: 'no-undo' });
  });

  it('restart resets everything', () => {
    const s = tap(tap(createGame(strip()), 0).state, 1).state;
    expect(apply(s, { type: 'restart' }).state).toEqual(createGame(strip()));
  });
});

describe('ray blocking in all 6 directions', () => {
  const center = [2, 2, 2];
  for (const d of [0, 1, 2, 3, 4, 5] as Dir[]) {
    const v = DIRS[d];
    // Shooter: head at center, tail one cell behind. Blocker: 2 cells ahead, lying across.
    const tail = [center[0] - v[0], center[1] - v[1], center[2] - v[2]];
    const ahead = [center[0] + 2 * v[0], center[1] + 2 * v[1], center[2] + 2 * v[2]];
    const perp = DIRS[((d + 2) % 6) as Dir];
    const blockerTail = [ahead[0] + perp[0], ahead[1] + perp[1], ahead[2] + perp[2]];
    const perpDir = ((d + 2) % 6) as Dir;
    const l = () =>
      level([5, 5, 5], [arrow(0, [tail, center], d), arrow(1, [ahead, blockerTail], perpDir)]);

    it(`dir ${d}: blocked while the blocker is present, free once it leaves`, () => {
      expect(validateLevel(l())).toEqual([]);
      let s = createGame(l());
      expect(blockersOf(s, 0)).toEqual([{ id: 1, gap: 1 }]);
      expect(freeArrows(s)).toEqual([1]);
      expect(tap(s, 0).events[0]).toMatchObject({ type: 'arrowBlocked', blockerId: 1, gap: 1 });
      s = tap(s, 1).state;
      expect(tap(s, 0).state.status).toBe('won');
    });

    it(`dir ${d}: an arrow beside or behind the ray does not block`, () => {
      const side = [center[0] + perp[0], center[1] + perp[1], center[2] + perp[2]];
      const side2 = [side[0] + perp[0], side[1] + perp[1], side[2] + perp[2]];
      const behind = [center[0] - 2 * v[0], center[1] - 2 * v[1], center[2] - 2 * v[2]];
      const l2 = level(
        [5, 5, 5],
        [
          arrow(0, [tail, center], d),
          arrow(1, [side, side2], perpDir),
          arrow(
            2,
            [behind, [behind[0] + perp[0], behind[1] + perp[1], behind[2] + perp[2]]],
            perpDir,
          ),
        ],
      );
      expect(validateLevel(l2)).toEqual([]);
      expect(blockersOf(createGame(l2), 0)).toEqual([]);
    });
  }

  it('rayCells walks to the grid edge', () => {
    expect(rayCells([4, 3, 2], [1, 1, 0], 0)).toEqual([
      [2, 1, 0],
      [3, 1, 0],
    ]);
    expect(rayCells([4, 3, 2], [1, 1, 0], 1)).toEqual([[0, 1, 0]]);
    expect(rayCells([4, 3, 2], [1, 1, 0], 5)).toEqual([]);
    expect(rayCells([4, 3, 2], [1, 1, 0], 4)).toEqual([[1, 1, 1]]);
  });
});

describe('validateLevel', () => {
  it('flags overlaps, gaps, short arrows, out-of-bounds and self-pointing heads', () => {
    expect(validateLevel(level([3, 1, 1], [arrow(0, [[0, 0, 0]], 0)]))[0]).toMatch(/at least 2/);
    expect(
      validateLevel(
        level(
          [3, 1, 1],
          [
            arrow(
              0,
              [
                [0, 0, 0],
                [2, 0, 0],
              ],
              0,
            ),
          ],
        ),
      )[0],
    ).toMatch(/adjacent/);
    expect(
      validateLevel(
        level(
          [3, 1, 1],
          [
            arrow(
              0,
              [
                [0, 0, 0],
                [3, 0, 0],
              ],
              0,
            ),
          ],
        ),
      )[0],
    ).toMatch(/bounds/);
    expect(
      validateLevel(
        level(
          [3, 1, 1],
          [
            arrow(
              0,
              [
                [0, 0, 0],
                [1, 0, 0],
              ],
              1,
            ),
          ],
        ),
      )[0],
    ).toMatch(/own body/);
    expect(
      validateLevel(
        level(
          [3, 2, 1],
          [
            arrow(
              0,
              [
                [0, 0, 0],
                [1, 0, 0],
              ],
              2,
            ),
            arrow(
              1,
              [
                [1, 0, 0],
                [1, 1, 0],
              ],
              2,
            ),
          ],
        ),
      ).join(),
    ).toMatch(/overlaps/);
  });
});
