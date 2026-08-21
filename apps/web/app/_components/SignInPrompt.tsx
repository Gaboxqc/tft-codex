/**
 * Shown on personal pages when signed out.
 *
 * R7.1: the only route in is Riot Sign-On, so this is a link to the RSO flow
 * and not a form. There is no username field, no password field, and nothing
 * on this page that could collect a credential.
 *
 * R7.4: it also says plainly that most of the product works without linking,
 * because it does — and a sign-in wall implying otherwise would be a lie.
 *
 * _Requirements: 7.1, 7.2, 7.4_
 */
import { signInHref } from '@/lib/sign-in';

export interface SignInPromptProps {
  /** Where to return after linking. */
  redirectTo?: string;
  what?: string;
}

export function SignInPrompt({ redirectTo = '/', what = 'your match history' }: SignInPromptProps) {
  return (
    <section className="sign-in-prompt">
      <h2>Link your Riot account to see {what}</h2>
      <p>
        Sign-in goes through Riot directly — we never see your password. We store your PUUID, region
        and Riot ID display name, and nothing else.
      </p>
      <p>
        <a className="tftc-btn tftc-btn--primary" href={signInHref(redirectTo)}>
          Sign in with Riot
        </a>
      </p>
      <p className="sign-in-prompt__note">
        You can unlink at any time, which stops us serving your data immediately and deletes it
        within 30 days. The tier list, comp explorer, augment reference and breakpoint chart all
        work without linking anything.
      </p>
    </section>
  );
}
