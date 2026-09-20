import type { Env, JevResponse, JevAutopsyResponse, JevIncidentResponse } from './types';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const COST_PER_M_INPUT = 0.042;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const CACHE_TTL_SECONDS = 86400; // 24 hours

export class JevUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevUnavailableError';
  }
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

export interface JudgeResult {
  score: number;
  estimatedCost: number;
}

export async function judgeMatch(
  question: string,
  state: Record<string, string>,
  env: Env,
): Promise<JudgeResult> {
  const body = {
    model: JEV_MODEL,
    state,
    questions: {
      episode_match: {
        type: 'noul',
        instructions: question,
      },
    },
  };

  const stateKey = JSON.stringify({ q: question, s: state });
  const key = await hashState(stateKey);

  if (env.JEV_CACHE) {
    try {
      const cached = await env.JEV_CACHE.get(key, 'json');
      if (cached) return cached as JudgeResult;
    } catch { /* cache miss */ }
  }

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
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jev API ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { answers: { episode_match: { noul: number } }; usage?: { input_tokens: number } };
      const tokens = data.usage?.input_tokens ?? 0;
      const result: JudgeResult = {
        score: data.answers.episode_match.noul,
        estimatedCost: (tokens / 1_000_000) * COST_PER_M_INPUT,
      };

      if (env.JEV_CACHE) {
        try {
          await env.JEV_CACHE.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
        } catch { /* non-fatal */ }
      }

      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        throw new JevUnavailableError(`Judge unavailable after ${MAX_RETRIES} attempts: ${msg}`);
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new JevUnavailableError('Judge unavailable');
}

const AUTOPSY_CRITERIA: Record<string, string> = {
  lookahead_leakage:
    'A meaningful share of orders show a decision that used feature data timestamped after the decision time — information from the future reached the strategy before it should exist.',
  timezone_mismatch:
    'Fills cluster outside the declared trading session by a consistent offset, suggesting bar or order timestamps were interpreted in the wrong timezone.',
  bad_corporate_action_adjustment:
    'The price series shows an unexplained large discontinuity that does not match any recorded split or dividend adjustment factor.',
  event_ordering_violation:
    'Order events show a fill recorded before its submission, or a submission recorded before its signal — an impossible causal sequence.',
  unrealistic_fills:
    'Fill prices fall outside the bar high-low range, or a fill size exceeds plausible bar liquidity.',
  clean:
    'No diagnostic signal rises meaningfully above normal noise; the run looks internally consistent.',
};

export interface AutopsyResult {
  family: string;
  probabilities: Record<string, number>;
  confidence: number;
  estimatedCost: number;
}

export async function judgeAutopsy(
  state: Record<string, string>,
  env: Env,
): Promise<AutopsyResult> {
  const body = {
    model: JEV_MODEL,
    state,
    questions: {
      failure_family: {
        type: 'choice',
        instructions:
          'Classify the most likely cause of a backtest data-integrity problem from the described diagnostic signals. Pick "clean" only if no signal rises meaningfully above normal noise.',
        criteria: AUTOPSY_CRITERIA,
      },
    },
  };

  const key = await hashState(JSON.stringify({ autopsy: state }));

  if (env.JEV_CACHE) {
    try {
      const cached = await env.JEV_CACHE.get(key, 'json');
      if (cached) return cached as AutopsyResult;
    } catch { /* cache miss */ }
  }

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
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jev API ${res.status}: ${text}`);
      }

      const data = (await res.json()) as JevAutopsyResponse;
      const tokens = data.usage?.input_tokens ?? 0;
      const answer = data.answers.failure_family;
      const result: AutopsyResult = {
        family: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        estimatedCost: (tokens / 1_000_000) * COST_PER_M_INPUT,
      };

      if (env.JEV_CACHE) {
        try {
          await env.JEV_CACHE.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
        } catch { /* non-fatal */ }
      }

      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        throw new JevUnavailableError(`Autopsy unavailable after ${MAX_RETRIES} attempts: ${msg}`);
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new JevUnavailableError('Autopsy unavailable');
}

const INCIDENT_CRITERIA: Record<string, string> = {
  stale_quote:
    'The bid/ask quote stayed frozen for an unusually long run of consecutive prints while trades kept occurring — the feed stopped updating one side of the book.',
  crossed_book:
    'A meaningful share of quotes show the bid at or above the ask — a crossed or locked book, which should not persist in a clean feed.',
  duplicate_tick:
    'A meaningful share of trade prints are exact duplicates of the immediately preceding print — same time, price, and size.',
  out_of_order_event:
    'One or more trade prints arrived with an earlier timestamp than the print immediately before it, despite a later sequence number — an ordering violation.',
  unadjusted_split:
    'A large single-print price jump has no corroborating explanation and no other feed symptom — consistent with an unadjusted corporate action rather than a real market move.',
  clean:
    'No diagnostic signal rises meaningfully above normal noise, including an isolated price jump that stands alone with no other feed symptom.',
};

export interface IncidentResult {
  family: string;
  probabilities: Record<string, number>;
  confidence: number;
  estimatedCost: number;
}

export async function judgeIncident(
  state: Record<string, string>,
  env: Env,
): Promise<IncidentResult> {
  const body = {
    model: JEV_MODEL,
    state,
    questions: {
      incident_family: {
        type: 'choice',
        instructions:
          'Classify the most likely market-data feed incident from the described diagnostic signals. Pick "clean" if the signals look like normal feed behavior, including a genuine one-off price discontinuity with no other corroborating symptom.',
        criteria: INCIDENT_CRITERIA,
      },
    },
  };

  const key = await hashState(JSON.stringify({ incident: state }));

  if (env.JEV_CACHE) {
    try {
      const cached = await env.JEV_CACHE.get(key, 'json');
      if (cached) return cached as IncidentResult;
    } catch { /* cache miss */ }
  }

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
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jev API ${res.status}: ${text}`);
      }

      const data = (await res.json()) as JevIncidentResponse;
      const tokens = data.usage?.input_tokens ?? 0;
      const answer = data.answers.incident_family;
      const result: IncidentResult = {
        family: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        estimatedCost: (tokens / 1_000_000) * COST_PER_M_INPUT,
      };

      if (env.JEV_CACHE) {
        try {
          await env.JEV_CACHE.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
        } catch { /* non-fatal */ }
      }

      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        throw new JevUnavailableError(`Incident triage unavailable after ${MAX_RETRIES} attempts: ${msg}`);
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new JevUnavailableError('Incident triage unavailable');
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
        const msg = err instanceof Error ? err.message : 'unknown error';
        throw new JevUnavailableError(`Classification unavailable after ${MAX_RETRIES} attempts: ${msg}`);
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new JevUnavailableError('Classification unavailable');
}
