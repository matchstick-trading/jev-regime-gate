import type { SearchResult, TodayResult, ScreenerBar, RawBar } from './types';

const BASE = '';

export async function searchSymbols(q: string, limit = 8): Promise<SearchResult[]> {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) return [];
  return res.json() as Promise<SearchResult[]>;
}

export async function classifyToday(symbol: string): Promise<TodayResult> {
  const res = await fetch(`${BASE}/api/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, source: 'yahoo' }),
  });
  if (!res.ok) throw new Error(`Classification failed: ${res.status}`);
  return res.json() as Promise<TodayResult>;
}

export async function classifyBYOD(bars: RawBar[]): Promise<TodayResult> {
  const res = await fetch(`${BASE}/api/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bars }),
  });
  if (!res.ok) throw new Error(`BYOD classification failed: ${res.status}`);
  return res.json() as Promise<TodayResult>;
}

export async function fetchHistory(
  symbol: string,
  range: '1y' | '3y',
): Promise<ScreenerBar[]> {
  const res = await fetch(`${BASE}/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
  return res.json() as Promise<ScreenerBar[]>;
}
