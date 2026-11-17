/**
 * Pure, deterministic game engine. No DOM, no Three.js, no randomness.
 *
 *   apply(state, action) -> { state, events }
 *
 * State is plain data and is never mutated; events describe what happened so
 * that rendering, audio and UI can react without containing any game logic.
 */
import {
  buildOccupancy,
  findBlockers,
  inBounds,
  isAdjacent,
  keyOf,
  rayCells,
  headOf,
} from './grid';
import type { Action, ApplyResult, Arrow, GameEvent, GameState, Level } from './types';

export const DEFAULT_HEARTS = 3;
export const DEFAULT_UNDOS = 3;

export interface GameOptions {
  hearts?: number;
  undos?: number;
}

export function createGame(level: Level, opts: GameOptions = {}): GameState {
  const hearts = opts.hearts ?? DEFAULT_HEARTS;
  return {
    level,
    removed: [],
    hearts,
    maxHearts: hearts,
    mistakes: 0,
    undosLeft: opts.undos ?? DEFAULT_UNDOS,
    status: level.arrows.length === 0 ? 'won' : 'playing',
    history: [],
  };
}

export function starsFor(mistakes: number): number {
  return mistakes <= 0 ? 3 : mistakes === 1 ? 2 : 1;
}

export function getArrow(level: Level, id: number): Arrow | undefined {
  const direct = level.arrows[id];
  return direct && direct.id === id ? direct : level.arrows.find((a) => a.id === id);
}

export function remainingArrows(state: GameState): Arrow[] {
  const removed = new Set(state.removed);
  return state.level.arrows.filter((a) => !removed.has(a.id));
}

/** Blockers (nearest first) for one arrow in the current state. Empty = free. */
export function blockersOf(state: GameState, arrowId: number) {
  const arrow = getArrow(state.level, arrowId);
  if (!arrow) return [];
  const occ = buildOccupancy(state.level, new Set(state.removed));
  return findBlockers(state.level, occ, arrow);
}

/** Ids of arrows that could escape right now. */
export function freeArrows(state: GameState): number[] {
  const removed = new Set(state.removed);
  const occ = buildOccupancy(state.level, removed);
  const out: number[] = [];
  for (const a of state.level.arrows) {
    if (removed.has(a.id)) continue;
    if (findBlockers(state.level, occ, a).length === 0) out.push(a.id);
  }
  return out;
}

export function apply(state: GameState, action: Action): ApplyResult {
  switch (action.type) {
    case 'tap':
      return applyTap(state, action.arrowId, action.player);
    case 'undo':
      return applyUndo(state);
    case 'restart':
      return {
        state: createGame(state.level, { hearts: state.maxHearts }),
        events: [{ type: 'restarted' }],
      };
  }
}

function reject(state: GameState, reason: Extract<GameEvent, { type: 'rejected' }>['reason']) {
  return { state, events: [{ type: 'rejected', reason } as GameEvent] };
}

function applyTap(state: GameState, arrowId: number, player?: number): ApplyResult {
  if (state.status !== 'playing') return reject(state, 'not-playing');
  const arrow = getArrow(state.level, arrowId);
  if (!arrow) return reject(state, 'unknown-arrow');
  if (state.removed.includes(arrowId)) return reject(state, 'already-removed');

  const occ = buildOccupancy(state.level, new Set(state.removed));
  const blockers = findBlockers(state.level, occ, arrow);
  const events: GameEvent[] = [];
  const tag = player === undefined ? {} : { player };

  if (blockers.length === 0) {
    const removed = [...state.removed, arrowId];
    const remaining = state.level.arrows.length - removed.length;
    events.push({ type: 'arrowEscaped', arrowId, remaining, ...tag });
    const won = remaining === 0;
    if (won)
      events.push({ type: 'levelWon', stars: starsFor(state.mistakes), mistakes: state.mistakes });
    return {
      state: {
        ...state,
        removed,
        status: won ? 'won' : 'playing',
        history: [...state.history, { type: 'escape', arrowId }],
      },
      events,
    };
  }

  const nearest = blockers[0];
  const hearts = state.hearts - 1;
  events.push({
    type: 'arrowBlocked',
    arrowId,
    blockerId: nearest.id,
    gap: nearest.gap,
    blockers: blockers.map((b) => b.id),
    ...tag,
  });
  events.push({ type: 'heartLost', hearts });
  const lost = hearts <= 0;
  if (lost) events.push({ type: 'levelLost' });
  return {
    state: {
      ...state,
      hearts,
      mistakes: state.mistakes + 1,
      status: lost ? 'lost' : 'playing',
      history: [...state.history, { type: 'blocked', arrowId, blockerId: nearest.id }],
    },
    events,
  };
}

/** Reverts the last tap. A blocked tap gives the heart back (but not the star). */
function applyUndo(state: GameState): ApplyResult {
  if (state.status !== 'playing') return reject(state, 'not-playing');
  if (state.undosLeft <= 0 || state.history.length === 0) return reject(state, 'no-undo');
  const entry = state.history[state.history.length - 1];
  const history = state.history.slice(0, -1);
  const undosLeft = state.undosLeft - 1;
  const next: GameState =
    entry.type === 'escape'
      ? { ...state, removed: state.removed.slice(0, -1), history, undosLeft }
      : { ...state, hearts: Math.min(state.maxHearts, state.hearts + 1), history, undosLeft };
  return { state: next, events: [{ type: 'undone', entry, hearts: next.hearts, undosLeft }] };
}

/** Structural checks for a level. Returns human-readable problems (empty = valid). */
export function validateLevel(level: Level): string[] {
  const errors: string[] = [];
  const { size } = level;
  const seen = new Map<number, number>();
  const ids = new Set<number>();
  for (const arrow of level.arrows) {
    const tag = `arrow ${arrow.id}`;
    if (ids.has(arrow.id)) errors.push(`${tag}: duplicate id`);
    ids.add(arrow.id);
    if (arrow.cells.length < 2) errors.push(`${tag}: needs at least 2 cells`);
    if (!(arrow.dir >= 0 && arrow.dir <= 5)) errors.push(`${tag}: bad direction`);
    for (let i = 0; i < arrow.cells.length; i++) {
      const c = arrow.cells[i];
      if (!inBounds(size, c[0], c[1], c[2])) {
        errors.push(`${tag}: cell ${c.join(',')} out of bounds`);
        continue;
      }
      const key = keyOf(size, c);
      if (seen.has(key)) errors.push(`${tag}: cell ${c.join(',')} overlaps arrow ${seen.get(key)}`);
      seen.set(key, arrow.id);
      if (i > 0 && !isAdjacent(arrow.cells[i - 1], c))
        errors.push(`${tag}: cells ${i - 1},${i} not adjacent`);
    }
    if (arrow.cells.length > 0 && arrow.dir >= 0 && arrow.dir <= 5) {
      const own = new Set(arrow.cells.map((c) => keyOf(size, c)));
      if (rayCells(size, headOf(arrow), arrow.dir).some((c) => own.has(keyOf(size, c)))) {
        errors.push(`${tag}: head points at its own body`);
      }
    }
  }
  return errors;
}
