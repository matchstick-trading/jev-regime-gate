import type { JevResponse, BacktestConfig, GateDecision, RegimeType } from './types.js';

export interface GateResult {
  decision: GateDecision;
  sizeFactor: number;
}

function maxProbability(probabilities: Record<string, number>): number {
  return Math.max(...Object.values(probabilities));
}

export function applyGate(jev: JevResponse, config: BacktestConfig): GateResult {
  const regime = jev.answers.regime_type;
  const regimeType = regime.choice as RegimeType;
  const maxP = maxProbability(regime.probabilities);
  const changeLikely = jev.answers.regime_change_likely.noul;
  const viable = jev.answers.strategy_viable.noul;

  if (viable < 0.4) {
    return { decision: 'stand_down', sizeFactor: 0 };
  }

  if (changeLikely > 0.6) {
    return { decision: 'stand_down', sizeFactor: 0 };
  }

  const regimeMatch = config.favoredRegimes.includes(regimeType);

  if (!regimeMatch) {
    return { decision: 'stand_down', sizeFactor: 0 };
  }

  if (maxP >= config.confidenceThreshold) {
    return { decision: 'trade', sizeFactor: 1.0 };
  }

  if (maxP >= config.halfSizeThreshold) {
    return { decision: 'half_size', sizeFactor: 0.5 };
  }

  return { decision: 'stand_down', sizeFactor: 0 };
}
