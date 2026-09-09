# JayDB Cloud Frontend SDK (`@jaydb/cloud`)

The official zero-dependency frontend SDK for **[JayDB Cloud](https://jaydb.com)**.

Build collaborative, multi-user web applications with **zero backend servers**. The browser communicates directly with JayDB Cloud for both **user authentication (OIDC PKCE)** and **document storage with optimistic concurrency control (ETags / CAS)**.

[![npm version](https://img.shields.io/badge/npm-v0.1.0-blue.svg)](#installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)
[![TypeScript Ready](https://img.shields.io/badge/types-TypeScript-blue.svg)](types/index.d.ts)

---

## ⚡ Key Features

- 🚀 **Zero Backend Required**: Ship apps as 100% static HTML & JavaScript to GitHub Pages, Cloudflare Pages, Vercel, or S3.
- 🔑 **Built-in OIDC + PKCE Authentication**: Users log in directly from the browser with Google, GitHub, or Microsoft. No client secrets are ever shipped to the browser.
- 🛡️ **Conflict-Free Concurrency (CAS)**: First-class support for HTTP ETags (`If-Match` / `If-None-Match: *`), preventing race conditions and accidental overwrites.
- 🌲 **Tree ACL Collaboration**: Generate and verify stateless, cryptographically signed invite tokens client-side.
- 📊 **Built-in Latency & Observability**: Real-time counters for reads, writes, lists, conflicts, and round-trip latencies.
- 🪶 **Zero Dependencies & Lightweight**: Pure native Web APIs (`fetch`, `crypto.subtle`, `sessionStorage`). Works in any browser and Node.js 18+.
- 🟦 **Full TypeScript Support**: Complete `.d.ts` type declarations and generics for typed document models.

---

## 📦 Installation & Adoption

### 1. Modern Bundlers (Vite, Next.js, Webpack, esbuild)

```bash
npm install @jaydb/cloud
# or
pnpm add @jaydb/cloud
# or
yarn add @jaydb/cloud
```

```javascript
import { JayDB, Auth, TreeACL, ConflictError } from '@jaydb/cloud';
```

### 2. Zero-Build Browser (Vanilla HTML/JS or Static Sites)

No build tools or node_modules needed! Import the standalone ESM bundle directly:

```html
<script type="module">
  import { JayDB, Auth } from './jaydb-cloud.esm.js';

  const db = new JayDB({
    baseUrl: 'https://your-tenant.jaydb.com',
    namespace: 'default',
    apiKey: 'jcloud_sec_your_key',
  });

  const doc = await db.get('settings/theme');
  console.log('Current theme:', doc?.data);
</script>
```

### 3. Classic Script Tag (Global `window.JayDBCloud`)

```html
<script src="./jaydb-cloud.js"></script>
<script>
  const { JayDB, Auth } = window.JayDBCloud;
</script>
```

---

## 🚀 Quick Start (60 Seconds)

### Scenario A: Connect with an API Key

Ideal for public read-only apps, internal dashboards, or rapid prototyping:

```javascript
import { JayDB } from '@jaydb/cloud';

const db = new JayDB({
  baseUrl: 'https://acme.jaydb.com',
  namespace: 'production',
  apiKey: 'jcloud_sec_live_example123',
});

// 1. Write a document
await db.put('users/101', { name: 'Alice', role: 'engineer' });

// 2. Read it back
const doc = await db.get('users/101');
console.log(doc.data); // { name: 'Alice', role: 'engineer' }
console.log(doc.etag); // e.g. "9a2f1c84..."
```

---

### Scenario B: User Sign-In with OIDC + PKCE (Frontend-Only Auth)

Let each user sign in with their own identity (Google, GitHub, Microsoft). The SDK automatically manages token exchange, token storage, and background silent refresh:

```javascript
import { JayDB, Auth } from '@jaydb/cloud';

// 1. Initialize Auth
const auth = new Auth({
  issuer: 'https://acme.jaydb.com',
  clientId: 'my-kanban-app',
});

// 2. Connect the database to auth
const db = new JayDB({
  baseUrl: 'https://acme.jaydb.com',
  namespace: 'production',
  auth, // All database calls automatically send `Authorization: Bearer <token>`
});

// 3. Handle login callback when returning from Identity Provider
if (new URL(window.location.href).searchParams.has('code')) {
  const returnContext = await auth.handleCallback();
  console.log('Signed in successfully!', auth.getUser());
}

// 4. Trigger sign-in redirect
document.getElementById('login-google-btn').onclick = () => {
  auth.signIn({ idp: 'google', context: { currentBoard: 'roadmap' } });
};
```

---

## 📖 Core Concepts & Usage

### 1. Document CRUD & Optimistic Concurrency Control (CAS)

Every document in JayDB Cloud carries an **ETag**. Reads return the current ETag, and writes can demand it. This allows multiple browsers to collaborate without overwriting each other.

```javascript
import { JayDB, ConflictError } from '@jaydb/cloud';

const db = new JayDB({ baseUrl, namespace, auth });

// Read
const doc = await db.get('cards/task-123');
if (!doc) {
  console.log('Document does not exist');
}

// Write with Optimistic Locking (Compare-And-Swap)
try {
  await db.put('cards/task-123', {
    ...doc.data,
    status: 'in-progress',
    assignedTo: 'Alice',
  }, {
    ifMatch: doc.etag, // Fails if someone else edited the card in the meantime
  });
} catch (err) {
  if (err instanceof ConflictError) {
    console.warn('Someone else modified this card! Re-reading latest version...');
    const latest = await db.get('cards/task-123');
    // re-apply your changes to `latest.data` and try again
  }
}

// Create-Only Allocation (Guarantees no accidental overwrite)
await db.put('cards/task-new', { title: 'New Task' }, {
  createOnly: true, // Sends `If-None-Match: *`
});

// Delete with ETag guard
await db.delete('cards/task-123', { ifMatch: doc.etag });
```

---

### 2. Prefix Listings & Pagination

JayDB Cloud keys are hierarchical (e.g. `cards/todo/card-1`). You can list keys by prefix:

```javascript
// List the first 50 cards
const { items, nextCursor } = await db.list({
  prefix: 'cards/',
  limit: 50,
});

for (const item of items) {
  console.log(item.key, item.etag, item.size, item.mod_time);
}

// Or list all items across pages automatically:
const allCards = await db.listAll({ prefix: 'cards/' });
console.log(`Found ${allCards.length} cards`);
```

> **Efficiency Tip:** Listings return metadata (`key`, `etag`, `mod_time`, `size`) rather than full bodies. Use ETags from listings to only re-fetch documents that actually changed.

---

### 3. Tree ACL: Stateless Share Links & Collaboration

JayDB Cloud supports hierarchical access control. The SDK provides stateless, client-signed invite tokens powered by HMAC-SHA256:

```javascript
import { TreeACL } from '@jaydb/cloud';

// 1. Board Owner generates a 7-day invite link:
const inviteToken = await TreeACL.signInvite({
  boardId: 'project-x', // or treePath: 'boards/project-x/**'
  role: 'write',        // 'read' | 'write' | 'own'
  inviterName: 'Alice',
  expiresInMs: 7 * 24 * 60 * 60 * 1000,
});

const inviteUrl = `${window.location.origin}/#invite=${inviteToken}`;

// 2. Invitee opens link — browser verifies the cryptographic signature instantly:
const invite = await TreeACL.verifyInvite(inviteToken);
if (invite) {
  console.log(`Invited to ${invite.boardId} with ${invite.role} access by ${invite.inviter}`);
} else {
  console.error('Invite link is invalid or expired!');
}
```

---

### 4. Observability & Live Metrics

The client tracks request counters and round-trip latencies:

```javascript
console.log(db.stats);
/*
{
  reads: 42,
  writes: 12,
  deletes: 2,
  lists: 10,
  conflicts: 1,
  totalRequests: 66,
  totalLatencyMs: 1420,
  lastLatencyMs: 18,
  avgLatencyMs: 21
}
*/
```

---

## 🛠️ TypeScript Support

The SDK is written with complete type definitions. Provide your own data schemas for type-safe document access:

```typescript
import { JayDB, DocumentResult } from '@jaydb/cloud';

interface UserProfile {
  name: string;
  avatar: string;
  theme: 'light' | 'dark';
}

const db = new JayDB({ baseUrl, namespace, apiKey });

// Typed GET
const doc = await db.get<UserProfile>('users/alice');
if (doc) {
  console.log(doc.data.theme); // string autocomplete & type-checked!
}

// Typed PUT
await db.put<UserProfile>('users/alice', {
  name: 'Alice',
  avatar: 'https://...',
  theme: 'dark',
});
```

---

## 🚨 Error Handling

All SDK exceptions inherit from `JayDBError`:

```javascript
import { JayDBError, ConflictError, NotFoundError, AuthError } from '@jaydb/cloud';

try {
  await db.put('boards/main', data, { ifMatch: oldETag });
} catch (err) {
  if (err instanceof ConflictError) {
    // HTTP 412: CAS mismatch — another user wrote first
  } else if (err instanceof AuthError) {
    // HTTP 401 or 403: Invalid key or token expired
  } else if (err instanceof NotFoundError) {
    // HTTP 404: Document or namespace not found
  } else if (err instanceof JayDBError) {
    console.error(`Database error [HTTP ${err.status}] for key ${err.key}:`, err.message);
  }
}
```

---

## 📄 License

MIT © [JayDB Cloud](https://jaydb.com)
