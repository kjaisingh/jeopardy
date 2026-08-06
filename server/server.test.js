import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnswerCorrect } from './match.js';
import { requiredText, requiredInteger, requiredOneOf, assertUniqueNames } from './validate.js';
import { gameStore } from './gameStore.js';

const questionsFor = (label) =>
  gameStore.QUESTION_VALUES.map((value) => ({
    prompt: `${label} prompt ${value}`,
    answer: `${label}-answer-${value}`,
    value
  }));

const setupGame = async ({ playerCount = 2, mode = 'finite', rounds = 1, dailyDouble = false, timerSeconds = 0 } = {}) => {
  const hostSocketId = `socket-host-${Math.random()}`;
  const host = await gameStore.createRoom('Host', hostSocketId);
  const players = [{ id: host.playerId, name: 'Host', socketId: hostSocketId }];

  for (let index = 1; index < playerCount; index += 1) {
    const name = `Player${index}`;
    const socketId = `socket-${index}-${host.code}`;
    const joined = await gameStore.joinRoom(host.code, name, socketId);
    players.push({ id: joined.playerId, name, socketId });
  }

  for (const player of players) {
    await gameStore.submitQuestions(host.code, player.id, questionsFor(player.name));
  }

  await gameStore.advanceToTeamSetup(host.code, host.playerId);

  const teams = players.map((player, index) => ({ name: `Team${index + 1}`, playerIds: [player.id] }));
  const room = await gameStore.setTeamsAndSettings(host.code, host.playerId, { teams, mode, rounds, dailyDouble, timerSeconds });

  return { code: host.code, hostPlayerId: host.playerId, players, room };
};

const findOpenCell = (board) => {
  for (const column of board.columns) {
    const cell = column.cells.find((entry) => entry.status === 'open');
    if (cell) return { playerId: column.playerId, value: cell.value };
  }
  return null;
};

const passAllQuestions = async (code, hostPlayerId, initialRoom) => {
  let room = initialRoom;
  while (room.phase !== 'finished') {
    const cell = findOpenCell(room.board);
    await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);
    const { room: nextRoom } = await gameStore.passActiveQuestion(code, hostPlayerId);
    room = nextRoom;
  }
  return room;
};

// --- match.js ----------------------------------------------------------------

test('match: token-sequence guard rejects Jerome/Rome substring', () => {
  assert.equal(isAnswerCorrect('Jerome', 'Rome'), false);
});

test('match: stop words are ignored on both sides', () => {
  assert.equal(isAnswerCorrect('the Roman Empire', 'Roman Empire'), true);
  assert.equal(isAnswerCorrect('the USA', 'USA'), true);
});

test('match: numeric answers do not fuzzy-match', () => {
  assert.equal(isAnswerCorrect('1492', '2'), false);
});

test('match: extra sentence content is not a match', () => {
  assert.equal(isAnswerCorrect("it's not Mars, it's Venus", 'Mars'), false);
});

test('match: typo tolerance survives the rewrite', () => {
  assert.equal(isAnswerCorrect('Napolean', 'Napoleon'), true);
});

test('match: blank submissions never match', () => {
  assert.equal(isAnswerCorrect('', 'Anything'), false);
  assert.equal(isAnswerCorrect('   ', 'Anything'), false);
});

// --- validate.js ---------------------------------------------------------------

test('validate: requiredText rejects blank and whitespace', () => {
  assert.throws(() => requiredText(undefined, 'Answer'), /Answer is required/);
  assert.throws(() => requiredText('   ', 'Answer'), /Answer is required/);
});

test('validate: requiredInteger enforces bounds and integer-ness', () => {
  assert.throws(() => requiredInteger('abc', 'Rounds', { min: 1, max: 10 }), /whole number/);
  assert.throws(() => requiredInteger(0, 'Rounds', { min: 1, max: 10 }), /between 1 and 10/);
  assert.throws(() => requiredInteger(1e9, 'Rounds', { min: 1, max: 10 }), /between 1 and 10/);
  assert.equal(requiredInteger(5, 'Rounds', { min: 1, max: 10 }), 5);
});

test('validate: requiredOneOf rejects values outside the enum', () => {
  assert.throws(() => requiredOneOf('weird', 'Mode', ['finite', 'infinite']), /Mode must be one of/);
});

test('validate: assertUniqueNames is case-insensitive', () => {
  assert.throws(() => assertUniqueNames(['Alice', 'alice'], 'Name'), /already taken/);
});

// --- gameStore: submission edge cases -------------------------------------------

test('gameStore: blank attempt answer is rejected with a readable message, no TypeError', async () => {
  const { code, hostPlayerId, room } = await setupGame();
  const cell = findOpenCell(room.board);
  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);

  await assert.rejects(() => gameStore.submitAttempt(code, hostPlayerId, ''), /unable to answer/);
  await assert.rejects(() => gameStore.submitAttempt(code, hostPlayerId, '   '), /unable to answer/);
});

test('gameStore: malformed question submissions are rejected', async () => {
  const host = await gameStore.createRoom('Host', 'socket-malformed');
  await assert.rejects(
    () => gameStore.submitQuestions(host.code, host.playerId, [null, null, null, null, null]),
    /Every question must have prompt and answer/
  );
});

test('gameStore: setTeamsAndSettings rejects an out-of-range rounds value', async () => {
  const host = await gameStore.createRoom('Host', 'socket-rounds');
  await gameStore.submitQuestions(host.code, host.playerId, questionsFor('Host'));
  await gameStore.advanceToTeamSetup(host.code, host.playerId);

  await assert.rejects(
    () =>
      gameStore.setTeamsAndSettings(host.code, host.playerId, {
        teams: [{ name: 'Team1', playerIds: [host.playerId] }],
        mode: 'finite',
        rounds: 1e9,
        dailyDouble: false,
        timerSeconds: 0
      }),
    /Rounds must be between/
  );
});

test('gameStore: setTeamScore is gated to playing/finished phases', async () => {
  const host = await gameStore.createRoom('Host', 'socket-score-gate');
  await assert.rejects(
    () => gameStore.setTeamScore(host.code, host.playerId, 'any-team', 100),
    /Scores can only be edited during or after play/
  );
});

test('gameStore: restartGame is gated to the finished phase', async () => {
  const { code, hostPlayerId } = await setupGame();
  await assert.rejects(() => gameStore.restartGame(code, hostPlayerId), /Game is not finished yet/);
});

// --- gameStore: attempts, events, and history -----------------------------------

test('gameStore: a correct answer closes the question, awards points, and pushes one event', async () => {
  const { code, hostPlayerId, players, room } = await setupGame({ playerCount: 2 });
  const cell = findOpenCell(room.board);
  const ownerName = players.find((player) => player.id === cell.playerId).name;
  const answer = `${ownerName}-answer-${cell.value}`;

  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);
  const { room: afterAttempt, result } = await gameStore.submitAttempt(code, hostPlayerId, answer);

  assert.equal(result.isCorrect, true);
  assert.equal(result.points, cell.value);
  assert.equal(afterAttempt.history.length, 1);
  assert.equal(afterAttempt.history[0].closedReason, 'solved');
  assert.equal(afterAttempt.events.at(-1).type, 'attempt-correct');
});

test('gameStore: a non-exhausting miss pushes attempt-incorrect immediately (the flicker-bug fix)', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2, mode: 'finite', rounds: 1 });
  const cell = findOpenCell(room.board);
  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);

  const { room: afterMiss, result } = await gameStore.submitAttempt(code, hostPlayerId, 'definitely wrong');

  assert.equal(result.isCorrect, false);
  assert.equal(result.exhausted, false);
  const lastEvent = afterMiss.events.at(-1);
  assert.equal(lastEvent.type, 'attempt-incorrect');
  assert.ok(lastEvent.teamId);
  assert.ok(lastEvent.nextTeamName);
});

test('gameStore: skipping records skipped:true and does not arm the override', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2, mode: 'infinite' });
  const cell = findOpenCell(room.board);
  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);

  const { room: afterSkip, result } = await gameStore.skipCurrentTeam(code, hostPlayerId);

  assert.equal(result.skipped, true);
  assert.equal(afterSkip.lastWrongAttempt, null);
  assert.equal(afterSkip.events.at(-1).type, 'attempt-skipped');
});

test('gameStore: exhausting every attempt closes the question and reveals the answer', async () => {
  const { code, hostPlayerId, players, room } = await setupGame({ playerCount: 2, mode: 'finite', rounds: 1 });
  const cell = findOpenCell(room.board);
  const ownerName = players.find((player) => player.id === cell.playerId).name;
  const expectedAnswer = `${ownerName}-answer-${cell.value}`;

  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);
  await gameStore.submitAttempt(code, hostPlayerId, 'wrong once');
  const { room: afterExhaust, result } = await gameStore.submitAttempt(code, hostPlayerId, 'wrong twice');

  assert.equal(result.exhausted, true);
  assert.equal(result.answer, expectedAnswer);
  assert.equal(afterExhaust.activeQuestion, null);
  assert.equal(afterExhaust.history.at(-1).closedReason, 'exhausted');
  assert.equal(afterExhaust.events.at(-1).type, 'question-exhausted');
});

test('gameStore: overriding a wrong answer awards points and closes the question', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2 });
  const cell = findOpenCell(room.board);
  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);
  await gameStore.submitAttempt(code, hostPlayerId, 'wrong answer');

  const { room: afterOverride, result } = await gameStore.overrideLastIncorrect(code, hostPlayerId);

  assert.equal(result.points, cell.value);
  assert.equal(afterOverride.history.at(-1).closedReason, 'overridden');
  assert.equal(afterOverride.events.at(-1).type, 'override-correct');
});

test('gameStore: passing a question reveals the answer and awards nobody', async () => {
  const { code, hostPlayerId, players, room } = await setupGame();
  const cell = findOpenCell(room.board);
  const ownerName = players.find((player) => player.id === cell.playerId).name;
  const expectedAnswer = `${ownerName}-answer-${cell.value}`;

  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);
  const { room: afterPass, result } = await gameStore.passActiveQuestion(code, hostPlayerId);

  assert.equal(result.answer, expectedAnswer);
  assert.equal(afterPass.history.at(-1).pointsAwarded, 0);
  assert.equal(afterPass.events.at(-1).type, 'question-passed');
});

test('gameStore: event seq strictly increases and the feed caps at 30', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2, mode: 'infinite', dailyDouble: false });
  const cell = findOpenCell(room.board);
  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);

  let latest;
  for (let index = 0; index < 40; index += 1) {
    ({ room: latest } = await gameStore.skipCurrentTeam(code, hostPlayerId));
  }

  const seqs = latest.events.map((event) => event.seq);
  for (let index = 1; index < seqs.length; index += 1) {
    assert.ok(seqs[index] > seqs[index - 1]);
  }
  assert.equal(latest.events.length, 30);
  assert.equal(latest.events.at(-1).seq, 40);
  assert.equal(latest.events[0].seq, 11);
});

// --- Daily Double ----------------------------------------------------------------

test('gameStore: exactly one cell is boosted when Daily Double is enabled, and it is hidden while open', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2, dailyDouble: true });

  assert.ok(room.board.columns.every((column) => column.cells.every((cell) => cell.multiplier === 1)));

  let dailyDoubleCount = 0;
  let current = room;
  for (const column of room.board.columns) {
    for (const cellRef of column.cells) {
      const afterSelect = await gameStore.selectQuestion(code, hostPlayerId, column.playerId, cellRef.value);
      if (afterSelect.activeQuestion.multiplier === 2) dailyDoubleCount += 1;
      const { room: afterPass } = await gameStore.passActiveQuestion(code, hostPlayerId);
      current = afterPass;
    }
  }

  assert.equal(dailyDoubleCount, 1);
  assert.equal(current.phase, 'finished');
});

test('gameStore: a correct answer on the Daily Double awards double points', async () => {
  const { code, hostPlayerId, players, room } = await setupGame({ playerCount: 2, dailyDouble: true });

  for (const column of room.board.columns) {
    const ownerName = players.find((player) => player.id === column.playerId).name;
    for (const cellRef of column.cells) {
      const afterSelect = await gameStore.selectQuestion(code, hostPlayerId, column.playerId, cellRef.value);
      if (afterSelect.activeQuestion.multiplier === 2) {
        const answer = `${ownerName}-answer-${cellRef.value}`;
        const { result } = await gameStore.submitAttempt(code, hostPlayerId, answer);
        assert.equal(result.points, cellRef.value * 2);
        return;
      }
      await gameStore.passActiveQuestion(code, hostPlayerId);
    }
  }

  assert.fail('No Daily Double cell was found');
});

test('gameStore: overriding a miss on the Daily Double awards double points', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2, dailyDouble: true });

  for (const column of room.board.columns) {
    for (const cellRef of column.cells) {
      const afterSelect = await gameStore.selectQuestion(code, hostPlayerId, column.playerId, cellRef.value);
      if (afterSelect.activeQuestion.multiplier === 2) {
        await gameStore.submitAttempt(code, hostPlayerId, 'wrong answer');
        const { result } = await gameStore.overrideLastIncorrect(code, hostPlayerId);
        assert.equal(result.points, cellRef.value * 2);
        return;
      }
      await gameStore.passActiveQuestion(code, hostPlayerId);
    }
  }

  assert.fail('No Daily Double cell was found');
});

// --- Redaction ---------------------------------------------------------------

test('gameStore: each player only ever sees their own questions', async () => {
  const { code } = await setupGame({ playerCount: 2 });
  const views = gameStore.roomViews(code);
  assert.equal(views.length, 2);

  for (const { room: view } of views) {
    const self = view.players.find((player) => player.questions !== null);
    assert.ok(self);
    assert.equal(self.questions.length, 5);
    const others = view.players.filter((player) => player.id !== self.id);
    assert.ok(others.every((player) => player.questions === null));
  }
});

test('gameStore: a live answer is hidden from non-host viewers and revealed in history after close', async () => {
  const { code, hostPlayerId, players, room } = await setupGame({ playerCount: 2 });
  const cell = findOpenCell(room.board);
  const ownerName = players.find((player) => player.id === cell.playerId).name;
  const expectedAnswer = `${ownerName}-answer-${cell.value}`;

  await gameStore.selectQuestion(code, hostPlayerId, cell.playerId, cell.value);

  for (const { socketId, room: view } of gameStore.roomViews(code)) {
    const viewerId = players.find((player) => player.socketId === socketId).id;
    const isHostView = viewerId === hostPlayerId;
    assert.equal(view.activeQuestion.answer, isHostView ? expectedAnswer : null);
  }

  const { room: afterPass } = await gameStore.passActiveQuestion(code, hostPlayerId);
  assert.equal(afterPass.history.at(-1).answer, expectedAnswer);

  for (const { room: view } of gameStore.roomViews(code)) {
    assert.equal(view.history.at(-1).answer, expectedAnswer);
  }
});

// --- Ties ----------------------------------------------------------------------

test('gameStore: a tied finish sets tiedTeamIds and leaves winnerTeamId null', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2 });
  const finished = await passAllQuestions(code, hostPlayerId, room);

  assert.equal(finished.phase, 'finished');
  assert.equal(finished.winnerTeamId, null);
  assert.equal(finished.tiedTeamIds.length, 2);
});

test('gameStore: editing a score after the game ends recomputes the winner', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2 });
  const finished = await passAllQuestions(code, hostPlayerId, room);
  const [teamA, teamB] = finished.teams;

  const updated = await gameStore.setTeamScore(code, hostPlayerId, teamA.id, teamB.score + 100);

  assert.equal(updated.winnerTeamId, teamA.id);
  assert.deepEqual(updated.tiedTeamIds, []);
});
