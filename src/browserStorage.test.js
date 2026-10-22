import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSession, readStorage, writeStorage, removeStorage } from './browserStorage.js';
import { loadDrafts, saveDrafts, clearDrafts } from './draftStorage.js';

const session = { code: 'ABC234', playerId: 'player', sessionToken: 'a'.repeat(43) };
const draft = { localId: 'draft', value: 100, prompt: 'Question', answer: 'Answer' };

test('storage denial and quota errors never interrupt gameplay', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Denied'); } });
  t.after(() => descriptor
    ? Object.defineProperty(globalThis, 'localStorage', descriptor)
    : delete globalThis.localStorage);
  assert.equal(readStorage('key'), null);
  assert.equal(writeStorage('key', 'value'), false);
  assert.equal(removeStorage('key'), false);
  assert.equal(loadSession('key'), null);
  assert.deepEqual(loadDrafts(session), []);
  assert.equal(saveDrafts(session, [draft]), false);
  assert.equal(clearDrafts(session), false);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => null,
    setItem() { throw new Error('Quota exceeded'); },
    removeItem() {}
  } });
  assert.equal(saveDrafts(session, [draft]), false);
});

test('saved sessions and drafts validate shape and preserve valid edits', (t) => {
  const values = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  } });
  t.after(() => descriptor
    ? Object.defineProperty(globalThis, 'localStorage', descriptor)
    : delete globalThis.localStorage);
  for (const invalid of ['{', '[]', '42', JSON.stringify({ ...session, sessionToken: 'bad' })]) {
    writeStorage('session', invalid);
    assert.equal(loadSession('session'), null);
  }
  writeStorage('session', JSON.stringify(session));
  assert.deepEqual(loadSession('session'), session);
  saveDrafts(session, [null, { ...draft, prompt: 123 }, draft, draft]);
  assert.deepEqual(loadDrafts(session), [draft]);
  clearDrafts(session);
  assert.deepEqual(loadDrafts(session), []);
});
