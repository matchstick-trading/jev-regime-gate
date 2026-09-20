export type RegimeType = 'trend_up' | 'trend_down' | 'range' | 'chop' | 'unclear';
export type GateDecision = 'trade' | 'stand_down' | 'half_size';

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
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
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
