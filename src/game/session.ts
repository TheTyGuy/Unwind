/**
 * Glue between the pure engine and everything that reacts to it. All rule
 * decisions come from engine.apply; this file only routes the resulting
 * events to the view, audio, haptics and UI.
 */
import { apply, blockersOf, createGame, getArrow } from '../core/engine';
import { hint as solverHint } from '../core/solver';
import type { Action, GameEvent, GameState, Level } from '../core/types';
import type { GameView } from '../render/view';
import type { Sfx } from './audio';
import type { Haptics } from './haptics';

export const HINTS_PER_LEVEL = 3;

export interface SessionHooks {
  oneTap(): boolean;
  /** Something the HUD shows has changed. */
  onChange(): void;
  onWin(stars: number): void;
  onLose(): void;
  /** Every engine event, for anything else that wants to listen (e.g. netcode later). */
  onEvent?(event: GameEvent): void;
}

export class GameSession {
  state: GameState | null = null;
  selected: number | null = null;
  selectedBlocked = false;
  hintsLeft = HINTS_PER_LEVEL;
  private combo = 0;
  private endTimer = 0;

  constructor(
    private view: GameView,
    private sfx: Sfx,
    private haptics: Haptics,
    private hooks: SessionHooks,
  ) {}

  start(level: Level): void {
    window.clearTimeout(this.endTimer);
    this.state = createGame(level);
    this.selected = null;
    this.hintsLeft = HINTS_PER_LEVEL;
    this.combo = 0;
    this.view.loadLevel(level);
    this.hooks.onChange();
  }

  get playing(): boolean {
    return this.state?.status === 'playing';
  }

  get remaining(): number {
    return this.state ? this.state.level.arrows.length - this.state.removed.length : 0;
  }

  get canUndo(): boolean {
    return this.playing && this.state!.undosLeft > 0 && this.state!.history.length > 0;
  }

  tapArrow(id: number): void {
    if (!this.playing) return;
    if (this.hooks.oneTap() || this.selected === id) this.dispatch({ type: 'tap', arrowId: id });
    else this.select(id, true);
  }

  tapEmpty(): void {
    if (this.selected !== null) this.select(null, false);
  }

  launchSelected(): void {
    if (this.playing && this.selected !== null)
      this.dispatch({ type: 'tap', arrowId: this.selected });
  }

  undo(): void {
    if (this.canUndo) this.dispatch({ type: 'undo' });
  }

  restart(): void {
    if (this.state) this.start(this.state.level);
  }

  hint(): void {
    if (!this.playing || this.hintsLeft <= 0) return;
    const id = solverHint(this.state!);
    if (id === null) return;
    this.hintsLeft--;
    this.view.flashHint(id);
    this.sfx.hint();
    this.haptics.tick();
    this.hooks.onChange();
  }

  private select(id: number | null, feedback: boolean): void {
    this.selected = id;
    if (id === null || !this.state) {
      this.selectedBlocked = false;
      this.view.setSelection(null);
    } else {
      const blockers = blockersOf(this.state, id);
      this.selectedBlocked = blockers.length > 0;
      this.view.setSelection({
        id,
        blockers: blockers.map((b) => b.id),
        gap: blockers[0]?.gap ?? null,
      });
      if (feedback) {
        this.sfx.select();
        this.haptics.tick();
      }
    }
    this.hooks.onChange();
  }

  private dispatch(action: Action): void {
    if (!this.state) return;
    const result = apply(this.state, action);
    this.state = result.state;
    for (const event of result.events) {
      this.react(event);
      this.hooks.onEvent?.(event);
    }
    this.hooks.onChange();
  }

  private react(event: GameEvent): void {
    switch (event.type) {
      case 'arrowEscaped':
        this.view.playEscape(event.arrowId);
        this.sfx.launch(this.combo++);
        this.haptics.launch();
        // Keep inspecting a different selected arrow: its blockers may have changed.
        this.select(this.selected === event.arrowId ? null : this.selected, false);
        break;
      case 'arrowBlocked':
        this.combo = 0;
        this.view.playBonk(event.arrowId, event.blockerId, event.gap);
        this.sfx.bonk();
        this.haptics.bonk();
        break;
      case 'levelWon':
        this.view.celebrate();
        this.haptics.win();
        this.endTimer = window.setTimeout(() => {
          this.sfx.win();
          this.hooks.onWin(event.stars);
        }, 650);
        break;
      case 'levelLost':
        this.select(null, false);
        this.haptics.lose();
        this.endTimer = window.setTimeout(() => {
          this.sfx.lose();
          this.hooks.onLose();
        }, 700);
        break;
      case 'undone': {
        this.combo = 0;
        this.sfx.undo();
        this.haptics.tick();
        if (event.entry.type === 'escape') {
          const arrow = getArrow(this.state!.level, event.entry.arrowId);
          if (arrow) this.view.restoreArrow(arrow);
        }
        this.select(this.selected, false);
        break;
      }
      case 'heartLost':
      case 'restarted':
      case 'rejected':
        break;
    }
  }

  dispose(): void {
    window.clearTimeout(this.endTimer);
  }
}
