import { SymbolTrie } from './symbol-trie';
import type { TickerEntry } from './types';

const SEC_URL = 'https://www.sec.gov/files/company_tickers.json';

/** Shape of a single record in the SEC JSON object. */
interface SecTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

/** Module-level singleton — survives across requests within a Worker isolate. */
let cachedTrie: SymbolTrie | null = null;
let loading: Promise<SymbolTrie> | null = null;

/**
 * Build or return the cached trie. Only fetches SEC data once per
 * Worker isolate lifetime.
 */
export async function getTrie(): Promise<SymbolTrie> {
  if (cachedTrie) return cachedTrie;

  // Deduplicate concurrent callers during initial load.
  if (loading) return loading;

  loading = (async () => {
    const res = await fetch(SEC_URL, {
      headers: {
        'User-Agent': 'jev-regime-screener/1.0 (matthew.scott.hendricks@gmail.com)',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`SEC tickers ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as Record<string, SecTicker>;

    const entries: TickerEntry[] = [];
    const seen = new Set<string>();

    for (const val of Object.values(data)) {
      const symbol = val.ticker.toUpperCase();
      // Deduplicate — SEC data can have duplicates for the same ticker.
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      entries.push({
        id: String(val.cik_str),
        symbol,
        name: val.title,
      });
    }

    const trie = new SymbolTrie();
    trie.insertMany(entries);
    cachedTrie = trie;
    return trie;
  })();

  try {
    const trie = await loading;
    return trie;
  } finally {
    loading = null;
  }
}
