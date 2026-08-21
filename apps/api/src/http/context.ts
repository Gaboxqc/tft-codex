/**
 * The dependency bundle handed to route registrars.
 *
 * Explicit injection rather than module-level singletons: it makes the
 * ClickHouse credential boundary visible at the type level and lets integration
 * tests build a context with fakes instead of standing up three databases.
 *
 * The two OLAP entries are the compliance boundary in type form:
 *
 * - `olap` is built on the RESTRICTED gateway client. Its class has no method
 *   that touches `augment_internal_stats`, and its credentials could not read
 *   it anyway.
 * - `augmentStats` is built on the ADMIN client and CAN read it. It is here
 *   only because `POST /v1/recommendations` needs to *order* options; that
 *   route emits a qualitative reason string and never the number behind it
 *   (design.md §7 step 3).
 *
 * If you are adding a route that wants `augmentStats` for anything it will
 * serialize, stop — that is R3.1's boundary, not a missing feature.
 *
 * _Requirements: 3.1, 3.4_
 */
import type { RiotApiClient } from '@tft-codex/riot-client';

import type { AppConfig } from '../config.js';
import type { Cache } from '../db/redis.js';
import type { AugmentInternalRepository } from '../repositories/augment-internal-repository.js';
import type { AugmentRepository } from '../repositories/augment-repository.js';
import type { AuthRepository } from '../repositories/auth-repository.js';
import type { BuilderRepository } from '../repositories/builder-repository.js';
import type { CompRepository } from '../repositories/comp-repository.js';
import type { GameDataRepository } from '../repositories/game-data-repository.js';
import type { NotificationRepository } from '../repositories/notification-repository.js';
import type { PatchRepository } from '../repositories/patch-repository.js';
import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import type { OlapReadRepository } from '../repositories/olap-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { ReferenceRepository } from '../repositories/reference-repository.js';

export interface AppContext {
  config: AppConfig;
  cache: Cache;
  comps: CompRepository;
  /** Public augment records only — a letter and a play rate (R3.2, R3.3). */
  augments: AugmentRepository;
  ingestion: IngestionRepository;
  /**
   * Read-only OLAP access via the restricted gateway credentials. Request
   * handlers must not be able to reach `augment_internal_stats` through this.
   */
  olap: OlapReadRepository;
  /**
   * RESTRICTED. Ordering input for the recommendation engine only — never
   * serialized. See the module comment above before using this anywhere else.
   */
  augmentStats: AugmentInternalRepository;
  reference: ReferenceRepository;
  /** Linked profiles and their own matches. Never another player's (R4.6). */
  players: PlayerRepository;
  auth: AuthRepository;
  /** Saved builder boards. Anonymous saves are supported (R7.4). */
  builder: BuilderRepository;
  /** Static champion/trait/item data, cached per patch. */
  gameData: GameDataRepository;
  /** Patch metadata, archived tier-list snapshots and meta shifts. */
  patches: PatchRepository;
  /** Subscription preferences, bookmarks and the delivery outbox. */
  notifications: NotificationRepository;
  /**
   * Only for the request-time lookups that genuinely need Riot: the Riot ID on
   * link, and lobby intel. The crawler has its own client with its own lanes.
   */
  riot?: RiotApiClient | undefined;
  log: (message: string, detail?: unknown) => void;
}
