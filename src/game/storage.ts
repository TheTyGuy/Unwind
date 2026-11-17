/** Progress + settings persistence. Every storage access is guarded: private mode can throw. */

export interface Settings {
  sound: boolean;
  haptics: boolean;
  /** Tap once to launch instead of select-then-launch. */
  oneTap: boolean;
  reduceMotion: boolean;
}

export interface SaveData {
  v: 1;
  /** Best stars per campaign level id. */
  stars: Record<string, number>;
  settings: Settings;
  endless: { seed: number; stage: number; best: number };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'unwind:save:v1';

export function defaultSave(reduceMotion = false, seed = 1): SaveData {
  return {
    v: 1,
    stars: {},
    settings: { sound: true, haptics: true, oneTap: false, reduceMotion },
    endless: { seed, stage: 0, best: 0 },
  };
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Load the save, falling back to (and merging with) defaults on any problem. */
export function loadSave(
  fallback: SaveData,
  storage: StorageLike | null = safeStorage(),
): SaveData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (!data || typeof data !== 'object' || data.v !== 1) return fallback;
    const stars: Record<string, number> = {};
    for (const [id, n] of Object.entries(data.stars ?? {})) {
      if (typeof n === 'number' && n >= 1 && n <= 3) stars[id] = Math.floor(n);
    }
    return {
      v: 1,
      stars,
      settings: { ...fallback.settings, ...pickBooleans(data.settings) },
      endless: {
        seed: num(data.endless?.seed, fallback.endless.seed),
        stage: num(data.endless?.stage, 0),
        best: num(data.endless?.best, 0),
      },
    };
  } catch {
    return fallback;
  }
}

export function writeSave(data: SaveData, storage: StorageLike | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function pickBooleans(v: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (v && typeof v === 'object') {
    for (const key of ['sound', 'haptics', 'oneTap', 'reduceMotion'] as const) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === 'boolean') out[key] = val;
    }
  }
  return out;
}

/** Record a result; stars only ever go up. Returns true if it was a new best. */
export function recordStars(data: SaveData, levelId: string, stars: number): boolean {
  if ((data.stars[levelId] ?? 0) >= stars) return false;
  data.stars[levelId] = stars;
  return true;
}

export function totalStars(data: SaveData): number {
  return Object.values(data.stars).reduce((s, n) => s + n, 0);
}
