import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { classify, JevUnavailableError } from './jev-client.js';

const CACHE_PATH = 'fixtures/cache.json';

// Regression test for vaults.DEV-2026-09-275: on repeated failure, classify()
// must throw JevUnavailableError -- it must never return a plausible-looking
// regime/probability/confidence object tagged with a real model identity
// (the removed `defaultResponse()` fabrication).
test('classify() throws JevUnavailableError after repeated failures instead of returning a fabricated response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('{"error":"forced failure for test"}', { status: 500 })) as typeof fetch;

  try {
    // Unique state per run so this never hits a real cached fixtures/cache.json entry.
    const uniqueState = JSON.stringify({
      __test_probe: `dev-275-no-fabrication-${Date.now()}-${Math.random()}`,
    });

    await assert.rejects(
      () => classify(uniqueState, 'Test Strategy', 'test-key'),
      (err: unknown) => {
        assert.ok(err instanceof JevUnavailableError, 'expected a JevUnavailableError to be thrown');
        assert.equal((err as Error).name, 'JevUnavailableError');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression test for the cache-key audit finding (jev-engineering review,
// sec 9.2): the cache key used to be hash(state) alone, so classify() called
// with the SAME market state but two DIFFERENT strategies would silently
// return the first strategy's cached strategy_viable answer for the second
// -- a real collision risk for a backtester comparing strategies over
// overlapping historical bars. The key must now cover the full request body
// (state + strategy + model + question wording), so each strategy gets its
// own real network call and its own cache entry for identical state.
test('classify() does not share a cache entry across different strategies for the same state', async () => {
  const preexisting = existsSync(CACHE_PATH) ? readFileSync(CACHE_PATH, 'utf-8') : null;

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    const noul = callCount === 1 ? 0.9 : 0.1;
    return new Response(
      JSON.stringify({
        model: 'typesafe/jev-1.13',
        answers: {
          regime_type: {
            type: 'choice',
            choice: 'unclear',
            probabilities: { trend_up: 0.2, trend_down: 0.2, range: 0.2, chop: 0.2, unclear: 0.2 },
            confidence: 0,
          },
          regime_change_likely: { type: 'noul', noul: 0.5 },
          strategy_viable: { type: 'noul', noul },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const sharedState = JSON.stringify({
      __test_probe: `dev-cache-key-collision-${Date.now()}-${Math.random()}`,
    });

    const first = await classify(sharedState, 'Strategy A', 'test-key');
    const second = await classify(sharedState, 'Strategy B', 'test-key');

    assert.equal(callCount, 2, 'expected a real network call for each distinct strategy, not a cache hit');
    assert.equal(first.answers.strategy_viable.noul, 0.9);
    assert.equal(second.answers.strategy_viable.noul, 0.1);
    assert.notEqual(
      first.answers.strategy_viable.noul,
      second.answers.strategy_viable.noul,
      'second strategy must not read back the first strategy\'s cached answer',
    );
  } finally {
    globalThis.fetch = originalFetch;
    // Leave any pre-existing developer cache file exactly as found.
    if (preexisting !== null) {
      const fs = await import('node:fs');
      fs.writeFileSync(CACHE_PATH, preexisting);
    } else if (existsSync(CACHE_PATH)) {
      unlinkSync(CACHE_PATH);
    }
  }
});
