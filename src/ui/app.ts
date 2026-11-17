/** Screens and HUD. Plain DOM over the WebGL canvas; no game rules in here. */
import { endlessLevel } from '../core/endless';
import { generateLevel } from '../core/generator';
import { getShape } from '../core/shapes';
import type { Level } from '../core/types';
import { Sfx } from '../game/audio';
import { CAMPAIGN, coachText } from '../game/campaign';
import { Haptics } from '../game/haptics';
import { GameSession, HINTS_PER_LEVEL } from '../game/session';
import { recordStars, totalStars, writeSave, type SaveData, type Settings } from '../game/storage';
import { GameView } from '../render/view';
import { h, icon } from './dom';

type Mode = { kind: 'campaign'; index: number } | { kind: 'endless' };

const DEMO_LEVEL = generateLevel({
  shape: 'cube',
  size: 4,
  minLen: 3,
  maxLen: 8,
  twistiness: 0.8,
  density: 0.95,
  seed: 20,
});

export class App {
  readonly view: GameView;
  readonly session: GameSession;
  private sfx = new Sfx();
  private haptics = new Haptics();
  private mode: Mode | null = null;
  private screen: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private hud: Hud | null = null;
  private xray = false;

  constructor(
    canvas: HTMLCanvasElement,
    private ui: HTMLElement,
    private save: SaveData,
  ) {
    this.view = new GameView(canvas, {
      onArrowTap: (id) => this.session.tapArrow(id),
      onEmptyTap: () => this.session.tapEmpty(),
    });
    this.session = new GameSession(this.view, this.sfx, this.haptics, {
      oneTap: () => this.save.settings.oneTap,
      onChange: () => this.hud?.update(),
      onWin: (stars) => this.showWin(stars),
      onLose: () => this.showLose(),
    });
    this.applySettings();
    // Audio can only start from a user gesture.
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () =>
      document.hidden ? this.view.stop() : this.view.start(),
    );
    this.view.start();
    this.showHome();
  }

  // ------------------------------------------------------------- helpers --

  private applySettings(): void {
    const s = this.save.settings;
    this.sfx.enabled = s.sound;
    this.haptics.enabled = s.haptics;
    this.view.setReduceMotion(s.reduceMotion);
    document.documentElement.classList.toggle('reduce-motion', s.reduceMotion);
  }

  private persist(): void {
    writeSave(this.save);
  }

  private setScreen(el: HTMLElement, game = false): void {
    this.closeOverlay();
    this.screen?.remove();
    this.screen = el;
    this.ui.classList.toggle('in-game', game);
    this.ui.append(el);
    if (!game) this.hud = null;
  }

  private openOverlay(el: HTMLElement): void {
    this.closeOverlay();
    this.overlay = el;
    this.ui.append(el);
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private button(
    cls: string,
    label: string | Node,
    onTap: () => void,
    extra: Record<string, unknown> = {},
  ): HTMLButtonElement {
    return h(
      `button.${cls}` as 'button',
      {
        type: 'button',
        onclick: () => {
          this.sfx.click();
          onTap();
        },
        ...extra,
      },
      label,
    );
  }

  private unlocked(index: number): boolean {
    return index === 0 || (this.save.stars[CAMPAIGN[index - 1].id] ?? 0) > 0;
  }

  private nextCampaignIndex(): number {
    const i = CAMPAIGN.findIndex((l) => !this.save.stars[l.id]);
    return i < 0 ? CAMPAIGN.length - 1 : i;
  }

  // ---------------------------------------------------------------- home --

  showHome(): void {
    this.mode = null;
    this.session.state = null;
    this.view.loadLevel(DEMO_LEVEL);
    this.view.setXray(false);
    this.view.setPeel(0);
    this.view.setDemo(true);
    const next = this.nextCampaignIndex();
    const done = Object.keys(this.save.stars).length;
    this.setScreen(
      h(
        'div.screen.home',
        h(
          'div.home-top',
          h('h1.logo', 'Unwind'),
          h('p.tagline', 'Rotate the tangle. Free every arrow.'),
        ),
        h(
          'div.menu',
          this.button(
            'btn.primary',
            h('span', done ? `Continue · Level ${next + 1}` : 'Play'),
            () => this.startCampaign(next),
          ),
          this.button(
            'btn',
            h('span', 'Levels', h('small', `${totalStars(this.save)} / ${CAMPAIGN.length * 3} ★`)),
            () => this.showLevels(),
          ),
          this.button(
            'btn',
            h(
              'span',
              'Endless',
              h(
                'small',
                `Stage ${this.save.endless.stage + 1}${this.save.endless.best ? ` · best ${this.save.endless.best}` : ''}`,
              ),
            ),
            () => this.startEndless(),
          ),
          this.button('btn.ghost', 'Settings', () => this.showSettings()),
        ),
      ),
    );
  }

  // -------------------------------------------------------------- levels --

  showLevels(): void {
    if (this.mode) {
      this.mode = null;
      this.view.loadLevel(DEMO_LEVEL);
      this.view.setDemo(true);
    }
    const grid = h('div.level-grid');
    CAMPAIGN.forEach((level, i) => {
      const stars = this.save.stars[level.id] ?? 0;
      const open = this.unlocked(i);
      const cell = this.button(
        `level-cell${open ? '' : '.locked'}${stars ? '.done' : ''}`,
        h(
          'span',
          h('b', open ? String(i + 1) : icon('lock')),
          h('span.mini-stars', ...[1, 2, 3].map((n) => icon('star', n <= stars ? 'on' : ''))),
        ),
        () => open && this.startCampaign(i),
        {
          disabled: !open,
          'aria-label': `Level ${i + 1}${open ? `, ${stars} stars` : ', locked'}`,
        },
      );
      grid.append(cell);
    });
    this.setScreen(
      h(
        'div.screen.levels',
        h(
          'header.bar',
          this.button('icon-btn', icon('back'), () => this.showHome(), { 'aria-label': 'Back' }),
          h('h2', 'Levels'),
          h('span.star-total', icon('star', 'on'), `${totalStars(this.save)}`),
        ),
        h('div.scroll', grid),
      ),
    );
    grid
      .querySelector<HTMLElement>('.level-cell:not(.done):not(.locked)')
      ?.scrollIntoView({ block: 'center' });
  }

  // ---------------------------------------------------------------- game --

  startCampaign(index: number): void {
    this.mode = { kind: 'campaign', index };
    this.startLevel(
      CAMPAIGN[index],
      `Level ${index + 1}`,
      coachText(index, CAMPAIGN[index], this.save.settings.oneTap),
    );
  }

  startEndless(): void {
    this.mode = { kind: 'endless' };
    const { seed, stage } = this.save.endless;
    this.startLevel(endlessLevel(seed, stage), `Endless ${stage + 1}`, null);
  }

  private startLevel(level: Level, title: string, coach: string | null): void {
    this.view.setDemo(false);
    this.xray = false;
    this.view.setXray(false);
    this.view.setPeel(0);
    const subtitle = level.shape ? getShape(level.shape.id).name : '';
    this.hud = new Hud(this, title, subtitle, coach);
    this.setScreen(this.hud.el, true);
    this.session.start(level);
    this.hud.update();
  }

  retry(): void {
    this.closeOverlay();
    this.session.restart();
    this.hud?.resetTools();
  }

  exitGame(): void {
    if (this.mode?.kind === 'campaign') this.showLevels();
    else this.showHome();
  }

  toggleXray(): boolean {
    this.xray = !this.xray;
    this.view.setXray(this.xray);
    return this.xray;
  }

  private showWin(stars: number): void {
    const mode = this.mode;
    if (!mode) return;
    let title = 'Level cleared!';
    let next: (() => void) | null = null;
    if (mode.kind === 'campaign') {
      recordStars(this.save, CAMPAIGN[mode.index].id, stars);
      if (mode.index + 1 < CAMPAIGN.length) next = () => this.startCampaign(mode.index + 1);
      else title = 'Campaign complete!';
    } else {
      this.save.endless.stage++;
      this.save.endless.best = Math.max(this.save.endless.best, this.save.endless.stage);
      title = `Stage ${this.save.endless.stage} cleared!`;
      next = () => this.startEndless();
    }
    this.persist();

    const starRow = h(
      'div.stars',
      ...[0, 1, 2].map((i) => icon('star', i < stars ? `on pop d${i}` : '')),
    );
    for (let i = 0; i < stars; i++)
      window.setTimeout(() => this.overlay && this.sfx.star(i), 250 + i * 260);
    this.openOverlay(
      h(
        'div.overlay',
        h(
          'div.card',
          starRow,
          h('h2', title),
          h(
            'p',
            stars === 3
              ? 'Flawless. Not a single bonk.'
              : stars === 2
                ? 'Nice! Just one bonk.'
                : 'Cleared. Go for a clean run?',
          ),
          next
            ? this.button(
                'btn.primary',
                mode.kind === 'endless' ? 'Next stage' : 'Next level',
                next,
              )
            : null,
          h(
            'div.row',
            mode.kind === 'campaign'
              ? this.button('btn.small', 'Replay', () => this.startCampaign(mode.index))
              : null,
            this.button('btn.small', mode.kind === 'campaign' ? 'Levels' : 'Home', () =>
              this.exitGame(),
            ),
          ),
        ),
      ),
    );
  }

  private showLose(): void {
    this.openOverlay(
      h(
        'div.overlay',
        h(
          'div.card.lose',
          h('div.broken', icon('heart'), icon('heart'), icon('heart')),
          h('h2', 'Out of hearts'),
          h('p', 'Select an arrow to preview its path before you launch.'),
          this.button('btn.primary', 'Try again', () => this.retry()),
          h(
            'div.row',
            this.button('btn.small', this.mode?.kind === 'campaign' ? 'Levels' : 'Home', () =>
              this.exitGame(),
            ),
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ settings --

  showSettings(): void {
    const toggle = (key: keyof Settings, label: string, note: string) => {
      const input = h('input', { type: 'checkbox', checked: this.save.settings[key] });
      input.onchange = () => {
        this.save.settings[key] = input.checked;
        this.applySettings();
        this.persist();
        this.sfx.click();
        if (key === 'haptics' && input.checked) this.haptics.tick();
      };
      return h('label.toggle', h('span', h('b', label), h('small', note)), input, h('i'));
    };
    this.openOverlay(
      h(
        'div.overlay',
        { onclick: (e: Event) => e.target === e.currentTarget && this.closeOverlay() },
        h(
          'div.card.settings',
          h('h2', 'Settings'),
          toggle('sound', 'Sound', 'Pops, whooshes and bonks'),
          toggle('haptics', 'Haptics', 'Vibration, where the device supports it'),
          toggle('oneTap', 'One-tap launch', 'Skip the preview: tap fires immediately'),
          toggle('reduceMotion', 'Reduce motion', 'Shorter animations, no shake or wobble'),
          this.button('btn.primary', 'Done', () => this.closeOverlay()),
          this.session.state
            ? h(
                'div.row',
                this.button('btn.small', 'Restart level', () => this.retry()),
                this.button('btn.small', 'Quit', () => this.exitGame()),
              )
            : null,
        ),
      ),
    );
  }
}

/** In-game heads-up display. */
class Hud {
  readonly el: HTMLElement;
  private hearts = h('div.hearts');
  private remaining = h('span.remaining');
  private undoBtn: HTMLButtonElement;
  private hintBtn: HTMLButtonElement;
  private xrayBtn: HTMLButtonElement;
  private launchBtn: HTMLButtonElement;
  private peelWrap: HTMLElement;
  private peel: HTMLInputElement;
  private coach: HTMLElement | null;
  private lastHearts = -1;

  constructor(
    private app: App,
    title: string,
    subtitle: string,
    coach: string | null,
  ) {
    const s = app.session;
    const tool = (name: 'undo' | 'hint' | 'xray', label: string, onTap: () => void) =>
      h(
        'button.tool',
        { type: 'button', onclick: onTap, 'aria-label': label },
        icon(name),
        h('span.label', label),
        h('span.badge'),
      );
    this.undoBtn = tool('undo', 'Undo', () => s.undo());
    this.hintBtn = tool('hint', 'Hint', () => s.hint());
    this.xrayBtn = tool('xray', 'X-ray', () =>
      this.xrayBtn.classList.toggle('active', app.toggleXray()),
    );
    this.launchBtn = h(
      'button.launch',
      { type: 'button', onclick: () => s.launchSelected() },
      h('span', 'Launch'),
      icon('launch'),
    );
    this.peel = h('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: '0',
      'aria-label': 'Peel outer layers',
    });
    this.peel.oninput = () => app.view.setPeel((Number(this.peel.value) / 100) * 0.999);
    this.peelWrap = h('label.peel', icon('layers'), h('span', 'Peel'), this.peel);
    this.coach = coach ? h('p.coach', coach) : null;

    this.el = h(
      'div.screen.game',
      h(
        'header.bar',
        h(
          'button.icon-btn',
          { type: 'button', onclick: () => app.exitGame(), 'aria-label': 'Back' },
          icon('back'),
        ),
        h('div.title', h('b', title), h('small', subtitle)),
        this.hearts,
        h(
          'button.icon-btn',
          { type: 'button', onclick: () => app.showSettings(), 'aria-label': 'Settings' },
          icon('gear'),
        ),
      ),
      h('div.sub', this.remaining),
      this.coach,
      h('div.spacer'),
      this.launchBtn,
      this.peelWrap,
      h('footer.tools', this.undoBtn, this.hintBtn, this.xrayBtn),
    );
  }

  resetTools(): void {
    this.peel.value = '0';
    this.app.view.setPeel(0);
  }

  update(): void {
    const s = this.app.session;
    const state = s.state;
    if (!state) return;
    if (state.hearts !== this.lastHearts) {
      const lost = this.lastHearts > state.hearts;
      this.hearts.replaceChildren(
        ...Array.from({ length: state.maxHearts }, (_, i) =>
          icon(
            'heart',
            i < state.hearts ? 'on' : lost && i === state.hearts ? 'off breaking' : 'off',
          ),
        ),
      );
      this.lastHearts = state.hearts;
    }
    const left = s.remaining;
    this.remaining.textContent =
      left === 0 ? 'All clear!' : `${left} arrow${left === 1 ? '' : 's'} left`;
    this.undoBtn.disabled = !s.canUndo;
    this.undoBtn.querySelector('.badge')!.textContent = String(state.undosLeft);
    this.hintBtn.disabled = !s.playing || s.hintsLeft <= 0;
    this.hintBtn.querySelector('.badge')!.textContent = String(s.hintsLeft);
    this.hintBtn.classList.toggle('fresh', s.hintsLeft === HINTS_PER_LEVEL);

    const layered = this.app.view.hasLayers;
    this.xrayBtn.hidden = !layered;
    this.peelWrap.hidden = !layered;

    const show = s.playing && s.selected !== null;
    this.launchBtn.classList.toggle('show', show);
    this.launchBtn.classList.toggle('blocked', s.selectedBlocked);
    this.launchBtn.firstElementChild!.textContent = s.selectedBlocked ? 'Blocked' : 'Launch';
    if (this.coach && state.history.length > 0) this.coach.classList.add('hide');
  }
}
