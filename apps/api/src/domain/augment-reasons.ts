/**
 * The qualitative reason bank (task 2.8, design.md §7 step 3).
 *
 * This module is where a forbidden number becomes a permitted sentence. The
 * recommendation engine ranks augments using real win rates and placements
 * server-side; what leaves the server is an ordering plus a sentence from this
 * bank. R3.4 requires the justification be qualitative — "fits your Vanguard
 * front line" — and never numeric.
 *
 * Two rules hold for every template here, and both are unit-tested:
 *
 * 1. **No digits, ever.** Not "top 15%", not "3rd best", not "wins 2 in 5".
 *    A percentile is a win rate with extra steps; a reader can invert it.
 * 2. **No comparative-to-outcome language.** "Performs better than the others"
 *    is a placement claim in prose form. Reasons describe *fit* — what the
 *    augment does for the board in front of you — not *outcome*.
 *
 * The rank order already carries "which is best". The reason's job is to
 * explain the recommendation in game terms, not to re-encode the number.
 *
 * _Requirements: 3.1, 3.4, 3.5_
 */

/** What made this augment rank where it did, in game terms. */
export type ReasonSignal =
  | 'trait-fit'
  | 'carry-fit'
  | 'item-fit'
  | 'econ-fit'
  | 'flexible'
  | 'needs-board'
  | 'off-plan'
  | 'no-context';

export interface ReasonContext {
  signal: ReasonSignal;
  /** Human-readable trait name, already stripped of Riot's set prefix. */
  traitName?: string;
  /** Human-readable carry name. */
  carryName?: string;
  /** Comp display name, when the recommendation is scoped to one. */
  compName?: string;
}

/**
 * Templates keyed by signal. Multiple phrasings per signal so a three-option
 * augment round doesn't read like a form letter.
 *
 * `{trait}`, `{carry}` and `{comp}` are the only substitutions. There is no
 * numeric placeholder by design — a template literally cannot render one.
 */
const TEMPLATES: Record<ReasonSignal, readonly string[]> = {
  'trait-fit': [
    'Strengthens the {trait} core you already have on board.',
    'Builds directly on your {trait} breakpoint.',
    'Your {trait} units get the most out of this one.',
  ],
  'carry-fit': [
    'Goes straight onto {carry} and does exactly what that unit wants.',
    'Scales with {carry}, who is already your damage plan.',
    'A natural fit for {carry} as your carry.',
  ],
  'item-fit': [
    'Solves your itemisation rather than adding another thing to build around.',
    'Gives you components you can slam now instead of holding.',
    'Fixes an item gap this board has right now.',
  ],
  'econ-fit': [
    'Buys you tempo to reach your level spike rather than adding combat power now.',
    'An economy pick — it pays off if you can afford to play slowly from here.',
    'Trades immediate strength for a stronger mid game.',
  ],
  flexible: [
    'Keeps your options open — it works with most directions from here.',
    "Doesn't commit you to a line, which matters if your board is contested.",
    'Fits whatever you end up building.',
  ],
  'needs-board': [
    "Your board doesn't have the trait count to use this yet.",
    'Needs units you are not currently holding to do much.',
    'This wants a board you would have to rebuild toward.',
  ],
  'off-plan': [
    'Pulls against the direction your board is already committed to.',
    "Strong in the abstract, but not for what you're building.",
    'Would mean pivoting away from your current plan.',
  ],
  'no-context': [
    'A generally solid pick for {comp}.',
    'A dependable option in most boards.',
    'Reliable, without needing anything specific from your board.',
  ],
};

/**
 * Renders a reason.
 *
 * `seed` picks the phrasing deterministically, so the same request produces the
 * same text — a recommendation that reworded itself on refresh would look
 * unstable and invite the user to reload until they get an answer they like.
 */
export function reasonFor(context: ReasonContext, seed = 0): string {
  const templates = TEMPLATES[context.signal];
  const template = templates[Math.abs(seed) % templates.length]!;

  const rendered = template
    .replace('{trait}', context.traitName ?? 'core')
    .replace('{carry}', context.carryName ?? 'your carry')
    .replace('{comp}', context.compName ?? 'this comp');

  // Belt and braces. A template with a digit is a bug, not a style issue, and
  // it should not reach a client even once.
  if (/\d/.test(rendered)) {
    throw new Error(
      `Augment reason contains a digit: "${rendered}". Reasons must be qualitative — a ` +
        'number here is an R3.1 violation regardless of what it measures. See design.md §7.',
    );
  }

  return rendered;
}

/**
 * Picks the signal that best explains an augment given the board context.
 *
 * Note what this does NOT take: the augment's score, win rate, or placement.
 * The signal describes fit; the ranking is decided separately and carries the
 * "which is best" information on its own.
 */
export function signalFor(input: {
  /** Trait ids the augment reinforces that the board already has. */
  matchingTraits: readonly string[];
  /** True when the augment's carry is on the board. */
  carryOnBoard: boolean;
  /** Augment category, from static augment metadata. */
  category?: 'combat' | 'econ' | 'item' | 'trait' | 'utility' | undefined;
  /** True when we have no board context at all — R3.5's fallback. */
  contextless: boolean;
  /** True when the augment needs traits the board lacks. */
  missingRequirements: boolean;
}): ReasonSignal {
  if (input.contextless) return 'no-context';
  if (input.missingRequirements) return 'needs-board';
  if (input.carryOnBoard) return 'carry-fit';
  if (input.matchingTraits.length > 0) return 'trait-fit';
  if (input.category === 'item') return 'item-fit';
  if (input.category === 'econ') return 'econ-fit';
  if (input.category === 'utility') return 'flexible';
  return 'off-plan';
}

/** Every template, for the compliance test that scans them all. */
export function allTemplates(): string[] {
  return Object.values(TEMPLATES).flat();
}
