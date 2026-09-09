import test from 'node:test';
import assert from 'node:assert/strict';
import { JayDBAuth, Auth, AuthError } from '../src/index.js';

class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(k) {
    return this.store[k] ?? null;
  }
  setItem(k, v) {
    this.store[k] = String(v);
  }
  removeItem(k) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

test('JayDBAuth signIn generates PKCE parameters and stashes state', async () => {
  const storage = new MockStorage();
  const auth = new JayDBAuth({
    issuer: 'https://acme.jaydb.com',
    clientId: 'client-app-1',
    storage,
  });

  // Mock discover call
  auth.discover = async () => ({
    authorization_endpoint: 'https://acme.jaydb.com/oauth/v2/authorize',
    token_endpoint: 'https://acme.jaydb.com/oauth/v2/token',
  });

  const { authorizeUrl, state } = await auth.signIn({
    idp: 'google',
    context: { returnBoard: 'board-alpha' },
    autoRedirect: false,
  });

  const url = new URL(authorizeUrl);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client-app-1');
  assert.equal(url.searchParams.get('idp'), 'google');
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));

  // Stored state verification
  assert.equal(storage.getItem('jaydb_pkce_state'), state);
  assert.ok(storage.getItem('jaydb_pkce_verifier'));
  assert.deepEqual(JSON.parse(storage.getItem('jaydb_pkce_return')), { returnBoard: 'board-alpha' });
});

test('JayDBAuth handleCallback completes code exchange', async () => {
  const storage = new MockStorage();
  storage.setItem('jaydb_pkce_verifier', 'test-verifier-string');
  storage.setItem('jaydb_pkce_state', 'valid-state');
  storage.setItem('jaydb_pkce_token_endpoint', 'https://acme.jaydb.com/oauth/v2/token');
  storage.setItem('jaydb_pkce_return', JSON.stringify({ board: 'marketing' }));

  const auth = new JayDBAuth({
    issuer: 'https://acme.jaydb.com',
    clientId: 'client-app-1',
    storage,
  });

  // Mock global fetch for token exchange
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, 'https://acme.jaydb.com/oauth/v2/token');
    assert.equal(opts.method, 'POST');
    const params = new URLSearchParams(opts.body);
    assert.equal(params.get('code'), 'auth-code-123');
    assert.equal(params.get('code_verifier'), 'test-verifier-string');

    // Create a fake id_token with JSON payload: {"sub":"user-42","name":"Alice","email":"alice@example.com"}
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const payload = btoa(JSON.stringify({ sub: 'user-42', name: 'Alice', email: 'alice@example.com' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fakeIdToken = `${header}.${payload}.fakesig`;

    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'acc-token-xyz',
        refresh_token: 'ref-token-xyz',
        id_token: fakeIdToken,
        expires_in: 3600,
      }),
    };
  };

  try {
    const callbackUrl = 'https://app.example.com/callback?code=auth-code-123&state=valid-state';
    const ctx = await auth.handleCallback({ url: callbackUrl });
    assert.deepEqual(ctx, { board: 'marketing' });

    assert.equal(auth.isSignedIn(), true);
    assert.equal(auth.currentToken(), 'acc-token-xyz');

    const user = auth.getUser();
    assert.equal(user.name, 'Alice');
    assert.equal(user.email, 'alice@example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JayDBAuth handleCallback rejects state mismatch', async () => {
  const storage = new MockStorage();
  storage.setItem('jaydb_pkce_verifier', 'test-verifier');
  storage.setItem('jaydb_pkce_state', 'expected-state');
  storage.setItem('jaydb_pkce_token_endpoint', 'https://acme.jaydb.com/oauth/v2/token');

  const auth = new JayDBAuth({
    issuer: 'https://acme.jaydb.com',
    clientId: 'client-app-1',
    storage,
  });

  const callbackUrl = 'https://app.example.com/callback?code=123&state=different-state';
  await assert.rejects(
    async () => auth.handleCallback({ url: callbackUrl }),
    /state mismatch/,
  );
});

test('JayDBAuth getToken refreshes expiring token', async () => {
  const storage = new MockStorage();
  const auth = new JayDBAuth({
    issuer: 'https://acme.jaydb.com',
    clientId: 'client-app-1',
    storage,
  });

  // Stored token expiring in 10 seconds (less than 30s threshold)
  auth.storeTokens(
    {
      access_token: 'old-access-token',
      refresh_token: 'valid-refresh-token',
      expires_in: 10,
    },
    'https://acme.jaydb.com/oauth/v2/token',
    'client-app-1',
  );

  let refreshCalled = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    refreshCalled++;
    const params = new URLSearchParams(opts.body);
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('refresh_token'), 'valid-refresh-token');

    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-fresh-token',
        expires_in: 3600,
      }),
    };
  };

  try {
    // Call getToken concurrently twice
    const [t1, t2] = await Promise.all([auth.getToken(), auth.getToken()]);
    assert.equal(t1, 'new-fresh-token');
    assert.equal(t2, 'new-fresh-token');
    // Coalescing: refresh should only be requested once over the network
    assert.equal(refreshCalled, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
