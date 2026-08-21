/**
 * Riot Data Dragon — official static game data (task 6.1).
 *
 * Data Dragon is Riot's own CDN, published for third-party use, versioned per
 * patch. It is deliberately **not** routed through `RiotApiClient`: it takes no
 * API key and is not covered by the development key's rate limits, so putting
 * it behind the token bucket would spend live-lane budget on a plain CDN
 * request. It is also why this is the sanctioned source for patch data under
 * R12.1 — no scraping, no third-party site.
 *
 * What it does and does not carry matters, because task 6.1's scope follows
 * from it. Verified against the live CDN:
 *
 * - `tft-champion.json` — id, name, cost, tier. **No stats, no ability values.**
 * - `tft-trait.json` — id, name. **No breakpoints, no effect values.**
 * - `tft-item.json` — id, name. **No stats.**
 * - `tft-augments.json` — a display container with no augment list at all.
 *
 * So a diff of two versions detects roster and cost movement, and cannot see
 * numeric balance changes. Those are entered by hand through the editorial
 * route; see `balance-diff.ts` for how the two are merged without one
 * destroying the other.
 *
 * _Requirements: 8.1, 12.1_
 */

/** One entry as Data Dragon returns it. Only the fields we actually read. */
export interface DataDragonEntry {
  id: string;
  name: string;
  /** Champions only: shop cost. Absent on traits and items. */
  cost?: number;
  /** Champions only: rarity tier, which is not the same as our tier list. */
  tier?: number;
}

export interface DataDragonSnapshot {
  version: string;
  champions: DataDragonEntry[];
  traits: DataDragonEntry[];
  items: DataDragonEntry[];
}

export interface DataDragonClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://ddragon.leagueoflegends.com';

/** Shape of every `tft-*.json` file: a keyed map under `data`. */
interface DataDragonFile {
  version?: string;
  data?: Record<string, DataDragonEntry>;
}

export class DataDragonError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DataDragonError';
  }
}

export class DataDragonClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: DataDragonClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  /**
   * Every published version, newest first.
   *
   * These are League client versions ("16.16.1"), not TFT patch labels
   * ("17.9"). The two are related but not equal, which is why the ingestion
   * job takes the Data Dragon version as an explicit argument rather than
   * trying to derive it from a patch id.
   */
  async versions(): Promise<string[]> {
    return this.#getJson<string[]>('/api/versions.json');
  }

  /** The three diffable files for one version, fetched together. */
  async snapshot(version: string, locale = 'en_US'): Promise<DataDragonSnapshot> {
    const [champions, traits, items] = await Promise.all([
      this.#entries(version, locale, 'tft-champion'),
      this.#entries(version, locale, 'tft-trait'),
      this.#entries(version, locale, 'tft-item'),
    ]);

    return { version, champions, traits, items };
  }

  async #entries(version: string, locale: string, file: string): Promise<DataDragonEntry[]> {
    const payload = await this.#getJson<DataDragonFile>(
      `/cdn/${version}/data/${locale}/${file}.json`,
    );

    // Keyed by an internal path ("Maps/Shipping/.../TFT17_Zoe"), so the map key
    // is not the id. Read `id` off the value and ignore the key entirely.
    return Object.values(payload.data ?? {})
      .filter((entry): entry is DataDragonEntry => typeof entry?.id === 'string')
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        ...(entry.cost === undefined ? {} : { cost: entry.cost }),
        ...(entry.tier === undefined ? {} : { tier: entry.tier }),
      }));
  }

  async #getJson<T>(path: string): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new DataDragonError(`Data Dragon returned ${response.status}`, url, response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof DataDragonError) throw error;
      throw new DataDragonError(
        error instanceof Error ? error.message : 'Data Dragon request failed',
        url,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
