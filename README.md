# Unwind

A mobile-first 3D "arrow escape" puzzle for the web. Rotate a tangle of wavy, snake-like arrows
and tap them out one at a time. An arrow can only leave if the path ahead of its head is clear.
Remove every arrow to win.

Vite + TypeScript + Three.js, no UI framework. Installable as a PWA and playable offline.

## Getting started

```bash
npm install
npm run dev        # dev server with hot reload
```

| Script                    | What it does                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run dev`             | Start the Vite dev server                                         |
| `npm run build`           | Type-check, then build to `dist/` (also emits the service worker) |
| `npm run preview`         | Serve the production build locally (use this to test the PWA)     |
| `npm test`                | Run the Vitest unit tests once                                    |
| `npm run test:watch`      | Vitest in watch mode                                              |
| `npm run lint`            | ESLint                                                            |
| `npm run format`          | Prettier (write)                                                  |
| `npm run generate-levels` | Regenerate the campaign into `src/data/campaign.json`             |

To try it on a phone, run `npm run dev -- --host` and open the printed network URL.

## How to play

- **Drag** to rotate, **pinch** to zoom, **double-tap empty space** to reset the view.
- **Tap an arrow** to select it: its body lights up, a dotted line shows its exit path, and anything
  in the way glows red. **Tap it again** (or press **Launch**) to fire.
- A blocked launch bonks and costs a heart. Three hearts per level.
- **X-ray** fades the outer arrows; **Peel** hides outer layers. Both appear only on shapes that
  have an inside.
- **Undo** (3 per level) takes back the last tap. It returns a lost heart, but the bonk still counts
  against your stars. **Hint** (3 per level) pulses an arrow that is free right now.
- Stars: 3 for no bonks, 2 for one, 1 for finishing.
- Settings: sound, haptics, one-tap launch (skip the preview), reduce motion.

## Rules (the game model)

- A level is a 3D voxel grid. A _shape_ is the set of cells arrows may occupy.
- An arrow is an ordered path of 2+ face-adjacent cells. The last cell is the head, which points
  along one of the six axis directions.
- Tapping an arrow checks every cell on the straight ray from its head to the edge of the grid. If
  no other arrow occupies any of them, it escapes; otherwise it is blocked by the nearest one.
- The body follows its own path out, so only the head's ray matters.
- A 2D level is the same thing in a grid one cell thick.

Because removing an arrow only ever frees cells, a level is solvable exactly when its "is blocked
by" graph has no cycle. The skill is in reading the tangle to find what is free.

## Architecture

```
src/core/     Pure game logic. No DOM, no Three.js (enforced by an ESLint rule).
  types.ts      Level / Arrow / GameState / Action / GameEvent
  engine.ts     apply(state, action) -> { state, events }
  grid.ts       rays, occupancy, blockers
  rng.ts        seeded RNG (mulberry32) + seed hashing
  shapes.ts     shape definitions as data
  generator.ts  backwards level generator
  solver.ts     solvability, difficulty metrics, hints
  endless.ts    generate toward a difficulty target from a seed
  campaign.ts   curation of a difficulty curve
  codec.ts      compact JSON level encoding
src/render/   Three.js view. Told what happened; decides nothing.
src/game/     session.ts wires engine events to view, audio, haptics and UI; storage, audio.
src/ui/       DOM screens and HUD.
scripts/      generate-levels.ts
tests/        Vitest suites for everything in core, plus storage and tap detection.
```

**Engine.** State is plain JSON. `apply` never mutates and never reads a clock or random number, so
the same state and action always give the same result. It returns events (`arrowEscaped`,
`arrowBlocked`, `heartLost`, `levelWon`, `levelLost`, `undone`, ...) and those events are the only
thing that drives animation, sound and UI.

**Generator.** Levels are built backwards. Each new arrow is placed so its exit ray is clear of
everything placed before it, which means it could leave first; replaying the placement order in
reverse is always a solution. Bodies grow from the head as self-avoiding random walks that prefer
turning. Parameters: `shape`, `size`, `minLen`, `maxLen`, `twistiness`, `density`, `interlock`
(how hard to push arrows across each other's exit paths) and `seed`.

**Solver.** `analyze(level)` reports solvability, one valid order, arrow count, dependency depth
(longest "A blocks B blocks C" chain), average free arrows per step, total trap taps (blocked arrows
on offer across a playthrough) and how many of those traps are "sneaky" (the blocker is not touching
the head). These combine into a 0-100 difficulty score.

**Campaign.** `npm run generate-levels` generates 300 candidates per shape, validates and scores
each, then picks 60 along a smooth difficulty curve with shape variety and flat levels first.
Options: `-- --per 300 --count 60 --seed 2026`. The output is deterministic for a given seed.

**Endless.** `generateForDifficulty(target, seed)` picks parameters for the target, generates a
handful of candidates and keeps the closest. Same inputs, same level.

### Adding a shape

Append to `SHAPES` in `src/core/shapes.ts`:

```ts
{ id: 'tower', name: 'Tower', minSize: 3, maxSize: 6, build: (n) => box(2, n, 2) }
```

`build` returns voxels for size `n`, either from a predicate or from layered ASCII art via
`voxelArt` (see the rubber duck). The generator, renderer and level script pick it up automatically.
Included: flat square, cube (3-6), pyramid, stairs, hollow cube, donut, plus, diamond, heart and a
rubber duck.

### Rendering notes

- Each arrow is one mesh: a tube swept along a centripetal Catmull-Rom curve through its cell
  centres, with a rounded tail and a cone head. Sliding and escaping re-sweep the same vertex buffer
  further along the path, so nothing is allocated per frame.
- A level is one draw call per arrow plus a few for the shell and effects; the largest campaign
  level is about 56 draw calls and 25k triangles. Geometry and materials are disposed when an arrow
  leaves or a level unloads.
- Picking is analytic: each arrow has an invisible capsule chain along its curve. An exact hit
  nearest the camera wins; otherwise a fatter radius (about 14 CSS px) catches near misses.
- A drag becomes a rotation after 10 px of movement; a tap is a press under 10 px and 350 ms with
  one finger.

## PWA

`public/manifest.webmanifest` makes the game installable. The build emits `dist/sw.js` (from a small
plugin in `vite.config.ts`) that precaches every built file under a content-hashed cache name and
serves cache-first, so the game works offline after the first visit and each deploy replaces the old
cache. The service worker is only registered in production builds. `base` is `./`, so `dist/` can be
hosted from any path.

## Future multiplayer

Not built yet, but the engine is shaped for it:

- **Race on the same puzzle.** A level is fully determined by `(seed, params)` or
  `(difficulty target, seed)`, so two phones only need to exchange a few numbers to get an identical
  tangle. Each runs its own `GameState`; only progress needs syncing.
- **Take turns on a shared tangle.** State is serializable and `apply` is deterministic, so peers
  can exchange actions rather than state and stay in lockstep, or a host can apply actions and
  broadcast the resulting events. A turn rule is a thin wrapper that rejects actions from the wrong
  player before calling `apply`.
- **Co-op by colour.** Actions already carry an optional `player`, echoed on `arrowEscaped` and
  `arrowBlocked`. Ownership can be a pure function of the level (for example `arrow.id % players`),
  checked in the same wrapper.

`GameSession` exposes an `onEvent` hook that receives every engine event, which is where a network
layer would attach. Rendering already reacts only to events, so remote moves would animate the same
way local ones do.
