/**
 * Patch-notes ingestion (task 6.1).
 *
 * Fetches two Data Dragon versions, diffs them, and writes the result onto the
 * patch — preserving anything an editor has written. See `balance-diff.ts` for
 * why this reads structured game data instead of the patch-notes prose.
 *
 * The job is idempotent by construction. It recomputes the automatic half from
 * scratch every run, so running it twice produces the same rows rather than
 * duplicates, and a corrected upstream file yields a corrected record.
 *
 * _Requirements: 8.1, 12.1_
 */
import type { DataDragonClient } from '@tft-codex/riot-client';
import type { BalanceChange } from '@tft-codex/shared-types';

import { diffGameData, mergeBalanceChanges } from '../domain/balance-diff.js';
import type { PatchRepository } from '../repositories/patch-repository.js';

export interface PatchNotesJobOptions {
  dataDragon: DataDragonClient;
  patches: PatchRepository;
  logger?: (message: string, detail?: unknown) => void;
}

export interface PatchNotesRunResult {
  patch: string;
  fromVersion: string;
  toVersion: string;
  detected: number;
  editorialPreserved: number;
  written: boolean;
  reason?: string;
}

export class PatchNotesJob {
  readonly #dataDragon: DataDragonClient;
  readonly #patches: PatchRepository;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: PatchNotesJobOptions) {
    this.#dataDragon = options.dataDragon;
    this.#patches = options.patches;
    this.#log = options.logger ?? (() => {});
  }

  /**
   * Diffs into the current patch.
   *
   * `from` and `to` may be pinned for a backfill; by default it takes the two
   * newest published Data Dragon versions. The set prefix comes from the
   * patch's own `setNumber` rather than configuration — the patch record
   * already knows which set it belongs to, and a second source of that truth
   * would be one that could disagree.
   */
  async run(
    options: { patchId?: string; from?: string; to?: string } = {},
  ): Promise<PatchNotesRunResult> {
    const patch = options.patchId
      ? await this.#patches.findById(options.patchId)
      : await this.#patches.latest();

    if (!patch) {
      throw new Error('no patch to ingest into — seed a patch row first');
    }

    const versions = await this.#dataDragon.versions();
    const toVersion = options.to ?? versions[0];
    const fromVersion = options.from ?? versions[1];

    if (!toVersion || !fromVersion) {
      throw new Error('Data Dragon returned fewer than two versions — nothing to diff');
    }

    const base: PatchNotesRunResult = {
      patch: patch.id,
      fromVersion,
      toVersion,
      detected: 0,
      editorialPreserved: patch.balanceChanges.filter((change) => change.source === 'editorial')
        .length,
      written: false,
    };

    // Already up to date. Re-diffing would produce identical rows, so this is
    // a cost saving rather than a correctness guard — but it also keeps the
    // log honest about which runs actually did anything.
    const ingested = await this.#patches.dataDragonVersion(patch.id);
    if (ingested === toVersion && !options.to) {
      this.#log(`patch ${patch.id} already ingested at Data Dragon ${toVersion}`);
      return { ...base, reason: 'already-ingested' };
    }

    const [before, after] = await Promise.all([
      this.#dataDragon.snapshot(fromVersion),
      this.#dataDragon.snapshot(toVersion),
    ]);

    const detected = diffGameData(before, after, { setPrefix: `TFT${patch.setNumber}` });
    const merged: BalanceChange[] = mergeBalanceChanges(patch.balanceChanges, detected);

    await this.#patches.saveBalanceChanges(patch.id, merged, toVersion);

    this.#log(
      `patch ${patch.id}: ${detected.length} change(s) detected between ` +
        `${fromVersion} and ${toVersion}, ${base.editorialPreserved} editorial record(s) kept`,
    );

    if (detected.length === 0) {
      // Worth saying out loud. Data Dragon carries no ability values, so a
      // real balance patch can legitimately produce an empty diff — that is
      // the automatic half finding nothing, not the patch being quiet.
      this.#log(
        'no roster or cost movement detected. Data Dragon does not expose ability or trait ' +
          'numbers, so a numeric-only patch looks empty here — enter those through the ' +
          'editorial route.',
      );
    }

    return { ...base, detected: detected.length, written: true };
  }
}
