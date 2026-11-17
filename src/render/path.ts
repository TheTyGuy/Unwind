/**
 * Turns an arrow's cell path into a smooth, slightly wavy curve plus a straight
 * exit run along its head direction, resampled at uniform arc length so the
 * body can slide along it cheaply.
 */
import { CatmullRomCurve3, Vector3 } from 'three';
import { DIRS, type Arrow, type Vec3 } from '../core/types';

export const PATH_STEP = 0.04;
/** How far past the head cell centre the body (and so the arrowhead base) sits. */
const NOSE = 0.12;
const WAVE = 0.09;
const CURVE_DIV = 14;

export interface ArrowPath {
  /** xyz triples, PATH_STEP apart by arc length. */
  pts: Float32Array;
  count: number;
  /** Arc length of the resting body (tail tip to arrowhead base). */
  bodyLen: number;
  totalLen: number;
  dir: Vector3;
}

export function cellCenter(size: Vec3, c: Vec3, out = new Vector3()): Vector3 {
  return out.set(c[0] - (size[0] - 1) / 2, c[1] - (size[1] - 1) / 2, c[2] - (size[2] - 1) / 2);
}

export function buildArrowPath(arrow: Arrow, size: Vec3, exitLen: number): ArrowPath {
  const controls: Vector3[] = [];
  const cells = arrow.cells;
  for (let i = 0; i < cells.length; i++) {
    const p = cellCenter(size, cells[i]);
    if (i > 0) {
      // Wavy midpoint: nudge sideways, alternating, along an axis the grid actually has.
      const prev = cells[i - 1];
      const segAxis = prev[0] !== cells[i][0] ? 0 : prev[1] !== cells[i][1] ? 1 : 2;
      let axes = [0, 1, 2].filter((a) => a !== segAxis && size[a] > 1);
      if (axes.length === 0) axes = [0, 1, 2].filter((a) => a !== segAxis);
      const axis = axes[(arrow.id + i) % axes.length];
      const mid = controls[controls.length - 1].clone().add(p).multiplyScalar(0.5);
      mid.setComponent(axis, mid.getComponent(axis) + ((i + arrow.id) % 2 ? WAVE : -WAVE));
      controls.push(mid);
    }
    controls.push(p);
  }
  const d = DIRS[arrow.dir];
  const dir = new Vector3(d[0], d[1], d[2]);
  const head = controls[controls.length - 1];
  const nose = head.clone().addScaledVector(dir, NOSE);
  controls.push(nose, head.clone().addScaledVector(dir, NOSE + 1));

  // Control points land exactly on multiples of CURVE_DIV; stop at the nose.
  const curve = new CatmullRomCurve3(controls, false, 'centripetal');
  const dense = curve
    .getPoints(CURVE_DIV * (controls.length - 1))
    .slice(0, CURVE_DIV * (controls.length - 2) + 1);
  let bodyLen = 0;
  for (let i = 1; i < dense.length; i++) bodyLen += dense[i].distanceTo(dense[i - 1]);
  dense.push(nose.clone().addScaledVector(dir, exitLen));
  const totalLen = bodyLen + exitLen;

  const count = Math.ceil(totalLen / PATH_STEP) + 1;
  const pts = new Float32Array(count * 3);
  let seg = 0;
  let segStart = 0;
  let segLen = dense[1].distanceTo(dense[0]);
  const tmp = new Vector3();
  for (let i = 0; i < count; i++) {
    const s = Math.min(totalLen, i * PATH_STEP);
    while (seg < dense.length - 2 && s > segStart + segLen) {
      segStart += segLen;
      seg++;
      segLen = dense[seg + 1].distanceTo(dense[seg]);
    }
    tmp.lerpVectors(
      dense[seg],
      dense[seg + 1],
      segLen > 0 ? Math.min(1, (s - segStart) / segLen) : 0,
    );
    pts[i * 3] = tmp.x;
    pts[i * 3 + 1] = tmp.y;
    pts[i * 3 + 2] = tmp.z;
  }
  return { pts, count, bodyLen, totalLen, dir };
}

/** Point at arc length `s` along the path (clamped). */
export function samplePath(path: ArrowPath, s: number, out: Vector3): Vector3 {
  const f = Math.max(0, Math.min(path.count - 1.0001, s / PATH_STEP));
  const i = Math.floor(f);
  const t = f - i;
  const p = path.pts;
  const a = i * 3;
  return out.set(
    p[a] + (p[a + 3] - p[a]) * t,
    p[a + 1] + (p[a + 4] - p[a + 1]) * t,
    p[a + 2] + (p[a + 5] - p[a + 2]) * t,
  );
}
