import { useEffect, useState } from 'react';
import type { ScreenerFeed, ScreenerBar } from './types';
import { RegimeBadge, GateBadge, ConfidenceBar, FeaturePills } from './components';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

function pctChange(bar: ScreenerBar, prev?: ScreenerBar): number | null {
  if (!prev) return null;
  return ((bar.c - prev.c) / prev.c) * 100;
}

export default function App() {
  const [feed, setFeed] = useState<ScreenerFeed | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/spy-screener.json')
      .then((r) => r.json())
      .then((d: ScreenerFeed) => setFeed(d));
  }, []);

  if (!feed) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-zinc-500 font-mono text-sm">Loading screener data...</div>
      </div>
    );
  }

  const bars = [...feed.bars].reverse();
  const latest = bars[0];
  const regimeCounts: Record<string, number> = {};
  const gateCounts: Record<string, number> = {};
  for (const b of feed.bars) {
    regimeCounts[b.regime] = (regimeCounts[b.regime] || 0) + 1;
    gateCounts[b.gate] = (gateCounts[b.gate] || 0) + 1;
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-white font-semibold text-lg tracking-tight">
              Jev Regime Screener
            </h1>
            <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-border font-mono">
              {feed.symbol}
            </span>
            <span className="text-xs text-zinc-600 font-mono">{feed.interval}</span>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs text-zinc-500">
            <span>
              Powered by{' '}
              <a
                href="https://typesafe.ai"
                className="text-emerald-500 hover:text-emerald-400 transition-colors"
                target="_blank"
                rel="noopener"
              >
                Jev
              </a>
            </span>
            <span className="text-zinc-700">|</span>
            <a
              href="https://github.com/matchstick-trading/opencandle"
              className="text-zinc-400 hover:text-zinc-300 transition-colors"
              target="_blank"
              rel="noopener"
            >
              OpenCandle
            </a>
          </div>
        </div>
      </header>

      {/* Summary strip */}
      <div className="border-b border-border bg-surface/30 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4 sm:gap-6 text-xs min-w-max sm:min-w-0">
          <div>
            <span className="text-zinc-500">Latest</span>{' '}
            <span className="text-white font-mono font-medium">${formatPrice(latest.c)}</span>
          </div>
          <div>
            <span className="text-zinc-500">Regime</span>{' '}
            <RegimeBadge regime={latest.regime} />
          </div>
          <div>
            <span className="text-zinc-500">Conf</span>{' '}
            <span className="text-white font-mono">{(latest.maxP * 100).toFixed(0)}%</span>
          </div>
          <div>
            <span className="text-zinc-500">Gate</span> <GateBadge gate={latest.gate} />
          </div>
          <div className="ml-auto text-zinc-600 whitespace-nowrap">
            {feed.bars.length} sessions &middot; {feed.vendor} &middot; <span className="hidden sm:inline">Research experiment, n</span><span className="sm:hidden">N</span>ot investment advice
          </div>
        </div>
      </div>

      {/* Data grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-surface text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-3 py-2.5 text-left font-medium">Date</th>
                <th className="px-3 py-2.5 text-right font-medium">Close</th>
                <th className="px-3 py-2.5 text-right font-medium">Chg%</th>
                <th className="px-3 py-2.5 text-right font-medium">Vol</th>
                <th className="px-3 py-2.5 text-center font-medium">Regime</th>
                <th className="px-3 py-2.5 text-center font-medium">Conf</th>
                <th className="px-3 py-2.5 text-center font-medium">Change?</th>
                <th className="px-3 py-2.5 text-center font-medium">Viable?</th>
                <th className="px-3 py-2.5 text-center font-medium">Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {bars.map((bar, i) => {
                const prevBar = i < bars.length - 1 ? bars[i + 1] : undefined;
                const chg = pctChange(bar, prevBar);
                const isExpanded = expanded === bar.t;

                return (
                  <ScreenerRow
                    key={bar.t}
                    bar={bar}
                    chg={chg}
                    isExpanded={isExpanded}
                    onToggle={() => setExpanded(isExpanded ? null : bar.t)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-6 p-4 rounded-lg border border-border bg-surface/30 text-xs text-zinc-500">
          <div className="flex flex-wrap gap-6">
            <div>
              <span className="text-zinc-400 font-medium">Regimes: </span>
              <RegimeBadge regime="trend_up" />{' '}
              <RegimeBadge regime="trend_down" />{' '}
              <RegimeBadge regime="range" />{' '}
              <RegimeBadge regime="chop" />{' '}
              <RegimeBadge regime="unclear" />
            </div>
            <div>
              <span className="text-zinc-400 font-medium">Gates: </span>
              <GateBadge gate="trade" />{' '}
              <GateBadge gate="half_size" />{' '}
              <GateBadge gate="stand_down" />
            </div>
            <div className="sm:ml-auto">
              <span className="text-zinc-400 font-medium">Conf</span> = max probability from Jev distribution
            </div>
          </div>
        </div>

        <footer className="mt-4 pb-8 text-center text-xs text-zinc-600">
          <a
            href="https://github.com/matchstick-trading/jev-regime-gate"
            className="hover:text-zinc-400 transition-colors"
            target="_blank"
            rel="noopener"
          >
            matchstick-trading/jev-regime-gate
          </a>
          {' '}&middot; Classifications via{' '}
          <a href="https://typesafe.ai" className="hover:text-zinc-400 transition-colors" target="_blank" rel="noopener">
            TypeSafe Jev
          </a>
          {' '}&middot; Data stored in{' '}
          <a
            href="https://github.com/matchstick-trading/opencandle"
            className="hover:text-zinc-400 transition-colors"
            target="_blank"
            rel="noopener"
          >
            OpenCandle
          </a>{' '}
          meta fields
        </footer>
      </main>
    </div>
  );
}

function ScreenerRow({
  bar,
  chg,
  isExpanded,
  onToggle,
}: {
  bar: ScreenerBar;
  chg: number | null;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="hover:bg-zinc-900/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-zinc-400 font-mono text-xs">{formatDate(bar.t)}</td>
        <td className="px-3 py-2 text-right text-white font-mono">${formatPrice(bar.c)}</td>
        <td className="px-3 py-2 text-right font-mono">
          {chg !== null ? (
            <span className={chg >= 0 ? 'text-emerald-400' : 'text-matchstick'}>
              {chg >= 0 ? '+' : ''}
              {chg.toFixed(2)}%
            </span>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-zinc-500 font-mono text-xs">
          {formatVolume(bar.v)}
        </td>
        <td className="px-3 py-2 text-center">
          <RegimeBadge regime={bar.regime} />
        </td>
        <td className="px-3 py-2 text-center">
          <ConfidenceBar value={bar.maxP} />
        </td>
        <td className="px-3 py-2 text-center font-mono text-xs">
          <span className={bar.changeLikely > 0.5 ? 'text-amber-400' : 'text-zinc-500'}>
            {(bar.changeLikely * 100).toFixed(0)}%
          </span>
        </td>
        <td className="px-3 py-2 text-center font-mono text-xs">
          <span className={bar.viable > 0.5 ? 'text-emerald-400' : 'text-zinc-500'}>
            {(bar.viable * 100).toFixed(0)}%
          </span>
        </td>
        <td className="px-3 py-2 text-center">
          <GateBadge gate={bar.gate} />
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-zinc-900/80">
          <td colSpan={9} className="px-4 py-3">
            <div className="flex flex-wrap gap-6 text-xs">
              <div>
                <div className="text-zinc-500 mb-1 uppercase tracking-wider font-medium">
                  Features
                </div>
                <FeaturePills features={bar.feat} />
              </div>
              <div>
                <div className="text-zinc-500 mb-1 uppercase tracking-wider font-medium">
                  Regime Probabilities
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                  {Object.entries(bar.probs)
                    .sort(([, a], [, b]) => b - a)
                    .map(([regime, prob]) => (
                      <span key={regime} className={prob === bar.maxP ? 'text-white' : 'text-zinc-600'}>
                        {regime.replace('_', ' ')}: {(prob * 100).toFixed(0)}%
                      </span>
                    ))}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 mb-1 uppercase tracking-wider font-medium">
                  OHLCV
                </div>
                <div className="font-mono text-zinc-400">
                  O:{formatPrice(bar.o)} H:{formatPrice(bar.h)} L:{formatPrice(bar.l)} C:{formatPrice(bar.c)}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
