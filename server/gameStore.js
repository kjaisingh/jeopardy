import { customAlphabet } from 'nanoid';
import { isAnswerCorrect } from './match.js';
import { roomRepository } from './roomRepository.js';

const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const QUESTION_VALUES = [100, 200, 300, 400, 500];

const rooms = new Map();

const byName = (left, right) => left.name.localeCompare(right.name);

const toStoredPlayer = (player) => ({
  id: player.id,
  name: player.name,
  submitted: Boolean(player.submitted),
  questions: Array.isArray(player.questions) ? player.questions : []
});

const serializeRoom = (room) => ({
  code: room.code,
  hostPlayerId: room.hostPlayerId,
  phase: room.phase,
  players: [...room.players.values()].map(toStoredPlayer),
  settings: room.settings,
  teams: room.teams,
  turnTeamId: room.turnTeamId,
  board: room.board,
  activeQuestion: room.activeQuestion,
  lastWrongAttempt: room.lastWrongAttempt,
  winnerTeamId: room.winnerTeamId
});

const deserializeRoom = (snapshot) => ({
  code: snapshot.code,
  hostPlayerId: snapshot.hostPlayerId,
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
  settings: snapshot.settings || { mode: 'finite', rounds: 1 },
  teams: snapshot.teams || [],
  turnTeamId: snapshot.turnTeamId || null,
  board: snapshot.board || null,
  activeQuestion: snapshot.activeQuestion || null,
  lastWrongAttempt: snapshot.lastWrongAttempt || null,
  winnerTeamId: snapshot.winnerTeamId || null
});

const publicRoom = (room) => {
  const players = [...room.players.values()].sort(byName).map((player) => ({
    id: player.id,
    name: player.name,
    submitted: player.submitted,
    isConnected: Boolean(player.socketId),
    questions: player.questions
  }));

  return {
    code: room.code,
    phase: room.phase,
    hostPlayerId: room.hostPlayerId,
    players,
    settings: room.settings,
    teams: room.teams,
    turnTeamId: room.turnTeamId,
    board: room.board,
    activeQuestion: room.activeQuestion,
    lastWrongAttempt: room.lastWrongAttempt,
    winnerTeamId: room.winnerTeamId
  };
};

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

const ensureRoom = async (code) => {
  const normalizedCode = code.toUpperCase();
  const cachedRoom = rooms.get(normalizedCode);
  if (cachedRoom) {
    return cachedRoom;
  }

  const persistedRoom = await loadRoomIntoMemory(normalizedCode);
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

const validateQuestions = (questions) => {
  if (!Array.isArray(questions) || questions.length !== 5) {
    throw new Error('Exactly five questions are required');
  }

  const values = questions.map((entry) => Number(entry.value));
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== 5 || !QUESTION_VALUES.every((value) => uniqueValues.has(value))) {
    throw new Error('Questions must use values 100, 200, 300, 400, and 500 once each');
  }

  for (const question of questions) {
    if (!question.prompt?.trim() || !question.answer?.trim()) {
      throw new Error('Every question must have prompt and answer');
    }
  }
};

const initializeBoard = (room) => {
  const columns = [...room.players.values()].sort(byName).map((player) => ({
    playerId: player.id,
    playerName: player.name,
    cells: QUESTION_VALUES.map((value) => ({
      value,
      status: 'open'
    }))
  }));

  room.board = {
    values: QUESTION_VALUES,
    columns
  };
};

const findCell = (room, ownerPlayerId, value) => {
  const column = room.board.columns.find((entry) => entry.playerId === ownerPlayerId);
  const cell = column?.cells.find((entry) => entry.value === value);
  return { column, cell };
};

const allCellsClosed = (room) =>
  room.board.columns.every((column) => column.cells.every((cell) => cell.status === 'closed'));

const completeQuestionWithoutPoints = (room) => {
  const selectedTeamId = room.activeQuestion.selectedByTeamId;
  const teamIndex = room.teams.findIndex((team) => team.id === selectedTeamId);
  room.turnTeamId = room.teams[(teamIndex + 1) % room.teams.length]?.id;
  room.activeQuestion = null;
  room.lastWrongAttempt = null;

  if (allCellsClosed(room)) {
    room.phase = 'finished';
    const topScore = Math.max(...room.teams.map((team) => team.score));
    const winner = room.teams.find((team) => team.score === topScore);
    room.winnerTeamId = winner?.id || null;
  }
};

const completeQuestionWithPoints = (room, teamId, points) => {
  const team = room.teams.find((entry) => entry.id === teamId);
  team.score += points;
  room.turnTeamId = team.id;
  room.activeQuestion = null;
  room.lastWrongAttempt = null;

  if (allCellsClosed(room)) {
    room.phase = 'finished';
    const topScore = Math.max(...room.teams.map((entry) => entry.score));
    const winner = room.teams.find((entry) => entry.score === topScore);
    room.winnerTeamId = winner?.id || null;
  }
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
  room.settings = { mode: 'finite', rounds: 1 };
  room.teams = [];
  room.turnTeamId = null;
  room.board = null;
  room.activeQuestion = null;
  room.lastWrongAttempt = null;
  room.winnerTeamId = null;

  room.players.forEach((player) => {
    player.submitted = false;
    player.questions = [];
  });
};

export const gameStore = {
  QUESTION_VALUES,

  persistenceEnabled() {
    return roomRepository.isEnabled();
  },

  persistenceConfigError() {
    return roomRepository.getConfigError();
  },

  async createRoom(name, socketId) {
    const code = await generateUniqueCode();
    const playerId = crypto.randomUUID();
    const room = {
      code,
      hostPlayerId: playerId,
      phase: 'lobby',
      players: new Map(),
      settings: { mode: 'finite', rounds: 1 },
      teams: [],
      turnTeamId: null,
      board: null,
      activeQuestion: null,
      lastWrongAttempt: null,
      winnerTeamId: null
    };

    room.players.set(playerId, {
      id: playerId,
      name: name.trim(),
      socketId,
      submitted: false,
      questions: []
    });

    rooms.set(code, room);
    await persistRoom(room);
    return { code, playerId, room: publicRoom(room) };
  },

  async joinRoom(code, name, socketId) {
    const room = await ensureRoom(code.toUpperCase());
    const playerId = crypto.randomUUID();

    room.players.set(playerId, {
      id: playerId,
      name: name.trim(),
      socketId,
      submitted: false,
      questions: []
    });

    await persistRoom(room);
    return { code: room.code, playerId, room: publicRoom(room) };
  },

  async reconnect(code, playerId, socketId) {
    const room = await ensureRoom(code.toUpperCase());
    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');
    player.socketId = socketId;
    return { code: room.code, room: publicRoom(room) };
  },

  async submitQuestions(code, playerId, questions) {
    const room = await ensureRoom(code.toUpperCase());
    const player = room.players.get(playerId);
    if (!player) throw new Error('Player not found');
    validateQuestions(questions);

    player.questions = questions.map((entry) => ({
      prompt: entry.prompt.trim(),
      answer: entry.answer.trim(),
      value: Number(entry.value)
    }));
    player.submitted = true;

    if ([...room.players.values()].every((entry) => entry.submitted)) {
      room.phase = 'team-setup';
    }

    await persistRoom(room);
    return publicRoom(room);
  },

  async setTeamsAndSettings(code, hostPlayerId, payload) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can configure teams');
    if (!Array.isArray(payload.teams) || payload.teams.length < 1) throw new Error('At least one team is required');

    const allPlayers = new Set(room.players.keys());
    const assignedPlayers = new Set();

    const teams = payload.teams.map((team) => {
      if (!team.name?.trim()) throw new Error('Team name is required');
      if (!Array.isArray(team.playerIds) || team.playerIds.length < 1) {
        throw new Error('Each team must include players');
      }

      team.playerIds.forEach((playerId) => {
        if (!allPlayers.has(playerId)) throw new Error('Invalid player assignment');
        if (assignedPlayers.has(playerId)) throw new Error('Player assigned to multiple teams');
        assignedPlayers.add(playerId);
      });

      return {
        id: crypto.randomUUID(),
        name: team.name.trim(),
        playerIds: team.playerIds,
        score: 0
      };
    });

    if (assignedPlayers.size !== allPlayers.size) throw new Error('All players must be assigned to a team');

    room.settings = payload.mode === 'infinite'
      ? { mode: 'infinite', rounds: null }
      : { mode: 'finite', rounds: Number(payload.rounds) };
    room.teams = teams;
    room.turnTeamId = teams[0].id;
    room.phase = 'playing';
    room.winnerTeamId = null;

    initializeBoard(room);
    await persistRoom(room);
    return publicRoom(room);
  },

  async setTeamScore(code, hostPlayerId, teamId, score) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can edit scores');

    const nextScore = Number(score);
    if (!Number.isFinite(nextScore)) throw new Error('Score must be a valid number');

    const team = room.teams.find((entry) => entry.id === teamId);
    if (!team) throw new Error('Team not found');

    team.score = Math.trunc(nextScore);
    await persistRoom(room);
    return publicRoom(room);
  },

  async selectQuestion(code, hostPlayerId, ownerPlayerId, value) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can select questions');
    if (room.phase !== 'playing') throw new Error('Game is not in playing phase');
    if (room.activeQuestion) throw new Error('Another question is active');

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
      value,
      prompt: question.prompt,
      answer: question.answer,
      attemptOrder: buildAttemptOrder(room.teams, selectedByTeamId, room.settings),
      attemptIndex: 0,
      attempts: []
    };
    room.lastWrongAttempt = null;

    await persistRoom(room);
    return publicRoom(room);
  },

  async submitAttempt(code, hostPlayerId, answer) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can submit attempts');
    if (!room.activeQuestion) throw new Error('No active question');

    const active = room.activeQuestion;
    const teamId = room.settings.mode === 'infinite'
      ? active.attemptOrder[active.attemptIndex % active.attemptOrder.length]
      : active.attemptOrder[active.attemptIndex];
    if (!teamId) throw new Error('No attempts remaining');

    const team = room.teams.find((entry) => entry.id === teamId);
    const isCorrect = isAnswerCorrect(answer, active.answer);

    active.attempts.push({
      teamId,
      teamName: team.name,
      answer: answer.trim(),
      isCorrect
    });

    if (isCorrect) {
      const { cell } = findCell(room, active.ownerPlayerId, active.value);
      cell.status = 'closed';
      completeQuestionWithPoints(room, teamId, active.value);
      await persistRoom(room);
      return {
        room: publicRoom(room),
        result: { isCorrect: true, teamId, teamName: team.name, value: active.value }
      };
    }

    room.lastWrongAttempt = {
      teamId,
      teamName: team.name,
      answer: answer.trim(),
      value: active.value
    };
    active.attemptIndex += 1;

    if (room.settings.mode === 'finite' && active.attemptIndex >= active.attemptOrder.length) {
      const { cell } = findCell(room, active.ownerPlayerId, active.value);
      cell.status = 'closed';
      completeQuestionWithoutPoints(room);
      await persistRoom(room);
      return {
        room: publicRoom(room),
        result: { isCorrect: false, exhausted: true }
      };
    }

    await persistRoom(room);
    return {
      room: publicRoom(room),
      result: {
        isCorrect: false,
        exhausted: false,
        nextTeamId: room.settings.mode === 'infinite'
          ? active.attemptOrder[active.attemptIndex % active.attemptOrder.length]
          : active.attemptOrder[active.attemptIndex]
      }
    };
  },

  async overrideLastIncorrect(code, hostPlayerId) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can override answers');
    if (!room.activeQuestion || !room.lastWrongAttempt) throw new Error('No incorrect attempt to override');

    const { teamId, value } = room.lastWrongAttempt;
    const { cell } = findCell(room, room.activeQuestion.ownerPlayerId, room.activeQuestion.value);
    cell.status = 'closed';
    completeQuestionWithPoints(room, teamId, value);

    await persistRoom(room);
    return publicRoom(room);
  },

  async passActiveQuestion(code, hostPlayerId) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can pass questions');
    if (!room.activeQuestion) throw new Error('No active question');

    const { cell } = findCell(room, room.activeQuestion.ownerPlayerId, room.activeQuestion.value);
    cell.status = 'closed';
    completeQuestionWithoutPoints(room);

    await persistRoom(room);
    return publicRoom(room);
  },

  async restartGame(code, hostPlayerId) {
    const room = await ensureRoom(code.toUpperCase());
    if (room.hostPlayerId !== hostPlayerId) throw new Error('Only host can restart game');

    const oldCode = room.code;
    const newCode = await generateUniqueCode();
    rooms.delete(oldCode);
    resetForNewRound(room, newCode);
    rooms.set(newCode, room);

    if (roomRepository.isEnabled()) {
      await roomRepository.renameRoom(oldCode, serializeRoom(room));
    }

    return {
      oldCode,
      newCode,
      room: publicRoom(room),
      playerIds: [...room.players.keys()]
    };
  },

  disconnect(socketId) {
    const located = getPlayerBySocket(socketId);
    if (!located) return null;
    located.player.socketId = null;
    return { code: located.room.code, room: publicRoom(located.room) };
  },

  async getRoom(code) {
    return publicRoom(await ensureRoom(code.toUpperCase()));
  },

  getPlayerContext(socketId) {
    const located = getPlayerBySocket(socketId);
    if (!located) return null;
    return {
      code: located.room.code,
      playerId: located.player.id,
      isHost: located.room.hostPlayerId === located.player.id,
      room: publicRoom(located.room)
    };
  }
};