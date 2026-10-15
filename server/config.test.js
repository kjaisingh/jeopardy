import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveInteger, positiveNumber } from './config.js';

test('positiveNumber accepts finite positive values and otherwise uses its fallback', () => {
  assert.equal(positiveNumber('1.5', 10), 1.5);
  assert.equal(positiveNumber('0', 10), 10);
  assert.equal(positiveNumber('-2', 10), 10);
  assert.equal(positiveNumber('invalid', 10), 10);
  assert.equal(positiveNumber('Infinity', 10), 10);
});

test('positiveInteger rejects fractions and non-positive values', () => {
  assert.equal(positiveInteger('24', 10), 24);
  assert.equal(positiveInteger('1.5', 10), 10);
  assert.equal(positiveInteger('0', 10), 10);
  assert.equal(positiveInteger(undefined, 10), 10);
});
