import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnswerCorrect } from './match.js';
import { requiredText, requiredInteger, requiredOneOf, assertUniqueNames } from './validate.js';
import { gameStore } from './gameStore.js';

const DEFAULT_SETTINGS = { mode: 'finite', rounds: 1, dailyDouble: false, timerSeconds: 0, questionsPerPlayer: 5 };

const questionsFor = (label, count = 5) =>
  gameStore.valuesForCount(count).map((value) => ({
    prompt: `${label} prompt ${value}`,
    answer: `${label}-answer-${value}`,
    value
  }));

const setupGame = async ({
  playerCount = 2,
  mode = 'finite',
  rounds = 1,
  dailyDouble = false,
  timerSeconds = 0,
  questionsPerPlayer = 5
} = {}) => {
  const hostSocketId = `socket-host-${Math.random()}`;
  const host = await gameStore.createRoom('Host', hostSocketId, {
    mode,
    rounds,
    dailyDouble,
    timerSeconds,
    questionsPerPlayer
  });
  const players = [{ id: host.playerId, name: 'Host', socketId: hostSocketId }];

  for (let index = 1; index < playerCount; index += 1) {
    const name = `Player${index}`;
    const socketId = `socket-${index}-${host.code}`;
    const joined = await gameStore.joinRoom(host.code, name, socketId);
    players.push({ id: joined.playerId, name, socketId });
  }

  for (const player of players) {
    await gameStore.submitQuestions(host.code, player.id, questionsFor(player.name, questionsPerPlayer));
  }

  await gameStore.advanceToTeamSetup(host.code, host.playerId);

  const teams = players.map((player, index) => ({ name: `Team${index + 1}`, playerIds: [player.id] }));
  const room = await gameStore.setTeams(host.code, host.playerId, { teams });

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
  const host = await gameStore.createRoom('Host', 'socket-malformed', DEFAULT_SETTINGS);
  await assert.rejects(
    () => gameStore.submitQuestions(host.code, host.playerId, [null, null, null, null, null]),
    /Every question must have prompt and answer/
  );
});

test('gameStore: createRoom rejects an out-of-range rounds value', async () => {
  await assert.rejects(
    () => gameStore.createRoom('Host', 'socket-rounds', { ...DEFAULT_SETTINGS, rounds: 1e9 }),
    /Rounds must be between/
  );
});

test('gameStore: setTeamScore is gated to playing/finished phases', async () => {
  const host = await gameStore.createRoom('Host', 'socket-score-gate', DEFAULT_SETTINGS);
  await assert.rejects(
    () => gameStore.setTeamScore(host.code, host.playerId, 'any-team', 100),
    /Scores can only be edited during or after play/
  );
});

test('gameStore: restartGame is gated to the finished phase', async () => {
  const { code, hostPlayerId } = await setupGame();
  await assert.rejects(() => gameStore.restartGame(code, hostPlayerId), /Game is not finished yet/);
});

// --- gameStore: kickPlayer -------------------------------------------------------

test('gameStore: host kicks a player during the lobby phase', async () => {
  const host = await gameStore.createRoom('Host', 'socket-kick-host', DEFAULT_SETTINGS);
  const joined = await gameStore.joinRoom(host.code, 'Target', 'socket-kick-target');

  const { room } = await gameStore.kickPlayer(host.code, host.playerId, joined.playerId);

  assert.equal(room.players.some((player) => player.id === joined.playerId), false);
  assert.equal(room.events.at(-1).type, 'player-kicked');
  assert.equal(room.events.at(-1).playerName, 'Target');
});

test('gameStore: a non-host cannot kick a player', async () => {
  const host = await gameStore.createRoom('Host', 'socket-kick-nonhost', DEFAULT_SETTINGS);
  const joined = await gameStore.joinRoom(host.code, 'Target', 'socket-kick-nonhost-target');

  await assert.rejects(
    () => gameStore.kickPlayer(host.code, joined.playerId, host.playerId),
    /Only host can remove players/
  );
});

test('gameStore: kickPlayer is gated to the lobby phase', async () => {
  const { code, hostPlayerId, players } = await setupGame({ playerCount: 2 });
  const target = players.find((player) => player.id !== hostPlayerId);

  await assert.rejects(
    () => gameStore.kickPlayer(code, hostPlayerId, target.id),
    /Players can only be removed during question submission/
  );
});

test('gameStore: host cannot kick themselves', async () => {
  const host = await gameStore.createRoom('Host', 'socket-kick-self', DEFAULT_SETTINGS);
  await assert.rejects(
    () => gameStore.kickPlayer(host.code, host.playerId, host.playerId),
    /Host cannot remove themselves/
  );
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

// --- Host auto-promote failover -------------------------------------------------

test('gameStore: host disconnect auto-promotes the longest-connected player after grace, pushes host-changed', async () => {
  const host = await gameStore.createRoom('Host', 'socket-promote-host', DEFAULT_SETTINGS);
  const p1 = await gameStore.joinRoom(host.code, 'P1', 'socket-promote-p1');
  await gameStore.joinRoom(host.code, 'P2', 'socket-promote-p2');

  const disconnectResult = gameStore.disconnect('socket-promote-host');
  assert.deepEqual(disconnectResult, { code: host.code, wasHost: true });

  const promotedTooSoon = await gameStore.maybePromoteHost(host.code);
  assert.equal(promotedTooSoon, false);

  await new Promise((resolve) => setTimeout(resolve, gameStore.HOST_GRACE_MS + 10));

  const promoted = await gameStore.maybePromoteHost(host.code);
  assert.equal(promoted, true);

  const view = gameStore.roomViews(host.code).find((entry) => entry.socketId === 'socket-promote-p1');
  assert.equal(view.room.hostPlayerId, p1.playerId);
  assert.equal(view.room.events.at(-1).type, 'host-changed');
  assert.equal(view.room.events.at(-1).newHostName, 'P1');

  const promotedAgain = await gameStore.maybePromoteHost(host.code);
  assert.equal(promotedAgain, false);
});

test('gameStore: host reconnecting within the grace period keeps them as host', async () => {
  const host = await gameStore.createRoom('Host', 'socket-promote3-host', DEFAULT_SETTINGS);
  await gameStore.joinRoom(host.code, 'P1', 'socket-promote3-p1');

  gameStore.disconnect('socket-promote3-host');
  const reconnected = await gameStore.reconnect(host.code, host.playerId, 'socket-promote3-host-new');
  assert.equal(reconnected.room.hostPlayerId, host.playerId);

  await new Promise((resolve) => setTimeout(resolve, gameStore.HOST_GRACE_MS + 10));
  const promoted = await gameStore.maybePromoteHost(host.code);
  assert.equal(promoted, false);
});

test('gameStore: promotion no-ops when nobody is connected, then fires on the next reconnect', async () => {
  const host = await gameStore.createRoom('Host', 'socket-promote2-host', DEFAULT_SETTINGS);
  const p1 = await gameStore.joinRoom(host.code, 'P1', 'socket-promote2-p1');

  gameStore.disconnect('socket-promote2-host');
  gameStore.disconnect('socket-promote2-p1');

  await new Promise((resolve) => setTimeout(resolve, gameStore.HOST_GRACE_MS + 10));

  const promotedWithNobodyConnected = await gameStore.maybePromoteHost(host.code);
  assert.equal(promotedWithNobodyConnected, false);

  const reconnected = await gameStore.reconnect(host.code, p1.playerId, 'socket-promote2-p1-new');
  assert.equal(reconnected.room.hostPlayerId, p1.playerId);
});

test('gameStore: leaveRoom marks a player disconnected and arms host promotion just like a socket disconnect', async () => {
  const host = await gameStore.createRoom('Host', 'socket-leave-host', DEFAULT_SETTINGS);
  const p1 = await gameStore.joinRoom(host.code, 'P1', 'socket-leave-p1');

  const leaveResult = await gameStore.leaveRoom(host.code, host.playerId);
  assert.deepEqual(leaveResult, { code: host.code, wasHost: true });

  const view = gameStore.roomViews(host.code).find((entry) => entry.socketId === 'socket-leave-p1');
  assert.equal(view.room.players.find((player) => player.id === host.playerId).isConnected, false);

  await new Promise((resolve) => setTimeout(resolve, gameStore.HOST_GRACE_MS + 10));
  const promoted = await gameStore.maybePromoteHost(host.code);
  assert.equal(promoted, true);

  const promotedView = gameStore.roomViews(host.code).find((entry) => entry.socketId === 'socket-leave-p1');
  assert.equal(promotedView.room.hostPlayerId, p1.playerId);
});

test('gameStore: leaveRoom is a no-op for an already-disconnected or unknown player', async () => {
  const host = await gameStore.createRoom('Host', 'socket-leave2-host', DEFAULT_SETTINGS);

  gameStore.disconnect('socket-leave2-host');
  const result = await gameStore.leaveRoom(host.code, host.playerId);
  assert.equal(result, null);

  const unknownResult = await gameStore.leaveRoom(host.code, 'not-a-real-player-id');
  assert.equal(unknownResult, null);
});

// --- Duplicate-session supersede ------------------------------------------------

test('gameStore: reconnecting with a live prior socket supersedes it; the old socket disconnect is a no-op', async () => {
  const host = await gameStore.createRoom('Host', 'socket-super-host', DEFAULT_SETTINGS);
  const p1 = await gameStore.joinRoom(host.code, 'P1', 'socket-super-p1-a');

  const reconnected = await gameStore.reconnect(host.code, p1.playerId, 'socket-super-p1-b');
  assert.equal(reconnected.supersededSocketId, 'socket-super-p1-a');

  const disconnectResult = gameStore.disconnect('socket-super-p1-a');
  assert.equal(disconnectResult, null);
});

// --- Configurable question count -------------------------------------------------

test('gameStore: submitQuestions rejects a wrong-length submission naming the expected count', async () => {
  const host = await gameStore.createRoom('Host', 'socket-qcount', { ...DEFAULT_SETTINGS, questionsPerPlayer: 3 });
  await assert.rejects(
    () => gameStore.submitQuestions(host.code, host.playerId, questionsFor('Host', 2)),
    /Exactly 3 question/
  );
});

test('gameStore: submitQuestions rejects a submission missing a required value level', async () => {
  const host = await gameStore.createRoom('Host', 'socket-qmissing', { ...DEFAULT_SETTINGS, questionsPerPlayer: 3 });
  const questions = questionsFor('Host', 3);
  questions[2].value = questions[0].value;
  await assert.rejects(
    () => gameStore.submitQuestions(host.code, host.playerId, questions),
    /Questions must use values 100, 200, 300 once each/
  );
});

test('gameStore: submitQuestions rejects duplicate values even at the right length', async () => {
  const host = await gameStore.createRoom('Host', 'socket-qdup', { ...DEFAULT_SETTINGS, questionsPerPlayer: 3 });
  const questions = questionsFor('Host', 3).map((question) => ({ ...question, value: 100 }));
  await assert.rejects(
    () => gameStore.submitQuestions(host.code, host.playerId, questions),
    /Questions must use values 100, 200, 300 once each/
  );
});

test('gameStore: submitQuestions accepts correct coverage of every value level', async () => {
  const host = await gameStore.createRoom('Host', 'socket-qok', { ...DEFAULT_SETTINGS, questionsPerPlayer: 3 });
  const room = await gameStore.submitQuestions(host.code, host.playerId, questionsFor('Host', 3));
  assert.equal(room.players.find((player) => player.id === host.playerId).submitted, true);
});

test('gameStore: createRoom validates and persists the chosen settings', async () => {
  const settings = { mode: 'infinite', rounds: null, dailyDouble: true, timerSeconds: 20, questionsPerPlayer: 8 };
  const host = await gameStore.createRoom('Host', 'socket-settings-create', settings);
  assert.deepEqual(host.room.settings, settings);
});

test('gameStore: updateSettings rejects a non-host caller', async () => {
  const host = await gameStore.createRoom('Host', 'socket-settings-nonhost', DEFAULT_SETTINGS);
  const p1 = await gameStore.joinRoom(host.code, 'P1', 'socket-settings-nonhost-p1');

  await assert.rejects(
    () => gameStore.updateSettings(host.code, p1.playerId, DEFAULT_SETTINGS),
    /Only host can change settings/
  );
});

test('gameStore: updateSettings rejects changes outside the lobby phase', async () => {
  const { code, hostPlayerId } = await setupGame();
  await assert.rejects(
    () => gameStore.updateSettings(code, hostPlayerId, DEFAULT_SETTINGS),
    /Settings can only change in the lobby/
  );
});

test("gameStore: shrinking questionsPerPlayer trims a submitted player's questions and flips submitted to false", async () => {
  const host = await gameStore.createRoom('Host', 'socket-settings-shrink', { ...DEFAULT_SETTINGS, questionsPerPlayer: 5 });
  await gameStore.submitQuestions(host.code, host.playerId, questionsFor('Host', 5));

  const updated = await gameStore.updateSettings(host.code, host.playerId, { ...DEFAULT_SETTINGS, questionsPerPlayer: 3 });

  const self = updated.players.find((player) => player.id === host.playerId);
  assert.equal(self.submitted, false);
  assert.equal(self.questions.length, 3);
  assert.equal(updated.events.at(-1).type, 'settings-changed');
});

test('gameStore: restarting a finished game preserves the original settings on the new code', async () => {
  const { code, hostPlayerId, room } = await setupGame({ playerCount: 2, dailyDouble: true, questionsPerPlayer: 3 });
  const finished = await passAllQuestions(code, hostPlayerId, room);
  assert.equal(finished.phase, 'finished');

  const restarted = await gameStore.restartGame(code, hostPlayerId);
  assert.equal(restarted.room.settings.dailyDouble, true);
  assert.equal(restarted.room.settings.questionsPerPlayer, 3);
});

// --- Persistence -----------------------------------------------------------------

test('gameStore: serialize/deserialize round-trips hostDisconnectedAt and questionsPerPlayer', () => {
  const sampleRoom = {
    code: 'ABCDEF',
    hostPlayerId: 'host-1',
    hostDisconnectedAt: 1700000000000,
    phase: 'lobby',
    players: new Map([['host-1', { id: 'host-1', name: 'Host', socketId: null, submitted: false, questions: [] }]]),
    settings: { mode: 'finite', rounds: 1, dailyDouble: false, timerSeconds: 0, questionsPerPlayer: 7 },
    teams: [],
    turnTeamId: null,
    board: null,
    activeQuestion: null,
    lastWrongAttempt: null,
    winnerTeamId: null,
    tiedTeamIds: [],
    events: [],
    eventSeq: 0,
    history: []
  };

  const snapshot = gameStore.serializeRoom(sampleRoom);
  const restored = gameStore.deserializeRoom(snapshot);

  assert.equal(restored.hostDisconnectedAt, 1700000000000);
  assert.equal(restored.settings.questionsPerPlayer, 7);
});
