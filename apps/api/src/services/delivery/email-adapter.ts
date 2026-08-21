/**
 * Email delivery (task 6.6).
 *
 * Resend's REST API over plain `fetch` rather than an SDK: the surface used
 * here is one POST, and keeping it that thin makes swapping providers a
 * single-file change rather than a dependency migration.
 *
 * **Nothing is sent to an unverified address.** The address is typed into a
 * form by a person who may not own it, and sending before the owner confirms
 * would make this product the mechanism of that abuse. `Destination.email` is
 * null unless verified, so the check is in the type rather than in a policy
 * somebody has to remember.
 *
 * Every message carries a one-click unsubscribe (R9.4), in the body and in the
 * `List-Unsubscribe` header — mail clients surface the header version, and it
 * is what keeps a sending domain out of spam folders.
 *
 * _Requirements: 9.1, 9.2, 9.4_
 */
import type { OutboundNotification } from '../../domain/notifications.js';
import type { DeliveryAdapter, DeliveryOutcome, Destination } from './types.js';
import { unsubscribeUrl } from './types.js';

export interface EmailAdapterOptions {
  apiKey: string;
  /** Verified sending identity, e.g. `TFT Codex <notifications@example.com>`. */
  from: string;
  webBaseUrl: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  logger?: (message: string, detail?: unknown) => void;
}

/** 4xx other than 429 means the request itself is wrong; retrying will not fix it. */
const isPermanent = (status: number): boolean => status >= 400 && status < 500 && status !== 429;

export class EmailAdapter implements DeliveryAdapter {
  readonly channel = 'email' as const;

  readonly #options: EmailAdapterOptions;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: EmailAdapterOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#endpoint = options.endpoint ?? 'https://api.resend.com/emails';
    this.#log = options.logger ?? (() => {});
  }

  async send(message: OutboundNotification, destination: Destination): Promise<DeliveryOutcome> {
    if (!destination.email) {
      return { status: 'skipped', reason: 'no verified email address on file' };
    }

    const stopUrl = unsubscribeUrl(this.#options.webBaseUrl, message.category);

    return this.deliver({
      to: destination.email,
      subject: message.subject,
      text: `${message.body}\n\n—\nStop these emails: ${stopUrl}`,
      headers: {
        // Surfaced by mail clients as a native unsubscribe control, which is
        // both R9.4 and the thing that keeps a sending domain reputable.
        'List-Unsubscribe': `<${stopUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  }

  /**
   * Sends one message. Exposed so the address-verification mail can reuse it —
   * that one goes to an unverified address by definition, which is exactly why
   * it does not go through `send`.
   */
  async deliver(email: {
    to: string;
    subject: string;
    text: string;
    headers?: Record<string, string>;
  }): Promise<DeliveryOutcome> {
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.#options.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          ...(email.headers ? { headers: email.headers } : {}),
        }),
      });

      if (response.ok) return { status: 'sent' };

      const detail = (await response.text()).slice(0, 300);
      this.#log(`email provider returned ${response.status}`, detail);

      return {
        status: 'failed',
        permanent: isPermanent(response.status),
        error: `${response.status}: ${detail}`,
      };
    } catch (error) {
      // A thrown fetch is a network problem, which is exactly the retryable
      // kind — the provider never saw the request.
      return {
        status: 'failed',
        permanent: false,
        error: error instanceof Error ? error.message : 'email request failed',
      };
    }
  }
}
