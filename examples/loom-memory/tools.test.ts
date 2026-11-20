import { Agent as LoomAgent } from '@clickhouse/loom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDemo } from './main.ts';
import { preferenceTools } from './tools.ts';

type Body = Record<string, unknown>;

function fixture(
  options: {
    receipt?: Body;
    abstain?: boolean;
    reject?: boolean;
  } = {},
) {
  const calls: Array<{ path: string; body: Body }> = [];
  const stored = new Map<string, string>();
  const receipt: Body = {
    memory_id: 'f53da029-2ee1-49f3-8ba0-c1a9ed1ce9bd',
    version: 1,
    content_sha256: 'a'.repeat(64),
    status: 'active',
    conflict_verdict: 'clear',
    noop: false,
    ...options.receipt,
  };
  let searchResponse: Body | undefined;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Body;
    calls.push({ path, body });
    const scope = JSON.stringify([
      body.org,
      body.namespace,
      body.agent,
      body.user_id,
    ]);
    if (path === '/v1/memory.set') {
      if (options.reject) {
        return Response.json(
          { detail: 'Synthetic storage rejection' },
          { status: 400 },
        );
      }
      if (!receipt.noop && !receipt.dry_run) {
        stored.set(`${scope}/${String(body.memory_key)}`, String(body.value));
      }
      return Response.json({ ...receipt, memory_key: body.memory_key });
    }
    if (path === '/v1/memory.search') {
      const value = stored.get(`${scope}/examples/preferences/test`);
      searchResponse = {
        embedding_model: 'synthetic-test-model',
        results:
          value && !options.abstain
            ? [
                {
                  memory_key: 'examples/preferences/test',
                  content_excerpt: value,
                  similarity: 0.9,
                  source_class: 'derived',
                  verified: false,
                },
              ]
            : [],
        abstain: Boolean(options.abstain),
        abstain_code: options.abstain ? 'no_match' : '',
        retrieval_confidence: options.abstain ? 0 : 0.8,
        retrieval_risk: options.abstain ? 'abstain' : 'low',
      };
      return Response.json(searchResponse);
    }
    throw new Error(`Unexpected operation: ${path}`);
  });
  const createMemory = () =>
    new LoomAgent('example-org', 'example-space', 'travel-preferences', {
      baseUrl: 'https://loom.invalid',
      apiKey: 'synthetic-not-a-credential',
      fetch,
      logLevel: 'off',
    });
  return {
    calls,
    stored,
    receipt,
    createMemory,
    getSearch: () => searchResponse,
  };
}

describe('Loom preference tools', () => {
  beforeEach(() => vi.stubEnv('LOOM_MENTOR_BRIEF', 'off'));
  afterEach(() => vi.unstubAllEnvs());

  it('shares a fact across role clients without sharing their conversation', async () => {
    const service = fixture();
    const writer = service.createMemory();
    const reader = service.createMemory();
    expect(writer).not.toBe(reader);
    const offered = preferenceTools(
      writer,
      'demo-test',
      'examples/preferences/test',
    );
    expect(Object.keys(offered.remember.parameters.properties)).toEqual([
      'preference',
    ]);
    expect(Object.keys(offered.recall.parameters.properties)).toEqual([
      'query',
    ]);
    const result = await runDemo(writer, reader, 'test');

    expect(result.receipt).toEqual({
      ...service.receipt,
      memory_key: 'examples/preferences/test',
    });
    expect(result.recalled).toEqual(service.getSearch());
    expect(result.recalled.results).toMatchObject([
      {
        memory_key: 'examples/preferences/test',
        content_excerpt: 'The demo traveler prefers an aisle seat.',
        source_class: 'derived',
        verified: false,
      },
    ]);
    expect(result.writerModel.firstCall?.request.tools).toMatchObject([
      { name: 'remember_preference' },
    ]);
    expect(result.readerModel.firstCall?.request.tools).toMatchObject([
      { name: 'recall_preference' },
    ]);
    expect(result.readerModel.firstCall?.request.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: 'Retrieve the stored seat preference.',
      },
    ]);
    expect(service.calls.map(({ path }) => path)).toEqual([
      '/v1/memory.set',
      '/v1/memory.search',
    ]);
    for (const { body } of service.calls) {
      expect(body).toMatchObject({
        org: 'example-org',
        namespace: 'example-space',
        agent: 'travel-preferences',
        user_id: 'demo-test',
        session_id: '-',
      });
    }
    expect(service.calls[0].body).toMatchObject({ memory_type: 'preference' });
    expect(service.calls[1].body).toMatchObject({ top_k: 5, bodies: 'full' });
  });

  it.each([{ noop: true }, { dry_run: true }])(
    'does not claim a new write for receipt %j',
    async (receipt) => {
      const service = fixture({ receipt });
      await expect(
        runDemo(service.createMemory(), service.createMemory(), 'test'),
      ).rejects.toThrow('Loom did not confirm writing');
      expect(service.calls.map(({ path }) => path)).toEqual(['/v1/memory.set']);
      expect(service.stored.size).toBe(0);
    },
  );

  it('retains an abstention instead of replacing it with scripted success text', async () => {
    const service = fixture({ abstain: true });
    const result = await runDemo(
      service.createMemory(),
      service.createMemory(),
      'test',
    );
    expect(result.recalled).toEqual(service.getSearch());
    expect(result.recalled).toMatchObject({
      results: [],
      abstain: true,
      abstain_code: 'no_match',
      retrieval_confidence: 0,
      retrieval_risk: 'abstain',
    });
  });

  it('surfaces a storage failure before starting the read role', async () => {
    const service = fixture({ reject: true });
    await expect(
      runDemo(service.createMemory(), service.createMemory(), 'test'),
    ).rejects.toThrow('Synthetic storage rejection');
    expect(service.calls.map(({ path }) => path)).toEqual(['/v1/memory.set']);
    expect(service.stored.size).toBe(0);
  });
});
