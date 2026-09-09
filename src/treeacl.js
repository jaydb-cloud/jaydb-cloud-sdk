/**
 * treeacl.js — Cryptographic stateless invite token generator and verifier for JayDB Cloud.
 *
 * Implements HMAC-SHA256 signed payloads carrying tree path delegation claims:
 *   - tree_path: e.g. "boards/{boardId}/**"
 *   - role: "read" | "write" | "own"
 *   - inviter_id / inviter
 *   - exp: timestamp
 *
 * Generates and verifies 100% client-side with zero server calls.
 */

const DEFAULT_SECRET = 'jaydb-kanban-tree-acl-signing-key-2026';

function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Cryptography API (crypto.subtle) is required.');
}

export function b64url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function fromB64url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret = DEFAULT_SECRET) {
  const cryptoObj = getCrypto();
  const enc = new TextEncoder();
  return cryptoObj.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * TreeACL provides stateless invite signing and verification for hierarchical resources.
 */
export class TreeACL {
  /**
   * Sign a stateless invite token for a tree path or board ID.
   *
   * @param {object} opts
   * @param {string} [opts.treePath] - e.g. "boards/my-board/**"
   * @param {string} [opts.boardId] - Board identifier (convenience shorthand for treePath "boards/{boardId}/**")
   * @param {'read' | 'write' | 'own'} opts.role - Permission granted by this invite
   * @param {string} [opts.inviterName='Admin'] - Name or display tag of the inviting user
   * @param {number} [opts.expiresInMs=604800000] - Lifetime in ms (defaults to 7 days)
   * @param {string} [opts.secret] - Shared signing key (defaults to standard tenant key)
   * @returns {Promise<string>} URL-safe signed token string (payload.signature)
   */
  static async signInvite({
    treePath,
    boardId,
    role,
    inviterName = 'Admin',
    expiresInMs = 7 * 24 * 60 * 60 * 1000,
    secret = DEFAULT_SECRET,
  }) {
    if (!['read', 'write', 'own'].includes(role)) {
      throw new Error(`invalid role: ${role}`);
    }

    const path = treePath || (boardId ? `boards/${boardId}/**` : null);
    if (!path) {
      throw new Error('treePath or boardId is required');
    }

    const cryptoObj = getCrypto();
    const nonce = b64url(cryptoObj.getRandomValues(new Uint8Array(12)));
    const payload = {
      type: 'tree_invite',
      tree_path: path,
      role,
      inviter: inviterName,
      exp: Date.now() + expiresInMs,
      nonce,
    };
    if (boardId) {
      payload.board_id = boardId;
    }

    const enc = new TextEncoder();
    const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));

    const key = await getHmacKey(secret);
    const sigBuffer = await cryptoObj.subtle.sign('HMAC', key, enc.encode(payloadB64));
    const sigB64 = b64url(sigBuffer);

    return `${payloadB64}.${sigB64}`;
  }

  /**
   * Verify a stateless invite token.
   *
   * @param {string} rawToken - Signed invite token (payload.signature)
   * @param {object} [opts]
   * @param {string} [opts.secret] - Shared signing key
   * @returns {Promise<{treePath: string, boardId?: string, role: string, inviter: string, exp: number} | null>}
   *          Parsed invite claims or null if invalid or expired.
   */
  static async verifyInvite(rawToken, { secret = DEFAULT_SECRET } = {}) {
    if (!rawToken || typeof rawToken !== 'string') return null;

    const parts = rawToken.trim().split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const [payloadB64, sigB64] = parts;

    try {
      const cryptoObj = getCrypto();
      const key = await getHmacKey(secret);
      const enc = new TextEncoder();
      const sigBytes = fromB64url(sigB64);

      const valid = await cryptoObj.subtle.verify(
        'HMAC',
        key,
        sigBytes,
        enc.encode(payloadB64),
      );
      if (!valid) return null;

      const payloadBytes = fromB64url(payloadB64);
      const dec = new TextDecoder();
      const payload = JSON.parse(dec.decode(payloadBytes));

      if (payload.type !== 'tree_invite') return null;
      if (payload.exp && Date.now() > payload.exp) {
        return null; // Expired
      }

      return {
        treePath: payload.tree_path,
        boardId: payload.board_id || null,
        role: payload.role,
        inviter: payload.inviter,
        exp: payload.exp,
      };
    } catch {
      return null;
    }
  }
}

/** Shorthand for board invite generation, backwards compatible with Kanban demo. */
export async function signBoardInvite(opts) {
  return TreeACL.signInvite(opts);
}

/** Shorthand for board invite verification, backwards compatible with Kanban demo. */
export async function verifyBoardInvite(rawToken, opts) {
  return TreeACL.verifyInvite(rawToken, opts);
}
