-- Structural enforcement of requirements.md R3.1 / design.md §7 step 1.
--
-- `augment_internal_stats` holds real augment win rates and average placements.
-- They are genuinely useful for *ordering* the recommendation engine's output,
-- and they must never leave the server. Rather than relying on a filter in
-- application code, the API gateway connects as `tftcodex_gateway`, which has
-- no grant on that table at all — a leak would require a credential change, not
-- a missed `delete response.winRate`.
--
-- tasks.md 2.2 asserts this with an integration test that the gateway user
-- genuinely cannot query the table.

CREATE DATABASE IF NOT EXISTS tftcodex;

CREATE USER IF NOT EXISTS tftcodex_gateway
    IDENTIFIED WITH plaintext_password BY 'tftcodex_gateway';

-- Read access to the public rollups the API actually serves.
GRANT SELECT ON tftcodex.comp_stats TO tftcodex_gateway;
GRANT SELECT ON tftcodex.unit_stats TO tftcodex_gateway;
GRANT SELECT ON tftcodex.trait_stats TO tftcodex_gateway;
GRANT SELECT ON tftcodex.item_stats TO tftcodex_gateway;
GRANT SELECT ON tftcodex.augment_play_rates TO tftcodex_gateway;

-- Deliberately NOT granted, and deliberately called out rather than merely
-- omitted, so a future engineer adding grants sees why this one is missing:
--   tftcodex.augment_internal_stats  (win rate / avg placement — R3.1)
--
-- The recommendation engine reads it with the full-access `tftcodex` user from
-- a service that never serializes it, and emits qualitative reason strings
-- instead (design.md §7 step 3).
