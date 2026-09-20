import type { RegimeType, GateDecision, BarFeatures } from './types';

const REGIME_COLORS: Record<RegimeType, { bg: string; text: string; label: string }> = {
  trend_up: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Trend Up' },
  trend_down: { bg: 'bg-matchstick/15', text: 'text-matchstick', label: 'Trend Down' },
  range: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Range' },
  chop: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Chop' },
  unclear: { bg: 'bg-zinc-500/15', text: 'text-zinc-400', label: 'Unclear' },
};

const GATE_COLORS: Record<GateDecision, { bg: string; text: string; label: string }> = {
  trade: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Trade' },
  half_size: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Half' },
  stand_down: { bg: 'bg-zinc-600/15', text: 'text-zinc-500', label: 'Stand Down' },
};

export function RegimeBadge({ regime }: { regime: RegimeType }) {
  const c = REGIME_COLORS[regime] ?? REGIME_COLORS.unclear;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wide ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

export function GateBadge({ gate }: { gate: GateDecision }) {
  const c = GATE_COLORS[gate] ?? GATE_COLORS.stand_down;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wide ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.7
      ? 'bg-emerald-500'
      : value >= 0.5
        ? 'bg-amber-500'
        : 'bg-zinc-600';

  return (
    <div className="flex items-center gap-1.5" title={`${pct}% max probability`}>
      <div className="w-12 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-400 w-7 text-right">{pct}%</span>
    </div>
  );
}

const FEATURE_COLORS: Record<string, string> = {
  strong_up: 'text-emerald-400',
  up: 'text-emerald-500/70',
  flat: 'text-zinc-500',
  near: 'text-zinc-500',
  normal: 'text-zinc-500',
  down: 'text-matchstick/70',
  strong_down: 'text-matchstick',
  elevated: 'text-amber-400',
  extreme: 'text-red-400',
  compressed: 'text-blue-400',
  above: 'text-emerald-400',
  below: 'text-matchstick',
  weak_up: 'text-emerald-500/50',
  weak_down: 'text-matchstick/50',
  strong_up_persist: 'text-emerald-400',
  strong_down_persist: 'text-matchstick',
  expanding: 'text-amber-400',
  contracting: 'text-blue-400',
};

const FEATURE_LABELS: Record<string, string> = {
  returns_1d: '1d',
  returns_5d: '5d',
  vol_vs_baseline: 'Vol',
  trend_persistence: 'Trend',
  atr_expansion: 'ATR',
  price_vs_sma: 'SMA',
};

export function FeaturePills({ features }: { features: BarFeatures }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(features).map(([key, val]) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono ${FEATURE_COLORS[val] ?? 'text-zinc-400'}`}
        >
          <span className="text-zinc-600">{FEATURE_LABELS[key] ?? key}</span>
          {val}
        </span>
      ))}
    </div>
  );
}
