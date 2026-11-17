/** Bright, saturated arrow colours chosen to stay distinct from each other and from "blocked" red. */
export const ARROW_COLORS = [
  0xffc531, 0x35c8ff, 0x7be04a, 0xff7a3d, 0xb07bff, 0x2ee6c0, 0xff6fb5, 0x5b8cff, 0xe6e84a,
  0xff9d5c, 0x4fe38a, 0xd98bff,
];

export const BLOCK_RED = 0xff2a4a;
export const FREE_GREEN = 0x6dffa8;

export function colorFor(id: number): number {
  return ARROW_COLORS[id % ARROW_COLORS.length];
}
