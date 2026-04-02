/** Manages settle window timers for threads and channels.
 *  When a message arrives, the timer resets. After the window expires
 *  with no new messages, the callback fires to ingest the content. */

type SettleEntry = {
  timer: ReturnType<typeof setTimeout>;
  callback: () => void;
};

export class SettleManager {
  private timers = new Map<string, SettleEntry>();

  /** Schedule (or reschedule) ingestion for a key.
   *  If a timer already exists for this key, it's reset. */
  schedule(key: string, callback: () => void, delayMs: number): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      callback();
    }, delayMs);

    this.timers.set(key, { timer, callback });
  }

  /** Cancel a pending ingestion */
  cancel(key: string): boolean {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.timers.delete(key);
      return true;
    }
    return false;
  }

  /** Check if a key has a pending timer */
  isPending(key: string): boolean {
    return this.timers.has(key);
  }

  /** Cancel all pending timers (for shutdown) */
  cancelAll(): void {
    for (const [, entry] of this.timers) {
      clearTimeout(entry.timer);
    }
    this.timers.clear();
  }

  /** Number of active timers */
  get size(): number {
    return this.timers.size;
  }
}
