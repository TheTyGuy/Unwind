/** Faint translucent hull of the level's shape so its silhouette stays readable. */
import {
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { keyOf, inBounds } from '../core/grid';
import { DIRS, type Vec3 } from '../core/types';

// Corner offsets for each face, matching DIRS order (+X -X +Y -Y +Z -Z).
const FACES: number[][][] = [
  [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
  ],
];

export interface Shell {
  group: Group;
  dispose(): void;
}

export function buildShell(cells: Vec3[], size: Vec3): Shell {
  const solid = new Set(cells.map((c) => keyOf(size, c)));
  const has = (x: number, y: number, z: number) =>
    inBounds(size, x, y, z) && solid.has(x + size[0] * (y + size[1] * z));
  const positions: number[] = [];
  const ox = -size[0] / 2;
  const oy = -size[1] / 2;
  const oz = -size[2] / 2;
  for (const c of cells) {
    for (let f = 0; f < 6; f++) {
      const d = DIRS[f];
      if (has(c[0] + d[0], c[1] + d[1], c[2] + d[2])) continue;
      const q = FACES[f].map((k) => [c[0] + k[0] + ox, c[1] + k[1] + oy, c[2] + k[2] + oz]);
      for (const i of [0, 1, 2, 0, 2, 3]) positions.push(q[i][0], q[i][1], q[i][2]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const faceMat = new MeshBasicMaterial({
    color: 0x9fb6ff,
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
    side: DoubleSide,
  });
  const faces = new Mesh(geometry, faceMat);
  faces.renderOrder = 5;
  const edgeGeo = new EdgesGeometry(geometry, 1);
  const edgeMat = new LineBasicMaterial({
    color: 0xa9bcff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const edges = new LineSegments(edgeGeo, edgeMat);
  const group = new Group();
  group.add(faces, edges);
  return {
    group,
    dispose() {
      geometry.dispose();
      edgeGeo.dispose();
      faceMat.dispose();
      edgeMat.dispose();
    },
  };
}

/** Depth of each cell from the shape's surface (0 = touches the outside). Keyed by cell key. */
export function cellDepths(cells: Vec3[], size: Vec3): Map<number, number> {
  const solid = new Set(cells.map((c) => keyOf(size, c)));
  const depth = new Map<number, number>();
  let frontier: Vec3[] = [];
  for (const c of cells) {
    const surface = DIRS.some((d) => {
      const x = c[0] + d[0];
      const y = c[1] + d[1];
      const z = c[2] + d[2];
      return !inBounds(size, x, y, z) || !solid.has(x + size[0] * (y + size[1] * z));
    });
    if (surface) {
      depth.set(keyOf(size, c), 0);
      frontier.push(c);
    }
  }
  for (let level = 1; frontier.length > 0; level++) {
    const next: Vec3[] = [];
    for (const c of frontier) {
      for (const d of DIRS) {
        const n: Vec3 = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
        if (!inBounds(size, n[0], n[1], n[2])) continue;
        const k = keyOf(size, n);
        if (!solid.has(k) || depth.has(k)) continue;
        depth.set(k, level);
        next.push(n);
      }
    }
    frontier = next;
  }
  return depth;
}
