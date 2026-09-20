import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchResult } from './types';
import { searchSymbols } from './api';

interface SymbolSearchProps {
  onSelect: (symbol: string) => void;
  loading: boolean;
}

export function SymbolSearch({ onSelect, loading }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    const hits = await searchSymbols(q);
    setResults(hits);
    setOpen(hits.length > 0);
    setActive(-1);
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(() => doSearch(query), 150);
    return () => clearTimeout(timerRef.current);
  }, [query, doSearch]);

  function select(symbol: string) {
    setQuery(symbol);
    setOpen(false);
    setResults([]);
    onSelect(symbol);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((p) => Math.min(p + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((p) => Math.max(p - 1, 0));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      select(results[active].symbol);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value.toUpperCase())}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search any symbol... SPY, AAPL, TSLA"
        disabled={loading}
        className="w-full bg-zinc-900 border border-border rounded-lg px-4 py-3 text-white font-mono text-sm
          placeholder:text-zinc-600
          focus:outline-none focus:ring-2 focus:ring-matchstick focus:border-matchstick
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all"
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-matchstick/30 border-t-matchstick rounded-full animate-spin" />
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-30 w-full mt-1 bg-zinc-900 border border-border rounded-lg shadow-xl overflow-hidden">
          {results.map((r, i) => (
            <button
              key={r.symbol}
              type="button"
              onMouseDown={() => select(r.symbol)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === active ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
              }`}
            >
              <span className="text-white font-mono font-semibold text-sm">{r.symbol}</span>
              <span className="text-zinc-500 text-xs truncate">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const QUICK_PICKS = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMZN'];

interface QuickPicksProps {
  onSelect: (symbol: string) => void;
}

export function QuickPicks({ onSelect }: QuickPicksProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      {QUICK_PICKS.map((sym) => (
        <button
          key={sym}
          type="button"
          onClick={() => onSelect(sym)}
          className="px-3 py-1.5 rounded-full bg-zinc-900 border border-border text-zinc-400 font-mono text-xs
            hover:border-matchstick/50 hover:text-matchstick transition-colors"
        >
          {sym}
        </button>
      ))}
    </div>
  );
}
