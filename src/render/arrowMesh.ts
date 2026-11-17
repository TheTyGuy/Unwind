/**
 * One arrow = one mesh: a tube with a rounded tail, a tapering body and a cone
 * head, all swept along the arrow's path. `update(s)` re-sweeps the same
 * vertices `s` units further along, which is how arrows slide and escape.
 */
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, Vector3 } from 'three';
import { samplePath, type ArrowPath } from './path';

export const TUBE_R = 0.15;
export const HEAD_R = 0.3;
export const HEAD_LEN = 0.42;
const RADIAL = 10;
const RING_SPACING = 0.1;

interface Ring {
  /** Arc length from the tail tip. */
  u: number;
  r: number;
  /** Normal = nr * radial + nt * tangent. */
  nr: number;
  nt: number;
}

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

function buildRings(bodyLen: number): Ring[] {
  const tailR = TUBE_R * 0.78;
  const grow = Math.min(1.6, bodyLen * 0.6);
  const radius = (u: number) => tailR + (TUBE_R - tailR) * smooth(u / grow);
  const rings: Ring[] = [
    { u: 0, r: 0, nr: 0, nt: -1 },
    { u: 0.045, r: tailR * 0.72, nr: 0.7, nt: -0.7 },
    { u: 0.12, r: radius(0.12), nr: 1, nt: 0 },
  ];
  const n = Math.max(2, Math.round((bodyLen - 0.12) / RING_SPACING));
  for (let i = 1; i <= n; i++) {
    const u = 0.12 + ((bodyLen - 0.12) * i) / n;
    rings.push({ u, r: radius(u), nr: 1, nt: 0 });
  }
  const coneLen = Math.hypot(HEAD_LEN, HEAD_R);
  rings.push(
    { u: bodyLen, r: TUBE_R, nr: 0, nt: -1 },
    { u: bodyLen, r: HEAD_R, nr: 0, nt: -1 },
    { u: bodyLen, r: HEAD_R, nr: HEAD_LEN / coneLen, nt: HEAD_R / coneLen },
    { u: bodyLen + HEAD_LEN, r: 0.004, nr: HEAD_LEN / coneLen, nt: HEAD_R / coneLen },
  );
  return rings;
}

const C = new Vector3();
const A = new Vector3();
const B = new Vector3();
const T = new Vector3();
const N = new Vector3();
const BN = new Vector3();
const COS = Array.from({ length: RADIAL }, (_, j) => Math.cos((j / RADIAL) * Math.PI * 2));
const SIN = Array.from({ length: RADIAL }, (_, j) => Math.sin((j / RADIAL) * Math.PI * 2));

export class ArrowTube {
  readonly geometry = new BufferGeometry();
  readonly length: number;
  private rings: Ring[];
  private pos: Float32Array;
  private nor: Float32Array;

  constructor(private path: ArrowPath) {
    this.rings = buildRings(path.bodyLen);
    this.length = path.bodyLen + HEAD_LEN;
    const count = this.rings.length * RADIAL;
    this.pos = new Float32Array(count * 3);
    this.nor = new Float32Array(count * 3);
    const index: number[] = [];
    for (let i = 0; i < this.rings.length - 1; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = i * RADIAL + j;
        const b = i * RADIAL + ((j + 1) % RADIAL);
        const c = a + RADIAL;
        const d = b + RADIAL;
        index.push(a, b, c, b, d, c);
      }
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(this.nor, 3));
    this.geometry.setIndex(index);
    this.update(0);
  }

  /** Re-sweep the mesh with its tail at arc length `s` along the path. */
  update(s: number): void {
    const { rings, pos, nor, path } = this;
    let o = 0;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      const at = s + ring.u;
      samplePath(path, at, C);
      samplePath(path, at - 0.05, A);
      samplePath(path, at + 0.05, B);
      T.subVectors(B, A);
      if (T.lengthSq() < 1e-10) T.copy(path.dir);
      T.normalize();
      if (i === 0) {
        // Any stable vector perpendicular to the first tangent.
        N.set(Math.abs(T.y) < 0.9 ? 0 : 1, Math.abs(T.y) < 0.9 ? 1 : 0, 0);
      }
      // Parallel transport: keep the previous normal, re-orthogonalised.
      N.addScaledVector(T, -N.dot(T)).normalize();
      BN.crossVectors(T, N);
      for (let j = 0; j < RADIAL; j++) {
        const rx = COS[j] * N.x + SIN[j] * BN.x;
        const ry = COS[j] * N.y + SIN[j] * BN.y;
        const rz = COS[j] * N.z + SIN[j] * BN.z;
        pos[o] = C.x + rx * ring.r;
        pos[o + 1] = C.y + ry * ring.r;
        pos[o + 2] = C.z + rz * ring.r;
        nor[o] = rx * ring.nr + T.x * ring.nt;
        nor[o + 1] = ry * ring.nr + T.y * ring.nt;
        nor[o + 2] = rz * ring.nr + T.z * ring.nt;
        o += 3;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** Uniforms shared by every arrow material (one program, one clock). */
export const arrowUniforms = {
  uTime: { value: 0 },
  uBreath: { value: 0.012 },
  uRim: { value: 0.6 },
};

/** Standard material plus an idle "breathing" swell and a dark rim so overlaps read clearly. */
export function createArrowMaterial(color: number): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.4,
    metalness: 0.05,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = arrowUniforms.uTime;
    shader.uniforms.uBreath = arrowUniforms.uBreath;
    shader.uniforms.uRim = arrowUniforms.uRim;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uBreath;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed += normal * (sin(uTime * 1.7 + position.x * 2.1 + position.y * 1.7 + position.z * 1.3) * uBreath);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;')
      .replace(
        '#include <dithering_fragment>',
        `float rimK = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
         gl_FragColor.rgb *= 1.0 - uRim * pow(rimK, 2.6);
         #include <dithering_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'unwind-arrow';
  return mat;
}
