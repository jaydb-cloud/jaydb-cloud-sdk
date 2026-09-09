import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JayDBClient,
  JayDB,
  ConflictError,
  NotFoundError,
  AuthError,
  JayDBError,
  encodeKey,
  unquoteETag,
} from '../src/index.js';

test('encodeKey normalizes paths correctly', () => {
  assert.equal(encodeKey('cards/123'), 'cards/123');
  assert.equal(encodeKey('/cards/hello world/'), 'cards/hello%20world');
  assert.equal(encodeKey('a/b/c'), 'a/b/c');
});

test('unquoteETag strips quotes and weak tags', () => {
  assert.equal(unquoteETag('"abc"'), 'abc');
  assert.equal(unquoteETag('W/"abc"'), 'abc');
  assert.equal(unquoteETag('abc'), 'abc');
  assert.equal(unquoteETag(null), null);
  assert.equal(unquoteETag(undefined), null);
});

test('JayDBClient constructor requires baseUrl and namespace', () => {
  assert.throws(() => new JayDBClient({}), /baseUrl is required/);
  assert.throws(() => new JayDBClient({ baseUrl: 'https://test.jaydb.com' }), /namespace is required/);
  assert.throws(
    () => new JayDBClient({ baseUrl: 'https://test.jaydb.com', namespace: 'test' }),
    /auth, getToken, or token is required for OIDC authentication/,
  );
});

test('JayDBClient GET document with mock fetch', async () => {
  const mockFetch = async (url, opts) => {
    assert.equal(url, 'https://test.jaydb.com/v1/n/demo/docs/cards/c1');
    assert.equal(opts.method, 'GET');
    assert.equal(opts.headers['Authorization'], 'Bearer test-token');

    return {
      ok: true,
      status: 200,
      headers: new Map([['ETag', '"rev_123"']]),
      json: async () => ({ title: 'Card 1', column: 'todo' }),
    };
  };

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    token: 'test-token',
    fetch: mockFetch,
  });

  const res = await client.get('cards/c1');
  assert.notEqual(res, null);
  assert.equal(res.key, 'cards/c1');
  assert.equal(res.etag, 'rev_123');
  assert.equal(res.data.title, 'Card 1');
  assert.equal(client.stats.reads, 1);
  assert.equal(client.stats.totalRequests, 1);
});

test('JayDBClient GET returns null on 404', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    headers: new Map(),
    json: async () => ({ error: 'document not found' }),
  });

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    token: 'test-token',
    fetch: mockFetch,
  });

  const res = await client.get('cards/missing');
  assert.equal(res, null);
});

test('JayDBClient PUT handles If-Match and ConflictError (412)', async () => {
  const mockFetch = async (url, opts) => {
    assert.equal(opts.headers['If-Match'], '"rev_100"');
    return {
      ok: false,
      status: 412,
      statusText: 'Precondition Failed',
      headers: new Map(),
      json: async () => ({ error: 'etag mismatch' }),
    };
  };

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    token: 'test-token',
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => client.put('cards/c1', { title: 'Update' }, { ifMatch: 'rev_100' }),
    ConflictError,
  );
  assert.equal(client.stats.conflicts, 1);
  assert.equal(client.stats.writes, 1);
});

test('JayDBClient PUT handles createOnly (If-None-Match: *)', async () => {
  let capturedHeaders = null;
  const mockFetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true,
      status: 200,
      headers: new Map([['ETag', '"rev_created"']]),
      json: async () => ({ etag: 'rev_created', mod_time: '2026-09-09T12:00:00Z' }),
    };
  };

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    token: 'test-token',
    fetch: mockFetch,
  });

  const res = await client.put('cards/c1', { title: 'New' }, { createOnly: true });
  assert.equal(capturedHeaders['If-None-Match'], '*');
  assert.equal(res.etag, 'rev_created');
  assert.equal(res.modTime, '2026-09-09T12:00:00Z');
});

test('JayDBClient DELETE returns true on 200 and false on 404', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount === 1) {
      return { ok: true, status: 200, headers: new Map() };
    }
    return { ok: false, status: 404, headers: new Map() };
  };

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    token: 'test-token',
    fetch: mockFetch,
  });

  const d1 = await client.delete('cards/c1');
  assert.equal(d1, true);

  const d2 = await client.delete('cards/c1');
  assert.equal(d2, false);
});

test('JayDBClient list and listAll iterates pages correctly', async () => {
  let page = 0;
  const mockFetch = async (url) => {
    page++;
    if (page === 1) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          items: [{ key: 'cards/1', etag: '"e1"' }],
          next_cursor: 'cur_page2',
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        items: [{ key: 'cards/2', etag: '"e2"' }],
        next_cursor: null,
      }),
    };
  };

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    token: 'test-token',
    fetch: mockFetch,
  });

  const all = await client.listAll({ prefix: 'cards/' });
  assert.equal(all.length, 2);
  assert.equal(all[0].etag, 'e1'); // unquoted
  assert.equal(all[1].etag, 'e2');
  assert.equal(client.stats.lists, 2);
});

test('JayDBClient uses Bearer token from auth object', async () => {
  let authHeader = null;
  const mockFetch = async (url, opts) => {
    authHeader = opts.headers.Authorization;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ ok: true }),
    };
  };

  const mockAuth = {
    async getToken() {
      return 'jwt-token-xyz';
    },
  };

  const client = new JayDB({
    baseUrl: 'https://test.jaydb.com',
    namespace: 'demo',
    auth: mockAuth,
    fetch: mockFetch,
  });

  await client.get('test');
  assert.equal(authHeader, 'Bearer jwt-token-xyz');
});
