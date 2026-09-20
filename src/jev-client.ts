import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JevResponse } from './types.js';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const COST_PER_M_INPUT = 0.042;
const CACHE_PATH = 'fixtures/cache.json';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

interface CacheEntry {
  response: JevResponse;
  timestamp: number;
}

let cache: Record<string, CacheEntry> = {};
let totalInputTokens = 0;

function loadCache(): void {
  try {
    if (existsSync(CACHE_PATH)) {
      cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch {
    cache = {};
  }
}

function saveCache(): void {
  const dir = dirname(CACHE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function buildBody(state: string, strategyName: string) {
  return {
    model: JEV_MODEL,
    state: JSON.parse(state),
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
        instructions: `Given the described market features, is a regime transition likely happening right now? Consider volatility expansion, trend persistence shifts, and ATR changes as transition signals.`,
      },
      strategy_viable: {
        type: 'noul',
        instructions: `Is the ${strategyName} strategy compatible with the current regime? ${strategyName} profits in sustained directional moves and suffers in choppy or range-bound conditions.`,
      },
    },
  };
}

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

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function classify(
  state: string,
  strategyName: string,
  apiKey: string,
): Promise<JevResponse> {
  loadCache();
  const key = hashState(state);

  if (cache[key]) {
    return cache[key].response;
  }

  const body = buildBody(state, strategyName);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        process.stderr.write(`Rate limited, retrying in ${delay}ms...\n`);
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jev API ${res.status}: ${text}`);
      }

      const data = (await res.json()) as JevResponse;
      const tokens = data.usage?.input_tokens ?? 0;
      totalInputTokens += tokens;

      cache[key] = { response: data, timestamp: Date.now() };
      saveCache();

      return data;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        process.stderr.write(`Jev API failed after ${MAX_RETRIES} attempts, using default\n`);
        return defaultResponse();
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  return defaultResponse();
}

export function getCostSummary(): { totalInputTokens: number; estimatedCost: number } {
  return {
    totalInputTokens,
    estimatedCost: (totalInputTokens / 1_000_000) * COST_PER_M_INPUT,
  };
}

export function getCacheStats(): { entries: number; hits: number } {
  loadCache();
  return { entries: Object.keys(cache).length, hits: 0 };
}
