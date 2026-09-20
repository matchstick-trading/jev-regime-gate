import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, JevUnavailableError } from './jev-client.js';

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
