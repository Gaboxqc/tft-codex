/**
 * In-process token bucket.
 *
 * Correct only for a single process. It exists so tests, local scripts, and
 * single-instance dev runs don't need Redis — the crawler workers in production
 * run multiple replicas against one Riot key, and only the Redis limiter can
 * enforce a shared budget there. `createRateLimiter` picks between them.
 */
import { RateLimitTimeoutError } from '../errors.js';
import { type BucketState, admitAll } from './bucket-math.js';
import type {
  BucketConfig,
  RateLimitLane,
  RateLimitSnapshot,
  RateLimiter,
  RateLimiterConfig,
} from './types.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MemoryRateLimiter implements RateLimiter {
  readonly #config: RateLimiterConfig;
  readonly #now: () => number;
  readonly #globals: BucketState[];
  readonly #lanes = new Map<RateLimitLane, BucketState>();
  /** Serialises admission so two concurrent callers cannot both see the last token. */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(config: RateLimiterConfig, now: () => number = Date.now) {
    this.#config = config;
    this.#now = now;
    this.#globals = config.globalLimits.map((limit) => ({
      tokens: limit.capacity,
      updatedAt: now(),
    }));
  }

  #lane(lane: RateLimitLane): BucketState {
    let state = this.#lanes.get(lane);
    if (!state) {
      state = { tokens: this.#laneConfig(lane).capacity, updatedAt: this.#now() };
      this.#lanes.set(lane, state);
    }
    return state;
  }

  #laneConfig(lane: RateLimitLane): BucketConfig {
    const config = this.#config.laneLimits[lane];
    if (!config) throw new Error(`No rate-limit configuration for lane "${lane}".`);
    return config;
  }

  async acquire(lane: RateLimitLane, cost = 1): Promise<void> {
    const run = this.#chain.then(() => this.#acquireExclusive(lane, cost));
    // Keep the chain alive even when this acquisition rejects, so one timeout
    // doesn't wedge every subsequent caller.
    this.#chain = run.catch(() => undefined);
    return run;
  }

  async #acquireExclusive(lane: RateLimitLane, cost: number): Promise<void> {
    const maxWaitMs = this.#config.maxWaitMs ?? 30_000;
    const deadline = this.#now() + maxWaitMs;

    for (;;) {
      const now = this.#now();
      const configs = [...this.#config.globalLimits, this.#laneConfig(lane)];
      const states = [...this.#globals, this.#lane(lane)];
      const result = admitAll(states, configs, cost, now);

      if (result.admitted) {
        for (const [index, state] of result.states.slice(0, this.#globals.length).entries()) {
          this.#globals[index] = state;
        }
        this.#lanes.set(lane, result.states[result.states.length - 1]!);
        return;
      }

      if (!Number.isFinite(result.waitMs)) {
        throw new Error(
          `A cost of ${cost} exceeds the capacity of lane "${lane}" or a global limit; ` +
            'it can never be admitted. Raise the configured capacity or lower the cost.',
        );
      }
      if (now + result.waitMs > deadline) {
        throw new RateLimitTimeoutError(lane, maxWaitMs);
      }
      await sleep(result.waitMs);
    }
  }

  async inspect(lane: RateLimitLane): Promise<RateLimitSnapshot> {
    const now = this.#now();
    const laneConfig = this.#laneConfig(lane);
    const laneState = admitAll([this.#lane(lane)], [laneConfig], 0, now);
    const globalStates = this.#globals.map((state, index) =>
      admitAll([state], [this.#config.globalLimits[index]!], 0, now),
    );

    return {
      lane,
      laneTokens: laneState.admitted ? laneState.states[0]!.tokens : 0,
      laneCapacity: laneConfig.capacity,
      globalTokens: globalStates.map((state) => (state.admitted ? state.states[0]!.tokens : 0)),
      globalCapacities: this.#config.globalLimits.map((limit) => limit.capacity),
    };
  }
}
