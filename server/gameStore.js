import { customAlphabet } from 'nanoid';
import { isAnswerCorrect } from './match.js';
import { roomRepository } from './roomRepository.js';
import {
  LIMITS,
  requiredText,
  requiredInteger,
  requiredBoolean,
  requiredOneOf,
  normalizeRoomCode,
  assertUniqueNames
} from './validate.js';

const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const MAX_EVENTS = 30;
const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS || 30000);

const rooms = new Map();

const byName = (left, right) => left.name.localeCompare(right.name);

const valuesForCount = (count) => Array.from({ length: count }, (_, i) => (i + 1) * 100);

const defaultSettings = () => ({
  mode: 'infinite',
  rounds: 1,
  dailyDouble: false,
  timerSeconds: 0,
  questionsPerPlayer: 5
});

const toStoredPlayer = (player) => ({
  id: player.id,
  name: player.name,
  submitted: Boolean(player.submitted),
  questions: Array.isArray(player.questions) ? player.questions : []
});

const serializeRoom = (room) => ({
  code: room.code,
  hostPlayerId: room.hostPlayerId,
  hostDisconnectedAt: room.hostDisconnectedAt,
  phase: room.phase,
  players: [...room.players.values()].map(toStoredPlayer),
  settings: room.settings,
  teams: room.teams,
  turnTeamId: room.turnTeamId,
  board: room.board,
  activeQuestion: room.activeQuestion,
  lastWrongAttempt: room.lastWrongAttempt,
  winnerTeamId: room.winnerTeamId,
  tiedTeamIds: room.tiedTeamIds,
  events: room.events,
  eventSeq: room.eventSeq,
  history: room.history
});

const deserializeRoom = (snapshot) => ({
  code: snapshot.code,
  hostPlayerId: snapshot.hostPlayerId,
  hostDisconnectedAt: snapshot.hostDisconnectedAt || null,
  phase: snapshot.phase || 'lobby',
  players: new Map(
    (snapshot.players || []).map((player) => [
      player.id,
      {
        id: player.id,
        name: player.name,
        socketId: null,
        submitted: Boolean(player.submitted),
        questions: Array.isArray(player.questions) ? player.questions : []
      }
    ])
  ),
  settings: snapshot.settings || defaultSettings(),
  teams: snapshot.teams || [],
  turnTeamId: snapshot.turnTeamId || null,
  board: snapshot.board || null,
  activeQuestion: snapshot.activeQuestion || null,
  lastWrongAttempt: snapshot.lastWrongAttempt || null,
  winnerTeamId: snapshot.winnerTeamId || null,
  tiedTeamIds: snapshot.tiedTeamIds || [],
  events: snapshot.events || [],
  eventSeq: snapshot.eventSeq || 0,
  history: snapshot.history || []
});

const publicBoard = (board) =>
  board && {
    values: board.values,
    columns: board.columns.map((column) => ({
      playerId: column.playerId,
      playerName: column.playerName,
      cells: column.cells.map((cell) => ({
        value: cell.value,
        status: cell.status,
        // Daily Double stays hidden until the cell leaves 'open' -- even for the host.
        multiplier: cell.status === 'open' ? 1 : cell.multiplier
      }))
    }))
  };

const publicRoom = (room, viewerPlayerId) => {
  const isHost = viewerPlayerId === room.hostPlayerId;
  const players = [...room.players.values()].sort(byName).map((player) => ({
    id: player.id,
    name: player.name,
    submitted: player.submitted,
    isConnected: Boolean(player.socketId),
    questions: player.id === viewerPlayerId ? player.questions : null
  }));

  const activeQuestion = room.activeQuestion && {
    ...room.activeQuestion,
    answer: isHost ? room.activeQuestion.answer : null
  };

  return {
    code: room.code,
    phase: room.phase,
    hostPlayerId: room.hostPlayerId,
    players,
    settings: room.settings,
    teams: room.teams,
    turnTeamId: room.turnTeamId,
    board: publicBoard(room.board),
    activeQuestion,
    lastWrongAttempt: room.lastWrongAttempt,
    winnerTeamId: room.winnerTeamId,
    tiedTeamIds: room.tiedTeamIds,
    events: room.events,
    history: room.history
  };
};

const buildRoomViews = (room) =>
  [...room.players.values()]
    .filter((player) => player.socketId)
    .map((player) => ({ socketId: player.socketId, room: publicRoom(room, player.id) }));

const roomExists = async (code) => {
  if (rooms.has(code)) return true;
  return roomRepository.roomExists(code);
};

const generateUniqueCode = async () => {
  let code = makeCode();
  while (await roomExists(code)) code = makeCode();
  return code;
};

const loadRoomIntoMemory = async (code) => {
  const snapshot = await roomRepository.loadRoom(code);
  if (!snapshot) return null;

  const room = deserializeRoom(snapshot);
  rooms.set(code, room);
  return room;
};

const ensureRoom = async (rawCode) => {
  const code = normalizeRoomCode(rawCode);
  const cachedRoom = rooms.get(code);
  if (cachedRoom) {
    return cachedRoom;
  }

  const persistedRoom = await loadRoomIntoMemory(code);
  if (!persistedRoom) {
    throw new Error('Room not found');
  }

  return persistedRoom;
};

const persistRoom = async (room) => {
  await roomRepository.saveRoom(serializeRoom(room));
};

const getPlayerBySocket = (socketId) => {
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (player.socketId === socketId) return { room, player };
    }
  }
  return null;
};

const validateQuestions = (questions, count) => {
  const expectedValues = valuesForCount(count);

  if (!Array.isArray(questions) || questions.length !== count) {
    throw new Error(`Exactly ${count} question${count === 1 ? '' : 's'} are required`);
  }

  const normalized = questions.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Every question must have prompt and answer');
    }
    return {
      prompt: requiredText(entry.prompt, 'Question prompt', LIMITS.prompt),
      answer: requiredText(entry.answer, 'Question answer', LIMITS.answer),
      value: requiredInteger(entry.value, 'Question value')
    };
  });

  const uniqueValues = new Set(normalized.map((entry) => entry.value));
  if (uniqueValues.size !== count || !expectedValues.every((value) => uniqueValues.has(value))) {
    throw new Error(`Questions must use values ${expectedValues.join(', ')} once each`);
  }

  return normalized;
};

const initializeBoard = (room) => {
  const values = valuesForCount(room.settings.questionsPerPlayer);
  const columns = [...room.players.values()].sort(byName).map((player) => ({
    playerId: player.id,
    playerName: player.name,
    cells: values.map((value) => ({ value, status: 'open', multiplier: 1 }))
  }));

  room.board = { values, columns };

  if (room.settings.dailyDouble) {
    const allCells = columns.flatMap((column) => column.cells);
    allCells[Math.floor(Math.random() * allCells.length)].multiplier = 2;
  }
};

const findCell = (room, ownerPlayerId, value) => {
  const column = room.board.columns.find((entry) => entry.playerId === ownerPlayerId);
  const cell = column?.cells.find((entry) => entry.value === value);
  return { column, cell };
};

const allCellsClosed = (room) =>
  room.board.columns.every((column) => column.cells.every((cell) => cell.status === 'closed'));

const pushEvent = (room, event) => {
  room.eventSeq += 1;
  room.events.push({ seq: room.eventSeq, ...event });
  if (room.events.length > MAX_EVENTS) {
    room.events.splice(0, room.events.length - MAX_EVENTS);
  }
};

const applyWinner = (room) => {
  const topScore = Math.max(...room.teams.map((team) => team.score));
  const leaders = room.teams.filter((team) => team.score === topScore);

  if (leaders.length === 1) {
    room.winnerTeamId = leaders[0].id;
    room.tiedTeamIds = [];
  } else {
    room.winnerTeamId = null;
    room.tiedTeamIds = leaders.map((team) => team.id);
  }
};

const CLOSE_EVENT_TYPES = {
  solved: 'attempt-correct',
  overridden: 'override-correct',
  passed: 'question-passed',
  exhausted: 'question-exhausted'
};

const closeActiveQuestion = (room, { solvedByTeamId, closedReason }) => {
  const active = room.activeQuestion;
  const { cell } = findCell(room, active.ownerPlayerId, active.value);
  cell.status = 'closed';

  const points = solvedByTeamId ? active.value * active.multiplier : 0;
  let teamName = null;

  if (solvedByTeamId) {
    const team = room.teams.find((entry) => entry.id === solvedByTeamId);
    team.score += points;
    room.turnTeamId = team.id;
    teamName = team.name;
  } else {
    const teamIndex = room.teams.findIndex((team) => team.id === active.selectedByTeamId);
    room.turnTeamId = room.teams[(teamIndex + 1) % room.teams.length]?.id;
  }

  room.history.push({
    id: crypto.randomUUID(),
    ownerPlayerId: active.ownerPlayerId,
    ownerPlayerName: active.ownerPlayerName,
    prompt: active.prompt,
    answer: active.answer,
    value: active.value,
    multiplier: active.multiplier,
    selectedByTeamId: active.selectedByTeamId,
    solvedByTeamId: solvedByTeamId || null,
    solvedByTeamName: teamName,
    pointsAwarded: points,
    closedReason,
    attempts: active.attempts,
    startedAt: active.startedAt,
    closedAt: Date.now()
  });

  pushEvent(room, {
    type: CLOSE_EVENT_TYPES[closedReason],
    ownerPlayerId: active.ownerPlayerId,
    value: active.value,
    teamId: solvedByTeamId || null,
    teamName,
    points,
    multiplier: active.multiplier,
    correctAnswer: active.answer
  });

  room.activeQuestion = null;
  room.lastWrongAttempt = null;

  if (allCellsClosed(room)) {
    room.phase = 'finished';
    applyWinner(room);
    pushEvent(room, { type: 'game-over' });
  }

  return { points, teamId: solvedByTeamId || null, teamName, answer: active.answer };
};

const currentAttemptTeamId = (active, settings) => {
  const index = settings.mode === 'infinite'
    ? active.attemptIndex % active.attemptOrder.length
    : active.attemptIndex;
  return active.attemptOrder[index];
};

const recordMiss = (room, teamId, answerText, skipped) => {
  const active = room.activeQuestion;
  const team = room.teams.find((entry) => entry.id === teamId);

  active.attempts.push({ teamId, teamName: team.name, answer: answerText, isCorrect: false, skipped });
  room.lastWrongAttempt = skipped ? null : { teamId, teamName: team.name, answer: answerText, value: active.value };
  active.attemptIndex += 1;

  const exhausted = room.settings.mode === 'finite' && active.attemptIndex >= active.attemptOrder.length;
  if (exhausted) {
    const { answer } = closeActiveQuestion(room, { solvedByTeamId: null, closedReason: 'exhausted' });
    return { isCorrect: false, skipped, exhausted: true, answer };
  }

  const nextTeamId = currentAttemptTeamId(active, room.settings);
  active.currentTeamId = nextTeamId;
  const nextTeam = room.teams.find((entry) => entry.id === nextTeamId);

  pushEvent(room, {
    type: skipped ? 'attempt-skipped' : 'attempt-incorrect',
    ownerPlayerId: active.ownerPlayerId,
    value: active.value,
    teamId,
    teamName: team.name,
    nextTeamName: nextTeam?.name || null
  });

  return { isCorrect: false, skipped, exhausted: false, nextTeamId };
};

const buildAttemptOrder = (teams, selectedTeamId, settings) => {
  const startIndex = teams.findIndex((team) => team.id === selectedTeamId);
  const orderedTeams = [...teams.slice(startIndex), ...teams.slice(0, startIndex)].map((team) => team.id);

  if (settings.mode === 'infinite') {
    return orderedTeams;
  }

  const [first, ...rest] = orderedTeams;
  const repeatedOthers = Array.from({ length: settings.rounds }, () => rest).flat();
  return [first, ...repeatedOthers];
};

const resetForNewRound = (room, nextCode) => {
  room.code = nextCode;
  room.phase = 'lobby';
  room.teams = [];
  room.turnTeamId = null;
  room.board = null;
  room.activeQuestion = null;
  room.lastWrongAttempt = null;
  room.winnerTeamId = null;
  room.tiedTeamIds = [];
  room.events = [];
  room.eventSeq = 0;
  room.history = [];

  room.players.forEach((player) => {
    player.submitted = false;
    player.questions = [];
  });
};

const validateSettings = (payload) => {
  const mode = requiredOneOf(payload.mode, 'Mode', ['finite', 'infinite']);
  const rounds = mode === 'finite' ? requiredInteger(payload.rounds, 'Rounds', LIMITS.rounds) : null;
  const dailyDouble = requiredBoolean(payload.dailyDouble, 'Daily Double');
  const timerSeconds = requiredInteger(payload.timerSeconds, 'Timer', LIMITS.timerSeconds);
  const questionsPerPlayer = requiredInteger(
    payload.questionsPerPlayer,
    'Questions per player',
    LIMITS.questionsPerPlayer
  );

  return { mode, rounds, dailyDouble, timerSeconds, questionsPerPlayer };
};

export const gameStore = {
  HOST_GRACE_MS,
  valuesForCount,
  serializeRoom,
  deserializeRoom,

  persistenceEnabled() {
    return roomRepository.isEnabled();
  },

  persistenceConfigError() {
    return roomRepository.getConfigError();
  },

  async createRoom(rawName, socketId, rawSettings) {
    const name = requiredText(rawName, 'Name', LIMITS.name);
    const settings = validateSettings(rawSettings || {});
    const code = await generateUniqueCode();
    const playerId = crypto.randomUUID();
    const room = {
      code,
      hostPlayerId: playerId,
      hostDisconnectedAt: null,
      phase: 'lobby',
      players: new Map(),
      settings,
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

    room.players.set(playerId, { id: playerId, name, socketId, submitted: false, questions: [] });

    rooms.set(code, room);
    await persistRoom(room);
    return { code, playerId, room: publicRoom(room, playerId) };
  },

  async joinRoom(rawCode, rawName, socketId) {
    const room = await ensureRoom(rawCode);
    if (room.phase !== 'lobby') throw new Error('Joining is closed after question submission');
    if (room.players.size >= LIMITS.players.max) {
      throw new Error(`Room is full (max ${LIMITS.players.max} players)`);
    }

    const name = requiredText(rawName, 'Name', LIMITS.name);
    assertUniqueNames([...[...room.players.values()].map((player) => player.name), name], 'Name');

    const playerId = crypto.randomUUID();
    room.players.set(playerId, { id: playerId, name, socketId, submitted: false, questions: [] });

    await persistRoom(room);
    return { code: room.code, playerId, room: publicRoom(room, playerId) };
  },

  async reconnect(rawCode, playerId, socketId) {
    const room = await ensureRoom(rawCode);
    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');

    const prevSocketId = player.socketId;
    player.socketId = socketId;

    if (playerId === room.hostPlayerId) {
      room.hostDisconnectedAt = null;
    }

    await this.maybePromoteHost(room.code);
    await persistRoom(room);

    const supersededSocketId = prevSocketId && prevSocketId !== socketId ? prevSocketId : null;
    return { code: room.code, room: publicRoom(room, playerId), supersededSocketId };
  },

  async submitQuestions(rawCode, playerId, questions) {
    const room = await ensureRoom(rawCode);
    if (room.phase !== 'lobby') throw new Error('Question submission is closed');
    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');

    player.questions = validateQuestions(questions, room.settings.questionsPerPlayer);
    player.submitted = true;

    await persistRoom(room);
    return publicRoom(room, playerId);
  },

  async advanceToTeamSetup(rawCode, hostPlayerId) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can continue to team setup');
    if (room.phase !== 'lobby') throw new Error('Room is no longer accepting submissions');
    if (![...room.players.values()].every((entry) => entry.submitted)) {
      throw new Error('All players must submit before continuing');
    }

    room.phase = 'team-setup';
    await persistRoom(room);
    return publicRoom(room, hostPlayerId);
  },

  async setTeams(rawCode, hostPlayerId, payload) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can configure teams');
    if (!Array.isArray(payload.teams) || payload.teams.length < 1) throw new Error('At least one team is required');

    const allPlayers = new Set(room.players.keys());
    const assignedPlayers = new Set();
    const teamNames = [];

    const teams = payload.teams.map((team) => {
      const name = requiredText(team.name, 'Team name', LIMITS.name);
      if (!Array.isArray(team.playerIds) || team.playerIds.length < 1) {
        throw new Error('Each team must include players');
      }

      team.playerIds.forEach((playerId) => {
        if (!allPlayers.has(playerId)) throw new Error('Invalid player assignment');
        if (assignedPlayers.has(playerId)) throw new Error('Player assigned to multiple teams');
        assignedPlayers.add(playerId);
      });

      teamNames.push(name);
      return { id: crypto.randomUUID(), name, playerIds: team.playerIds, score: 0 };
    });

    assertUniqueNames(teamNames, 'Team name');
    if (assignedPlayers.size !== allPlayers.size) throw new Error('All players must be assigned to a team');

    room.teams = teams;
    room.turnTeamId = teams[0].id;
    room.phase = 'playing';
    room.winnerTeamId = null;
    room.tiedTeamIds = [];

    initializeBoard(room);
    await persistRoom(room);
    return publicRoom(room, hostPlayerId);
  },

  async updateSettings(rawCode, hostPlayerId, rawSettings) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can change settings');
    if (room.phase !== 'lobby') throw new Error('Settings can only change in the lobby');

    const settings = validateSettings(rawSettings);
    const countChanged = settings.questionsPerPlayer !== room.settings.questionsPerPlayer;
    room.settings = settings;

    if (countChanged) {
      room.players.forEach((player) => {
        if (player.submitted) {
          player.questions = player.questions.slice(0, settings.questionsPerPlayer);
          player.submitted = false;
        }
      });
      pushEvent(room, { type: 'settings-changed' });
    }

    await persistRoom(room);
    return publicRoom(room, hostPlayerId);
  },

  async kickPlayer(rawCode, hostPlayerId, targetPlayerId) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can remove players');
    if (room.phase !== 'lobby') throw new Error('Players can only be removed during question submission');
    if (targetPlayerId === hostPlayerId) throw new Error('Host cannot remove themselves');

    const target = room.players.get(targetPlayerId);
    if (!target) throw new Error('Player not found');

    const kickedSocketId = target.socketId;
    room.players.delete(targetPlayerId);
    pushEvent(room, { type: 'player-kicked', playerName: target.name });

    await persistRoom(room);
    return { room: publicRoom(room, hostPlayerId), kickedSocketId };
  },

  async setTeamScore(rawCode, hostPlayerId, teamId, score) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can edit scores');
    if (room.phase !== 'playing' && room.phase !== 'finished') {
      throw new Error('Scores can only be edited during or after play');
    }

    const nextScore = requiredInteger(score, 'Score', LIMITS.score);
    const team = room.teams.find((entry) => entry.id === teamId);
    if (!team) throw new Error('Team not found');

    team.score = nextScore;
    if (room.phase === 'finished') applyWinner(room);

    await persistRoom(room);
    return publicRoom(room, hostPlayerId);
  },

  async selectQuestion(rawCode, hostPlayerId, ownerPlayerId, value) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can select questions');
    if (room.phase !== 'playing') throw new Error('Game is not in playing phase');
    if (room.activeQuestion) throw new Error('Another question is active');
    if (!valuesForCount(room.settings.questionsPerPlayer).includes(Number(value))) {
      throw new Error('Invalid question value');
    }

    const { cell } = findCell(room, ownerPlayerId, value);
    if (!cell || cell.status !== 'open') throw new Error('Question unavailable');

    const owner = room.players.get(ownerPlayerId);
    const question = owner.questions.find((entry) => entry.value === value);
    if (!question) throw new Error('Question not found');

    cell.status = 'active';
    const selectedByTeamId = room.turnTeamId;
    room.activeQuestion = {
      ownerPlayerId,
      ownerPlayerName: owner.name,
      selectedByTeamId,
      currentTeamId: selectedByTeamId,
      value,
      multiplier: cell.multiplier,
      prompt: question.prompt,
      answer: question.answer,
      attemptOrder: buildAttemptOrder(room.teams, selectedByTeamId, room.settings),
      attemptIndex: 0,
      attempts: [],
      startedAt: Date.now()
    };
    room.lastWrongAttempt = null;

    if (cell.multiplier > 1) {
      pushEvent(room, {
        type: 'daily-double',
        ownerPlayerId,
        value,
        multiplier: cell.multiplier,
        teamId: selectedByTeamId
      });
    }

    await persistRoom(room);
    return publicRoom(room, hostPlayerId);
  },

  async submitAttempt(rawCode, hostPlayerId, rawAnswer) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can submit attempts');
    if (!room.activeQuestion) throw new Error('No active question');

    const trimmedAnswer = typeof rawAnswer === 'string' ? rawAnswer.trim() : '';
    if (!trimmedAnswer) throw new Error('Type the answer the team gave, or mark them as unable to answer');
    const answer = requiredText(rawAnswer, 'Answer', LIMITS.attemptAnswer);
    const active = room.activeQuestion;
    const teamId = currentAttemptTeamId(active, room.settings);
    if (!teamId) throw new Error('No attempts remaining');

    const isCorrect = isAnswerCorrect(answer, active.answer);

    if (isCorrect) {
      const team = room.teams.find((entry) => entry.id === teamId);
      active.attempts.push({ teamId, teamName: team.name, answer, isCorrect: true, skipped: false });
      const { points } = closeActiveQuestion(room, { solvedByTeamId: teamId, closedReason: 'solved' });
      await persistRoom(room);
      return {
        room: publicRoom(room, hostPlayerId),
        result: { isCorrect: true, teamId, teamName: team.name, value: active.value, multiplier: active.multiplier, points }
      };
    }

    const result = recordMiss(room, teamId, answer, false);
    await persistRoom(room);
    return { room: publicRoom(room, hostPlayerId), result };
  },

  async skipCurrentTeam(rawCode, hostPlayerId) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can skip a team');
    if (!room.activeQuestion) throw new Error('No active question');

    const active = room.activeQuestion;
    const teamId = currentAttemptTeamId(active, room.settings);
    if (!teamId) throw new Error('No attempts remaining');

    const result = recordMiss(room, teamId, '', true);
    await persistRoom(room);
    return { room: publicRoom(room, hostPlayerId), result };
  },

  async overrideLastIncorrect(rawCode, hostPlayerId) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can override answers');
    if (!room.activeQuestion || !room.lastWrongAttempt) throw new Error('No incorrect attempt to override');

    const { teamId, teamName } = room.lastWrongAttempt;
    const { points } = closeActiveQuestion(room, { solvedByTeamId: teamId, closedReason: 'overridden' });

    await persistRoom(room);
    return { room: publicRoom(room, hostPlayerId), result: { teamId, teamName, points } };
  },

  async passActiveQuestion(rawCode, hostPlayerId) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can pass questions');
    if (!room.activeQuestion) throw new Error('No active question');

    const { answer } = closeActiveQuestion(room, { solvedByTeamId: null, closedReason: 'passed' });

    await persistRoom(room);
    return { room: publicRoom(room, hostPlayerId), result: { answer } };
  },

  async restartGame(rawCode, hostPlayerId) {
    const room = await ensureRoom(rawCode);
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can restart game');
    if (room.phase !== 'finished') throw new Error('Game is not finished yet');

    const oldCode = room.code;
    const newCode = await generateUniqueCode();
    rooms.delete(oldCode);
    resetForNewRound(room, newCode);
    rooms.set(newCode, room);

    if (roomRepository.isEnabled()) {
      await roomRepository.renameRoom(oldCode, serializeRoom(room));
    }

    return { oldCode, newCode, room: publicRoom(room, hostPlayerId) };
  },

  disconnect(socketId) {
    const located = getPlayerBySocket(socketId);
    if (!located) return null;

    const { room, player } = located;
    player.socketId = null;

    const wasHost = player.id === room.hostPlayerId;
    if (wasHost) room.hostDisconnectedAt = Date.now();

    return { code: room.code, wasHost };
  },

  async leaveRoom(rawCode, playerId) {
    const room = await ensureRoom(rawCode);
    const player = room.players.get(playerId);
    if (!player || !player.socketId) return null;

    player.socketId = null;

    const wasHost = player.id === room.hostPlayerId;
    if (wasHost) room.hostDisconnectedAt = Date.now();

    return { code: room.code, wasHost };
  },

  async maybePromoteHost(rawCode) {
    const room = rooms.get(normalizeRoomCode(rawCode));
    if (!room) return false;

    const host = room.players.get(room.hostPlayerId);
    if (!room.hostDisconnectedAt || host?.socketId) return false;
    if (Date.now() - room.hostDisconnectedAt < HOST_GRACE_MS) return false;

    const nextHost = [...room.players.values()].find((player) => player.socketId);
    if (!nextHost) return false;

    room.hostPlayerId = nextHost.id;
    room.hostDisconnectedAt = null;
    pushEvent(room, { type: 'host-changed', newHostName: nextHost.name });

    await persistRoom(room);
    return true;
  },

  roomViews(rawCode) {
    const room = rooms.get(normalizeRoomCode(rawCode));
    if (!room) return [];
    return buildRoomViews(room);
  }
};
