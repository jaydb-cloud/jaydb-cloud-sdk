/**
 * auth.js — OIDC Authorization Code + PKCE flow for JayDB Cloud.
 *
 * Implements public-client OAuth2/OIDC without client secrets:
 *   1. Authorize: Random S256 verifier and challenge -> /oauth/v2/authorize
 *   2. Token Exchange: Exchange code + verifier -> /oauth/v2/token
 *   3. Token Lifecycle: Transparent background refresh with request coalescing
 *   4. Session: Stored in sessionStorage or custom storage adapter
 */

import { AuthError } from './errors.js';

const STORAGE_PREFIX = 'jaydb_pkce_';
const VERIFIER_KEY = `${STORAGE_PREFIX}verifier`;
const STATE_KEY = `${STORAGE_PREFIX}state`;
const RETURN_KEY = `${STORAGE_PREFIX}return`;
const TOKENS_KEY = 'jaydb_oidc_tokens';
const TOKEN_ENDPOINT_KEY = `${STORAGE_PREFIX}token_endpoint`;

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

function resolveStorage(customStorage) {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return new MemoryStorage();
}

function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Cryptography API (crypto.subtle) is required for PKCE.');
}

function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (let i = 0; i < arr.length; i++) {
    str += String.fromCharCode(arr[i]);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(bytes = 32) {
  const cryptoObj = getCrypto();
  return b64url(cryptoObj.getRandomValues(new Uint8Array(bytes)));
}

async function s256(verifier) {
  const cryptoObj = getCrypto();
  const digest = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

function defaultRedirectUri() {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin + window.location.pathname;
  }
  return 'http://localhost';
}

function cleanUrl() {
  if (typeof window === 'undefined' || !window.location || !window.history) return;
  try {
    const url = new URL(window.location.href);
    ['code', 'state', 'error', 'error_description', 'iss'].forEach((p) => url.searchParams.delete(p));
    window.history.replaceState({}, document.title, url.pathname + (url.search || '') + url.hash);
  } catch {
    /* ignore in non-standard window mocks */
  }
}

/**
 * JayDBAuth manages OIDC PKCE authentication against a JayDB Cloud tenant.
 */
export class JayDBAuth {
  /**
   * @param {object} [opts]
   * @param {string} [opts.issuer] - Tenant OIDC issuer, e.g. "https://acme.jaydb.com"
   * @param {string} [opts.clientId] - Registered public application client ID
   * @param {string} [opts.redirectUri] - OAuth redirect URI (defaults to current page origin+path)
   * @param {string[]} [opts.scopes=['openid', 'profile', 'email']] - Default requested scopes
   * @param {Storage} [opts.storage] - Storage provider (defaults to window.sessionStorage)
   */
  constructor({ issuer, clientId, redirectUri, scopes = ['openid', 'profile', 'email'], storage } = {}) {
    this.issuer = issuer ? String(issuer).replace(/\/+$/, '') : null;
    this.clientId = clientId || null;
    this.redirectUri = redirectUri || null;
    this.scopes = scopes;
    this.storage = resolveStorage(storage);
    this.#refreshInFlight = null;
  }

  #refreshInFlight;

  /**
   * Fetch OIDC discovery document from the tenant issuer.
   *
   * @param {string} [issuer]
   */
  async discover(issuer = this.issuer) {
    const iss = issuer ? String(issuer).replace(/\/+$/, '') : this.issuer;
    if (!iss) throw new AuthError('OIDC issuer is required for discovery.');

    const url = `${iss}/.well-known/openid-configuration`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
      throw new AuthError(`OIDC discovery failed (${res.status}) at ${url}`, { status: res.status });
    }
    return res.json();
  }

  /**
   * Initiate PKCE authorization.
   *
   * @param {object} [opts]
   * @param {string} [opts.issuer]
   * @param {string} [opts.clientId]
   * @param {string[]} [opts.scopes]
   * @param {string} [opts.redirectUri]
   * @param {'google' | 'github' | 'microsoft' | string} [opts.idp] - Upstream provider configured on tenant
   * @param {any} [opts.context] - Arbitrary state to preserve and restore after the redirect
   * @param {boolean} [opts.autoRedirect=true] - If true, automatically navigates window.location
   * @returns {Promise<{authorizeUrl: string, state: string}>}
   */
  async signIn({
    issuer = this.issuer,
    clientId = this.clientId,
    scopes = this.scopes,
    redirectUri = this.redirectUri || defaultRedirectUri(),
    idp,
    context,
    autoRedirect = true,
  } = {}) {
    if (!issuer) throw new AuthError('issuer is required for signIn');
    if (!clientId) throw new AuthError('clientId is required for signIn');

    const cfg = await this.discover(issuer);
    const verifier = randomString(32);
    const state = randomString(16);

    this.storage.setItem(VERIFIER_KEY, verifier);
    this.storage.setItem(STATE_KEY, state);
    if (context !== undefined) {
      this.storage.setItem(RETURN_KEY, JSON.stringify(context));
    }
    this.storage.setItem(TOKEN_ENDPOINT_KEY, cfg.token_endpoint);

    const challenge = await s256(verifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: Array.isArray(scopes) ? scopes.join(' ') : String(scopes),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (idp) params.set('idp', idp);

    const authorizeUrl = `${cfg.authorization_endpoint}?${params}`;

    if (autoRedirect && typeof window !== 'undefined' && window.location) {
      window.location.assign(authorizeUrl);
    }

    return { authorizeUrl, state };
  }

  /** Alias for signIn to support existing Kanban call sites. */
  async beginLogin(opts) {
    return this.signIn(opts);
  }

  /**
   * Complete sign-in when the application page loads with callback query parameters (?code=...&state=...).
   *
   * @param {object} [opts]
   * @param {string} [opts.clientId]
   * @param {string} [opts.redirectUri]
   * @param {string} [opts.url] - URL string (defaults to current window.location.href)
   * @returns {Promise<any|null>} The restored context object if a callback was processed, or null if not a callback.
   */
  async handleCallback({
    clientId = this.clientId,
    redirectUri = this.redirectUri || defaultRedirectUri(),
    url: rawUrl,
  } = {}) {
    const currentHref = rawUrl || (typeof window !== 'undefined' ? window.location.href : null);
    if (!currentHref) return null;

    const url = new URL(currentHref);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      cleanUrl();
      const desc = url.searchParams.get('error_description');
      throw new AuthError(`sign-in failed: ${error}${desc ? ` — ${desc}` : ''}`);
    }

    if (!code) return null; // Not a callback

    const verifier = this.storage.getItem(VERIFIER_KEY);
    const expectedState = this.storage.getItem(STATE_KEY);
    const tokenEndpoint = this.storage.getItem(TOKEN_ENDPOINT_KEY);

    cleanUrl();

    if (!verifier || !expectedState) {
      throw new AuthError('Sign-in state is missing — please initiate login again.');
    }
    if (returnedState !== expectedState) {
      throw new AuthError('Sign-in state mismatch (possible CSRF) — login aborted.');
    }
    if (!tokenEndpoint) {
      throw new AuthError('Sign-in lost token endpoint metadata — please initiate login again.');
    }

    const cid = clientId || this.clientId;
    if (!cid) throw new AuthError('clientId is required to complete token exchange.');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: cid,
      code_verifier: verifier,
    });

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      mode: 'cors',
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AuthError(
        `Token exchange failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        { status: res.status, body: detail },
      );
    }

    const tokens = await res.json();
    this.storeTokens(tokens, tokenEndpoint, cid);

    this.storage.removeItem(VERIFIER_KEY);
    this.storage.removeItem(STATE_KEY);

    const ret = this.storage.getItem(RETURN_KEY);
    this.storage.removeItem(RETURN_KEY);

    return ret ? JSON.parse(ret) : {};
  }

  /** Alias for handleCallback to support existing Kanban call sites. */
  async completeLoginIfCallback(opts) {
    return this.handleCallback(opts);
  }

  /** Store tokens and expiry timestamp into storage. */
  storeTokens(tokens, tokenEndpoint, clientId) {
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0;
    this.storage.setItem(
      TOKENS_KEY,
      JSON.stringify({
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        idToken: tokens.id_token ?? null,
        expiresAt,
        tokenEndpoint: tokenEndpoint || null,
        clientId: clientId || this.clientId || null,
      }),
    );
  }

  /** Read current token record from storage. */
  getTokens() {
    try {
      const raw = this.storage.getItem(TOKENS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Check if the user is currently signed in. */
  isSignedIn() {
    const t = this.getTokens();
    return Boolean(t?.accessToken);
  }

  /**
   * Decode the user identity claims from the ID token (name, email, picture, sub).
   * Display and presentation only.
   */
  getUser() {
    const t = this.getTokens();
    if (!t?.idToken) return null;
    try {
      const [, payload] = t.idToken.split('.');
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  }

  /** Alias for getUser to match existing Kanban demo. */
  identityClaims() {
    return this.getUser();
  }

  /** Sign out and clear stored tokens. */
  signOut() {
    this.storage.removeItem(TOKENS_KEY);
  }

  /**
   * Return a valid access token, automatically refreshing it if within 30s of expiration.
   * Concurrently coalesces multiple refresh calls into a single in-flight request.
   *
   * @returns {Promise<string|null>} Valid access token or null if unauthenticated.
   */
  async getToken() {
    const t = this.getTokens();
    if (!t?.accessToken) return null;

    const isStale = t.expiresAt && Date.now() > t.expiresAt - 30_000;
    if (!isStale) return t.accessToken;

    if (!t.refreshToken || !t.tokenEndpoint) {
      // Token is stale but no refresh token available
      return null;
    }

    if (!this.#refreshInFlight) {
      this.#refreshInFlight = (async () => {
        try {
          const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: t.refreshToken,
            client_id: t.clientId || this.clientId,
          });

          const res = await fetch(t.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            mode: 'cors',
          });

          if (!res.ok) {
            this.signOut();
            return null;
          }

          const tokens = await res.json();
          if (!tokens.refresh_token) {
            tokens.refresh_token = t.refreshToken;
          }
          this.storeTokens(tokens, t.tokenEndpoint, t.clientId || this.clientId);
          return tokens.access_token ?? null;
        } finally {
          this.#refreshInFlight = null;
        }
      })();
    }

    return this.#refreshInFlight;
  }

  /** Alias for getToken to match existing Kanban demo. */
  async ensureToken() {
    return this.getToken();
  }

  /** Synchronous accessor for currently stored access token (without refresh check). */
  currentToken() {
    return this.getTokens()?.accessToken ?? null;
  }
}

// Default singleton instance for quick usage
let defaultAuth = null;
function getDefaultAuth() {
  if (!defaultAuth) defaultAuth = new JayDBAuth();
  return defaultAuth;
}

export async function beginLogin(opts) {
  return getDefaultAuth().signIn(opts);
}

export async function completeLoginIfCallback(opts) {
  return getDefaultAuth().handleCallback(opts);
}

export function isSignedIn() {
  return getDefaultAuth().isSignedIn();
}

export function identityClaims() {
  return getDefaultAuth().getUser();
}

export async function ensureToken() {
  return getDefaultAuth().getToken();
}

export function currentToken() {
  return getDefaultAuth().currentToken();
}

export function signOut() {
  return getDefaultAuth().signOut();
}

export { JayDBAuth as Auth };
