import type { GateDecision, JevResponse, RegimeType } from './types';

export interface GateResult {
  decision: GateDecision;
  sizeFactor: number;
}

function maxProbability(probabilities: Record<string, number>): number {
  return Math.max(...Object.values(probabilities));
}

/**
 * Apply the regime gate to a Jev classification response.
 *
 * Uses hardcoded thresholds matching the screener spec:
 *   - viable < 0.4            -> stand_down
 *   - changeLikely > 0.6      -> stand_down
 *   - regime not trend_up/down -> stand_down
 *   - maxP >= 0.60            -> trade
 *   - maxP >= 0.45            -> half_size
 *   - else                    -> stand_down
 */
export function applyGate(jev: JevResponse): GateResult {
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

  const favoredRegimes: RegimeType[] = ['trend_up', 'trend_down'];
  if (!favoredRegimes.includes(regimeType)) {
    return { decision: 'stand_down', sizeFactor: 0 };
  }

  if (maxP >= 0.60) {
    return { decision: 'trade', sizeFactor: 1.0 };
  }

  if (maxP >= 0.45) {
    return { decision: 'half_size', sizeFactor: 0.5 };
  }

  return { decision: 'stand_down', sizeFactor: 0 };
}
