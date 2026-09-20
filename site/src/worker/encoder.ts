import type { Bar, BarFeatures } from './types';

// --- bucketing functions (thresholds copied verbatim from src/encoder.ts) ---

function bucketReturn(ret: number): string {
  if (ret > 0.02) return 'strong_up';
  if (ret > 0.005) return 'up';
  if (ret > -0.005) return 'flat';
  if (ret > -0.02) return 'down';
  return 'strong_down';
}

function bucketVolRatio(ratio: number): string {
  if (ratio < 0.7) return 'compressed';
  if (ratio < 1.3) return 'normal';
  if (ratio < 2.0) return 'elevated';
  return 'extreme';
}

function bucketTrendPersistence(upCount: number, total: number): string {
  const ratio = upCount / total;
  if (ratio >= 0.8) return 'strong_up';
  if (ratio >= 0.6) return 'weak_up';
  if (ratio >= 0.4) return 'mixed';
  if (ratio >= 0.2) return 'weak_down';
  return 'strong_down';
}

function bucketAtrExpansion(ratio: number): string {
  if (ratio < 0.8) return 'contracting';
  if (ratio < 1.2) return 'flat';
  if (ratio < 1.8) return 'expanding';
  return 'spiking';
}

function bucketPriceVsSma(price: number, sma: number): string {
  const pct = (price - sma) / sma;
  if (pct > 0.05) return 'well_above';
  if (pct > 0.01) return 'above';
  if (pct > -0.01) return 'near';
  if (pct > -0.05) return 'below';
  return 'well_below';
}

// --- helper functions ---

function sma(bars: Bar[], period: number): number {
  const slice = bars.slice(-period);
  return slice.reduce((s, b) => s + b.c, 0) / slice.length;
}

function realizedVol(bars: Bar[], period: number): number {
  const slice = bars.slice(-period);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i].c / slice[i - 1].c));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252);
}

function atr(bars: Bar[], period: number): number {
  const slice = bars.slice(-period - 1);
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const tr = Math.max(
      slice[i].h - slice[i].l,
      Math.abs(slice[i].h - slice[i - 1].c),
      Math.abs(slice[i].l - slice[i - 1].c),
    );
    sum += tr;
  }
  return sum / period;
}

// --- public API ---

export const MIN_LOOKBACK = 60;

/**
 * Encode the bar at `index` into bucketed features, using bars[0..index]
 * as lookback context. Returns null if fewer than MIN_LOOKBACK bars
 * precede the target.
 */
export function encodeBar(bars: Bar[], index: number): BarFeatures | null {
  if (index < MIN_LOOKBACK) return null;

  const window = bars.slice(0, index + 1);
  const current = window[window.length - 1];
  const prev = window[window.length - 2];

  const ret1d = (current.c - prev.c) / prev.c;
  const fiveDayAgo = window[window.length - 6];
  const ret5d = fiveDayAgo ? (current.c - fiveDayAgo.c) / fiveDayAgo.c : ret1d;

  const vol20 = realizedVol(window, 20);
  const vol60 = realizedVol(window, 60);
  const volRatio = vol60 > 0 ? vol20 / vol60 : 1;

  const last10 = window.slice(-10);
  let upCount = 0;
  for (const bar of last10) {
    if (bar.c > bar.o) upCount++;
  }

  const atr14 = atr(window, 14);
  const atr50 = atr(window, 50);
  const atrRatio = atr50 > 0 ? atr14 / atr50 : 1;

  const sma50 = sma(window, 50);

  return {
    returns_1d: bucketReturn(ret1d),
    returns_5d: bucketReturn(ret5d),
    vol_vs_baseline: bucketVolRatio(volRatio),
    trend_persistence: bucketTrendPersistence(upCount, last10.length),
    atr_expansion: bucketAtrExpansion(atrRatio),
    price_vs_sma: bucketPriceVsSma(current.c, sma50),
  };
}

/** Serialize features to the JSON string that Jev expects as `state`. */
export function formatState(features: BarFeatures): string {
  return JSON.stringify(features);
}
