# Deploy: Progressive Screener

PR: https://github.com/matchstick-trading/jev-regime-gate/pull/1
Branch: `feat/progressive-screener`
Status: code-reviewed, all findings fixed, builds clean

## Steps

### 1. Merge the PR

```sh
gh pr merge 1 --squash
```

### 2. Create the KV namespace

```sh
cd site
wrangler kv namespace create JEV_CACHE
```

Copy the returned `id` into `site/wrangler.jsonc` → `kv_namespaces[0].id`, replacing `"placeholder"`.

### 3. Set the OpenRouter API key

```sh
wrangler secret put OPENROUTER_API_KEY
# paste your OpenRouter key when prompted
```

### 4. Build and deploy

```sh
npm run build        # or: npx vite build
wrangler deploy
```

### 5. Verify

- https://jev.matchstick.trading — search for SPY, should show today's classification
- Try a few symbols: AAPL, TSLA, NVDA
- Try the BYOD section with sample CSV data
- History tab: expect 2-13s for 1yr of data

## What changed

- **Search**: local trie over ~13K US equities (SEC data), <50ms
- **Today**: fetches 3mo of Yahoo EOD data, Jev-classifies today's bar, ~1-2s
- **History**: classifies each bar over 1yr or 3yr range, 2-13s
- **BYOD**: upload CSV or paste OHLCV data, classify without Yahoo
- **Worker API**: `/api/search`, `/api/classify`, `/api/history`

## Known issues

- **History timeout**: sequential Jev calls (~192 for 1yr) may hit Worker CPU limit on long ranges. The static SPY demo on main still works as a fallback.
- **No explicit rate limiting** on the API yet. KV caching per symbol/day mitigates repeat requests.
