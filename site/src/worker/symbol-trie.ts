import type { TickerEntry } from './types';

interface TrieNode {
  tokens: TickerEntry[];
  children: Map<string, TrieNode>;
}

function createNode(): TrieNode {
  return { tokens: [], children: new Map() };
}

/**
 * Symbol Trie for O(M) prefix lookups against ~13K US equities.
 * Stripped from matchstick-radar-daas SymbolTrie — keeps only insert,
 * insertMany, findExact, and findPrefix.
 */
export class SymbolTrie {
  private root: TrieNode = createNode();

  /** Insert a single entry — O(M) where M = symbol length. */
  insert(entry: TickerEntry): void {
    const symbol = entry.symbol.toUpperCase();
    let node = this.root;
    for (const char of symbol) {
      let child = node.children.get(char);
      if (!child) {
        child = createNode();
        node.children.set(char, child);
      }
      node = child;
    }
    node.tokens.push(entry);
  }

  /** Bulk insert. */
  insertMany(entries: TickerEntry[]): void {
    for (const entry of entries) {
      this.insert(entry);
    }
  }

  /** Exact match — returns all entries whose symbol equals the query. */
  findExact(symbol: string): TickerEntry[] {
    const node = this.findNode(symbol.toUpperCase());
    return node ? [...node.tokens] : [];
  }

  /**
   * Prefix search — returns all entries whose symbol starts with the
   * given prefix, collected via subtree traversal.
   */
  findPrefix(prefix: string, limit = 50): TickerEntry[] {
    const node = this.findNode(prefix.toUpperCase());
    if (!node) return [];
    const results: TickerEntry[] = [];
    this.collect(node, results, limit);
    return results;
  }

  // --- private helpers ---

  private findNode(symbol: string): TrieNode | null {
    let node = this.root;
    for (const char of symbol) {
      const next = node.children.get(char);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  private collect(node: TrieNode, results: TickerEntry[], limit: number): void {
    if (results.length >= limit) return;
    for (const token of node.tokens) {
      if (results.length >= limit) return;
      results.push(token);
    }
    for (const child of node.children.values()) {
      if (results.length >= limit) return;
      this.collect(child, results, limit);
    }
  }
}
