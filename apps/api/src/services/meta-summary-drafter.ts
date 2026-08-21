/**
 * Drafting the per-patch meta summary (task 6.2).
 *
 * The model call and the approval gate are deliberately far apart. This
 * service can only ever reach `saveMetaSummaryDraft`; the column the API
 * actually serves is written by `approveMetaSummaryAs`, from an editorial
 * route, under a named approver. There is no code path from "the model
 * answered" to "the public sees it" (R8.2).
 *
 * The drafter interface is injected so the guard logic is testable without a
 * network call and without an API key — and so that swapping the provider, or
 * dropping in a human-written draft, does not touch the validation.
 *
 * _Requirements: 8.1, 8.2, 3.1_
 */
import {
  buildSummaryPrompt,
  hasEnoughToSay,
  validateDraft,
  type DraftGuardVocabulary,
  type MetaSummaryFacts,
} from '../domain/meta-summary.js';
import type { PatchRepository } from '../repositories/patch-repository.js';

/** Anything that can turn a prompt into prose. */
export interface SummaryDrafter {
  draft(prompt: { system: string; user: string }): Promise<string>;
}

export interface DraftMetaSummaryResult {
  patch: string;
  stored: boolean;
  draft?: string;
  /** Why nothing was stored, when nothing was. */
  reason?: 'nothing-to-say' | 'rejected' | 'no-drafter';
  problems?: string[];
}

export interface MetaSummaryServiceOptions {
  patches: PatchRepository;
  /** Absent in environments with no model credentials — drafting then no-ops. */
  drafter?: SummaryDrafter | undefined;
  logger?: (message: string, detail?: unknown) => void;
}

export class MetaSummaryService {
  readonly #patches: PatchRepository;
  readonly #drafter: SummaryDrafter | undefined;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: MetaSummaryServiceOptions) {
    this.#patches = options.patches;
    this.#drafter = options.drafter;
    this.#log = options.logger ?? (() => {});
  }

  /**
   * Drafts a summary and stores it as pending review.
   *
   * A rejected draft is discarded rather than stored-with-a-warning. An editor
   * skimming a review queue should not have to notice that this one entry
   * failed its guards — the guards exist precisely because that is easy to
   * miss.
   */
  async draftFor(
    facts: MetaSummaryFacts,
    vocabulary?: DraftGuardVocabulary,
  ): Promise<DraftMetaSummaryResult> {
    if (!this.#drafter) {
      this.#log('no drafter configured — set ANTHROPIC_API_KEY to enable summary drafting');
      return { patch: facts.patch, stored: false, reason: 'no-drafter' };
    }

    if (!hasEnoughToSay(facts)) {
      // Leaving the summary null is the honest outcome: the page already says
      // "still being reviewed", which beats prose invented to fill the space.
      this.#log(`patch ${facts.patch}: nothing substantive changed, skipping draft`);
      return { patch: facts.patch, stored: false, reason: 'nothing-to-say' };
    }

    const text = (await this.#drafter.draft(buildSummaryPrompt(facts))).trim();
    const verdict = validateDraft(text, facts, vocabulary);

    if (!verdict.ok) {
      this.#log(`patch ${facts.patch}: draft rejected`, verdict.problems);
      return {
        patch: facts.patch,
        stored: false,
        reason: 'rejected',
        problems: verdict.problems,
        draft: text,
      };
    }

    await this.#patches.saveMetaSummaryDraft(facts.patch, text);
    this.#log(`patch ${facts.patch}: draft stored, awaiting editorial review`);

    return { patch: facts.patch, stored: true, draft: text };
  }
}
