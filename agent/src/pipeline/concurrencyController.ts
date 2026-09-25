/**
 * ============================================================================
 * CONCURRENCY CONTROLLER
 * ============================================================================
 * Semaphore-style concurrency limiter that restricts parallel browser sessions
 * and network requests per source adapter and across the whole cluster.
 * Protects against memory exhaustion and rate-limit violations during scale runs.
 */

export interface ConcurrencyOptions {
  defaultMaxPerSource?: number;
  sourceLimits?: Record<string, number>;
  globalMax?: number;
}

export class ConcurrencyController {
  private runningCounts: Map<string, number> = new Map();
  private waitQueues: Map<string, Array<() => void>> = new Map();
  private globalRunning = 0;
  private globalWaitQueue: Array<() => void> = [];

  private defaultMaxPerSource: number;
  private sourceLimits: Map<string, number> = new Map();
  private globalMax: number;

  constructor(options: ConcurrencyOptions = {}) {
    this.defaultMaxPerSource = options.defaultMaxPerSource || 2;
    this.globalMax = options.globalMax || 8;

    if (options.sourceLimits) {
      for (const [source, limit] of Object.entries(options.sourceLimits)) {
        this.sourceLimits.set(source.toLowerCase(), limit);
      }
    }
  }

  /**
   * Sets custom concurrency limit for a specific source adapter.
   */
  public setLimit(sourceId: string, limit: number): void {
    this.sourceLimits.set(sourceId.toLowerCase(), Math.max(1, limit));
  }

  /**
   * Gets the max allowed concurrency for a given source adapter.
   */
  public getLimit(sourceId: string): number {
    return this.sourceLimits.get(sourceId.toLowerCase()) || this.defaultMaxPerSource;
  }

  /**
   * Returns the current active running count for a source.
   */
  public getRunningCount(sourceId: string): number {
    return this.runningCounts.get(sourceId.toLowerCase()) || 0;
  }

  /**
   * Returns the current waiting queue length for a source.
   */
  public getWaitingCount(sourceId: string): number {
    return this.waitQueues.get(sourceId.toLowerCase())?.length || 0;
  }

  /**
   * Acquires a concurrency slot for the given source adapter.
   * If source or global capacity is reached, pauses execution until a slot opens.
   */
  public async acquire(sourceId: string): Promise<void> {
    const key = sourceId.toLowerCase();
    const limit = this.getLimit(key);

    // 1. Wait for global capacity if needed
    if (this.globalRunning >= this.globalMax) {
      await new Promise<void>((resolve) => {
        this.globalWaitQueue.push(resolve);
      });
    }

    // 2. Wait for source-specific capacity
    const current = this.runningCounts.get(key) || 0;
    if (current >= limit) {
      await new Promise<void>((resolve) => {
        const queue = this.waitQueues.get(key) || [];
        queue.push(resolve);
        this.waitQueues.set(key, queue);
      });
    }

    // 3. Slot acquired -> increment counters
    this.globalRunning++;
    const nowRunning = (this.runningCounts.get(key) || 0) + 1;
    this.runningCounts.set(key, nowRunning);
  }

  /**
   * Releases a concurrency slot for the given source adapter, waking the next queued caller.
   */
  public release(sourceId: string): void {
    const key = sourceId.toLowerCase();

    // 1. Decrement source counter
    const current = this.runningCounts.get(key) || 0;
    if (current > 0) {
      this.runningCounts.set(key, current - 1);
    }

    // 2. Decrement global counter
    if (this.globalRunning > 0) {
      this.globalRunning--;
    }

    // 3. Wake next queued caller for this source if any
    const queue = this.waitQueues.get(key);
    if (queue && queue.length > 0) {
      const nextResolve = queue.shift();
      if (nextResolve) {
        nextResolve();
      }
    }

    // 4. Wake next queued global caller if any
    if (this.globalWaitQueue.length > 0) {
      const nextGlobalResolve = this.globalWaitQueue.shift();
      if (nextGlobalResolve) {
        nextGlobalResolve();
      }
    }
  }

  /**
   * Helper to execute an async operation within an acquired concurrency slot.
   */
  public async withConcurrency<T>(
    sourceId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    await this.acquire(sourceId);
    try {
      return await fn();
    } finally {
      this.release(sourceId);
    }
  }
}

export const concurrencyController = new ConcurrencyController({
  defaultMaxPerSource: 2,
  sourceLimits: {
    slideshare: 2,
    scribd: 2,
    archive_org: 3,
    zenodo_core: 3,
    studocu: 2,
  },
  globalMax: 8,
});
