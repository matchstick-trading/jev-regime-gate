export type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };

// --- OpenCandle types (from matchstick-trading/adapter-opencandle) ---

export interface OpenCandleRecord {
  version: 1;
  vendor: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  meta: Record<string, JsonValue>;
}

export interface OpenCandleFeed {
  version: 1;
  vendor: string;
  symbol: string;
  interval: string;
  candles: OpenCandleRecord[];
  startTime: number;
  endTime: number;
}

// --- Jev decision types ---

export type RegimeType = 'trend_up' | 'trend_down' | 'range' | 'chop' | 'unclear';

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  /**
   * NOT the raw probability of `choice`. Measured directly against this same
   * endpoint (openrouter.ai/api/alpha/decisions, model typesafe/jev-1.13) in
   * the sibling power-spec-directory project (2026-09-21, across 5 recorded
   * decisions x 5 Choice questions): this field is a chance-corrected
   * agreement index, confidence = (p_max - 1/k) / (1 - 1/k), where k is the
   * option count -- not probabilities[choice]. A fixed threshold compared
   * against it is therefore k-dependent: the same threshold is stricter on
   * `regime_type` (5 options) than it would be on a 2-option question. If
   * this ever gates a real decision (today it is display-only -- see
   * site/src/worker/jev.ts's pass-through to the frontend), compare against
   * `probabilities[choice]` directly instead of this field, per the
   * "Jev Engineering" review's guidance (sec 3.4): "A threshold becomes
   * useful only after its observed error and coverage are measured on the
   * application."
   */
  confidence: number;
}

export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
  confidence?: number;
}

export interface JevScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
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

// --- Per-bar metadata stored in OpenCandle.meta ---

export interface BarFeatures {
  returns_1d: string;
  returns_5d: string;
  vol_vs_baseline: string;
  trend_persistence: string;
  atr_expansion: string;
  price_vs_sma: string;
}

export type GateDecision = 'trade' | 'stand_down' | 'half_size';

export interface JevMeta {
  regime_type: string;
  regime_probabilities: Record<string, number>;
  regime_max_p: number;
  regime_change_likely: number;
  strategy_viable: number;
  gate_decision: GateDecision;
  size_factor: number;
  input_tokens?: number;
}

// --- Backtest types ---

export interface BacktestConfig {
  symbol: string;
  strategy: string;
  favoredRegimes: RegimeType[];
  confidenceThreshold: number;
  halfSizeThreshold: number;
}

export interface BacktestResult {
  label: string;
  sharpe: number;
  maxDrawdown: number;
  totalReturn: number;
  winRate: number;
  tradeCount: number;
  exposure: number;
  equityCurve: { timestamp: number; equity: number }[];
}
