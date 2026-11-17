/**
 * Tap picking against invisible capsule hit volumes that follow each arrow's
 * curve. An exact hit on the visible tube wins (nearest to the camera); if the
 * tap misses everything, a fatter volume catches near misses so thin tubes
 * stay easy to tap on a phone.
 */
import { Vector3 } from 'three';
import { HEAD_LEN, HEAD_R, TUBE_R } from './arrowMesh';
import { PATH_STEP, type ArrowPath } from './path';

const STRIDE = 3;

export interface PickTarget {
  id: number;
  /** Segment endpoints (xyz triples) along the resting body. */
  pts: Float32Array;
  /** Index of the first point belonging to the arrowhead. */
  headStart: number;
}

export function buildPickTarget(id: number, path: ArrowPath): PickTarget {
  const last = Math.min(path.count - 1, Math.ceil((path.bodyLen + HEAD_LEN) / PATH_STEP));
  const idx: number[] = [];
  for (let i = 0; i < last; i += STRIDE) idx.push(i);
  idx.push(last);
  const pts = new Float32Array(idx.length * 3);
  idx.forEach((src, i) => pts.set(path.pts.subarray(src * 3, src * 3 + 3), i * 3));
  const headStart = idx.findIndex((i) => i * PATH_STEP >= path.bodyLen - 0.05);
  return { id, pts, headStart: headStart < 0 ? idx.length - 1 : headStart };
}

export interface PickHit {
  id: number;
  /** Distance along the ray to the closest approach. */
  t: number;
  /** Distance from the ray to the arrow's centre line. */
  dist: number;
  exact: boolean;
}

const P = new Vector3();
const Q = new Vector3();
const U = new Vector3();
const W = new Vector3();

/** Closest approach between a ray and a segment. Returns [distance, t along ray]. */
function raySegment(o: Vector3, d: Vector3, p: Vector3, q: Vector3): [number, number] {
  U.subVectors(q, p);
  W.subVectors(o, p);
  const b = d.dot(U);
  const c = U.dot(U);
  const dd = d.dot(W);
  const e = U.dot(W);
  const denom = c - b * b;
  let sc = denom > 1e-8 ? (e - b * dd) / denom : 0;
  sc = Math.max(0, Math.min(1, c > 0 ? sc : 0));
  const tc = Math.max(0, b * sc - dd);
  const dx = o.x + d.x * tc - (p.x + U.x * sc);
  const dy = o.y + d.y * tc - (p.y + U.y * sc);
  const dz = o.z + d.z * tc - (p.z + U.z * sc);
  return [Math.sqrt(dx * dx + dy * dy + dz * dz), tc];
}

/**
 * @param origin ray origin in the same space as the targets
 * @param dir normalised ray direction
 * @param fat extra radius for forgiving near-miss picking
 */
export function pick(
  origin: Vector3,
  dir: Vector3,
  targets: Iterable<PickTarget>,
  fat: number,
): PickHit | null {
  let exact: PickHit | null = null;
  let near: PickHit | null = null;
  for (const target of targets) {
    const n = target.pts.length / 3;
    for (let i = 0; i < n - 1; i++) {
      P.fromArray(target.pts, i * 3);
      Q.fromArray(target.pts, i * 3 + 3);
      const [dist, t] = raySegment(origin, dir, P, Q);
      const radius = (i >= target.headStart ? HEAD_R : TUBE_R) * 1.15;
      if (dist <= radius) {
        if (!exact || t < exact.t) exact = { id: target.id, t, dist, exact: true };
      } else if (dist <= radius + fat) {
        if (!near || dist - radius < near.dist)
          near = { id: target.id, t, dist: dist - radius, exact: false };
      }
    }
  }
  return exact ?? near;
}
