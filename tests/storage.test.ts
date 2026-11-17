import { describe, expect, it } from 'vitest';
import {
  defaultSave,
  loadSave,
  recordStars,
  totalStars,
  writeSave,
  type StorageLike,
} from '../src/game/storage';
import { isTap, TAP_MAX_MOVE, TAP_MAX_MS } from '../src/render/controls';

function memory(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('storage', () => {
  it('round-trips progress and settings', () => {
    const store = memory();
    const save = defaultSave();
    save.settings.oneTap = true;
    recordStars(save, 'c1', 3);
    save.endless.stage = 4;
    expect(writeSave(save, store)).toBe(true);
    expect(loadSave(defaultSave(), store)).toEqual(save);
  });

  it('falls back to defaults on missing, corrupt or wrong-version data', () => {
    const fallback = defaultSave(true, 9);
    expect(loadSave(fallback, memory())).toEqual(fallback);
    expect(loadSave(fallback, memory({ 'unwind:save:v1': '{not json' }))).toEqual(fallback);
    expect(loadSave(fallback, memory({ 'unwind:save:v1': '{"v":2}' }))).toEqual(fallback);
    expect(loadSave(fallback, null)).toEqual(fallback);
  });

  it('survives a storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSave(defaultSave(), broken)).toEqual(defaultSave());
    expect(writeSave(defaultSave(), broken)).toBe(false);
  });

  it('sanitises bad values and keeps unknown settings at defaults', () => {
    const raw = JSON.stringify({
      v: 1,
      stars: { a: 7, b: 2, c: 'x' },
      settings: { sound: false, oneTap: 'yes' },
      endless: { stage: -3 },
    });
    const save = loadSave(defaultSave(), memory({ 'unwind:save:v1': raw }));
    expect(save.stars).toEqual({ b: 2 });
    expect(save.settings).toEqual({
      sound: false,
      haptics: true,
      oneTap: false,
      reduceMotion: false,
    });
    expect(save.endless.stage).toBe(0);
  });

  it('stars only go up', () => {
    const save = defaultSave();
    expect(recordStars(save, 'c1', 2)).toBe(true);
    expect(recordStars(save, 'c1', 1)).toBe(false);
    expect(recordStars(save, 'c2', 3)).toBe(true);
    expect(save.stars.c1).toBe(2);
    expect(totalStars(save)).toBe(5);
  });
});

describe('tap vs drag', () => {
  it('a short, still, single-finger press is a tap', () => {
    expect(isTap(0, 80, false)).toBe(true);
    expect(isTap(TAP_MAX_MOVE, TAP_MAX_MS, false)).toBe(true);
  });

  it('movement, long presses and multi-touch are not taps', () => {
    expect(isTap(TAP_MAX_MOVE + 1, 80, false)).toBe(false);
    expect(isTap(2, TAP_MAX_MS + 1, false)).toBe(false);
    expect(isTap(0, 50, true)).toBe(false);
  });
});
