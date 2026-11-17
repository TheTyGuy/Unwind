import { apply, blockersOf, createGame } from './core/engine';
import { generateLevel } from './core/generator';
import { GameView } from './render/view';

// Milestone 3 harness: one generated level, tap to launch.
const canvas = document.getElementById('stage') as HTMLCanvasElement;
Object.assign(document.body.style, {
  margin: '0',
  background: 'linear-gradient(#1b2452,#0c1027)',
  height: '100vh',
  overflow: 'hidden',
});
Object.assign(canvas.style, {
  width: '100vw',
  height: '100vh',
  display: 'block',
  touchAction: 'none',
});
const q = new URLSearchParams(location.search);
const level = generateLevel({
  shape: q.get('shape') ?? 'cube',
  size: Number(q.get('size') ?? 4),
  minLen: 2,
  maxLen: 7,
  twistiness: 0.7,
  density: 0.9,
  seed: Number(q.get('seed') ?? 7),
});
let state = createGame(level);
const view = new GameView(canvas, {
  onArrowTap(id) {
    const r = apply(state, { type: 'tap', arrowId: id });
    state = r.state;
    for (const e of r.events) {
      if (e.type === 'arrowEscaped') view.playEscape(e.arrowId);
      if (e.type === 'arrowBlocked') view.playBonk(e.arrowId, e.blockerId, e.gap);
    }
  },
  onEmptyTap() {},
});
view.loadLevel(level);
view.start();
Object.assign(window, {
  __view: view,
  __state: () => state,
  __blockers: (id: number) => blockersOf(state, id),
});
