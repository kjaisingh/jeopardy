import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateNames, reconcileDrafts, reconcileTeams } from './gameSetup.js';
import { formatMoney } from './format.js';

test('reconcileDrafts preserves matching values and creates missing slots', () => {
  const current = [
    { localId: 'one', value: 100, prompt: 'Keep me', answer: 'A' },
    { localId: 'three', value: 300, prompt: 'Also keep me', answer: 'B' }
  ];

  const result = reconcileDrafts(current, 3);

  assert.equal(result.length, 3);
  assert.equal(result[0].localId, 'one');
  assert.equal(result[1].value, 200);
  assert.equal(result[2].localId, 'three');
});

test('reconcileTeams assigns each player exactly once', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const current = [
    { id: 'one', name: 'One', playerIds: ['a', 'missing'] },
    { id: 'two', name: 'Two', playerIds: ['b'] }
  ];

  const result = reconcileTeams(current, 2, players);
  const assigned = result.flatMap((team) => team.playerIds);

  assert.deepEqual(assigned.sort(), ['a', 'b', 'c']);
});

test('duplicateNames ignores case and surrounding whitespace', () => {
  assert.deepEqual(
    duplicateNames([{ name: 'Alpha' }, { name: ' alpha ' }, { name: 'Beta' }]),
    ['alpha']
  );
});

test('formatMoney places minus sign before currency symbol', () => {
  assert.equal(formatMoney(-1200), '-$1,200');
  assert.equal(formatMoney(1200), '$1,200');
});
