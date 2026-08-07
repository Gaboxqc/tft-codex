-- ClickHouse rollup tables (design.md §2, §3, §7).
--
-- All of these are SummingMergeTree: the aggregation job inserts *deltas* for
-- the matches consumed in that run, and ClickHouse sums them. That makes an
-- incremental run additive rather than a full recount, and a partially failed
-- run leaves the previous totals intact instead of publishing a half table
-- (design.md §9). Exactly-once is enforced upstream by `raw_matches.
-- aggregated_at` — a match is marked consumed only after its deltas land.
--
-- Rates are derived at query time from the counters rather than stored, so a
-- rate can never drift out of sync with the counts that produced it.

CREATE DATABASE IF NOT EXISTS tftcodex;

-- ── Public rollups — the gateway may read these ─────────────────────────────

CREATE TABLE IF NOT EXISTS tftcodex.comp_stats
(
    patch          LowCardinality(String),
    comp_id        String,
    games          UInt64,
    top4_count     UInt64,
    win_count      UInt64,
    placement_sum  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (patch, comp_id);

CREATE TABLE IF NOT EXISTS tftcodex.unit_stats
(
    patch          LowCardinality(String),
    champion_id    String,
    games          UInt64,
    top4_count     UInt64,
    win_count      UInt64,
    placement_sum  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (patch, champion_id);

CREATE TABLE IF NOT EXISTS tftcodex.trait_stats
(
    patch          LowCardinality(String),
    trait_id       String,
    tier_hit       UInt8,
    games          UInt64,
    top4_count     UInt64,
    win_count      UInt64,
    placement_sum  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (patch, trait_id, tier_hit);

CREATE TABLE IF NOT EXISTS tftcodex.item_stats
(
    patch          LowCardinality(String),
    item_id        String,
    champion_id    String,
    games          UInt64,
    top4_count     UInt64,
    win_count      UInt64,
    placement_sum  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (patch, item_id, champion_id);

-- Augment PLAY RATE only — pick frequency, which R3.3 explicitly permits.
-- Deliberately a separate table from augment_internal_stats below so the
-- gateway can be granted one and not the other.
CREATE TABLE IF NOT EXISTS tftcodex.augment_play_rates
(
    patch       LowCardinality(String),
    augment_id  String,
    times_picked UInt64,
    games       UInt64
)
ENGINE = SummingMergeTree
ORDER BY (patch, augment_id);

-- ── Restricted — the gateway has NO grant on this table ─────────────────────
--
-- Real augment win rates and average placements. They are genuinely useful for
-- *ordering* the recommendation engine's output, and they must never leave the
-- server (requirements.md R3.1, design.md §7 step 1).
--
-- The protection is a missing GRANT, not a filter in application code: see
-- infra/clickhouse/init/01-gateway-user.sql. A leak would require someone to
-- change the gateway's credentials, which is a reviewable act, rather than to
-- forget a `delete response.winRate`, which is not.
--
-- The recommendation engine reads this with the admin user from a service that
-- never serializes it, and emits a templated qualitative reason string instead.
CREATE TABLE IF NOT EXISTS tftcodex.augment_internal_stats
(
    patch          LowCardinality(String),
    augment_id     String,
    -- Empty string = global (not scoped to a comp).
    comp_id        String,
    games          UInt64,
    top4_count     UInt64,
    win_count      UInt64,
    placement_sum  UInt64
)
ENGINE = SummingMergeTree
ORDER BY (patch, augment_id, comp_id);
