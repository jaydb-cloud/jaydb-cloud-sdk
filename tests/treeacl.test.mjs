import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TreeACL,
  signBoardInvite,
  verifyBoardInvite,
} from '../src/index.js';

test('TreeACL signs and verifies valid invite token', async () => {
  const token = await TreeACL.signInvite({
    treePath: 'boards/demo-1/**',
    role: 'write',
    inviterName: 'Alice',
    expiresInMs: 60_000,
  });

  assert.ok(token);
  assert.equal(token.split('.').length, 2);

  const payload = await TreeACL.verifyInvite(token);
  assert.notEqual(payload, null);
  assert.equal(payload.treePath, 'boards/demo-1/**');
  assert.equal(payload.role, 'write');
  assert.equal(payload.inviter, 'Alice');
  assert.ok(payload.exp > Date.now());
});

test('TreeACL supports boardId convenience parameter', async () => {
  const token = await signBoardInvite({
    boardId: 'project-x',
    role: 'read',
    inviterName: 'Bob',
  });

  const payload = await verifyBoardInvite(token);
  assert.notEqual(payload, null);
  assert.equal(payload.treePath, 'boards/project-x/**');
  assert.equal(payload.boardId, 'project-x');
  assert.equal(payload.role, 'read');
  assert.equal(payload.inviter, 'Bob');
});

test('TreeACL rejects tampered tokens', async () => {
  const token = await TreeACL.signInvite({
    treePath: 'boards/tamper/**',
    role: 'read',
  });

  const [payloadB64, sig] = token.split('.');
  // Modify one character in payload
  const tamperedPayload = payloadB64.slice(0, -2) + 'AA';
  const tamperedToken = `${tamperedPayload}.${sig}`;

  const verified = await TreeACL.verifyInvite(tamperedToken);
  assert.equal(verified, null);
});

test('TreeACL rejects expired tokens', async () => {
  const token = await TreeACL.signInvite({
    treePath: 'boards/expired/**',
    role: 'read',
    expiresInMs: -1000, // already expired
  });

  const verified = await TreeACL.verifyInvite(token);
  assert.equal(verified, null);
});

test('TreeACL validates roles strictly', async () => {
  await assert.rejects(
    async () => TreeACL.signInvite({ treePath: 'a/b', role: 'superuser' }),
    /invalid role: superuser/,
  );
});
