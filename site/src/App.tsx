import { useState, useCallback } from 'react';
import type { TodayResult, ScreenerBar, RawBar, LoadingState, HistoryRange } from './types';
import { RegimeBadge, GateBadge, ConfidenceBar, FeaturePills } from './components';
import { SymbolSearch, QuickPicks } from './search';
import { TodayCard, TodayCardSkeleton } from './today-card';
import { BYOD } from './byod';
import { classifyToday, classifyBYOD, fetchHistory } from './api';

/* ── Formatting helpers ── */

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

const DISCLOSURE =
  'Experimental research output—not investment advice or a recommendation to buy, sell, hold, or size a position. ' +
  'This tool classifies bucketed patterns in recent end-of-day data. Percentages are model-output scores for the stated questions, ' +
  'not calibrated probabilities of future price movement, profit, or loss. ' +
  'Outputs may be inaccurate, stale, incomplete, or unavailable and should not be used as the basis for a trade.';

function Disclosure() {
  return (
    <p className="text-[10px] leading-relaxed text-zinc-600 max-w-2xl mx-auto mt-3">
      {DISCLOSURE}
    </p>
  );
}

/* ── App ── */

export default function App() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [today, setToday] = useState<TodayResult | null>(null);
  const [history, setHistory] = useState<ScreenerBar[] | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('1y');
  const [loading, setLoading] = useState<LoadingState>('idle');
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectSymbol = useCallback(async (sym: string) => {
    setSymbol(sym);
    setToday(null);
    setHistory(null);
    setError(null);
    setLoading('classifying');
    try {
      const result = await classifyToday(sym);
      setToday(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Classification failed');
    } finally {
      setLoading('idle');
    }
  }, []);

  const handleBYOD = useCallback(async (bars: RawBar[]) => {
    setSymbol('BYOD');
    setToday(null);
    setHistory(null);
    setError(null);
    setLoading('classifying');
    try {
      const result = await classifyBYOD(bars);
      setToday(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BYOD classification failed');
    } finally {
      setLoading('idle');
    }
  }, []);

  const handleViewHistory = useCallback(async () => {
    if (!symbol || symbol === 'BYOD') return;
    setLoading('history');
    setHistory([]);
    setHistoryTotal(0);
    setError(null);
    try {
      const bars = await fetchHistory(symbol, historyRange, (partial, total) => {
        setHistory([...partial]);
        setHistoryTotal(total);
      });
      setHistory(bars);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading('idle');
    }
  }, [symbol, historyRange]);

  const handleRangeChange = useCallback(async (range: HistoryRange) => {
    setHistoryRange(range);
    if (!symbol || symbol === 'BYOD') return;
    setLoading('history');
    setHistory([]);
    setHistoryTotal(0);
    setError(null);
    try {
      const bars = await fetchHistory(symbol, range, (partial, total) => {
        setHistory([...partial]);
        setHistoryTotal(total);
      });
      setHistory(bars);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading('idle');
    }
  }, [symbol]);

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-white font-semibold text-lg tracking-tight">
              Jev Regime Screener
            </h1>
            {symbol && symbol !== 'BYOD' && (
              <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-border font-mono">
                {symbol}
              </span>
            )}
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Search */}
        <div className="flex flex-col items-center gap-2">
          <SymbolSearch
            onSelect={handleSelectSymbol}
            loading={loading === 'searching' || loading === 'classifying'}
          />
          <BYOD onBars={handleBYOD} loading={loading === 'classifying'} />
        </div>

        {/* Phase 1: Empty state */}
        {!symbol && loading === 'idle' && (
          <div className="mt-8 text-center">
            <p className="text-zinc-500 text-sm max-w-md mx-auto">
              Type any ticker to see its Jev regime classification.
            </p>
            <p className="text-zinc-600 text-xs mt-2">
              Data from Yahoo Finance EOD &middot; Classified by TypeSafe Jev &middot; Not investment advice
            </p>
            <QuickPicks onSelect={handleSelectSymbol} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-6 max-w-2xl mx-auto px-4 py-3 rounded-lg border border-matchstick/30 bg-matchstick/5 text-matchstick text-sm font-mono text-center">
            {error}
          </div>
        )}

        {/* Phase 2: Classifying skeleton */}
        {loading === 'classifying' && (
          <div className="mt-6">
            <TodayCardSkeleton />
          </div>
        )}

        {/* Phase 2: Today's snapshot */}
        {today && loading !== 'classifying' && (
          <div className="mt-6">
            <TodayCard result={today} onViewHistory={handleViewHistory} />
            <Disclosure />
          </div>
        )}

        {/* Phase 3: History progress */}
        {loading === 'history' && (
          <div className="mt-6">
            <div className="flex items-center gap-3 justify-center">
              <div className="inline-flex items-center gap-2 text-zinc-500 text-sm font-mono">
                <div className="w-4 h-4 border-2 border-matchstick/30 border-t-matchstick rounded-full animate-spin" />
                {historyTotal > 0
                  ? `Classifying ${history?.length ?? 0} / ${historyTotal} bars…`
                  : 'Fetching bars…'}
              </div>
            </div>
            {historyTotal > 0 && (
              <div className="mt-2 max-w-md mx-auto h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-matchstick rounded-full transition-all duration-200 ease-out"
                  style={{ width: `${((history?.length ?? 0) / historyTotal) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Phase 3: History grid (visible during streaming and after) */}
        {history && history.length > 0 && (
          <div className="mt-6">
            {/* Range selector */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-zinc-500 text-xs font-medium">Range:</span>
              {(['1y', '3y'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleRangeChange(r)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    historyRange === r
                      ? 'bg-zinc-800 text-white border border-border'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
              <span className="ml-auto text-zinc-600 text-xs font-mono">
                {history.length} sessions
              </span>
            </div>

            <HistoryGrid bars={history} expanded={expanded} setExpanded={setExpanded} />
            <Disclosure />
          </div>
        )}

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
              <GateBadge gate="compatible" />{' '}
              <GateBadge gate="mixed" />{' '}
              <GateBadge gate="not_compatible" />
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

/* ── History Grid ── */

function HistoryGrid({
  bars,
  expanded,
  setExpanded,
}: {
  bars: ScreenerBar[];
  expanded: number | null;
  setExpanded: (t: number | null) => void;
}) {
  const sorted = [...bars].reverse();

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm min-w-[540px]">
        <thead>
          <tr className="bg-surface text-zinc-500 text-xs uppercase tracking-wider">
            <th className="px-3 py-2.5 text-left font-medium">Date</th>
            <th className="px-3 py-2.5 text-center font-medium">Regime</th>
            <th className="px-3 py-2.5 text-center font-medium">Conf</th>
            <th className="px-3 py-2.5 text-center font-medium">Change?</th>
            <th className="px-3 py-2.5 text-center font-medium">Viable?</th>
            <th className="px-3 py-2.5 text-center font-medium">Gate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sorted.map((bar) => {
            const isExpanded = expanded === bar.t;

            return (
              <ScreenerRow
                key={bar.t}
                bar={bar}
                isExpanded={isExpanded}
                onToggle={() => setExpanded(isExpanded ? null : bar.t)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Screener Row ── */

function ScreenerRow({
  bar,
  isExpanded,
  onToggle,
}: {
  bar: ScreenerBar;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="row-enter hover:bg-zinc-900/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-zinc-400 font-mono text-xs">{formatDate(bar.t)}</td>
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
          <td colSpan={6} className="px-4 py-3">
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
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
