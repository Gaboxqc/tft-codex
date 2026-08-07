/**
 * Riot's required legal disclaimer.
 *
 * R12.3 requires this on **every** client — web and the Overwolf overlay — and
 * forbids using Riot's official logo. It is a component rather than copied
 * markup so the wording stays identical everywhere and a change lands in one
 * place.
 *
 * _Requirements: 12.3_
 */
import type { JSX } from 'react';

/**
 * The exact wording Riot's legal boilerplate asks third-party apps to use.
 * Exported so tests can assert against it rather than a paraphrase.
 */
export const RIOT_DISCLAIMER_TEXT =
  "TFT Codex isn't endorsed by Riot Games and doesn't reflect the views or " +
  'opinions of Riot Games or anyone officially involved in producing or ' +
  'managing Riot Games properties. Riot Games and all associated properties ' +
  'are trademarks or registered trademarks of Riot Games, Inc.';

export interface RiotDisclaimerProps {
  /** `compact` uses the 12px overlay scale for the Overwolf window. */
  variant?: 'default' | 'compact';
  className?: string;
}

export function RiotDisclaimer({
  variant = 'default',
  className,
}: RiotDisclaimerProps): JSX.Element {
  const classes = [
    'tftc-disclaimer',
    variant === 'compact' ? 'tftc-disclaimer--compact' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // No Riot logo or brand mark here, deliberately — R12.3 permits the text
    // and forbids the logo.
    <p className={classes} data-testid="riot-disclaimer">
      {RIOT_DISCLAIMER_TEXT}
    </p>
  );
}
