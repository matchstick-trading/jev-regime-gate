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

/** Compact bar shape used throughout the worker API. */
export interface Bar {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ScreenerBar extends Bar {
  regime: RegimeType;
  maxP: number;
  probs: Record<string, number>;
  changeLikely: number;
  viable: number;
  gate: GateDecision;
  size: number;
  feat: BarFeatures;
}

export interface TickerEntry {
  id: string;
  symbol: string;
  name: string;
}

// --- Jev API response types ---

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
  confidence?: number;
}

export interface JevResponse {
  model: string;
  answers: {
    regime_type: JevChoiceAnswer;
    regime_change_likely: JevNoulAnswer;
    strategy_viable: JevNoulAnswer;
  };
  usage?: { input_tokens: number; output_tokens: number; cost?: number };
}

// --- Worker environment bindings ---

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  JEV_CACHE: KVNamespace;
  OPENROUTER_API_KEY: string;
}
