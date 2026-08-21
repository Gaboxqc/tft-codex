/**
 * Claude-backed implementation of `SummaryDrafter` (task 6.2).
 *
 * Kept behind the `SummaryDrafter` interface so the guards in
 * `meta-summary.ts` are tested without a network call, and so the provider is
 * one file rather than a dependency threaded through the domain.
 *
 * _Requirements: 8.2_
 */
import Anthropic from '@anthropic-ai/sdk';

import type { SummaryDrafter } from './meta-summary-drafter.js';

export interface AnthropicDrafterOptions {
  apiKey: string;
  model?: string;
  logger?: (message: string, detail?: unknown) => void;
}

export class AnthropicDrafter implements SummaryDrafter {
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: AnthropicDrafterOptions) {
    this.#client = new Anthropic({ apiKey: options.apiKey });
    this.#model = options.model ?? 'claude-opus-5';
    this.#log = options.logger ?? (() => {});
  }

  async draft(prompt: { system: string; user: string }): Promise<string> {
    try {
      const response = await this.#client.messages.create({
        model: this.#model,
        // Room for adaptive thinking plus a handful of sentences. The output
        // itself is deliberately tiny; thinking tokens count against this cap,
        // so a snug limit would truncate the answer rather than shorten it.
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        // Low effort suits the task: the facts are already structured and the
        // job is to phrase them, not to work anything out.
        output_config: { effort: 'low' },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      });

      // A safety decline is a legitimate outcome here, not an exception. The
      // caller treats an empty draft as "nothing to review", which is right.
      if (response.stop_reason === 'refusal') {
        this.#log('model declined to draft the summary', response.stop_details);
        return '';
      }

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
    } catch (error) {
      // Drafting is never on a request path — it runs after the pipeline
      // publishes. Failing it must not fail the run, and an absent draft is
      // already a state the review screen and the public page both handle.
      if (error instanceof Anthropic.RateLimitError) {
        this.#log('rate limited while drafting the meta summary');
      } else if (error instanceof Anthropic.APIError) {
        this.#log(`Anthropic API error ${error.status} while drafting`, error.message);
      } else {
        this.#log('drafting failed', error);
      }
      return '';
    }
  }
}
