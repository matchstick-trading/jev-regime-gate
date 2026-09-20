import type { Bar } from './types';

type YahooRange = '3mo' | '1y' | '5y';

interface YahooResult {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

// --- concurrency limiter ---

const MAX_CONCURRENT = 5;
let inflight = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inflight < MAX_CONCURRENT) {
    inflight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      inflight++;
      resolve();
    });
  });
}

function release(): void {
  inflight--;
  const next = queue.shift();
  if (next) next();
}

/**
 * Fetch OHLCV bars from Yahoo Finance for the given symbol and range.
 * Applies a concurrency limiter (max 5 in-flight).
 */
export async function fetchBars(symbol: string, range: YahooRange): Promise<Bar[]> {
  await acquire();
  try {
    return await fetchBarsInner(symbol, range);
  } finally {
    release();
  }
}

async function fetchBarsInner(symbol: string, range: YahooRange): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo Finance ${res.status}: ${text}`);
  }

  const data = (await res.json()) as YahooResult;

  if (data.chart.error) {
    throw new Error(`Yahoo Finance error: ${data.chart.error.description}`);
  }

  const result = data.chart.result[0];
  if (!result) {
    throw new Error(`Yahoo Finance: no data for ${symbol}`);
  }

  const quote = result.indicators.quote[0];
  const timestamps = result.timestamp;
  const bars: Bar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.close[i] == null) continue;
    bars.push({
      t: timestamps[i], // already unix seconds
      o: quote.open[i],
      h: quote.high[i],
      l: quote.low[i],
      c: quote.close[i],
      v: quote.volume[i],
    });
  }

  return bars;
}
