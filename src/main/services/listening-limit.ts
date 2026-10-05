export const LISTENING_LIMIT_MS = 3 * 60 * 60 * 1000;

/** Main-process wall-clock deadline: pause/reconnect never extends a session. */
export class ListeningLimit {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private token: number | null = null;
  private deadline = 0;
  expired = false;

  constructor(private onExpire: (token: number) => void) {}

  start(token: number): void {
    this.clearTimer();
    this.token = token;
    this.deadline = Date.now() + LISTENING_LIMIT_MS;
    this.expired = false;
    this.check();
  }

  stop(token?: number): void {
    if (token !== undefined && token !== this.token) return;
    this.clearTimer();
    this.token = null;
    // An expired session remains blocked until an explicit new Start.
  }

  check(): boolean {
    if (this.token === null) return !this.expired;
    this.clearTimer();
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) {
      const token = this.token;
      this.token = null;
      this.expired = true;
      this.onExpire(token);
      return false;
    }
    this.timer = setTimeout(() => this.check(), Math.min(remaining, 60_000));
    return true;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
