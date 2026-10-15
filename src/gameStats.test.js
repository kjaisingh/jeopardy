import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStandings, buildStats } from './gameStats.js';

const teams = [
  { id: 'a', name: 'Alpha', score: 100 },
  { id: 'b', name: 'Beta', score: 100 },
  { id: 'c', name: 'Gamma', score: -50 }
];

const historyEntry = (overrides = {}) => ({
  ownerPlayerId: 'owner-1',
  ownerPlayerName: 'Owner One',
  selectedByTeamId: 'a',
  solvedByTeamId: null,
  value: 100,
  multiplier: 1,
  pointsAwarded: 0,
  prompt: 'Prompt',
  answer: 'Answer',
  attempts: [],
  closedReason: 'passed',
  ...overrides
});

test('standings use competition ranks and support negative scores', () => {
  const standings = buildStandings(teams, []);
  assert.deepEqual(standings.map(({ name, rank }) => [name, rank]), [
    ['Alpha', 1],
    ['Beta', 1],
    ['Gamma', 3]
  ]);
  assert.equal(standings[2].gapToLeader, 150);
  assert.equal(standings[2].accuracyPct, null);
});

test('accuracy excludes skips and treats an overridden miss as correct', () => {
  const history = [
    historyEntry({
      solvedByTeamId: 'a',
      closedReason: 'overridden',
      pointsAwarded: 100,
      attempts: [
        { teamId: 'a', isCorrect: false, skipped: false },
        { teamId: 'b', isCorrect: false, skipped: true }
      ]
    })
  ];

  const standings = buildStandings(teams, history);
  assert.deepEqual(
    standings.find((team) => team.id === 'a'),
    {
      id: 'a',
      name: 'Alpha',
      score: 100,
      rank: 1,
      isLeader: true,
      gapToLeader: 0,
      attempted: 1,
      correct: 1,
      accuracyPct: 100
    }
  );
  assert.equal(standings.find((team) => team.id === 'b').attempted, 0);
});

test('summary identifies steals, Daily Double, toughest, and unsolved questions', () => {
  const history = [
    historyEntry({
      ownerPlayerId: 'owner-1',
      selectedByTeamId: 'a',
      solvedByTeamId: 'b',
      value: 200,
      multiplier: 2,
      pointsAwarded: 400,
      closedReason: 'solved',
      attempts: [
        { teamId: 'a', isCorrect: false, skipped: false },
        { teamId: 'b', isCorrect: true, skipped: false }
      ]
    }),
    historyEntry({
      ownerPlayerId: 'owner-2',
      ownerPlayerName: 'Owner Two',
      value: 500,
      prompt: 'Hard prompt',
      answer: 'Hard answer',
      closedReason: 'exhausted',
      attempts: [
        { teamId: 'a', isCorrect: false, skipped: false },
        { teamId: 'b', isCorrect: false, skipped: false },
        { teamId: 'c', isCorrect: false, skipped: false }
      ]
    })
  ];

  const stats = buildStats(teams, history);
  assert.equal(stats.questionsSolved, 1);
  assert.deepEqual(stats.mostSteals, { teamId: 'b', teamName: 'Beta', count: 1 });
  assert.deepEqual(stats.dailyDouble, {
    value: 200,
    points: 400,
    solved: true,
    teamName: 'Beta'
  });
  assert.equal(stats.toughestQuestion.ownerPlayerName, 'Owner Two');
  assert.deepEqual(stats.unsolved, [
    {
      ownerPlayerName: 'Owner Two',
      value: 500,
      prompt: 'Hard prompt',
      answer: 'Hard answer'
    }
  ]);
});
