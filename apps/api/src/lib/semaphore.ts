/** Counting semaphore for bounding concurrent upstream work. `tryAcquire` never queues. */
export class Semaphore {
  private active = 0;
  constructor(private readonly max: number) {}
  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (!released) { released = true; this.active--; }
    };
  }
  get inUse() { return this.active; }
}
