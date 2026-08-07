# TFT Codex — Visual Design System

Companion to `design.md` (architecture) and `review-and-roadmap.md` (feature roadmap). This covers the part neither of those does: the actual look and feel — tokens, components, and rules — for the Next.js web app and the `ow-electron` Overwolf overlay, which share `packages/ui` per `design.md` §13/R10.2.

## 1. Direction

Dark-first "command console" aesthetic: a competitive tool players glance at mid-decision, not a marketing site. Cyan is the single accent color used for interactivity, emphasis, and brand identity — it appears on links, active states, primary buttons, chart highlights, and the logo mark. It is **not** used for tier grades (S/A/B/C get their own semantic palette below) so "this is clickable/important" and "this is an S-tier comp" never compete for the same color.

Two rendering contexts, one token set:

- **Web** — full brightness range, generous whitespace, larger type scale.
- **Overlay** — semi-transparent glass panels over gameplay, tighter density, higher-contrast borders so panels read against unpredictable game backgrounds, and a "second screen" mode that scales the same components down without breaking layout (R5.7, R11.3).

## 2. Color tokens

All pairs below were checked with WCAG contrast math (relative luminance per WCAG 2.1) against the actual dark backgrounds in this system, not assumed.

### Background layers (dark, four-step elevation)

| Token         | Hex       | Use                                                      |
| ------------- | --------- | -------------------------------------------------------- |
| `--bg-canvas` | `#080B0F` | App background, web only                                 |
| `--bg-base`   | `#0B1016` | Overlay window background (also default "page" fallback) |
| `--surface-1` | `#121922` | Cards, panels                                            |
| `--surface-2` | `#1A2430` | Raised elements, modals, hovered rows                    |

### Brand / accent (cyan)

| Token        | Hex       | Use                                                      | Contrast on `--bg-base`                                             |
| ------------ | --------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `--cyan-300` | `#67E8F9` | Body-size links/text on dark bg, subtle glows            | 13.2:1 (AA normal)                                                  |
| `--cyan-400` | `#22D3EE` | Primary buttons, active nav, chart primary series, logo  | 10.6:1 as text; **9.15:1 as a filled button with `--ink-900` text** |
| `--cyan-500` | `#06B6D4` | Pressed/hover state of cyan-400                          | 7.9:1                                                               |
| `--ink-900`  | `#06222A` | Text color placed _on top of_ filled cyan buttons/badges | —                                                                   |

**Rule verified by calculation:** cyan-400 filled buttons must use `--ink-900` (near-black) text, not white — white-on-cyan-400 measures only **1.81:1**, a hard accessibility failure. This is a common mistake with bright accent colors; bake it into the button component so no one has to remember it.

### Text

| Token              | Hex       | Use                                             |
| ------------------ | --------- | ----------------------------------------------- |
| `--text-primary`   | `#E6EDF3` | Headings, primary body text                     |
| `--text-secondary` | `#9AA7B4` | Captions, metadata, timestamps                  |
| `--text-disabled`  | `#5C6772` | Disabled controls only (not required to hit AA) |

### Tier semantics (comps, R1.3 / augments, R3.2 — categorical only, never a heatmap of raw stats)

Deliberately a _different_ hue family from brand cyan so tier grade and interactivity never get confused.

| Tier        | Token                | Hex                                                       | Contrast on `--bg-base`                    |
| ----------- | -------------------- | --------------------------------------------------------- | ------------------------------------------ |
| S           | `--tier-s`           | `#F5A623` (amber)                                         | 9.4:1                                      |
| A           | `--tier-a`           | `#A78BFA` (violet)                                        | 7.0:1                                      |
| B           | `--tier-b`           | `#2DD4BF` (teal — intentionally distinct from brand cyan) | 10.3:1                                     |
| C           | `--tier-c`           | `#94A3B8` (slate)                                         | 7.5:1                                      |
| Provisional | `--tier-provisional` | `#5C6772` dashed outline, no fill                         | — (never implies confident rank, per R1.4) |

### Status / semantic

| Token       | Hex       | Use                                                                          |
| ----------- | --------- | ---------------------------------------------------------------------------- |
| `--success` | `#4ADE80` | Rising trend, positive delta                                                 | 11:1  |
| `--danger`  | `#FB7185` | Falling trend, stale-data banner (R1.6), errors                              | 7.1:1 |
| `--warning` | `#F5A623` | Caution states (reuses `--tier-s` intentionally — both mean "pay attention") | —     |

### Overlay-specific

| Token                    | Value                         | Use                                                                                        |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `--overlay-panel-bg`     | `rgba(11, 16, 22, 0.82)`      | Glass panel fill over gameplay                                                             |
| `--overlay-panel-border` | `rgba(103, 232, 249, 0.25)`   | Faint cyan edge so panels read as "app," not game UI                                       |
| `--overlay-blur`         | `backdrop-filter: blur(12px)` | Applied under panels; respect `--reduced-motion` for any animated blur transitions (R11.4) |

## 3. Typography

- **Display/headings:** a geometric, slightly technical sans — e.g. `"Rajdhani"` or `"Chakra Petch"` (both free, both read as "esports HUD" without being a novelty font). Use only for H1/H2 and big stat numbers.
- **Body/UI:** `"Inter"` — everything else (tables, labels, buttons, overlay text). Chosen for legibility at small overlay sizes, where a display font would blur.
- **Numeric/tabular:** enable `font-variant-numeric: tabular-nums` on all stat tables and the tier-list so placement/percentage columns align — small detail, big perceived-polish gain on a stats-heavy product.

| Token                    | Size / Line-height       | Use                       |
| ------------------------ | ------------------------ | ------------------------- |
| `--text-display`         | 32/40, Rajdhani SemiBold | Page H1                   |
| `--text-h2`              | 22/28, Rajdhani SemiBold | Section headers           |
| `--text-body`            | 15/22, Inter Regular     | Default body              |
| `--text-caption`         | 13/18, Inter Regular     | Metadata, timestamps      |
| `--text-overlay-compact` | 12/16, Inter Medium      | Overlay-only compact rows |

## 4. Spacing, radius, elevation

- Spacing scale: 4px base — 4/8/12/16/24/32/48.
- Radius: `--radius-sm: 6px` (chips, badges), `--radius-md: 10px` (cards), `--radius-lg: 16px` (modals). Overlay panels use `--radius-md` max — sharper corners read better at small sizes over a busy game background than fully rounded ones.
- Elevation is communicated by the `--surface-*` step, not drop shadows — shadows barely read on a semi-transparent overlay, so don't rely on them there; use border + surface-step instead, and let web reuse the same rule for visual consistency (R10.2).

## 5. Core components

- **Tier badge:** filled rounded-square, tier color background, `--ink-900`-equivalent dark text per tier (use the same contrast-checked-text rule as the cyan button), letter only (S/A/B/C) — never a number next to it that could be mistaken for a stat (guards R3.1 at the component level, not just the API level).
- **Comp card:** `--surface-1` background, tier badge top-left, trend arrow (success/danger) top-right, carry portraits, core-trait chips, computed-stat row (avgPlacement/top4/winRate/playRate) in tabular numerals, "provisional" state renders as a dashed border + muted stat row instead of the normal solid card.
- **Augment chip:** tier-colored left border only (not full fill, to visually de-emphasize vs. comp tier badges — augments are a _lighter-weight_ recommendation per R3.2), play-rate shown as a small percentage, no other number ever rendered inside this component by design — enforce via a component prop type that simply has no field for win rate/placement, mirroring the `Augment` TypeScript interface's structural restriction in `design.md` §4.
- **Stale-data banner (R1.6):** `--danger` left border, `--surface-2` background, persistent (not a dismissible toast) — it needs to stay visible for the whole session it applies to.
- **Overlay panel:** `--overlay-panel-bg` + `--overlay-panel-border` + `--overlay-blur`, drag handle, collapse-to-dock affordance, always renders at `--text-overlay-compact` scale regardless of web's normal type scale.
- **Charts (leveling/econ curves, R4.3):** single cyan-400 line for "you," `--text-secondary`-toned line for the top-4 baseline comparison — keep it to two lines max per chart; this is a comparison tool, not a dashboard to impress with data density.

## 6. Motion

- Standard transition: 150ms ease-out for hovers/focus, 220ms for panel open/close.
- Respect `prefers-reduced-motion` everywhere (R11.4): disable panel slide/blur transitions and chart entrance animations, keep only opacity crossfades under 100ms so state changes are still perceivable.
- The overlay in particular should default to minimal motion even without the OS flag — a moving element over live gameplay is a distraction risk, not just an accessibility one.

## 7. Accessibility checklist (ties to R11.3)

- Every token pair above is contrast-verified (see calculated ratios); if a new color is added, verify it the same way before shipping, don't eyeball it against a dark background.
- Tier and trend information is never color-only — badges carry the letter, trend arrows carry a glyph (↑/↓/→), not just a hue shift, for colorblind users.
- Keyboard navigation and visible focus rings (`--cyan-300` 2px outline) on every interactive element on web, per R11.3's explicit keyboard-nav requirement.
- Overlay text never drops below `--text-overlay-compact` (12px) even in second-screen/scaled mode (R5.7) — scale the panel, not the type, below that floor.

## 8. Starter token file

Drop-in for `packages/ui` (CSS custom properties; map to Tailwind config `theme.extend.colors` if using Tailwind, per `design.md` §13's Next.js choice):

```css
:root {
  /* backgrounds */
  --bg-canvas: #080b0f;
  --bg-base: #0b1016;
  --surface-1: #121922;
  --surface-2: #1a2430;

  /* brand */
  --cyan-300: #67e8f9;
  --cyan-400: #22d3ee;
  --cyan-500: #06b6d4;
  --ink-900: #06222a;

  /* text */
  --text-primary: #e6edf3;
  --text-secondary: #9aa7b4;
  --text-disabled: #5c6772;

  /* tiers */
  --tier-s: #f5a623;
  --tier-a: #a78bfa;
  --tier-b: #2dd4bf;
  --tier-c: #94a3b8;
  --tier-provisional: #5c6772;

  /* status */
  --success: #4ade80;
  --danger: #fb7185;
  --warning: #f5a623;

  /* overlay */
  --overlay-panel-bg: rgba(11, 16, 22, 0.82);
  --overlay-panel-border: rgba(103, 232, 249, 0.25);

  /* radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
}
```

## 9. Branding note

Per R12.3, no Riot logo anywhere, and the required disclaimer footer applies on every client including the overlay. Keep the TFT Codex wordmark/logo simple enough to render legibly at overlay dock-icon size (Overwolf's `icon_gray`/`launcher_icon` manifest fields, `tasks.md` 5.3) — a cyan geometric mark suggesting an open index/page (nodding to "codex") rather than a literal book icon reads better at small sizes; a monogram bracket-and-hex motif (evoking both a reference index and the game's hex board) works at both 256px web-header size and ~32px taskbar-icon size. Test the mark at both extremes before finalizing, not just at presentation size.
