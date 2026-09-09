/**
 * JayDB Cloud SDK
 *
 * Official frontend SDK for JayDB Cloud.
 * Dependency-free, type-safe client for document storage, optimistic concurrency (CAS),
 * OIDC PKCE authentication, and Tree ACL access delegation.
 */

export { JayDBClient, JayDB, encodeKey, unquoteETag } from './client.js';
export {
  JayDBAuth,
  Auth,
  beginLogin,
  completeLoginIfCallback,
  isSignedIn,
  identityClaims,
  ensureToken,
  currentToken,
  signOut,
} from './auth.js';
export {
  TreeACL,
  signBoardInvite,
  verifyBoardInvite,
  b64url,
  fromB64url,
} from './treeacl.js';
export {
  JayDBError,
  ConflictError,
  NotFoundError,
  AuthError,
} from './errors.js';
