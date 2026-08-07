/**
 * Button.
 *
 * The primary variant hardcodes dark-on-cyan text. White on `--tftc-cyan-400`
 * measures 1.81:1 — a hard WCAG failure, and the single most common mistake
 * with a bright accent color. design-system.md §2 says to bake it into the
 * component so nobody has to remember it; this is that.
 *
 * _Requirements: 11.3_
 */
import type { ButtonHTMLAttributes, JSX } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['tftc-btn', `tftc-btn--${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
