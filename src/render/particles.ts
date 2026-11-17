/** Small pooled additive sparkle system for trails, pops and confetti. */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';

const MAX = 320;

/** Soft round sprite so sparkles are glowing dots rather than squares. */
function softDot(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(canvas);
}

export class Particles {
  readonly points: Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private base = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private ttl = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private next = 0;
  private alive = 0;
  private geometry = new BufferGeometry();
  private material: PointsMaterial;

  constructor() {
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.col, 3));
    this.material = new PointsMaterial({
      size: 0.3,
      map: softDot(),
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.pos.fill(1e5);
  }

  emit(at: Vector3, velocity: Vector3, color: Color, ttl: number, drag = 2): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set([velocity.x, velocity.y, velocity.z], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.life[i] = ttl;
    this.ttl[i] = ttl;
    this.drag[i] = drag;
    this.alive = Math.max(this.alive, 1);
  }

  burst(at: Vector3, color: Color, count: number, speed: number, ttl = 0.6): void {
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.emit(at, v, color, ttl * (0.6 + Math.random() * 0.6));
    }
  }

  update(dt: number): void {
    if (!this.alive) return;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const a = i * 3;
      if (this.life[i] <= 0) {
        this.pos[a] = this.pos[a + 1] = this.pos[a + 2] = 1e5;
        continue;
      }
      alive++;
      const damp = Math.exp(-this.drag[i] * dt);
      const k = this.life[i] / this.ttl[i];
      for (let c = 0; c < 3; c++) {
        this.vel[a + c] *= damp;
        this.pos[a + c] += this.vel[a + c] * dt;
        this.col[a + c] = this.base[a + c] * k * k;
      }
    }
    this.alive = alive;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
