import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, judgeMatch, FIXTURE_CACHE_TTL_SECONDS } from './jev.ts';
import type { Env } from './types.ts';

// Tests for vaults.DEV-2026-09-278: cache metadata envelope + per-route TTL.
//
// Covers the three required scenarios (miss -> live -> envelope write, hit -> unwrap with no live
// call, legacy/un-enveloped entry -> treated as miss not a crash), plus TTL-threading checks proving
// the default stays 24h (the two real-market-data call sites, /api/classify and /api/history, are
// unaffected) while an explicit FIXTURE_CACHE_TTL_SECONDS (the /api/boundary call site, and the three
// judge* functions as called from index.ts) is honored when the caller passes it.

interface MockPut {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

/** A KV double that starts empty and records every write -- for miss -> write assertions. */
function createRecordingKV() {
  const store = new Map<string, unknown>();
  const puts: MockPut[] = [];
  const kv = {
    async get(key: string, type?: string) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      return type === 'json' ? value : JSON.stringify(value);
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      puts.push({ key, value, options });
      store.set(key, JSON.parse(value));
    },
  };
  return { kv, puts };
}

/** A KV double that returns one fixed value for any key -- for hit / legacy-entry assertions. */
function createFixedEntryKV(storedValue: unknown) {
  const puts: MockPut[] = [];
  const kv = {
    async get(_key: string, _type?: string) {
      return storedValue;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      puts.push({ key, value, options });
    },
  };
  return { kv, puts };
}

function fakeJevResponse(choice: string, nOverrides: { changeLikely?: number; viable?: number } = {}) {
  return {
    model: 'typesafe/jev-1.13',
    answers: {
      regime_type: { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 },
      regime_change_likely: { type: 'noul', noul: nOverrides.changeLikely ?? 0.2 },
      strategy_viable: { type: 'noul', noul: nOverrides.viable ?? 0.7 },
    },
    usage: { input_tokens: 1000, output_tokens: 10 },
  };
}

function withMockFetch<T>(body: unknown, run: (calls: { count: number }) => Promise<T>): Promise<T> {
  const calls = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.count++;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('classify(): cache miss makes exactly one live call and writes an enveloped KV entry', async () => {
  const { kv, puts } = createRecordingKV();
  const env = { JEV_CACHE: kv, OPENROUTER_API_KEY: 'test-key' } as unknown as Env;

  await withMockFetch(fakeJevResponse('trend_up'), async (calls) => {
    const stateJson = JSON.stringify({ probe: `dev-278-miss-${Date.now()}-${Math.random()}` });
    const result = await classify(stateJson, env);

    assert.equal(calls.count, 1, 'expected exactly one live call on a cache miss');
    assert.equal(result.cache, 'miss');
    assert.ok(result.generatedAt, 'expected a generatedAt timestamp on a live result');

    assert.equal(puts.length, 1, 'expected exactly one KV write');
    const written = JSON.parse(puts[0].value);
    assert.equal(written.model, 'typesafe/jev-1.13', 'envelope must record the model identity');
    assert.equal(written.schemaVersion, 1, 'envelope must record a schema version');
    assert.equal(written.generatedAt, result.generatedAt, 'stored generatedAt must match the returned one');
    assert.ok(written.value?.answers, 'envelope must wrap the raw JevResponse under .value');
    assert.equal(
      puts[0].options?.expirationTtl,
      86400,
      'default ttl (as used by /api/classify and /api/history) must stay the unchanged 24h value',
    );
  });
});

test('classify(): cache hit unwraps the envelope correctly and makes no live call', async () => {
  const generatedAt = '2026-01-01T00:00:00.000Z';
  const envelope = {
    value: fakeJevResponse('range', { changeLikely: 0.1, viable: 0.4 }),
    generatedAt,
    model: 'typesafe/jev-1.13',
    schemaVersion: 1,
  };
  const { kv, puts } = createFixedEntryKV(envelope);
  const env = { JEV_CACHE: kv, OPENROUTER_API_KEY: 'test-key' } as unknown as Env;

  await withMockFetch(fakeJevResponse('trend_down'), async (calls) => {
    const stateJson = JSON.stringify({ probe: `dev-278-hit-${Date.now()}` });
    const result = await classify(stateJson, env);

    assert.equal(calls.count, 0, 'a cache hit must not trigger a live call');
    assert.equal(puts.length, 0, 'a cache hit must not write back to KV');
    assert.equal(result.cache, 'hit');
    assert.equal(result.generatedAt, generatedAt, 'must surface the envelope\'s original generatedAt, not "now"');
    assert.equal(result.response.answers.regime_type.choice, 'range', 'must return the unwrapped cached value');
    assert.equal(result.estimatedCost, 0, 'a cache hit costs nothing');
  });
});

test('classify(): a legacy un-enveloped KV entry is treated as a miss, not a crash', async () => {
  // Shape written by the pre-DEV-278 worker: the bare JevResponse, no envelope fields at all.
  const legacyRawResponse = fakeJevResponse('chop');
  const { kv } = createFixedEntryKV(legacyRawResponse);
  const env = { JEV_CACHE: kv, OPENROUTER_API_KEY: 'test-key' } as unknown as Env;

  await withMockFetch(fakeJevResponse('trend_down'), async (calls) => {
    const stateJson = JSON.stringify({ probe: `dev-278-legacy-${Date.now()}` });

    const result = await classify(stateJson, env); // must not throw

    assert.equal(calls.count, 1, 'a legacy raw entry must not be mistaken for a hit -- must fall through live');
    assert.equal(result.cache, 'miss');
    assert.equal(
      result.response.answers.regime_type.choice,
      'trend_down',
      'must return the fresh live result, not the legacy value misread as a hit',
    );
  });
});

test('classify(): an explicit long ttlSeconds (boundary-style call) is threaded to the KV write', async () => {
  const { kv, puts } = createRecordingKV();
  const env = { JEV_CACHE: kv, OPENROUTER_API_KEY: 'test-key' } as unknown as Env;

  await withMockFetch(fakeJevResponse('unclear'), async () => {
    const stateJson = JSON.stringify({ probe: `dev-278-boundary-ttl-${Date.now()}` });
    await classify(stateJson, env, FIXTURE_CACHE_TTL_SECONDS);

    assert.equal(FIXTURE_CACHE_TTL_SECONDS, 60 * 60 * 24 * 90);
    assert.equal(puts[0].options?.expirationTtl, FIXTURE_CACHE_TTL_SECONDS);
  });
});

test('judgeMatch(): defaults to the unchanged 24h TTL when the caller passes none', async () => {
  const { kv, puts } = createRecordingKV();
  const env = { JEV_CACHE: kv, OPENROUTER_API_KEY: 'test-key' } as unknown as Env;

  await withMockFetch({ answers: { episode_match: { noul: 0.5 } }, usage: { input_tokens: 100 } }, async () => {
    await judgeMatch(`probe-default-${Date.now()}`, { a: 'b' }, env);
    assert.equal(puts[0].options?.expirationTtl, 86400);
  });
});

test('judgeMatch(): honors an explicit FIXTURE_CACHE_TTL_SECONDS (as index.ts\'s handleJudge passes)', async () => {
  const { kv, puts } = createRecordingKV();
  const env = { JEV_CACHE: kv, OPENROUTER_API_KEY: 'test-key' } as unknown as Env;

  await withMockFetch({ answers: { episode_match: { noul: 0.77 } }, usage: { input_tokens: 200 } }, async () => {
    const result = await judgeMatch(`probe-${Date.now()}`, { a: 'b' }, env, FIXTURE_CACHE_TTL_SECONDS);

    assert.equal(result.cache, 'miss');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].options?.expirationTtl, FIXTURE_CACHE_TTL_SECONDS);
    const written = JSON.parse(puts[0].value);
    assert.equal(written.schemaVersion, 1);
    assert.ok(written.generatedAt);
  });
});
