/** Dotted exit-ray preview: a stream of small dots flowing out of the selected arrow's head. */
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import { BLOCK_RED, FREE_GREEN } from './palette';

const MAX_DOTS = 48;
const SPACING = 0.34;

export class RayPreview {
  readonly mesh: InstancedMesh;
  private origin = new Vector3();
  private dir = new Vector3();
  private length = 0;
  private blockedAt = Infinity;
  private phase = 0;
  private m = new Matrix4();
  private free = new Color(FREE_GREEN);
  private blocked = new Color(BLOCK_RED);
  private dim = new Color(BLOCK_RED).multiplyScalar(0.5);

  constructor() {
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new SphereGeometry(0.055, 8, 6), material, MAX_DOTS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }

  /** @param blockedAt distance along the ray to the first blocker (Infinity if clear). */
  show(origin: Vector3, dir: Vector3, length: number, blockedAt: number): void {
    this.origin.copy(origin);
    this.dir.copy(dir);
    this.length = length;
    this.blockedAt = blockedAt;
    this.mesh.visible = true;
    this.update(0);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.phase = (this.phase + dt * 1.1) % SPACING;
    let n = 0;
    for (let d = this.phase; d < this.length && n < MAX_DOTS; d += SPACING, n++) {
      // Dots swell in at the head and shrink away at the far end.
      const scale = Math.min(1, d / 0.3, (this.length - d) / 0.5);
      this.m.makeScale(scale, scale, scale);
      this.m.setPosition(
        this.origin.x + this.dir.x * d,
        this.origin.y + this.dir.y * d,
        this.origin.z + this.dir.z * d,
      );
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(
        n,
        this.blockedAt === Infinity ? this.free : d < this.blockedAt ? this.blocked : this.dim,
      );
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
