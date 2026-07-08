/**
 * Database store-layer integration tests.
 *
 * Exercises the shared Drizzle query-builder paths that back the console:
 * insert + `.returning()`, `onConflictDoUpdate` (INSERT ... ON CONFLICT),
 * autoincrement primary keys, `selectDistinct`, and the API-key quota-charge
 * flow (which has a dialect-specific branch for SQLite vs PostgreSQL).
 *
 * Runs against whatever `TEST_DATABASE_URL` points at — by default an embedded
 * SQLite file (see test/setup.ts), or a PostgreSQL instance when configured.
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { createManagedApiKey, getManagedApiKey } from '../src/api-keys';
import { upsertConsoleProviderEntry, listConsoleProviderEntries } from '../src/console-provider-store';
import { createModelAlias, getModelAliasByAlias } from '../src/console-model-alias-store';
import {
  saveConsoleRequest,
  saveConsoleResponse,
  getConsoleRequest,
  getConsoleFilterOptions,
} from '../src/console-store';
import { __setPricingCacheForTests, type ModelPricing } from '../src/pricing';

const MODEL = 'claude-store-test-model';

beforeAll(() => {
  // Inject pricing in-memory so the quota-charge path computes a non-zero cost
  // without any network / catalog lookup.
  const pricing = new Map<string, ModelPricing>([[MODEL, { input: 3, output: 15 }]]);
  __setPricingCacheForTests(pricing);
});

describe('db store layer', () => {
  it('creates an API key and reads it back (insert + returning)', async () => {
    const { record } = await createManagedApiKey('store-test-key');
    expect(record.id).toBeTruthy();
    expect(record.name).toBe('store-test-key');

    const fetched = await getManagedApiKey(record.id);
    expect(fetched?.id).toBe(record.id);
    expect(fetched?.name).toBe('store-test-key');
  });

  it('upserts a provider (onConflictDoUpdate updates the existing row)', async () => {
    const channel = 'store-test-channel';
    await upsertConsoleProviderEntry(channel, {
      type: 'anthropic',
      targetBaseUrl: 'https://first.example.com',
      models: [],
    } as any);
    await upsertConsoleProviderEntry(channel, {
      type: 'anthropic',
      targetBaseUrl: 'https://second.example.com',
      models: [],
    } as any);

    const entries = await listConsoleProviderEntries();
    expect(entries[channel]).toBeDefined();
    expect((entries[channel] as any).targetBaseUrl).toBe('https://second.example.com');
  });

  it('creates a model alias with an autoincrement id', async () => {
    const created = await createModelAlias({
      alias: 'store-test-alias',
      provider: 'store-test-channel',
      model: 'claude-x',
    } as any);
    expect(typeof (created as any).id).toBe('number');

    const fetched = await getModelAliasByAlias('store-test-alias');
    expect(fetched?.alias).toBe('store-test-alias');
  });

  it('saves a request, upserts on repeat, and records a response with quota charge', async () => {
    const { record: key } = await createManagedApiKey('store-test-quota-key');
    const requestId = 'store-test-req-1';

    const baseRequest = {
      request_id: requestId,
      created_at: Date.now(),
      route_prefix: 'store-test-route',
      upstream_type: 'anthropic' as const,
      method: 'POST',
      path: '/v1/messages',
      target_url: 'https://api.example.com/v1/messages',
      request_model: MODEL,
      api_key_id: key.id,
      api_key_name: key.name,
      original_payload: '{"a":1}',
      original_payload_truncated: false,
      original_summary: null,
      forwarded_payload: null,
      forwarded_payload_truncated: false,
      forwarded_summary: null,
      original_headers: null,
      forward_headers: null,
      failover_from: null,
      failover_chain: [] as string[],
      original_route_prefix: null,
      original_request_model: null,
      failover_reason: null,
    };

    await saveConsoleRequest(baseRequest);
    // Second save with the same id must take the ON CONFLICT update branch.
    await saveConsoleRequest({ ...baseRequest, original_payload: '{"a":2}' });

    await saveConsoleResponse({
      request_id: requestId,
      response_status: 200,
      response_status_text: 'OK',
      response_payload: '{"ok":true}',
      response_payload_truncated: false,
      response_usage: {
        model: MODEL,
        stop_reason: 'end_turn',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
      },
    });

    const detail = await getConsoleRequest(requestId);
    expect(detail?.record.response_status).toBe(200);
    expect(detail?.record.request_model).toBe(MODEL);

    // Quota-charge path (SQLite branch when running on SQLite) should have
    // debited the key by a positive amount.
    const keyAfter = await getManagedApiKey(key.id);
    expect(keyAfter?.cost_used).toBeGreaterThan(0);
  });

  it('returns distinct filter options (selectDistinct + model bucket)', async () => {
    const options = await getConsoleFilterOptions();
    expect(options.routes).toContain('store-test-route');
    expect(options.models).toContain(MODEL);
  });
});
