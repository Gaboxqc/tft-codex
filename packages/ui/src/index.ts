/**
 * @tft-codex/ui — components and design tokens shared by the Next.js web app
 * and the ow-electron overlay, so the two cannot drift visually (R10.2).
 *
 * Import the stylesheet once per app:
 *   import '@tft-codex/ui/styles.css';
 */
export { Button, type ButtonProps } from './components/Button.js';
export { AugmentChip, type AugmentChipProps } from './components/AugmentChip.js';
export {
  RiotDisclaimer,
  RIOT_DISCLAIMER_TEXT,
  type RiotDisclaimerProps,
} from './components/RiotDisclaimer.js';
export { StaleDataBanner, type StaleDataBannerProps } from './components/StaleDataBanner.js';
export { TierBadge, type TierBadgeProps } from './components/TierBadge.js';
export { TrendIndicator, type TrendIndicatorProps } from './components/TrendIndicator.js';
