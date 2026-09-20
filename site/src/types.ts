export type RegimeType = 'trend_up' | 'trend_down' | 'range' | 'chop' | 'unclear';
export type GateDecision = 'compatible' | 'not_compatible' | 'mixed';

export interface BarFeatures {
  returns_1d: string;
  returns_5d: string;
  vol_vs_baseline: string;
  trend_persistence: string;
  atr_expansion: string;
  price_vs_sma: string;
}

export interface ScreenerBar {
  t: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  regime: RegimeType;
  maxP: number;
  probs: Record<string, number>;
  changeLikely: number;
  viable: number;
  gate: GateDecision;
  size: number;
  feat: BarFeatures;
}

export interface ScreenerFeed {
  symbol: string;
  interval: string;
  vendor: string;
  bars: ScreenerBar[];
}

/* --- Progressive screener types --- */

export interface SearchResult {
  symbol: string;
  name: string;
}

export interface TodayResult {
  symbol: string;
  name: string;
  date: string;
  close: number;
  change: number;
  regime: RegimeType;
  maxP: number;
  probs: Record<string, number>;
  changeLikely: number;
  viable: number;
  gate: GateDecision;
  features: BarFeatures;
}

/** Raw OHLCV bar for BYOD uploads */
export interface RawBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type LoadingState = 'idle' | 'searching' | 'classifying' | 'history';
export type HistoryRange = '1y' | '3y';
