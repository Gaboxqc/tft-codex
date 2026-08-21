/**
 * The AI-drafted "what this means for the meta" summary (task 6.2).
 *
 * R8.2: *generate a plain-language summary per patch, **flagged for human
 * editorial review before publishing***. Two halves, and the second is the one
 * that matters — so nothing in this module can publish anything. It builds a
 * prompt and it judges the result; storing a draft and approving a draft are
 * separate repository methods, and only the approval path writes the column
 * the API serves.
 *
 * ## What the drafter is allowed to know
 *
 * The facts handed to the model contain **no augment data of any kind**. That
 * is a structural R3.1 guarantee rather than a filter: a model cannot leak an
 * augment win rate it was never shown. `validateDraft` then rejects any draft
 * that mentions an augment at all, so an invented one cannot slip through
 * either.
 *
 * ## What the drafter is allowed to say
 *
 * No numbers beyond the patch id, and no percentages. Every figure this
 * summary might want — placements, top-4 rates, sample sizes — already exists
 * on the tier list, computed, labelled and attributable. A number that appears
 * only in generated prose has no provenance, and a reader cannot tell the two
 * kinds apart. `augment-reasons.ts` takes the same line for the same reason.
 *
 * _Requirements: 8.1, 8.2, 3.1_
 */
import type { BalanceChange } from '@tft-codex/shared-types';

export interface TierMovementFact {
  compId: string;
  compName: string;
  from: string;
  to: string;
}

export interface MetaSummaryFacts {
  patch: string;
  setName: string;
  balanceChanges: readonly BalanceChange[];
  tierMovements: readonly TierMovementFact[];
  newComps: readonly { compId: string; compName: string; tier: string }[];
}

export interface DraftGuardVocabulary {
  /**
   * Every augment name on the patch. A draft mentioning one is rejected
   * outright — see the module comment.
   */
  augmentNames: readonly string[];
}

export interface DraftValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Upper bound on a patch summary.
 *
 * Not from a requirement — R15.1's 3–5 sentence budget is about the post-game
 * summary, not this one. This is editorial judgement: a patch note nobody
 * finishes reading has failed at the only job it has.
 */
export const MAX_DRAFT_SENTENCES = 6;

const SYSTEM_PROMPT = [
  'You write short patch summaries for a Teamfight Tactics meta site.',
  '',
  'Your summary is a draft. A human editor reads it before anything is published,',
  'so write what you can support from the facts given and nothing else.',
  '',
  'Rules, all of which are enforced automatically after you answer:',
  `- At most ${MAX_DRAFT_SENTENCES} sentences. Fewer is better.`,
  '- Use no numbers and no percentages, except the patch number itself.',
  '  The site already shows every statistic with its own provenance; a figure',
  '  invented in prose cannot be told apart from a computed one.',
  '- Never mention augments. They are outside what you have been told about.',
  '- Only discuss champions, traits, items and comps that appear in the facts.',
  '  Do not add context from your own knowledge of the game — it may describe a',
  '  different patch entirely.',
  '- Plain language. No hype, no "meta-defining", no second-person address.',
  '- If the facts are too thin to say anything useful, say exactly that in one',
  '  sentence rather than padding.',
].join('\n');

const bullet = (line: string): string => `- ${line}`;

/** Renders the structured facts as the user turn. */
export function buildSummaryPrompt(facts: MetaSummaryFacts): {
  system: string;
  user: string;
} {
  const sections: string[] = [`Patch ${facts.patch} of ${facts.setName}.`, ''];

  sections.push('Balance changes:');
  sections.push(
    facts.balanceChanges.length === 0
      ? bullet('None recorded.')
      : facts.balanceChanges
          .map((change) => bullet(`${change.entityType} ${change.entityId}: ${change.summary}`))
          .join('\n'),
  );
  sections.push('');

  sections.push('Comps that changed tier since the last published list:');
  sections.push(
    facts.tierMovements.length === 0
      ? bullet('None.')
      : facts.tierMovements
          .map((move) => bullet(`${move.compName} moved from ${move.from} tier to ${move.to} tier`))
          .join('\n'),
  );
  sections.push('');

  sections.push('Comps appearing for the first time:');
  sections.push(
    facts.newComps.length === 0
      ? bullet('None.')
      : facts.newComps
          .map((comp) => bullet(`${comp.compName} entered at ${comp.tier} tier`))
          .join('\n'),
  );

  return { system: SYSTEM_PROMPT, user: sections.join('\n') };
}

/** Rough sentence split. Good enough to enforce a budget, not to parse prose. */
const sentenceCount = (text: string): number =>
  text
    .split(/[.!?]+(?:\s|$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;

/**
 * Judges a draft before it is stored.
 *
 * Returns problems rather than throwing: a rejected draft is a normal outcome
 * worth logging and showing the editor, not an exception. The one thing it
 * must never do is pass something an editor would have to catch on our behalf.
 */
export function validateDraft(
  draft: string,
  facts: MetaSummaryFacts,
  vocabulary: DraftGuardVocabulary = { augmentNames: [] },
): DraftValidation {
  const problems: string[] = [];
  const text = draft.trim();

  if (text.length === 0) {
    return { ok: false, problems: ['The draft is empty.'] };
  }

  if (sentenceCount(text) > MAX_DRAFT_SENTENCES) {
    problems.push(`Longer than ${MAX_DRAFT_SENTENCES} sentences.`);
  }

  if (text.includes('%')) {
    problems.push('Contains a percentage.');
  }

  // Digits are allowed only where they spell out the patch id. Removing every
  // occurrence of it first means "Patch 17.9 shook things up" passes while
  // "a 4.2 average placement" does not.
  const withoutPatchId = text.split(facts.patch).join('');
  if (/\d/.test(withoutPatchId)) {
    problems.push('Contains a number that is not the patch id.');
  }

  // R3.1's hard line. The facts carry no augment data, so any augment here was
  // invented — which is both a fabrication and the one topic we may not
  // characterise by performance.
  const lowered = text.toLowerCase();
  if (lowered.includes('augment')) {
    problems.push('Mentions augments, which are outside this summary’s scope.');
  }

  const namedAugment = vocabulary.augmentNames.find(
    (name) => name.length > 3 && lowered.includes(name.toLowerCase()),
  );
  if (namedAugment) {
    problems.push(`Names an augment (“${namedAugment}”).`);
  }

  // Grounding: at least one thing from the facts has to appear, or the draft is
  // about some other patch. A weak check by design — the strong guarantee is
  // that the model was given nothing else to work from.
  const subjects = [
    ...facts.tierMovements.map((move) => move.compName),
    ...facts.newComps.map((comp) => comp.compName),
    ...facts.balanceChanges.map((change) => change.entityId),
  ].filter((subject) => subject.length > 0);

  if (subjects.length > 0 && !subjects.some((subject) => lowered.includes(subject.toLowerCase()))) {
    problems.push('Mentions nothing from the supplied facts.');
  }

  return { ok: problems.length === 0, problems };
}

/** True when there is not enough on a patch to be worth drafting about. */
export function hasEnoughToSay(facts: MetaSummaryFacts): boolean {
  return (
    facts.balanceChanges.length > 0 || facts.tierMovements.length > 0 || facts.newComps.length > 0
  );
}
