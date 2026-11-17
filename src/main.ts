import './ui/styles.css';
import { defaultSave, loadSave } from './game/storage';
import { App } from './ui/app';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const prefersReducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const save = loadSave(
  defaultSave(prefersReducedMotion, (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0),
);

try {
  const app = new App(canvas, ui, save);
  if (import.meta.env.DEV) Object.assign(window, { __unwind: app });
} catch (err) {
  console.error(err);
  ui.innerHTML =
    '<div class="screen home"><div class="home-top"><h1 class="logo">Unwind</h1><p class="tagline">This device could not start WebGL, which the game needs.</p></div></div>';
}

// iOS Safari ignores user-scalable=no; stop page-level pinch zoom so pinch only zooms the puzzle.
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
