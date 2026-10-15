import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedCycle, parseBadge, statusForJob, updateBody } from './check-cron-job-badge.mjs';

const badge = (message) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>Job title</tspan></text><text fill="#fff"><tspan>${message}</tspan></text></svg>`;
const issue = `Automated keepalive watch.\n\n| Scheduled cycle (ET) | Project | Monitor |\n| --- | --- | --- |\n<!-- keepalive-monitor:end -->`;
const job = { name: 'Project', minute: 10 };

test('parses badge results and rejects changed markup', () => {
  assert.deepEqual(parseBadge(badge('success (18:10)')), { status: 'success', time: '18:10' });
  assert.deepEqual(parseBadge(badge('not run yet')), { status: 'not run yet' });
  assert.deepEqual(parseBadge(badge('failure (18:10)')), { status: 'failure or unknown format' });
  assert.throws(() => parseBadge('<svg></svg>'), /unexpected format/);
});

test('expects the staggered run after the thirty-minute grace', () => {
  assert.equal(expectedCycle(new Date('2026-10-15T22:45:00Z'), job.minute), '2026-10-15 18:10');
  assert.equal(expectedCycle(new Date('2026-10-16T04:45:00Z'), job.minute), '2026-10-16 00:10');
  assert.equal(expectedCycle(new Date('2026-10-16T10:45:00Z'), job.minute), '2026-10-16 06:10');
});

test('rejects a stale success badge', () => {
  const at1845 = new Date('2026-10-15T22:45:00Z');
  assert.equal(statusForJob(job, parseBadge(badge('success (18:10)')), at1845).ok, true);
  assert.equal(statusForJob(job, parseBadge(badge('success (12:10)')), at1845).ok, false);
});

test('issue table detects missed cycles and replaces reruns', () => {
  const good = { ok: true, text: '✅ 18:10' };
  const first = updateBody(issue, '2026-10-15 18:00', good);
  assert.equal(first.anomaly, false);
  const rerun = updateBody(first.nextBody, '2026-10-15 18:00', good);
  assert.equal((rerun.nextBody.match(/\| 2026-10-15 18:00 \|/g) ?? []).length, 1);
  assert.equal(rerun.nextBody, first.nextBody);
  const gap = updateBody(rerun.nextBody, '2026-10-16 06:00', good);
  assert.equal(gap.gapCount, 1);
  assert.equal(gap.anomaly, true);
  assert.match(gap.nextBody, /missed 1 monitor cycle/);
  const missedFirst = updateBody(issue, '2026-10-16 00:00', good);
  assert.equal(missedFirst.gapCount, 1);
  assert.equal(missedFirst.anomaly, true);
});

test('issue table records a failed badge and detects recovery', () => {
  const failed = updateBody(issue, '2026-10-15 18:00', { ok: false, text: '❌ not run yet' });
  assert.equal(failed.anomaly, true);
  assert.equal(failed.wasAnomaly, false);
  const recovered = updateBody(failed.nextBody, '2026-10-16 00:00', { ok: true, text: '✅ 00:10' });
  assert.equal(recovered.anomaly, false);
  assert.equal(recovered.wasAnomaly, true);
});
