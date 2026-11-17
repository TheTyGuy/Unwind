import { decodeLevel, type EncodedLevel } from '../core/codec';
import type { Level } from '../core/types';
import data from '../data/campaign.json';

export const CAMPAIGN: Level[] = (data.levels as EncodedLevel[]).map(decodeLevel);

/** One-line coaching shown on the first few levels. */
export function coachText(index: number, level: Level, oneTap: boolean): string | null {
  if (index === 0)
    return oneTap
      ? 'Tap an arrow to launch it out'
      : 'Tap an arrow to select it, tap again to launch';
  if (index === 1) return 'An arrow can only leave if the path ahead of its head is clear';
  if (index === 2) return 'Blocked launches cost a heart. Clear the blockers first';
  if (level.size[2] > 1 && CAMPAIGN.slice(0, index).every((l) => l.size[2] === 1)) {
    return 'Drag to rotate, pinch to zoom, double-tap empty space to reset';
  }
  return null;
}
