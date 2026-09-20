import type { OpenCandleRecord, BacktestResult, GateDecision } from './types.js';

interface BarSignal {
  index: number;
  smaFast: number;
  smaSlow: number;
  longSignal: boolean;
}

function computeSMA(bars: OpenCandleRecord[], endIndex: number, period: number): number {
  const start = Math.max(0, endIndex - period + 1);
  const slice = bars.slice(start, endIndex + 1);
  return slice.reduce((s, b) => s + b.close, 0) / slice.length;
}

function generateSignals(bars: OpenCandleRecord[]): BarSignal[] {
  const signals: BarSignal[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < 50) {
      signals.push({ index: i, smaFast: 0, smaSlow: 0, longSignal: false });
      continue;
    }
    const smaFast = computeSMA(bars, i, 20);
    const smaSlow = computeSMA(bars, i, 50);
    signals.push({ index: i, smaFast, smaSlow, longSignal: smaFast > smaSlow });
  }
  return signals;
}

function computeSharpe(returns: number[]): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

export function runBacktest(
  bars: OpenCandleRecord[],
  label: string,
  getGate: (index: number) => { decision: GateDecision; sizeFactor: number } | null,
): BacktestResult {
  const signals = generateSignals(bars);
  let equity = 100_000;
  const equityCurve: { timestamp: number; equity: number }[] = [];
  const dailyReturns: number[] = [];
  let peakEquity = equity;
  let maxDrawdown = 0;
  let wins = 0;
  let trades = 0;
  let exposedBars = 0;
  let position = 0;
  let entryPrice = 0;

  for (let i = 50; i < bars.length; i++) {
    const signal = signals[i];
    const bar = bars[i];
    const prevEquity = equity;

    if (position > 0) {
      const ret = (bar.close - bars[i - 1].close) / bars[i - 1].close;
      equity += equity * position * ret;
      exposedBars++;
    }

    const dailyRet = (equity - prevEquity) / prevEquity;
    dailyReturns.push(dailyRet);

    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    equityCurve.push({ timestamp: bar.timestamp, equity });

    const gate = getGate(i);
    let targetPosition = signal.longSignal ? 1.0 : 0;

    if (gate && targetPosition > 0) {
      targetPosition *= gate.sizeFactor;
    }

    if (targetPosition !== position) {
      if (position > 0 && targetPosition === 0) {
        const tradeReturn = (bar.close - entryPrice) / entryPrice;
        if (tradeReturn > 0) wins++;
        trades++;
      }
      if (targetPosition > 0 && position === 0) {
        entryPrice = bar.close;
      }
      position = targetPosition;
    }
  }

  if (position > 0) {
    const lastBar = bars[bars.length - 1];
    const tradeReturn = (lastBar.close - entryPrice) / entryPrice;
    if (tradeReturn > 0) wins++;
    trades++;
  }

  const totalBars = bars.length - 50;

  return {
    label,
    sharpe: computeSharpe(dailyReturns),
    maxDrawdown,
    totalReturn: (equity - 100_000) / 100_000,
    winRate: trades > 0 ? wins / trades : 0,
    tradeCount: trades,
    exposure: totalBars > 0 ? exposedBars / totalBars : 0,
    equityCurve,
  };
}
