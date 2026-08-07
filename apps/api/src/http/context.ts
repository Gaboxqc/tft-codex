/**
 * The dependency bundle handed to route registrars.
 *
 * Explicit injection rather than module-level singletons: it makes the
 * ClickHouse credential boundary visible at the type level (request handlers
 * receive `OlapReadRepository`, built on the restricted gateway client — never
 * the admin one) and it lets integration tests build a context with fakes
 * instead of standing up three databases.
 *
 * _Requirements: 3.1_
 */
import type { AppConfig } from '../config.js';
import type { Cache } from '../db/redis.js';
import type { CompRepository } from '../repositories/comp-repository.js';
import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import type { OlapReadRepository } from '../repositories/olap-repository.js';

export interface AppContext {
  config: AppConfig;
  cache: Cache;
  comps: CompRepository;
  ingestion: IngestionRepository;
  /**
   * Read-only OLAP access via the restricted gateway credentials. There is
   * deliberately no admin client here — request handlers must not be able to
   * reach `augment_internal_stats` (R3.1, design.md §7).
   */
  olap: OlapReadRepository;
  log: (message: string, detail?: unknown) => void;
}
