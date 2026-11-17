/**
 * Core data model. Everything here is plain JSON-serializable data so that
 * game state can be saved, diffed, or sent over the wire unchanged.
 */

export type Vec3 = readonly [number, number, number];

/** Axis directions: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5;

export const DIRS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const ALL_DIRS: readonly Dir[] = [0, 1, 2, 3, 4, 5];

export const DIR_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;

export function opposite(d: Dir): Dir {
  return (d ^ 1) as Dir;
}

/** A snake-like arrow. `cells` runs tail -> head; the last cell is the head. */
export interface Arrow {
  id: number;
  cells: Vec3[];
  /** Direction the head points (its escape direction). */
  dir: Dir;
}

export interface ShapeRef {
  id: string;
  size: number;
}

export interface Level {
  id: string;
  name?: string;
  /** Grid bounds; cells live in [0, size) on each axis. */
  size: Vec3;
  arrows: Arrow[];
  /** Shape this level was carved from (used only to draw the shell). */
  shape?: ShapeRef;
  seed?: number;
  /** Difficulty score 0..100 from the solver. */
  difficulty?: number;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export type HistoryEntry =
  { type: 'escape'; arrowId: number } | { type: 'blocked'; arrowId: number; blockerId: number };

export interface GameState {
  level: Level;
  /** Ids of arrows that have escaped, in order. */
  removed: number[];
  hearts: number;
  maxHearts: number;
  /** Total blocked taps this attempt. Not reverted by undo; drives stars. */
  mistakes: number;
  undosLeft: number;
  status: GameStatus;
  history: HistoryEntry[];
}

export type Action =
  /** `player` is reserved for multiplayer modes; the engine echoes it in events. */
  | { type: 'tap'; arrowId: number; player?: number }
  | { type: 'undo'; player?: number }
  | { type: 'restart' };

export type GameEvent =
  | { type: 'arrowEscaped'; arrowId: number; remaining: number; player?: number }
  | {
      type: 'arrowBlocked';
      arrowId: number;
      /** Nearest blocker along the ray. */
      blockerId: number;
      /** Empty cells between the head and the nearest blocker. */
      gap: number;
      /** Every arrow sitting in the ray, nearest first. */
      blockers: number[];
      player?: number;
    }
  | { type: 'heartLost'; hearts: number }
  | { type: 'levelWon'; stars: number; mistakes: number }
  | { type: 'levelLost' }
  | { type: 'undone'; entry: HistoryEntry; hearts: number; undosLeft: number }
  | { type: 'restarted' }
  | { type: 'rejected'; reason: 'not-playing' | 'unknown-arrow' | 'already-removed' | 'no-undo' };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}
