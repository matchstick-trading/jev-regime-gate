import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { OpenCandleFeed, OpenCandleRecord } from './types.js';

const URL = 'https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=3y&interval=1d';

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
  };
}

export async function fetchSPY(): Promise<OpenCandleFeed> {
  const res = await fetch(URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as YahooResult;
  const result = data.chart.result[0];
  const quote = result.indicators.quote[0];
  const timestamps = result.timestamp;

  const candles: OpenCandleRecord[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.close[i] == null) continue;
    candles.push({
      version: 1,
      vendor: 'yahoo',
      timestamp: timestamps[i],
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i],
      meta: {},
    });
  }

  const feed: OpenCandleFeed = {
    version: 1,
    vendor: 'yahoo',
    symbol: 'SPY',
    interval: '1d',
    candles,
    startTime: candles[0].timestamp,
    endTime: candles[candles.length - 1].timestamp,
  };

  return feed;
}

async function main() {
  console.log('Fetching 3 years of SPY daily data from Yahoo Finance...');
  const feed = await fetchSPY();
  console.log(`Got ${feed.candles.length} bars`);

  if (!existsSync('fixtures')) mkdirSync('fixtures', { recursive: true });
  writeFileSync('fixtures/spy-daily.json', JSON.stringify(feed, null, 2));
  console.log('Saved to fixtures/spy-daily.json');
}

const isDirectRun = process.argv[1]?.endsWith('fetch-data.ts');
if (isDirectRun) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
