-- Phase 6: patch history, snapshots, bookmarks and notification delivery.
--
-- R8.4 wants a browsable history of tier-list snapshots over time, and R8.3
-- wants meta shifts flagged between consecutive ones. Both need the snapshots
-- to be *durable* — Redis holds the live one for serving, but it expires, and
-- a history that evaporates is not a history.

CREATE TABLE IF NOT EXISTS tier_list_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    patch         TEXT NOT NULL REFERENCES patches (id) ON DELETE CASCADE,
    -- Matches the Redis version key, so a snapshot can be tied back to the
    -- pipeline run that produced it (pipeline_runs.published_version).
    version       TEXT NOT NULL,
    -- The formula that produced these tiers. A historical snapshot has to be
    -- readable in the context of the formula of its day, not today's.
    formula_version TEXT NOT NULL,
    entries       JSONB NOT NULL,
    published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (patch, version)
);

CREATE INDEX IF NOT EXISTS tier_list_snapshots_history_idx
    ON tier_list_snapshots (patch, published_at DESC);

-- R8.3 — comps that moved more than one full tier between consecutive
-- snapshots. Stored rather than recomputed on read: the comparison is against
-- a *specific* prior snapshot, and recomputing later against whatever happens
-- to be adjacent would silently change history.
CREATE TABLE IF NOT EXISTS meta_shifts (
    id              BIGSERIAL PRIMARY KEY,
    patch           TEXT NOT NULL REFERENCES patches (id) ON DELETE CASCADE,
    comp_id         TEXT NOT NULL,
    from_tier       TEXT NOT NULL,
    to_tier         TEXT NOT NULL,
    -- The two snapshots this shift was measured between.
    from_version    TEXT NOT NULL,
    to_version      TEXT NOT NULL,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (patch, comp_id, to_version)
);

CREATE INDEX IF NOT EXISTS meta_shifts_recent_idx
    ON meta_shifts (patch, detected_at DESC);

-- R9.1 — what a player has asked to be told about.
--
-- Kind and id rather than two nullable columns: a bookmark is exactly one
-- thing, and two nullable foreign keys would allow a row that bookmarks both
-- or neither.
CREATE TABLE IF NOT EXISTS bookmarks (
    puuid       TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('comp', 'champion')),
    target_id   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (puuid, kind, target_id)
);

-- Outbox for notifications. Written by the detection jobs, drained by a
-- delivery worker.
--
-- An outbox rather than sending inline: detection runs inside the aggregation
-- pipeline, and a transactional-email provider being slow or down must not
-- stall the meta refresh. It also makes R9.3 checkable — a row exists only if
-- a channel was enabled at detection time.
CREATE TABLE IF NOT EXISTS notification_outbox (
    id           BIGSERIAL PRIMARY KEY,
    puuid        TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    channel      TEXT NOT NULL CHECK (channel IN ('email', 'webpush', 'overwolf-native')),
    category     TEXT NOT NULL CHECK (category IN ('patch', 'bookmarkedComp', 'bookmarkedChampion')),
    subject      TEXT NOT NULL,
    body         TEXT NOT NULL,
    -- Deduplication key. A tier change detected twice by an overlapping run
    -- must not send twice.
    dedupe_key   TEXT NOT NULL,
    queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at      TIMESTAMPTZ,
    failed_at    TIMESTAMPTZ,
    error        TEXT,
    UNIQUE (puuid, dedupe_key)
);

CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
    ON notification_outbox (queued_at)
    WHERE sent_at IS NULL AND failed_at IS NULL;
