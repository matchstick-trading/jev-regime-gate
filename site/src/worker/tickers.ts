import { SymbolTrie } from './symbol-trie';
import { TICKERS } from './ticker-data';

/**
 * Module-level singleton — built once from bundled data, survives across
 * requests within a Worker isolate.  No network fetch required.
 */
let cachedTrie: SymbolTrie | null = null;

/**
 * Build or return the cached trie.  The ticker data is compiled into the
 * Worker bundle so this is synchronous after the first call.
 */
export function getTrie(): Promise<SymbolTrie> {
  if (!cachedTrie) {
    const trie = new SymbolTrie();
    trie.insertMany(
      TICKERS.map((t) => ({ id: '', symbol: t.symbol, name: t.name })),
    );
    cachedTrie = trie;
  }
  return Promise.resolve(cachedTrie);
}
