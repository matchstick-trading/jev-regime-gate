import type { Env, Bar, RegimeType } from './types';
import { getTrie } from './tickers';
import { fetchBars } from './yahoo';
import { encodeBar, formatState, MIN_LOOKBACK } from './encoder';
import { classify } from './jev';
import { applyGate, maxProbability } from './gate';

// --- CORS helpers ---

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

function corsError(message: string, status: number): Response {
  return corsJson({ error: message }, status);
}

// --- Route handlers ---

async function handleSearch(url: URL): Promise<Response> {
  const q = url.searchParams.get('q');
  if (!q) return corsError('Missing ?q= parameter', 400);

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '10'), 50);
  const trie = await getTrie();
  const results = trie.findPrefix(q, limit).map(({ symbol, name }) => ({ symbol, name }));

  return corsJson({ results });
}

async function handleClassify(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    symbol?: string;
    source?: string;
    bars?: Bar[];
  };

  let bars: Bar[];
  let symbol: string | undefined;
  let tickerName: string | undefined;

  if (body.bars && Array.isArray(body.bars)) {
    // BYOD mode
    bars = body.bars;
    symbol = 'BYOD';
  } else if (body.symbol && body.source === 'yahoo') {
    // On-demand mode — fetch 3mo (enough for MIN_LOOKBACK + current bar)
    symbol = body.symbol.toUpperCase();
    bars = await fetchBars(symbol, '3mo');
    // Look up company name from trie
    const trie = await getTrie();
    const match = trie.findExact(symbol);
    if (match.length > 0) tickerName = match[0].name;
  } else {
    return corsError('Provide {symbol, source:"yahoo"} or {bars: [...]}', 400);
  }

  if (bars.length <= MIN_LOOKBACK) {
    return corsError(`Need at least ${MIN_LOOKBACK + 1} bars, got ${bars.length}`, 422);
  }

  const lastIndex = bars.length - 1;
  const features = encodeBar(bars, lastIndex);
  if (!features) {
    return corsError('Could not encode features — insufficient lookback', 422);
  }

  const stateJson = formatState(features);
  const { response: jev, estimatedCost } = await classify(stateJson, env);

  const regime = jev.answers.regime_type;
  const { decision } = applyGate(jev);
  const lastBar = bars[lastIndex];

  const prevBar = bars[lastIndex - 1];
  const change = prevBar ? ((lastBar.c - prevBar.c) / prevBar.c) * 100 : 0;

  const result = {
    symbol: symbol ?? 'BYOD',
    name: tickerName ?? '',
    date: new Date(lastBar.t * 1000).toISOString().slice(0, 10),
    close: Math.round(lastBar.c * 100) / 100,
    change: Math.round(change * 100) / 100,
    regime: regime.choice,
    maxP: Math.round(maxProbability(regime.probabilities) * 100) / 100,
    probs: regime.probabilities,
    changeLikely: Math.round(jev.answers.regime_change_likely.noul * 100) / 100,
    viable: Math.round(jev.answers.strategy_viable.noul * 100) / 100,
    gate: decision,
    features,
  };

  return corsJson(result, 200, {
    'X-Jev-Cost': estimatedCost.toFixed(6),
  });
}

async function handleHistory(url: URL, env: Env): Promise<Response> {
  const symbol = url.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return corsError('Missing ?symbol= parameter', 400);

  const rangeParam = url.searchParams.get('range') ?? '1y';
  const yahooRange = rangeParam === '3y' ? '5y' as const : '1y' as const;

  const bars = await fetchBars(symbol, yahooRange);

  if (bars.length <= MIN_LOOKBACK) {
    return corsError(`Not enough data for ${symbol} (got ${bars.length} bars)`, 422);
  }

  // Encode and classify each bar that has enough lookback.
  const screenedBars: unknown[] = [];

  for (let i = MIN_LOOKBACK; i < bars.length; i++) {
    const features = encodeBar(bars, i);
    if (!features) continue;

    const stateJson = formatState(features);
    const { response: jev, estimatedCost: _cost } = await classify(stateJson, env);

    const regime = jev.answers.regime_type;
    const gate = applyGate(jev);
    const bar = bars[i];

    screenedBars.push({
      t: bar.t,
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v,
      regime: regime.choice as RegimeType,
      maxP: Math.round(maxProbability(regime.probabilities) * 100) / 100,
      probs: regime.probabilities,
      changeLikely: Math.round(jev.answers.regime_change_likely.noul * 100) / 100,
      viable: Math.round(jev.answers.strategy_viable.noul * 100) / 100,
      gate: gate.decision,
      size: gate.sizeFactor,
      feat: features,
    });
  }

  return corsJson({
    symbol,
    interval: '1d',
    bars: screenedBars,
  });
}

// --- Worker entry point ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // API routing
      if (url.pathname === '/api/search' && request.method === 'GET') {
        return await handleSearch(url);
      }

      if (url.pathname === '/api/classify' && request.method === 'POST') {
        return await handleClassify(request, env);
      }

      if (url.pathname === '/api/history' && request.method === 'GET') {
        return await handleHistory(url, env);
      }

      // All other routes → static assets (the React app).
      return env.ASSETS.fetch(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      console.error('Worker error:', message);
      return corsError(message, 500);
    }
  },
} satisfies ExportedHandler<Env>;
