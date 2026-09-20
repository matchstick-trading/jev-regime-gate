import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  OpenCandleFeed,
  BacktestConfig,
  JevMeta,
  BarFeatures,
  JevResponse,
  GateDecision,
} from './types.js';
import { encodeBar, formatState, MIN_LOOKBACK } from './encoder.js';
import { classify, getCostSummary } from './jev-client.js';
import { applyGate } from './gate.js';
import { runBacktest } from './backtest.js';
import { fetchSPY } from './fetch-data.js';

function loadEnv(): Record<string, string> {
  const envPath = resolve(process.cwd(), '.env');
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const config: BacktestConfig = {
  symbol: 'SPY',
  strategy: 'SMA Crossover (20/50)',
  favoredRegimes: ['trend_up', 'trend_down'],
  confidenceThreshold: 0.60,
  halfSizeThreshold: 0.45,
};

function printTable(ungated: ReturnType<typeof runBacktest>, gated: ReturnType<typeof runBacktest>) {
  const pct = (n: number) => (n * 100).toFixed(2) + '%';
  const fmt = (n: number) => n.toFixed(3);

  console.log('\n┌─────────────────────┬──────────────┬──────────────┐');
  console.log('│ Metric              │ Ungated      │ Gated        │');
  console.log('├─────────────────────┼──────────────┼──────────────┤');
  const rows: [string, string, string][] = [
    ['Total Return', pct(ungated.totalReturn), pct(gated.totalReturn)],
    ['Sharpe Ratio', fmt(ungated.sharpe), fmt(gated.sharpe)],
    ['Max Drawdown', pct(ungated.maxDrawdown), pct(gated.maxDrawdown)],
    ['Win Rate', pct(ungated.winRate), pct(gated.winRate)],
    ['Trade Count', String(ungated.tradeCount), String(gated.tradeCount)],
    ['Exposure', pct(ungated.exposure), pct(gated.exposure)],
  ];
  for (const [label, u, g] of rows) {
    console.log(`│ ${label.padEnd(19)} │ ${u.padEnd(12)} │ ${g.padEnd(12)} │`);
  }
  console.log('└─────────────────────┴──────────────┴──────────────┘');
}

async function main() {
  const env = loadEnv();
  const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';

  if (!existsSync('fixtures')) mkdirSync('fixtures', { recursive: true });

  let feed: OpenCandleFeed;
  const dataPath = 'fixtures/spy-daily.json';

  if (existsSync(dataPath)) {
    console.log('Loading cached SPY data...');
    feed = JSON.parse(readFileSync(dataPath, 'utf-8')) as OpenCandleFeed;
  } else {
    console.log('Fetching SPY data...');
    feed = await fetchSPY();
    writeFileSync(dataPath, JSON.stringify(feed, null, 2));
    console.log(`Saved ${feed.candles.length} bars to ${dataPath}`);
  }

  const bars = feed.candles;
  console.log(`Processing ${bars.length} bars...`);

  const gateDecisions: Map<number, { decision: GateDecision; sizeFactor: number }> = new Map();
  let apiCalls = 0;
  let cacheHits = 0;

  for (let i = MIN_LOOKBACK; i < bars.length; i++) {
    const features = encodeBar(bars, i);
    if (!features) continue;

    (bars[i].meta as Record<string, unknown>).features = features;

    const state = formatState(features);
    let jevResponse: JevResponse;

    if (apiKey) {
      jevResponse = await classify(state, config.strategy, apiKey);
      apiCalls++;
    } else {
      jevResponse = {
        model: 'typesafe/jev-1.13',
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

    const gate = applyGate(jevResponse, config);
    gateDecisions.set(i, gate);

    const probabilities = jevResponse.answers.regime_type.probabilities;
    const maxP = Math.max(...Object.values(probabilities));

    const jevMeta: JevMeta = {
      regime_type: jevResponse.answers.regime_type.choice,
      regime_probabilities: probabilities,
      regime_max_p: maxP,
      regime_change_likely: jevResponse.answers.regime_change_likely.noul,
      strategy_viable: jevResponse.answers.strategy_viable.noul,
      gate_decision: gate.decision,
      size_factor: gate.sizeFactor,
      input_tokens: jevResponse.usage?.input_tokens,
    };

    (bars[i].meta as Record<string, unknown>).jev = jevMeta;
  }

  const ungated = runBacktest(bars, 'Ungated SMA 20/50', () => ({
    decision: 'trade' as GateDecision,
    sizeFactor: 1.0,
  }));

  const gated = runBacktest(bars, 'Jev-Gated SMA 20/50', (index) => {
    return gateDecisions.get(index) ?? { decision: 'trade' as GateDecision, sizeFactor: 1.0 };
  });

  printTable(ungated, gated);

  const cost = getCostSummary();
  if (cost.totalInputTokens > 0) {
    console.log(`\nJev API: ${apiCalls} calls, ${cost.totalInputTokens} input tokens, $${cost.estimatedCost.toFixed(4)} estimated cost`);
  } else if (!apiKey) {
    console.log('\nNo OPENROUTER_API_KEY set — ran with default (uniform) Jev responses.');
    console.log('Add your key to .env to get real regime classifications.');
  }

  const classifiedFeed: OpenCandleFeed = { ...feed, candles: bars };
  writeFileSync('fixtures/spy-daily-classified.json', JSON.stringify(classifiedFeed, null, 2));
  console.log('Saved classified feed to fixtures/spy-daily-classified.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
