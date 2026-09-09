/**
 * build.mjs — Zero-dependency build script for JayDB Cloud SDK.
 *
 * Generates:
 *   - dist/index.mjs (ESM entrypoint)
 *   - dist/index.cjs (CommonJS entrypoint)
 *   - dist/index.d.ts (TypeScript declarations)
 *   - dist/jaydb-cloud.esm.js (Standalone single-file ESM for direct browser import)
 *   - dist/jaydb-cloud.js (Standalone UMD/IIFE bundle with window.JayDBCloud)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const srcDir = path.resolve(rootDir, 'src');

fs.mkdirSync(distDir, { recursive: true });

// Read source files
const errorsContent = fs.readFileSync(path.join(srcDir, 'errors.js'), 'utf8');
const treeaclContent = fs.readFileSync(path.join(srcDir, 'treeacl.js'), 'utf8');
const authContent = fs.readFileSync(path.join(srcDir, 'auth.js'), 'utf8');
const clientContent = fs.readFileSync(path.join(srcDir, 'client.js'), 'utf8');
const indexContent = fs.readFileSync(path.join(srcDir, 'index.js'), 'utf8');

// 1. Copy TypeScript declarations
const typesSrc = path.join(rootDir, 'types', 'index.d.ts');
if (fs.existsSync(typesSrc)) {
  fs.copyFileSync(typesSrc, path.join(distDir, 'index.d.ts'));
}

// 2. Build standalone single-file ESM (concatenate modules without internal imports)
function cleanImportsAndExports(code) {
  return code
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/^export\s*\{\s*JayDBAuth\s+as\s+Auth\s*\}\s*;\s*$/gm, '')
    .replace(/^export\s*\{\s*JayDBClient\s+as\s+JayDB\s*\}\s*;\s*$/gm, '');
}

const bundledBody = [
  '// JayDB Cloud SDK — Standalone Bundle',
  cleanImportsAndExports(errorsContent),
  cleanImportsAndExports(treeaclContent),
  cleanImportsAndExports(authContent),
  cleanImportsAndExports(clientContent),
  `
export {
  JayDBClient,
  JayDBClient as JayDB,
  JayDBAuth,
  JayDBAuth as Auth,
  TreeACL,
  JayDBError,
  ConflictError,
  NotFoundError,
  AuthError,
  encodeKey,
  unquoteETag,
  beginLogin,
  completeLoginIfCallback,
  isSignedIn,
  identityClaims,
  ensureToken,
  currentToken,
  signOut,
  signBoardInvite,
  verifyBoardInvite,
  b64url,
  fromB64url
};
`,
].join('\n');

fs.writeFileSync(path.join(distDir, 'jaydb-cloud.esm.js'), bundledBody, 'utf8');
fs.writeFileSync(path.join(distDir, 'index.mjs'), bundledBody, 'utf8');

// 3. Build UMD / IIFE bundle for <script src="...">
const iifeBundle = `(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JayDBCloud = factory();
    root.JayDB = root.JayDBCloud.JayDB;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  ${cleanImportsAndExports(errorsContent).replace(/^export\s+/gm, '')}
  ${cleanImportsAndExports(treeaclContent).replace(/^export\s+/gm, '')}
  ${cleanImportsAndExports(authContent).replace(/^export\s+/gm, '')}
  ${cleanImportsAndExports(clientContent).replace(/^export\s+/gm, '')}

  return {
    JayDBClient: JayDBClient,
    JayDB: JayDBClient,
    JayDBAuth: JayDBAuth,
    Auth: JayDBAuth,
    TreeACL: TreeACL,
    JayDBError: JayDBError,
    ConflictError: ConflictError,
    NotFoundError: NotFoundError,
    AuthError: AuthError,
    encodeKey: encodeKey,
    unquoteETag: unquoteETag,
    beginLogin: beginLogin,
    completeLoginIfCallback: completeLoginIfCallback,
    isSignedIn: isSignedIn,
    identityClaims: identityClaims,
    ensureToken: ensureToken,
    currentToken: currentToken,
    signOut: signOut,
    signBoardInvite: signBoardInvite,
    verifyBoardInvite: verifyBoardInvite,
    b64url: b64url,
    fromB64url: fromB64url
  };
}));
`;

fs.writeFileSync(path.join(distDir, 'jaydb-cloud.js'), iifeBundle, 'utf8');
fs.writeFileSync(path.join(distDir, 'index.cjs'), iifeBundle, 'utf8');

console.log('Build completed successfully!');
console.log('Generated:');
console.log('  - dist/index.mjs');
console.log('  - dist/index.cjs');
console.log('  - dist/index.d.ts');
console.log('  - dist/jaydb-cloud.esm.js');
console.log('  - dist/jaydb-cloud.js');
