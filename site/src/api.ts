import type { SearchResult, TodayResult, ScreenerBar, RawBar } from './types';

const BASE = '';

export async function searchSymbols(q: string, limit = 8): Promise<SearchResult[]> {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { results: SearchResult[] };
  return data.results;
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
  onProgress?: (bars: ScreenerBar[], total: number) => void,
): Promise<ScreenerBar[]> {
  const res = await fetch(`${BASE}/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);

  // Non-streaming fallback: if the response is JSON (e.g. an error response),
  // or the caller did not provide onProgress and body is not streamable.
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('ndjson') || !res.body) {
    const data = (await res.json()) as { symbol: string; interval: string; bars: ScreenerBar[] };
    return data.bars;
  }

  // Stream NDJSON lines.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const bars: ScreenerBar[] = [];
  let total = 0;
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines.
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as { type: string } & Record<string, unknown>;
        if (parsed.type === 'header') {
          total = Number(parsed['total']) || 0;
        } else if (parsed.type === 'bar') {
          // Strip the type field, keep everything else as ScreenerBar.
          const { type: _, ...barData } = parsed;
          bars.push(barData as unknown as ScreenerBar);
          onProgress?.(bars, total);
        }
      } catch {
        // Skip malformed lines.
      }
    }
  }

  return bars;
}
