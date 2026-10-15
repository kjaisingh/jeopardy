import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteRoomCode, normalizeRoomCodeInput } from './constants.js';

test('room code input normalizes valid characters and removes ambiguous ones', () => {
  assert.equal(normalizeRoomCodeInput('abci-10234xyz'), 'ABC234');
  assert.equal(normalizeRoomCodeInput('abc234extra'), 'ABC234');
});

test('room code readiness requires exactly six valid characters', () => {
  assert.equal(isCompleteRoomCode('abc234'), true);
  assert.equal(isCompleteRoomCode('abc23'), false);
  assert.equal(isCompleteRoomCode('abc10o'), false);
});
