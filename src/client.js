/**
 * client.js — High-level, dependency-free client for the JayDB Cloud Document API.
 *
 * Talks directly to:
 *   https://{tenant}.jaydb.com/v1/n/{namespace}/docs/{key}
 *
 * Supports optimistic concurrency control (CAS) via standard HTTP ETags,
 * per-user OIDC PKCE tokens, API keys, and automatic request metrics.
 */

import { JayDBError, ConflictError, NotFoundError, AuthError } from './errors.js';

/**
 * Percent-encode a document key while preserving the hierarchy separators ('/').
 * e.g., "boards/project 1/meta" -> "boards/project%201/meta"
 */
export function encodeKey(key) {
  return String(key)
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Strip transport quoting and weak indicators from an ETag header.
 * e.g., 'W/"abc123"' -> 'abc123'
 */
export function unquoteETag(value) {
  if (!value) return null;
  return String(value).replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '');
}

export class JayDBClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl - Tenant origin, e.g. "https://acme.jaydb.com"
   * @param {string} opts.namespace - Namespace name, e.g. "default"
   * @param {import('./auth.js').JayDBAuth} [opts.auth] - JayDBAuth instance managing the OIDC PKCE session
   * @param {function} [opts.getToken] - Sync or async `() => string | null` returning an access token
   * @param {string} [opts.token] - Static access token string
   * @param {typeof fetch} [opts.fetch] - Custom fetch implementation
   */
  constructor({ baseUrl, namespace, auth, getToken, token, fetch: customFetch } = {}) {
    if (!baseUrl) throw new Error('jaydb: baseUrl is required');
    if (!namespace) throw new Error('jaydb: namespace is required');
    if (!auth && !getToken && !token) {
      throw new Error('jaydb: auth, getToken, or token is required for OIDC authentication');
    }

    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.namespace = namespace;
    this.auth = auth ?? null;
    this.getToken = getToken ?? (token ? () => token : null);
    this.fetch = customFetch || (typeof globalThis !== 'undefined' ? globalThis.fetch.bind(globalThis) : null);

    if (!this.fetch) {
      throw new Error('jaydb: fetch API is not available in this environment.');
    }

    /** Request counters and latency metrics. */
    this.stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      lists: 0,
      conflicts: 0,
      totalRequests: 0,
      totalLatencyMs: 0,
      lastLatencyMs: 0,
      avgLatencyMs: 0,
    };

    this.#warned = new Set();
  }

  #warned;

  /**
   * Build authentication headers using the OIDC Bearer token.
   */
  async #authHeaders() {
    if (this.auth && typeof this.auth.getToken === 'function') {
      const token = await this.auth.getToken();
      if (token) return { Authorization: `Bearer ${token}` };
    }
    if (this.getToken) {
      const token = await this.getToken();
      if (token) return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  #docsUrl(key = '') {
    const base = `${this.baseUrl}/v1/n/${encodeURIComponent(this.namespace)}/docs`;
    const encoded = encodeKey(key);
    return encoded ? `${base}/${encoded}` : base;
  }

  #recordLatency(ms) {
    this.stats.totalRequests++;
    this.stats.totalLatencyMs += ms;
    this.stats.lastLatencyMs = Math.round(ms);
    this.stats.avgLatencyMs = Math.round(this.stats.totalLatencyMs / this.stats.totalRequests);
  }

  async #request(method, url, { headers = {}, body, signal } = {}, key = null) {
    const startedAt = performance.now();
    let response;
    try {
      const authHeaders = await this.#authHeaders();
      response = await this.fetch(url, {
        method,
        headers: { ...authHeaders, ...headers },
        body,
        signal,
        credentials: 'omit',
        mode: 'cors',
      });
    } catch (cause) {
      this.#recordLatency(performance.now() - startedAt);
      if (cause?.name === 'AbortError') throw cause;
      throw new JayDBError(
        `Network or CORS failure calling ${method} ${url}. If the server is reachable, ` +
          `verify that your application's origin is listed in allowed origins.`,
        { key, body: String(cause?.message ?? cause) },
      );
    }
    this.#recordLatency(performance.now() - startedAt);
    return response;
  }

  async #errorFrom(response, key) {
    let message = `${response.status} ${response.statusText}`;
    let body = null;
    try {
      body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error bodies ignored */
    }

    const opts = { status: response.status, key, body };
    switch (response.status) {
      case 401:
      case 403:
        return new AuthError(message, opts);
      case 404:
        return new NotFoundError(message, opts);
      case 412:
        return new ConflictError(message, opts);
      default:
        return new JayDBError(message, opts);
    }
  }

  #warnOnce(id, message) {
    if (this.#warned.has(id)) return;
    this.#warned.add(id);
    console.warn(`[jaydb] ${message}`);
  }

  /**
   * Read one document by key.
   *
   * @template T
   * @param {string} key - Document key path
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal]
   * @param {string} [opts.knownETag] - Fallback ETag if CORS headers mask the ETag header
   * @returns {Promise<{key: string, data: T, etag: string|null} | null>}
   *          Document record or null when the key does not exist.
   */
  async get(key, { signal, knownETag } = {}) {
    this.stats.reads++;
    const response = await this.#request('GET', this.#docsUrl(key), { signal }, key);

    if (response.status === 404) return null;
    if (!response.ok) throw await this.#errorFrom(response, key);

    const data = await response.json();
    let etag = unquoteETag(response.headers.get('ETag'));

    // Fallback if ETag is not exposed via Access-Control-Expose-Headers
    if (!etag) {
      etag = knownETag ?? (await this.#etagFromListing(key, signal));
    }

    return { key, data, etag };
  }

  async #etagFromListing(key, signal) {
    try {
      const { items } = await this.list({ prefix: key, limit: 10, signal });
      return items.find((item) => item.key === key)?.etag ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Write one document.
   *
   * @template T
   * @param {string} key - Document key path
   * @param {T} data - JSON-serializable document content
   * @param {object} [opts]
   * @param {string} [opts.ifMatch] - Only write if the existing document matches this ETag (CAS).
   * @param {boolean} [opts.createOnly] - Only write if the key does not yet exist (If-None-Match: *).
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{key: string, etag: string, modTime: string|null}>}
   */
  async put(key, data, { ifMatch, createOnly, signal } = {}) {
    this.stats.writes++;

    const headers = { 'Content-Type': 'application/json' };
    if (ifMatch) {
      headers['If-Match'] = `"${unquoteETag(ifMatch)}"`;
    } else if (createOnly) {
      headers['If-None-Match'] = '*';
    }

    const response = await this.#request(
      'PUT',
      this.#docsUrl(key),
      { headers, body: JSON.stringify(data), signal },
      key,
    );

    if (!response.ok) {
      if (response.status === 412) this.stats.conflicts++;
      throw await this.#errorFrom(response, key);
    }

    const payload = await response.json().catch(() => ({}));
    return {
      key,
      etag: unquoteETag(response.headers.get('ETag')) ?? unquoteETag(payload.etag),
      modTime: payload.mod_time ?? null,
    };
  }

  /**
   * Delete one document.
   *
   * @param {string} key - Document key path
   * @param {object} [opts]
   * @param {string} [opts.ifMatch] - Only delete if the document still matches this ETag.
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<boolean>} True if deleted, false if the document did not exist.
   */
  async delete(key, { ifMatch, signal } = {}) {
    this.stats.deletes++;

    const headers = {};
    if (ifMatch) {
      headers['If-Match'] = `"${unquoteETag(ifMatch)}"`;
    }

    const response = await this.#request('DELETE', this.#docsUrl(key), { headers, signal }, key);

    if (response.status === 404) return false;
    if (!response.ok) {
      if (response.status === 412) this.stats.conflicts++;
      throw await this.#errorFrom(response, key);
    }
    return true;
  }

  /**
   * List document metadata under a key prefix.
   *
   * @param {object} [opts]
   * @param {string} [opts.prefix=''] - Path prefix, e.g. "cards/"
   * @param {number} [opts.limit=100] - Items per page (server caps at 1000)
   * @param {string} [opts.cursor] - Continuation cursor from previous list call
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{items: Array<{key: string, etag: string, mod_time: string, size: number}>, nextCursor: string|null}>}
   */
  async list({ prefix = '', limit = 100, cursor, signal } = {}) {
    this.stats.lists++;

    const params = new URLSearchParams({ list: '1' });
    if (prefix) params.set('prefix', prefix);
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);

    const url = `${this.#docsUrl()}?${params}`;
    const response = await this.#request('GET', url, { signal }, prefix);

    if (!response.ok) throw await this.#errorFrom(response, prefix);

    const payload = await response.json();
    return {
      items: (payload.items ?? []).map((item) => ({
        ...item,
        etag: unquoteETag(item.etag),
      })),
      nextCursor: payload.next_cursor ?? null,
    };
  }

  /**
   * List all documents under a prefix, automatically iterating through cursors.
   *
   * @param {object} [opts]
   * @param {string} [opts.prefix='']
   * @param {number} [opts.pageLimit=1000]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<Array<{key: string, etag: string, mod_time: string, size: number}>>}
   */
  async listAll({ prefix = '', pageLimit = 1000, signal } = {}) {
    const items = [];
    let cursor;
    do {
      const page = await this.list({ prefix, limit: pageLimit, cursor, signal });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }
}

export { JayDBClient as JayDB };
