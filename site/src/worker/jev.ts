import type { Env, JevResponse, JevAutopsyResponse, JevIncidentResponse, JevIntentResponse, OrderDraft } from './types';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DRAFT_MODEL = 'openai/gpt-4o-mini';
const COST_PER_M_INPUT = 0.042;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const CACHE_TTL_SECONDS = 86400; // 24 hours -- keeps real market-data routes honest per experiment-service-degradation-spec.md L161.

/**
 * Hypothesis, not a decided number (vaults.DEV-2026-09-278): 90 days is "clearly long" for the
 * four fixture-backed plays (Find the Moment, Backtest Autopsy, Market Data Incident Lab, Decision
 * Boundary Lab) whose inputs are frozen synthetic fixtures that never change. Shorten/lengthen freely.
 */
export const FIXTURE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

/** Bump this to deliberately invalidate old cache entries after a response-shape change. */
const CACHE_SCHEMA_VERSION = 1;

export class JevUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevUnavailableError';
  }
}

/** Envelope wrapping every KV-cached value with disclosure metadata (vaults.DEV-2026-09-278). */
interface CacheEnvelope<T> {
  value: T;
  generatedAt: string;
  model: string;
  schemaVersion: number;
}

function isCacheEnvelope<T>(entry: unknown): entry is CacheEnvelope<T> {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as Record<string, unknown>;
  return (
    'value' in candidate &&
    typeof candidate.generatedAt === 'string' &&
    candidate.schemaVersion !== undefined
  );
}

/**
 * Read an enveloped KV entry. A missing key, a KV error, or a pre-rollout raw (un-enveloped) entry
 * all return `null` -- treated as a cache miss, not a crash. This is a one-time deploy-transition
 * guard (existing 24h-TTL raw entries will all expire within a day of deploy regardless), not a
 * standing backward-compatibility shim.
 */
async function readCacheEnvelope<T>(cache: KVNamespace, key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const cached = await cache.get(key, 'json');
    if (cached && isCacheEnvelope<T>(cached)) return cached;
    return null;
  } catch {
    return null;
  }
}

/** Write a value to KV wrapped in the disclosure envelope. Non-fatal on failure. */
async function writeCacheEnvelope<T>(
  cache: KVNamespace,
  key: string,
  value: T,
  generatedAt: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    const envelope: CacheEnvelope<T> = {
      value,
      generatedAt,
      model: JEV_MODEL,
      schemaVersion: CACHE_SCHEMA_VERSION,
    };
    await cache.put(key, JSON.stringify(envelope), { expirationTtl: ttlSeconds });
  } catch {
    // non-fatal
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
  cache: 'hit' | 'miss';
  generatedAt: string;
}

export interface JudgeResult {
  score: number;
  estimatedCost: number;
  cache: 'hit' | 'miss';
  generatedAt: string;
}

export async function judgeMatch(
  question: string,
  state: Record<string, string>,
  env: Env,
  ttlSeconds: number = CACHE_TTL_SECONDS,
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
    const envelope = await readCacheEnvelope<Omit<JudgeResult, 'cache' | 'generatedAt'>>(env.JEV_CACHE, key);
    if (envelope) {
      return { ...envelope.value, cache: 'hit', generatedAt: envelope.generatedAt };
    }
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
      const generatedAt = new Date().toISOString();
      const result: JudgeResult = {
        score: data.answers.episode_match.noul,
        estimatedCost: (tokens / 1_000_000) * COST_PER_M_INPUT,
        cache: 'miss',
        generatedAt,
      };

      if (env.JEV_CACHE) {
        await writeCacheEnvelope(
          env.JEV_CACHE,
          key,
          { score: result.score, estimatedCost: result.estimatedCost },
          generatedAt,
          ttlSeconds,
        );
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
  cache: 'hit' | 'miss';
  generatedAt: string;
}

export async function judgeAutopsy(
  state: Record<string, string>,
  env: Env,
  ttlSeconds: number = CACHE_TTL_SECONDS,
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
    const envelope = await readCacheEnvelope<Omit<AutopsyResult, 'cache' | 'generatedAt'>>(env.JEV_CACHE, key);
    if (envelope) {
      return { ...envelope.value, cache: 'hit', generatedAt: envelope.generatedAt };
    }
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
      const generatedAt = new Date().toISOString();
      const result: AutopsyResult = {
        family: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        estimatedCost: (tokens / 1_000_000) * COST_PER_M_INPUT,
        cache: 'miss',
        generatedAt,
      };

      if (env.JEV_CACHE) {
        await writeCacheEnvelope(
          env.JEV_CACHE,
          key,
          {
            family: result.family,
            probabilities: result.probabilities,
            confidence: result.confidence,
            estimatedCost: result.estimatedCost,
          },
          generatedAt,
          ttlSeconds,
        );
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
  cache: 'hit' | 'miss';
  generatedAt: string;
}

export async function judgeIncident(
  state: Record<string, string>,
  env: Env,
  ttlSeconds: number = CACHE_TTL_SECONDS,
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
    const envelope = await readCacheEnvelope<Omit<IncidentResult, 'cache' | 'generatedAt'>>(env.JEV_CACHE, key);
    if (envelope) {
      return { ...envelope.value, cache: 'hit', generatedAt: envelope.generatedAt };
    }
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
      const generatedAt = new Date().toISOString();
      const result: IncidentResult = {
        family: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        estimatedCost: (tokens / 1_000_000) * COST_PER_M_INPUT,
        cache: 'miss',
        generatedAt,
      };

      if (env.JEV_CACHE) {
        await writeCacheEnvelope(
          env.JEV_CACHE,
          key,
          {
            family: result.family,
            probabilities: result.probabilities,
            confidence: result.confidence,
            estimatedCost: result.estimatedCost,
          },
          generatedAt,
          ttlSeconds,
        );
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

const INSTRUMENT_LIST = 'ES (E-mini S&P 500), NQ (E-mini Nasdaq-100), CL (Crude Oil), GC (Gold), 6E (Euro FX)';

const DRAFT_SYSTEM_PROMPT = `You convert a plain-English futures order request into a structured JSON draft. You never execute or submit anything -- you only draft. Available instruments: ${INSTRUMENT_LIST}. If the request names an instrument not in this list, or isn't a futures order at all, set instrument to null.

Respond with ONLY a JSON object, no other text, with exactly these fields:
{
  "instrument": one of "ES","NQ","CL","GC","6E", or null,
  "side": "buy", "sell", or null,
  "quantity": integer number of contracts, or null,
  "orderType": "market", "limit", or "stop",
  "limitPrice": number or null,
  "stopPrice": number or null,
  "stopLossPoints": number or null -- distance in points from entry if a stop-loss was mentioned,
  "restatement": one plain-English sentence restating what you understood,
  "confidence": "high", "medium", or "low" -- your own confidence this draft captures the user's intent
}`;

/**
 * Draft a structured order from a plain-English request using a general
 * chat model (not Jev). This step only interprets and drafts -- it never
 * executes or submits anything. Results are cached in KV for 24 hours.
 */
export async function draftIntent(requestText: string, env: Env): Promise<OrderDraft> {
  const key = await hashState(JSON.stringify({ draft: requestText }));

  if (env.JEV_CACHE) {
    try {
      const cached = await env.JEV_CACHE.get(key, 'json');
      if (cached) return cached as OrderDraft;
    } catch { /* cache miss */ }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: DRAFT_MODEL,
          messages: [
            { role: 'system', content: DRAFT_SYSTEM_PROMPT },
            { role: 'user', content: requestText },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (res.status === 429) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Draft model ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { choices?: { message: { content: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Draft model returned no content');
      const draft = JSON.parse(content) as OrderDraft;

      if (env.JEV_CACHE) {
        try {
          await env.JEV_CACHE.put(key, JSON.stringify(draft), { expirationTtl: CACHE_TTL_SECONDS });
        } catch { /* non-fatal */ }
      }

      return draft;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        throw new JevUnavailableError(`Draft model unavailable after ${MAX_RETRIES} attempts: ${msg}`);
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new JevUnavailableError('Draft model unavailable');
}

export interface IntentJudgment {
  matchesIntent: number;
  ambiguous: number;
  needsReview: number;
  estimatedCost: number;
}

/**
 * Given a drafted order and code-computed risk state, ask Jev three bounded
 * questions: does the draft match the request, is the request ambiguous,
 * and should a human review it. Jev never sees raw dollar figures -- only
 * the bucketed state the caller provides.
 */
export async function judgeIntent(state: Record<string, string>, env: Env): Promise<IntentJudgment> {
  const body = {
    model: JEV_MODEL,
    state,
    questions: {
      matches_intent: {
        type: 'noul',
        instructions:
          "Given the user's original request and the drafted order, does the draft plausibly match what the user asked for? Consider instrument, side, size, and any stated conditions.",
      },
      ambiguous: {
        type: 'noul',
        instructions:
          "Is the user's original request ambiguous or underspecified -- missing a clear instrument, side, size, or price, or open to more than one reasonable reading?",
      },
      needs_review: {
        type: 'noul',
        instructions:
          'Should a human review this draft before it is used for anything, considering its completeness, its risk figures, and how well it matches the original request?',
      },
    },
  };

  const key = await hashState(JSON.stringify({ intent: state }));

  if (env.JEV_CACHE) {
    try {
      const cached = await env.JEV_CACHE.get(key, 'json');
      if (cached) return cached as IntentJudgment;
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

      const data = (await res.json()) as JevIntentResponse;
      const tokens = data.usage?.input_tokens ?? 0;
      const result: IntentJudgment = {
        matchesIntent: data.answers.matches_intent.noul,
        ambiguous: data.answers.ambiguous.noul,
        needsReview: data.answers.needs_review.noul,
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
        throw new JevUnavailableError(`Intent judge unavailable after ${MAX_RETRIES} attempts: ${msg}`);
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new JevUnavailableError('Intent judge unavailable');
}

/**
 * Send bar features to the Jev decision API and return the regime
 * classification. Results are cached in KV.
 *
 * `ttlSeconds` defaults to the 24h `CACHE_TTL_SECONDS` -- correct for the two real-market-data call
 * sites (`/api/classify`, `/api/history`), which must never label stale EOD data as current
 * (experiment-service-degradation-spec.md L161). The `/api/boundary` call site (Decision Boundary
 * Lab, synthetic/frozen input) passes `FIXTURE_CACHE_TTL_SECONDS` explicitly instead.
 */
export async function classify(
  stateJson: string,
  env: Env,
  ttlSeconds: number = CACHE_TTL_SECONDS,
): Promise<ClassifyResult> {
  const key = await hashState(stateJson);

  // Check KV cache first.
  if (env.JEV_CACHE) {
    const envelope = await readCacheEnvelope<JevResponse>(env.JEV_CACHE, key);
    if (envelope) {
      return { response: envelope.value, estimatedCost: 0, cache: 'hit', generatedAt: envelope.generatedAt };
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
      const generatedAt = new Date().toISOString();

      // Write to KV cache (fire-and-forget).
      if (env.JEV_CACHE) {
        await writeCacheEnvelope(env.JEV_CACHE, key, data, generatedAt, ttlSeconds);
      }

      return { response: data, estimatedCost, cache: 'miss', generatedAt };
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
