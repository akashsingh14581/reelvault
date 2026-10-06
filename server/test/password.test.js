import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

test('password hashing verifies only the right password', () => {
  const h = hashPassword('correct horse battery');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.notEqual(hashPassword('a'), hashPassword('a')); // unique salts
});
