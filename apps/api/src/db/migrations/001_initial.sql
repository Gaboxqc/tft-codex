-- Phase 1 schema: the entities Postgres is the source of truth for.
--
-- Aggregate statistics do NOT live here. Per-comp rollups over match-history
-- volume are an OLAP workload that Postgres handles poorly, so they live in
-- ClickHouse (design.md §2). Postgres owns entities: comps, signatures,
-- patches, static game data, raw matches, and pipeline bookkeeping.

-- ── Static game data ────────────────────────────────────────────────────────
-- Refreshed per patch from Riot's Data Dragon. Keyed by (id, patch) because a
-- champion's cost and traits genuinely change between sets.

CREATE TABLE IF NOT EXISTS champions (
    id          TEXT    NOT NULL,
    patch       TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    cost        SMALLINT NOT NULL CHECK (cost BETWEEN 1 AND 5),
    traits      TEXT[]  NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, patch)
);

CREATE TABLE IF NOT EXISTS traits (
    id          TEXT    NOT NULL,
    patch       TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('origin', 'class')),
    breakpoints INTEGER[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, patch)
);

CREATE TABLE IF NOT EXISTS items (
    id          TEXT    NOT NULL,
    patch       TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    -- NULL for basic components; two component ids for completed items.
    components  TEXT[],
    tags        TEXT[]  NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, patch)
);

-- ── Patches ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patches (
    id                  TEXT PRIMARY KEY,          -- "17.9"
    set_number          INTEGER NOT NULL,
    set_name            TEXT    NOT NULL,
    release_date        DATE    NOT NULL,
    is_current_patch    BOOLEAN NOT NULL DEFAULT FALSE,
    -- R1.8 — prior Sets are archived, never deleted.
    archived            BOOLEAN NOT NULL DEFAULT FALSE,
    balance_changes     JSONB   NOT NULL DEFAULT '[]',
    -- NULL until a human approves the AI-drafted summary (R8.2).
    meta_impact_summary TEXT
);

-- Exactly one current patch at a time; a second one silently splits the meta.
CREATE UNIQUE INDEX IF NOT EXISTS patches_single_current
    ON patches ((is_current_patch)) WHERE is_current_patch;

-- ── Comps and their signatures ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comps (
    id                TEXT NOT NULL,
    patch             TEXT NOT NULL REFERENCES patches (id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    alt_name          TEXT,
    playstyle         TEXT NOT NULL,
    difficulty        TEXT NOT NULL,
    core_traits       TEXT[] NOT NULL DEFAULT '{}',
    carries           TEXT[] NOT NULL DEFAULT '{}',
    units             JSONB  NOT NULL DEFAULT '[]',
    formation         JSONB  NOT NULL DEFAULT '{"front":[],"back":[]}',
    -- Ordered category labels only, e.g. ["Items","Combat","Econ"] (R2.4).
    augment_priority  TEXT[] NOT NULL DEFAULT '{}',
    -- Editorially curated, never win-rate ranked (R2.4).
    curated_augments  TEXT[] NOT NULL DEFAULT '{}',
    explanation       TEXT   NOT NULL DEFAULT '',
    stage_guides      JSONB  NOT NULL DEFAULT '{"stage2":"","stage3":"","stage4":""}',
    flex_slots        JSONB  NOT NULL DEFAULT '[]',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, patch)
);

CREATE INDEX IF NOT EXISTS comps_patch_idx ON comps (patch);
CREATE INDEX IF NOT EXISTS comps_carries_idx ON comps USING GIN (carries);
CREATE INDEX IF NOT EXISTS comps_core_traits_idx ON comps USING GIN (core_traits);

-- The registry that maps a board to a named comp (design.md §3 step 2).
-- Seeded by hand each patch on purpose: no comp gets a tier until a human
-- confirms its signature, while the stats behind it stay fully computed.
CREATE TABLE IF NOT EXISTS comp_signatures (
    comp_id            TEXT NOT NULL,
    patch              TEXT NOT NULL,
    core_traits        TEXT[] NOT NULL,
    -- trait id -> minimum active count for a board to match.
    min_trait_counts   JSONB  NOT NULL DEFAULT '{}',
    carry_champion_ids TEXT[] NOT NULL,
    PRIMARY KEY (comp_id, patch),
    FOREIGN KEY (comp_id, patch) REFERENCES comps (id, patch) ON DELETE CASCADE
);

-- ── Ingestion ───────────────────────────────────────────────────────────────

-- Apex-tier players used to seed match discovery (task 1.1).
CREATE TABLE IF NOT EXISTS seed_players (
    puuid           TEXT PRIMARY KEY,
    platform        TEXT NOT NULL,
    tier            TEXT NOT NULL,
    discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_crawled_at TIMESTAMPTZ
);

-- Ordering the crawl by last_crawled_at NULLS FIRST is what stops the same
-- handful of players being re-crawled while the rest of the pool goes stale.
CREATE INDEX IF NOT EXISTS seed_players_crawl_order_idx
    ON seed_players (last_crawled_at NULLS FIRST);

-- Discovered match ids. Existence here is the dedup mechanism (task 1.2) —
-- a match id we have already seen never gets re-fetched, which is the single
-- biggest saving on the Riot rate-limit budget.
CREATE TABLE IF NOT EXISTS discovered_matches (
    match_id      TEXT PRIMARY KEY,
    regional      TEXT NOT NULL,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fetched_at    TIMESTAMPTZ,
    -- Set when a fetch fails permanently (404, unsupported queue) so the
    -- worker stops retrying it forever.
    skipped_reason TEXT
);

CREATE INDEX IF NOT EXISTS discovered_matches_pending_idx
    ON discovered_matches (discovered_at)
    WHERE fetched_at IS NULL AND skipped_reason IS NULL;

-- Raw match payloads, upserted by matchId so re-running ingestion is
-- idempotent (design.md §9).
CREATE TABLE IF NOT EXISTS raw_matches (
    match_id      TEXT PRIMARY KEY,
    patch         TEXT,
    queue_id      INTEGER,
    set_number    INTEGER,
    game_datetime TIMESTAMPTZ,
    regional      TEXT NOT NULL,
    payload       JSONB NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL until the aggregation job has consumed this row. The aggregation
    -- job reads by this column, so it can resume cleanly after a partial run.
    aggregated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS raw_matches_pending_aggregation_idx
    ON raw_matches (ingested_at) WHERE aggregated_at IS NULL;
CREATE INDEX IF NOT EXISTS raw_matches_patch_idx ON raw_matches (patch);

-- ── Pipeline bookkeeping ────────────────────────────────────────────────────

-- Backs the "minutes since last successful publish" healthcheck (R1.6, R11.5)
-- and the stale-data banner the clients render.
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('crawl', 'aggregate', 'score')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'succeeded', 'failed')),
    -- Version key of the tier-list snapshot this run published, if any.
    published_version TEXT,
    matches_processed INTEGER NOT NULL DEFAULT 0,
    error             TEXT
);

CREATE INDEX IF NOT EXISTS pipeline_runs_last_success_idx
    ON pipeline_runs (kind, finished_at DESC) WHERE status = 'succeeded';
