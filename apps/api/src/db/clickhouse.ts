/**
 * ClickHouse clients.
 *
 * Two of them, and the split is a compliance boundary rather than a
 * convenience:
 *
 * - `createAdminClickHouse` — full access. Aggregation jobs and the
 *   recommendation engine use it, and it CAN read `augment_internal_stats`.
 *   Nothing that serializes a response should ever hold this client.
 * - `createGatewayClickHouse` — what the HTTP layer uses. Connects as
 *   `tftcodex_gateway`, which has no grant on `augment_internal_stats`
 *   (infra/clickhouse/init/01-gateway-user.sql). If gateway code ever tries to
 *   read augment win rates, ClickHouse refuses — the failure is loud and at the
 *   database, not a silent leak in a response body.
 *
 * _Requirements: 3.1_
 */
import { createClient, type ClickHouseClient } from '@clickhouse/client';

import type { AppConfig } from '../config.js';

export type OlapClient = ClickHouseClient;

/** Full-access client. Never hand this to request-handling code. */
export function createAdminClickHouse(config: AppConfig): OlapClient {
  return createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.admin.username,
    password: config.clickhouse.admin.password,
  });
}

/**
 * Restricted client for the API gateway. The restriction lives in the
 * database's grants, so it holds even if this file is edited.
 */
export function createGatewayClickHouse(config: AppConfig): OlapClient {
  return createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.gateway.username,
    password: config.clickhouse.gateway.password,
  });
}

/** Table names, so a typo is a compile error rather than an empty result set. */
export const OLAP_TABLES = {
  compStats: 'comp_stats',
  unitStats: 'unit_stats',
  traitStats: 'trait_stats',
  itemStats: 'item_stats',
  augmentPlayRates: 'augment_play_rates',
  /** Restricted — reachable only with the admin client. See R3.1. */
  augmentInternalStats: 'augment_internal_stats',
} as const;
