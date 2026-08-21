/**
 * Patch-notes ingestion and summary drafting entry point (tasks 6.1, 6.2).
 *
 * `npm run patch-notes --workspace @tft-codex/api [-- --patch 17.9 --from X --to Y]`
 *
 * Two steps in one job because the second depends on the first: the summary is
 * drafted from the balance changes the diff just wrote, plus the meta shifts
 * the publisher recorded. Running them separately would mean drafting against
 * whatever the previous run left behind.
 *
 * Nothing here publishes. The draft lands in `meta_impact_draft` and stays
 * there until a person approves it through the editorial route (R8.2).
 */
import { DataDragonClient } from '@tft-codex/riot-client';

import { loadConfig } from '../config.js';
import { createPostgresPool } from '../db/postgres.js';
import type { MetaSummaryFacts } from '../domain/meta-summary.js';
import { AugmentRepository } from '../repositories/augment-repository.js';
import { CompRepository } from '../repositories/comp-repository.js';
import { PatchRepository } from '../repositories/patch-repository.js';
import { AnthropicDrafter } from '../services/anthropic-drafter.js';
import { MetaSummaryService } from '../services/meta-summary-drafter.js';
import { PatchNotesJob } from './patch-notes.js';

/** Minimal `--flag value` parsing. Enough for an operator-run job. */
function readFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token?.startsWith('--')) {
      const value = argv[index + 1];
      if (value && !value.startsWith('--')) {
        flags[token.slice(2)] = value;
        index += 1;
      }
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const flags = readFlags(process.argv.slice(2));
  const db = createPostgresPool(config.postgres.connectionString);
  const log = (message: string, detail?: unknown) =>
    console.warn(`[patch-notes] ${message}`, detail ?? '');

  try {
    const patches = new PatchRepository(db);

    const result = await new PatchNotesJob({
      dataDragon: new DataDragonClient(),
      patches,
      logger: log,
    }).run({
      ...(flags['patch'] ? { patchId: flags['patch'] } : {}),
      ...(flags['from'] ? { from: flags['from'] } : {}),
      ...(flags['to'] ? { to: flags['to'] } : {}),
    });

    log(
      `patch ${result.patch}: ${result.detected} detected, ` +
        `${result.editorialPreserved} editorial kept, written=${result.written}`,
    );

    // ── Draft the summary (task 6.2) ─────────────────────────────────────

    const patch = await patches.findById(result.patch);
    if (!patch) return;

    const shifts = await patches.recentMetaShifts(patch.id);
    const comps = new CompRepository(db);
    const names = new Map(
      (await comps.listMetadata(patch.id)).map((comp) => [comp.id, comp.name] as const),
    );

    const facts: MetaSummaryFacts = {
      patch: patch.id,
      setName: patch.setName,
      balanceChanges: patch.balanceChanges,
      tierMovements: shifts.map((shift) => ({
        compId: shift.compId,
        compName: names.get(shift.compId) ?? shift.compId,
        from: shift.fromTier,
        to: shift.toTier,
      })),
      // Left empty here: "new this patch" needs a comparison against the
      // previous patch's registry, which the shift log does not carry. Better
      // absent than guessed — the drafter is told only what we actually know.
      newComps: [],
    };

    // The augment vocabulary is the guard's second layer: the facts above
    // contain no augment data at all, so anything the model names was invented.
    const augmentNames = (await new AugmentRepository(db).list(patch.id)).map(
      (augment) => augment.name,
    );

    const drafted = await new MetaSummaryService({
      patches,
      drafter: config.drafter
        ? new AnthropicDrafter({ ...config.drafter, logger: log })
        : undefined,
      logger: log,
    }).draftFor(facts, { augmentNames });

    if (drafted.stored) {
      log(`draft stored for patch ${patch.id} — approve it via the editorial route`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error('[patch-notes] failed', error);
  process.exit(1);
});
