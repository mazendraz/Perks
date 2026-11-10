type Work = () => Promise<void>;

// A live event arriving during a read requests one follow-up, rather than
// superseding the still-useful response or starting an unbounded request burst.
export class RefreshQueue {
  private active?: { next?: Work; promise: Promise<void> };
  run(work: Work): Promise<void> {
    if (this.active) {
      this.active.next = work;
      return this.active.promise;
    }
    const cycle = { next: work as Work | undefined, promise: Promise.resolve() };
    this.active = cycle;
    cycle.promise = (async () => {
      try {
        while (cycle.next && this.active === cycle) {
          const next = cycle.next;
          cycle.next = undefined;
          await next();
        }
      } finally {
        if (this.active === cycle) this.active = undefined;
      }
    })();
    return cycle.promise;
  }
  invalidate() {
    this.active = undefined;
  }
}
