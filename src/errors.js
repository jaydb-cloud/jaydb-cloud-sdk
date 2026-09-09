/**
 * errors.js — Typed error hierarchy for JayDB Cloud.
 */

/**
 * Base class for all errors raised by the JayDB Cloud SDK.
 */
export class JayDBError extends Error {
  /**
   * @param {string} message - Human-readable error description.
   * @param {object} [opts]
   * @param {number} [opts.status=0] - HTTP status code if originated from an HTTP request.
   * @param {string|null} [opts.key=null] - Document key involved in the operation.
   * @param {any} [opts.body=null] - Response body or raw error payload.
   */
  constructor(message, { status = 0, key = null, body = null } = {}) {
    super(message);
    this.name = 'JayDBError';
    this.status = status;
    this.key = key;
    this.body = body;
  }
}

/**
 * Precondition Failed (HTTP 412).
 * Raised when an `ifMatch` conditional write lost a race with a concurrent update,
 * or when a `createOnly` write found the key already occupied.
 *
 * Typical resolution: re-read the latest document revision (`get()`), re-apply your
 * mutations to the new state, and write again with the updated ETag.
 */
export class ConflictError extends JayDBError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'ConflictError';
  }
}

/**
 * Document or Namespace Not Found (HTTP 404).
 */
export class NotFoundError extends JayDBError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'NotFoundError';
  }
}

/**
 * Authentication or Authorization failure (HTTP 401 / 403).
 * Raised when credentials (API key or Bearer token) are missing, invalid, expired,
 * or lack permissions for the requested path or action.
 */
export class AuthError extends JayDBError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'AuthError';
  }
}
