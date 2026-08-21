-- Phase 4: saved builder boards.
--
-- R6.3 wants a shareable link that reconstructs the exact board. The share id
-- is the primary key rather than a serial: a sequential id in a public URL
-- lets anyone enumerate every board ever saved, which is both a privacy
-- problem and an invitation to scrape.
--
-- Boards may be saved anonymously. R7.4 requires the builder be fully usable
-- logged out, so `puuid` is nullable — an anonymous board is owned by whoever
-- holds the link, which is the same trust model as an unlisted document.

CREATE TABLE IF NOT EXISTS builder_comps (
    -- URL-safe random id. See newShareId() in the repository.
    id          TEXT PRIMARY KEY,
    -- NULL for an anonymous save. ON DELETE SET NULL rather than CASCADE:
    -- unlinking an account should not break links the user already shared
    -- with other people, and the board holds no personal data of its own.
    puuid       TEXT REFERENCES player_profiles (puuid) ON DELETE SET NULL,
    patch       TEXT NOT NULL REFERENCES patches (id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'Untitled board',
    -- [{ championId, starLevel, itemIds, position }]
    units       JSONB NOT NULL DEFAULT '[]',
    -- The level the board is built for, used to normalise the estimate.
    level       SMALLINT NOT NULL DEFAULT 8 CHECK (level BETWEEN 1 AND 11),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_comps_owner_idx
    ON builder_comps (puuid, updated_at DESC) WHERE puuid IS NOT NULL;
