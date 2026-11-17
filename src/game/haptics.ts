/** Vibration feedback where the platform supports it (not iOS Safari). */
export class Haptics {
  enabled = true;

  private buzz(pattern: number | number[]): void {
    if (!this.enabled) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported or blocked */
    }
  }

  tick(): void {
    this.buzz(8);
  }

  launch(): void {
    this.buzz(18);
  }

  bonk(): void {
    this.buzz([35, 40, 35]);
  }

  win(): void {
    this.buzz([20, 60, 20, 60, 60]);
  }

  lose(): void {
    this.buzz([120, 60, 160]);
  }
}
