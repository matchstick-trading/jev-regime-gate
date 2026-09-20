import type { Env, Bar, RegimeType } from './types';
import { getTrie } from './tickers';
import { fetchBars } from './yahoo';
import { encodeBar, formatState, MIN_LOOKBACK } from './encoder';
import { classify, judgeMatch, judgeAutopsy, judgeIncident, JevUnavailableError } from './jev';
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
  let jevResult;
  try {
    jevResult = await classify(stateJson, env);
  } catch (err) {
    if (err instanceof JevUnavailableError) {
      return corsError('Classification unavailable — model service did not respond', 503);
    }
    throw err;
  }
  const { response: jev, estimatedCost } = jevResult;

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

async function handleJudge(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    question?: string;
    state?: Record<string, string>;
  };

  if (!body.question || !body.state) {
    return corsError('Provide {question: "...", state: {...}}', 400);
  }

  try {
    const result = await judgeMatch(body.question, body.state, env);
    return corsJson(result, 200, {
      'X-Jev-Cost': result.estimatedCost.toFixed(6),
    });
  } catch (err) {
    if (err instanceof JevUnavailableError) {
      return corsError('Judge unavailable — model service did not respond', 503);
    }
    throw err;
  }
}

async function handleAutopsy(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    state?: Record<string, string>;
  };

  if (!body.state) {
    return corsError('Provide {state: {...}}', 400);
  }

  try {
    const result = await judgeAutopsy(body.state, env);
    return corsJson(result, 200, {
      'X-Jev-Cost': result.estimatedCost.toFixed(6),
    });
  } catch (err) {
    if (err instanceof JevUnavailableError) {
      return corsError('Autopsy unavailable — model service did not respond', 503);
    }
    throw err;
  }
}

async function handleIncident(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    state?: Record<string, string>;
  };

  if (!body.state) {
    return corsError('Provide {state: {...}}', 400);
  }

  try {
    const result = await judgeIncident(body.state, env);
    return corsJson(result, 200, {
      'X-Jev-Cost': result.estimatedCost.toFixed(6),
    });
  } catch (err) {
    if (err instanceof JevUnavailableError) {
      return corsError('Incident triage unavailable — model service did not respond', 503);
    }
    throw err;
  }
}

const BOUNDARY_KEYS = ['vol_vs_baseline', 'trend_persistence', 'atr_expansion', 'price_vs_sma'] as const;

async function handleBoundary(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    state?: Record<string, string>;
  };

  if (!body.state || BOUNDARY_KEYS.some((k) => typeof body.state![k] !== 'string')) {
    return corsError(`Provide {state: {${BOUNDARY_KEYS.join(', ')}}}`, 400);
  }

  const state: Record<string, string> = {};
  for (const key of BOUNDARY_KEYS) state[key] = body.state[key];

  let jevResult;
  try {
    jevResult = await classify(JSON.stringify(state), env);
  } catch (err) {
    if (err instanceof JevUnavailableError) {
      return corsError('Classification unavailable — model service did not respond', 503);
    }
    throw err;
  }
  const { response: jev, estimatedCost } = jevResult;
  const regime = jev.answers.regime_type;

  const result = {
    regime: regime.choice,
    probs: regime.probabilities,
    maxP: Math.round(maxProbability(regime.probabilities) * 100) / 100,
    changeLikely: Math.round(jev.answers.regime_change_likely.noul * 100) / 100,
    viable: Math.round(jev.answers.strategy_viable.noul * 100) / 100,
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

  const total = bars.length - MIN_LOOKBACK;
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Kick off the streaming classification in the background.
  const streamBars = async () => {
    try {
      // Header line so the client knows how many bars to expect.
      await writer.write(
        encoder.encode(JSON.stringify({ type: 'header', symbol, total }) + '\n'),
      );

      for (let i = MIN_LOOKBACK; i < bars.length; i++) {
        const features = encodeBar(bars, i);
        if (!features) continue;

        const bar = bars[i];
        const stateJson = formatState(features);

        try {
          const { response: jev } = await classify(stateJson, env);
          const regime = jev.answers.regime_type;
          const gate = applyGate(jev);

          const line = JSON.stringify({
            type: 'bar',
            t: bar.t,
            regime: regime.choice as RegimeType,
            maxP: Math.round(maxProbability(regime.probabilities) * 100) / 100,
            probs: regime.probabilities,
            changeLikely: Math.round(jev.answers.regime_change_likely.noul * 100) / 100,
            viable: Math.round(jev.answers.strategy_viable.noul * 100) / 100,
            gate: gate.decision,
            size: gate.sizeFactor,
            feat: features,
          });

          await writer.write(encoder.encode(line + '\n'));
        } catch {
          await writer.write(
            encoder.encode(JSON.stringify({ type: 'error', t: bar.t, message: 'classification unavailable' }) + '\n'),
          );
        }
      }
    } catch (err) {
      console.error('Stream error:', err instanceof Error ? err.message : err);
    } finally {
      await writer.close();
    }
  };

  // The function runs without await so the Response is returned immediately.
  void streamBars();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      ...CORS_HEADERS,
    },
  });
}

// --- Worker entry point ---

export default {
  scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(getTrie());
  },

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

      if (url.pathname === '/api/judge' && request.method === 'POST') {
        return await handleJudge(request, env);
      }

      if (url.pathname === '/api/autopsy' && request.method === 'POST') {
        return await handleAutopsy(request, env);
      }

      if (url.pathname === '/api/incident' && request.method === 'POST') {
        return await handleIncident(request, env);
      }

      if (url.pathname === '/api/boundary' && request.method === 'POST') {
        return await handleBoundary(request, env);
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
