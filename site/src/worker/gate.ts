import type { GateDecision, JevResponse, RegimeType } from './types';

export interface GateResult {
  decision: GateDecision;
  sizeFactor: number;
}

export function maxProbability(probabilities: Record<string, number>): number {
  return Math.max(...Object.values(probabilities));
}

export function applyGate(jev: JevResponse): GateResult {
  const regime = jev.answers.regime_type;
  const regimeType = regime.choice as RegimeType;
  const maxP = maxProbability(regime.probabilities);
  const changeLikely = jev.answers.regime_change_likely.noul;
  const viable = jev.answers.strategy_viable.noul;

  if (viable < 0.4) {
    return { decision: 'not_compatible', sizeFactor: 0 };
  }

  if (changeLikely > 0.6) {
    return { decision: 'not_compatible', sizeFactor: 0 };
  }

  const favoredRegimes: RegimeType[] = ['trend_up', 'trend_down'];
  if (!favoredRegimes.includes(regimeType)) {
    return { decision: 'not_compatible', sizeFactor: 0 };
  }

  if (maxP >= 0.60) {
    return { decision: 'compatible', sizeFactor: 1.0 };
  }

  if (maxP >= 0.45) {
    return { decision: 'mixed', sizeFactor: 0.5 };
  }

  return { decision: 'not_compatible', sizeFactor: 0 };
}
