import type { TodayResult, RegimeType } from './types';
import { RegimeBadge, GateBadge, ConfidenceBar, FeaturePills } from './components';

const REGIME_BAR_COLORS: Record<RegimeType, string> = {
  trend_up: 'bg-emerald-500',
  trend_down: 'bg-matchstick',
  range: 'bg-blue-500',
  chop: 'bg-amber-500',
  unclear: 'bg-zinc-500',
};

const REGIME_LABELS: Record<RegimeType, string> = {
  trend_up: 'Trend Up',
  trend_down: 'Trend Down',
  range: 'Range',
  chop: 'Chop',
  unclear: 'Unclear',
};

interface TodayCardProps {
  result: TodayResult;
  onViewHistory: () => void;
}

export function TodayCard({ result, onViewHistory }: TodayCardProps) {
  const changePositive = result.change >= 0;

  return (
    <div className="w-full max-w-2xl mx-auto rounded-lg border border-border bg-surface/60 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/50 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-white font-semibold text-xl tracking-tight">{result.symbol}</h2>
            <RegimeBadge regime={result.regime} />
          </div>
          {result.name && (
            <p className="text-zinc-500 text-xs mt-0.5">{result.name}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-white font-mono text-lg">${formatPrice(result.close)}</div>
          <div className={`font-mono text-xs ${changePositive ? 'text-emerald-400' : 'text-matchstick'}`}>
            {changePositive ? '+' : ''}{result.change.toFixed(2)}%
          </div>
          <div className="text-zinc-600 text-xs font-mono mt-0.5">{result.date}</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCell label="Confidence" value={<ConfidenceBar value={result.maxP} />} />
        <MetricCell
          label="Gate"
          value={<GateBadge gate={result.gate} />}
        />
        <MetricCell
          label="Change Likely"
          value={
            <span className={`font-mono text-sm ${result.changeLikely > 0.5 ? 'text-amber-400' : 'text-zinc-400'}`}>
              {(result.changeLikely * 100).toFixed(0)}%
            </span>
          }
        />
        <MetricCell
          label="Viable"
          value={
            <span className={`font-mono text-sm ${result.viable > 0.5 ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {(result.viable * 100).toFixed(0)}%
            </span>
          }
        />
      </div>

      {/* Probability distribution */}
      <div className="px-5 pb-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-2">
          Regime Probabilities
        </div>
        <ProbabilityBars probs={result.probs} maxP={result.maxP} />
      </div>

      {/* Features */}
      <div className="px-5 pb-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-2">
          Features
        </div>
        <FeaturePills features={result.features} />
      </div>

      {/* Actions */}
      <div className="px-5 py-3 border-t border-border/50 flex justify-end">
        <button
          type="button"
          onClick={onViewHistory}
          className="px-4 py-2 rounded-lg bg-zinc-800 border border-border text-zinc-300 text-sm font-medium
            hover:bg-zinc-700 hover:border-zinc-600 transition-colors"
        >
          View History
        </button>
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-1">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function ProbabilityBars({ probs, maxP }: { probs: Record<string, number>; maxP: number }) {
  const sorted = Object.entries(probs).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-1.5">
      {sorted.map(([regime, prob]) => {
        const pct = Math.round(prob * 100);
        const isMax = prob === maxP;
        return (
          <div key={regime} className="flex items-center gap-2">
            <span className={`w-16 text-xs font-mono text-right ${isMax ? 'text-white' : 'text-zinc-600'}`}>
              {REGIME_LABELS[regime as RegimeType] ?? regime}
            </span>
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  REGIME_BAR_COLORS[regime as RegimeType] ?? 'bg-zinc-500'
                } ${isMax ? 'opacity-100' : 'opacity-40'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`w-8 text-xs font-mono text-right ${isMax ? 'text-white' : 'text-zinc-600'}`}>
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Skeleton shown while classification is in progress */
export function TodayCardSkeleton() {
  return (
    <div className="w-full max-w-2xl mx-auto rounded-lg border border-border bg-surface/60 overflow-hidden animate-pulse">
      <div className="px-5 py-4 border-b border-border/50 flex items-start justify-between gap-4">
        <div>
          <div className="h-6 w-24 bg-zinc-800 rounded" />
          <div className="h-3 w-40 bg-zinc-800/50 rounded mt-2" />
        </div>
        <div className="text-right">
          <div className="h-6 w-20 bg-zinc-800 rounded ml-auto" />
          <div className="h-3 w-12 bg-zinc-800/50 rounded mt-2 ml-auto" />
        </div>
      </div>
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-3 w-14 bg-zinc-800/50 rounded mb-2" />
            <div className="h-5 w-16 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
      <div className="px-5 pb-4 space-y-2">
        <div className="h-3 w-28 bg-zinc-800/50 rounded" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-2 bg-zinc-800 rounded-full" style={{ width: `${80 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
