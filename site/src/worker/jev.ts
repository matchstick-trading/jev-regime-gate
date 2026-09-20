import type { Env, JevResponse } from './types';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const COST_PER_M_INPUT = 0.042;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const CACHE_TTL_SECONDS = 86400; // 24 hours

function defaultResponse(): JevResponse {
  return {
    model: JEV_MODEL,
    answers: {
      regime_type: {
        type: 'choice',
        choice: 'unclear',
        probabilities: { trend_up: 0.2, trend_down: 0.2, range: 0.2, chop: 0.2, unclear: 0.2 },
        confidence: 0.2,
      },
      regime_change_likely: { type: 'noul', noul: 0.5 },
      strategy_viable: { type: 'noul', noul: 0.5 },
    },
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function buildBody(state: Record<string, string>) {
  return {
    model: JEV_MODEL,
    state,
    questions: {
      regime_type: {
        type: 'choice',
        instructions: 'Classify the current market regime based on the described features.',
        criteria: {
          trend_up: 'Sustained upward price movement with bullish persistence, price above moving average and rising',
          trend_down: 'Sustained downward price movement with bearish persistence, price below moving average and falling',
          range: 'Price oscillating within bounds, no clear directional bias, mixed trend signals',
          chop: 'Erratic price moves with no follow-through, high volatility relative to baseline, no persistence',
          unclear: 'Conflicting signals across features, cannot confidently classify into another regime',
        },
      },
      regime_change_likely: {
        type: 'noul',
        instructions: 'Given the described market features, is a regime transition likely happening right now? Consider volatility expansion, trend persistence shifts, and ATR changes as transition signals.',
      },
      strategy_viable: {
        type: 'noul',
        instructions: 'Is a trend-following strategy compatible with the current regime? Trend-following profits in sustained directional moves and suffers in choppy or range-bound conditions.',
      },
    },
  };
}

async function hashState(stateJson: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(stateJson);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClassifyResult {
  response: JevResponse;
  estimatedCost: number;
}

/**
 * Send bar features to the Jev decision API and return the regime
 * classification. Results are cached in KV for 24 hours.
 */
export async function classify(
  stateJson: string,
  env: Env,
): Promise<ClassifyResult> {
  const key = await hashState(stateJson);

  // Check KV cache first.
  if (env.JEV_CACHE) {
    try {
      const cached = await env.JEV_CACHE.get(key, 'json');
      if (cached) {
        return { response: cached as JevResponse, estimatedCost: 0 };
      }
    } catch {
      // KV miss or error — continue to API call.
    }
  }

  const state = JSON.parse(stateJson) as Record<string, string>;
  const body = buildBody(state);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jev API ${res.status}: ${text}`);
      }

      const data = (await res.json()) as JevResponse;
      const tokens = data.usage?.input_tokens ?? 0;
      const estimatedCost = (tokens / 1_000_000) * COST_PER_M_INPUT;

      // Write to KV cache (fire-and-forget).
      if (env.JEV_CACHE) {
        try {
          await env.JEV_CACHE.put(key, JSON.stringify(data), {
            expirationTtl: CACHE_TTL_SECONDS,
          });
        } catch {
          // Non-fatal — cache write failure should not block the response.
        }
      }

      return { response: data, estimatedCost };
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        console.error(`Jev API failed after ${MAX_RETRIES} attempts, using default`);
        return { response: defaultResponse(), estimatedCost: 0 };
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  return { response: defaultResponse(), estimatedCost: 0 };
}
