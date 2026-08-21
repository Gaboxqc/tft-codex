-- Patch-notes ingestion and the meta-summary draft workflow (tasks 6.1, 6.2).
--
-- _Requirements: 8.1, 8.2_

-- Which Data Dragon version the balance changes were computed from.
--
-- Riot's static-data versions ("16.16.1") are League client versions, not TFT
-- patch labels ("17.9"). They are related but not equal, so the mapping has to
-- be recorded rather than derived — and recording it also makes a re-run
-- idempotent: the job can tell whether it has already diffed up to a version.
ALTER TABLE patches ADD COLUMN IF NOT EXISTS data_dragon_version TEXT;

-- R8.2's approval gate, in two columns.
--
-- The draft and the published summary are deliberately separate columns rather
-- than one column with a status flag. A single column would mean an unapproved
-- draft sits in the field every reader already selects, and one forgotten
-- `WHERE approved` would publish it. Here, the only way to publish is to copy
-- it across — which is exactly the human action R8.2 requires.
ALTER TABLE patches ADD COLUMN IF NOT EXISTS meta_impact_draft TEXT;
ALTER TABLE patches ADD COLUMN IF NOT EXISTS meta_impact_drafted_at TIMESTAMPTZ;

-- Who approved it and when. R8.2 requires editorial approval; an approval with
-- no accountable name attached is a rubber stamp.
ALTER TABLE patches ADD COLUMN IF NOT EXISTS meta_impact_approved_by TEXT;
ALTER TABLE patches ADD COLUMN IF NOT EXISTS meta_impact_approved_at TIMESTAMPTZ;
