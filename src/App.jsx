import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ResultsScreen } from './ResultsScreen.jsx';
import { useSound } from './useSound.js';

const QUESTION_VALUES = [100, 200, 300, 400, 500];
const STORAGE_KEY = 'jeopardy-session';
const NAME_MAX = 24;
const PROMPT_MAX = 300;
const ANSWER_MAX = 120;
const ATTEMPT_MAX = 200;
const TIMER_OPTIONS = [0, 10, 15, 20, 30, 45, 60];

const socketUrl =
  import.meta.env.VITE_SERVER_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

const socket = io(socketUrl, {
  autoConnect: true
});

const blankDraft = () =>
  QUESTION_VALUES.map((value) => ({
    localId: crypto.randomUUID(),
    value,
    prompt: '',
    answer: ''
  }));

const call = (event, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.message || 'Operation failed'));
        return;
      }
      resolve(response);
    });
  });

const teamById = (teams) => Object.fromEntries(teams.map((team) => [team.id, team]));

const tailSeq = (events) => (events && events.length ? events[events.length - 1].seq : 0);

const toFlash = (event, teamMap) => {
  switch (event.type) {
    case 'attempt-correct':
    case 'override-correct':
      return { tone: 'correct', headline: 'CORRECT!', detail: `${event.teamName} +$${event.points}`, holdMs: 1300 };
    case 'attempt-incorrect':
      return {
        tone: 'incorrect',
        headline: 'INCORRECT',
        detail: `Passing to ${event.nextTeamName}`,
        holdMs: 1300
      };
    case 'attempt-skipped':
      return {
        tone: 'incorrect',
        headline: "CAN'T ANSWER",
        detail: `Passing to ${event.nextTeamName}`,
        holdMs: 1300
      };
    case 'question-passed':
      return {
        tone: 'incorrect',
        headline: 'PASSED',
        detail: `Answer: ${event.correctAnswer}`,
        holdMs: 1800
      };
    case 'question-exhausted':
      return {
        tone: 'incorrect',
        headline: 'NO ONE GOT IT',
        detail: `Answer: ${event.correctAnswer}`,
        holdMs: 1800
      };
    case 'daily-double': {
      const teamName = teamMap[event.teamId]?.name || 'A team';
      return {
        tone: 'daily-double',
        headline: 'DAILY DOUBLE!',
        detail: `${teamName} · $${event.value} → $${event.value * event.multiplier}`,
        holdMs: 2000
      };
    }
    case 'game-over':
      return { tone: 'game-over', headline: 'GAME OVER', detail: '', holdMs: 1500 };
    default:
      return null;
  }
};

const SOUND_BY_TYPE = {
  'attempt-correct': 'correct',
  'override-correct': 'correct',
  'attempt-incorrect': 'incorrect',
  'attempt-skipped': 'incorrect',
  'question-passed': 'incorrect',
  'question-exhausted': 'incorrect',
  'daily-double': 'dailyDouble',
  'game-over': 'gameOver'
};

function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  });
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [suppressAutoResume, setSuppressAutoResume] = useState(false);

  const [busy, setBusy] = useState('');
  const busyRef = useRef('');
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const suppressAutoResumeRef = useRef(suppressAutoResume);
  suppressAutoResumeRef.current = suppressAutoResume;

  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [drafts, setDrafts] = useState(blankDraft);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [invalidDraftIds, setInvalidDraftIds] = useState(() => new Set());

  const [teamCountInput, setTeamCountInput] = useState('2');
  const [teamConfig, setTeamConfig] = useState([]);
  const [roundMode, setRoundMode] = useState('finite');
  const [roundCountInput, setRoundCountInput] = useState('1');
  const [dailyDoubleEnabled, setDailyDoubleEnabled] = useState(false);
  const [timerSecondsInput, setTimerSecondsInput] = useState('0');

  const [activeAnswerInput, setActiveAnswerInput] = useState('');
  const [scoreEditMode, setScoreEditMode] = useState(false);
  const [scoreDrafts, setScoreDrafts] = useState({});

  const [flash, setFlash] = useState(null);
  const [flashCursor, setFlashCursor] = useState(null);

  const [deadline, setDeadline] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const me = useMemo(() => room?.players.find((player) => player.id === session?.playerId) || null, [room, session]);
  const isHost = Boolean(room && session && room.hostPlayerId === session.playerId);

  const { muted, toggleMuted, play } = useSound(isHost);

  const teamMap = useMemo(() => teamById(room?.teams || []), [room]);
  const activeQuestion = room?.activeQuestion || null;
  const questionKey = activeQuestion ? `${activeQuestion.ownerPlayerId}:${activeQuestion.value}` : null;
  const attemptKey = activeQuestion ? `${questionKey}:${activeQuestion.attemptIndex}` : null;
  const isDailyDouble = Boolean(activeQuestion && activeQuestion.multiplier > 1);

  const run = async (key, action) => {
    if (busyRef.current) return;
    busyRef.current = key;
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      busyRef.current = '';
      setBusy('');
    }
  };

  const reconnectSession = async (nextSession) => {
    if (!nextSession?.code || !nextSession?.playerId) return false;
    try {
      const response = await call('room:reconnect', { code: nextSession.code, playerId: nextSession.playerId });
      setRoom(response.room);
      setFlashCursor(tailSeq(response.room.events));
      const rejoinedMe = response.room.players.find((player) => player.id === nextSession.playerId);
      if (rejoinedMe?.questions) {
        setDrafts(rejoinedMe.questions.map((question) => ({ localId: crypto.randomUUID(), ...question })));
      }
      setError('');
      return true;
    } catch (requestError) {
      setError(`Could not rejoin ${nextSession.code}: ${requestError.message}`);
      return false;
    }
  };

  // Flash drain: promote the next unseen event to a banner, one at a time.
  useEffect(() => {
    const events = room?.events || [];
    if (!events.length) return;
    const tail = tailSeq(events);
    if (flashCursor === null || tail < flashCursor) {
      setFlashCursor(tail);
      return;
    }
    if (flash) return;
    const next = events.find((event) => event.seq > flashCursor);
    if (!next) return;
    setFlashCursor(next.seq);
    const mapped = toFlash(next, teamMap);
    if (!mapped) return;
    const soundName = SOUND_BY_TYPE[next.type];
    if (soundName) play(soundName);
    setFlash({
      id: next.seq,
      ...mapped,
      questionKey: next.ownerPlayerId ? `${next.ownerPlayerId}:${next.value}` : null,
      visible: true
    });
  }, [room?.events, flash, flashCursor, teamMap, play]);

  // Flash lifecycle: hold, then a short exit fade, then gone.
  useEffect(() => {
    if (!flash) return undefined;
    if (flash.visible) {
      const holdTimeout = window.setTimeout(() => {
        setFlash((current) => (current?.id === flash.id ? { ...current, visible: false } : current));
      }, flash.holdMs);
      return () => window.clearTimeout(holdTimeout);
    }
    const exitTimeout = window.setTimeout(() => {
      setFlash((current) => (current?.id === flash.id ? null : current));
    }, 200);
    return () => window.clearTimeout(exitTimeout);
  }, [flash]);

  // Kill a stale banner the instant a new question opens.
  useEffect(() => {
    setFlash((current) => {
      if (!current?.questionKey || !questionKey) return current;
      return current.questionKey === questionKey ? current : null;
    });
  }, [questionKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    const onRoom = (nextRoom) => {
      setRoom(nextRoom);
      setError('');
    };
    const onConnect = () => {
      if (!suppressAutoResumeRef.current && sessionRef.current) reconnectSession(sessionRef.current);
    };
    socket.on('room:updated', onRoom);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:updated', onRoom);
      socket.off('connect', onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a saved session's code in sync after a restart hands out a new one.
  useEffect(() => {
    if (!room?.code || !session?.code) return;
    if (room.code !== session.code) {
      setSession((current) => (current ? { ...current, code: room.code } : current));
    }
  }, [room?.code, session?.code]);

  const teamCount = room?.players?.length
    ? Math.min(Math.max(Math.floor(Number(teamCountInput)) || 1, 1), room.players.length)
    : Math.max(Math.floor(Number(teamCountInput)) || 1, 1);

  useEffect(() => {
    if (!room || room.phase !== 'team-setup' || !isHost) return;
    const currentIds = new Set(room.players.map((player) => player.id));
    const configuredIds = new Set(teamConfig.flatMap((team) => team.playerIds));
    const coversRoomExactly =
      currentIds.size === configuredIds.size && [...currentIds].every((id) => configuredIds.has(id));
    if (coversRoomExactly) return;
    const teams = Array.from({ length: teamCount }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Team ${index + 1}`,
      playerIds: []
    }));
    room.players.forEach((player, index) => {
      teams[index % teamCount].playerIds.push(player.id);
    });
    setTeamConfig(teams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, isHost, teamCount]);

  useEffect(() => {
    setScoreDrafts(Object.fromEntries((room?.teams || []).map((team) => [team.id, String(team.score)])));
  }, [room]);

  useEffect(() => {
    if (!isHost || !activeQuestion || !room?.settings?.timerSeconds) {
      setDeadline(null);
      return;
    }
    setDeadline(Date.now() + room.settings.timerSeconds * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey, isHost, room?.settings?.timerSeconds]);

  useEffect(() => {
    if (!deadline) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [deadline]);

  useEffect(() => {
    if (!deadline || !activeQuestion) return;
    if (now >= deadline) {
      setDeadline(null);
      play('timeUp');
      skipTeam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, deadline, activeQuestion]);

  const resetToHome = () => {
    setRoom(null);
    setError('');
    setNotice('');
    setDrafts(blankDraft());
    setEditingQuestions(false);
    setInvalidDraftIds(new Set());
    setTeamCountInput('2');
    setTeamConfig([]);
    setRoundMode('finite');
    setRoundCountInput('1');
    setDailyDoubleEnabled(false);
    setTimerSecondsInput('0');
    setActiveAnswerInput('');
    setScoreEditMode(false);
    setFlash(null);
    setFlashCursor(null);
    setSuppressAutoResume(true);
  };

  const leaveCompletely = () => {
    resetToHome();
    setSuppressAutoResume(false);
    setSession(null);
  };

  const createRoom = () => run('create', async () => {
    setSuppressAutoResume(false);
    const response = await call('room:create', { name: createName.trim() });
    setSession({ code: response.code, playerId: response.playerId });
    setRoom(response.room);
    setFlashCursor(tailSeq(response.room.events));
  });

  const joinRoom = () => run('join', async () => {
    setSuppressAutoResume(false);
    const response = await call('room:join', { code: joinCode.trim().toUpperCase(), name: joinName.trim() });
    setSession({ code: response.code, playerId: response.playerId });
    setRoom(response.room);
    setFlashCursor(tailSeq(response.room.events));
  });

  const updateDraft = (localId, key, value) => {
    setDrafts((current) => current.map((entry) => (entry.localId === localId ? { ...entry, [key]: value } : entry)));
    setInvalidDraftIds((current) => {
      if (!current.has(localId)) return current;
      const next = new Set(current);
      next.delete(localId);
      return next;
    });
  };

  const resumePreviousGame = () => run('resume', async () => {
    await reconnectSession(session);
    setSuppressAutoResume(false);
  });

  const updateDraftValue = (localId, value) => {
    setDrafts((current) => {
      const numeric = Number(value);
      const collision = current.find((entry) => entry.localId !== localId && entry.value === numeric);
      return current.map((entry) => {
        if (entry.localId === localId) return { ...entry, value: numeric };
        if (collision && entry.localId === collision.localId) return { ...entry, value: current.find((e) => e.localId === localId).value };
        return entry;
      });
    });
  };

  const submitQuestions = () => run('submit-questions', async () => {
    const invalidIds = new Set(
      drafts
        .filter(
          (draft) =>
            !draft.prompt.trim() ||
            draft.prompt.length > PROMPT_MAX ||
            !draft.answer.trim() ||
            draft.answer.length > ANSWER_MAX
        )
        .map((draft) => draft.localId)
    );
    if (invalidIds.size) {
      setInvalidDraftIds(invalidIds);
      throw new Error('Fill out every question and answer before submitting.');
    }
    setInvalidDraftIds(new Set());
    await call('questions:submit', { code: room.code, playerId: session.playerId, questions: drafts });
    setEditingQuestions(false);
  });

  const continueToTeamSetup = () =>
    run('continue', () => call('lobby:continue', { code: room.code, playerId: session.playerId }));

  const regenerateTeams = (nextCountInput) => {
    setTeamCountInput(nextCountInput);
    if (!room) return;
    const count = Math.min(Math.max(Math.floor(Number(nextCountInput)) || 1, 1), room.players.length);
    const teams = Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Team ${index + 1}`,
      playerIds: []
    }));
    room.players.forEach((player, index) => {
      teams[index % count].playerIds.push(player.id);
    });
    setTeamConfig(teams);
  };

  const movePlayerTeam = (playerId, teamId) => {
    setTeamConfig((current) =>
      current.map((team) => ({
        ...team,
        playerIds:
          team.id === teamId
            ? [...team.playerIds.filter((id) => id !== playerId), playerId]
            : team.playerIds.filter((id) => id !== playerId)
      }))
    );
  };

  const emptyTeam = teamConfig.find((team) => team.playerIds.length === 0);
  const blankNameTeam = teamConfig.find((team) => !team.name.trim());
  const startGameBlocker = emptyTeam
    ? `"${emptyTeam.name || 'Unnamed team'}" has no players.`
    : blankNameTeam
    ? 'Every team needs a name.'
    : null;
  const duplicateTeamNames = (() => {
    const seen = new Set();
    const dupes = new Set();
    teamConfig.forEach((team) => {
      const key = team.name.trim().toLowerCase();
      if (key && seen.has(key)) dupes.add(team.name.trim());
      seen.add(key);
    });
    return [...dupes];
  })();

  const startGame = () =>
    run('start-game', () =>
      call('game:configure', {
        code: room.code,
        playerId: session.playerId,
        config: {
          teams: teamConfig.map((team) => ({ name: team.name, playerIds: team.playerIds })),
          mode: roundMode,
          rounds: roundMode === 'finite' ? Number(roundCountInput) : null,
          dailyDouble: dailyDoubleEnabled,
          timerSeconds: Number(timerSecondsInput)
        }
      })
    );

  const updateScoreDraft = (teamId, value) => {
    setScoreDrafts((current) => ({ ...current, [teamId]: value }));
  };

  const saveTeamScore = (teamId) =>
    run('score', async () => {
      const raw = (scoreDrafts[teamId] ?? '').trim();
      if (!/^-?\d{1,7}$/.test(raw)) throw new Error('Score must be a whole number.');
      await call('team:score:set', { code: room.code, playerId: session.playerId, teamId, score: Number(raw) });
      setNotice('Score updated.');
    });

  const selectQuestion = (ownerPlayerId, value) =>
    run('select', async () => {
      setActiveAnswerInput('');
      await call('question:select', { code: room.code, playerId: session.playerId, ownerPlayerId, value });
      play('select');
    });

  const submitAttempt = () =>
    run('attempt', async () => {
      const answer = activeAnswerInput;
      setActiveAnswerInput('');
      await call('question:attempt', { code: room.code, playerId: session.playerId, answer });
    });

  const skipTeam = () =>
    run('skip', () => call('question:skip', { code: room.code, playerId: session.playerId }));

  const overrideIncorrect = () =>
    run('override', () => call('question:override', { code: room.code, playerId: session.playerId }));

  const passQuestion = () =>
    run('pass', () => call('question:pass', { code: room.code, playerId: session.playerId }));

  const restartGame = () =>
    run('restart', async () => {
      setDrafts(blankDraft());
      setEditingQuestions(false);
      setInvalidDraftIds(new Set());
      await call('game:restart', { code: room.code, playerId: session.playerId });
    });

  const copyRoomCode = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice('Room code copied.');
    } catch {
      setError('Could not copy the room code.');
    }
  };

  const canResume = Boolean(session?.code && session?.playerId && !room);

  if (!room || !session) {
    return (
      <div className="app">
        <div className="home-screen">
          <div className="card home-card">
            <h1>Jeopardy</h1>
            <h2>Create a Game</h2>
            <input
              value={createName}
              maxLength={NAME_MAX}
              placeholder="Your name"
              onChange={(event) => setCreateName(event.target.value)}
            />
            <button type="button" disabled={!createName.trim() || Boolean(busy)} onClick={createRoom}>
              {busy === 'create' ? 'Creating…' : 'Create Game'}
            </button>
          </div>

          <div className="card home-card">
            <h2>Join a Game</h2>
            <input
              value={joinCode}
              maxLength={8}
              placeholder="Room code"
              onChange={(event) => setJoinCode(event.target.value)}
            />
            <input
              value={joinName}
              maxLength={NAME_MAX}
              placeholder="Your name"
              onChange={(event) => setJoinName(event.target.value)}
            />
            <button
              type="button"
              disabled={!joinCode.trim() || !joinName.trim() || Boolean(busy)}
              onClick={joinRoom}
            >
              {busy === 'join' ? 'Joining…' : 'Join Game'}
            </button>
          </div>

          {canResume && (
            <div className="card home-card">
              <h2>Resume</h2>
              <p>Room {session.code}</p>
              <button type="button" disabled={Boolean(busy)} onClick={resumePreviousGame}>
                Resume Previous Game
              </button>
              <button type="button" className="subtle" disabled={Boolean(busy)} onClick={leaveCompletely}>
                Forget Saved Session
              </button>
            </div>
          )}
        </div>
        {error && <div className="error sticky">{error}</div>}
      </div>
    );
  }

  const hostPlayer = room.players.find((player) => player.id === room.hostPlayerId);
  const hostName = hostPlayer?.name || 'the host';

  const flashFragment = flash && (
    <div className={`result-flash ${flash.tone}${flash.visible ? '' : ' leaving'}`}>
      <div className="result-flash-text">
        <div className="result-flash-headline">{flash.headline}</div>
        {flash.detail && <div className="result-flash-detail">{flash.detail}</div>}
      </div>
    </div>
  );

  if (room.phase === 'finished') {
    return (
      <div className="app">
        <ResultsScreen
          room={room}
          isHost={isHost}
          hostName={hostName}
          busy={Boolean(busy)}
          scoreEditMode={scoreEditMode}
          scoreDrafts={scoreDrafts}
          onToggleScoreEdit={() => setScoreEditMode((current) => !current)}
          onScoreDraftChange={updateScoreDraft}
          onSaveScore={saveTeamScore}
          onRestart={restartGame}
          onLeave={leaveCompletely}
        />
        {notice && <div className="pill notice">{notice}</div>}
        {flashFragment}
        {error && <div className="error sticky">{error}</div>}
      </div>
    );
  }

  const allSubmitted = room.players.length > 0 && room.players.every((player) => player.submitted);
  const currentTeam = room.turnTeamId ? teamMap[room.turnTeamId] : null;

  const renderScoreCard = (team, emphasizeTurn) => (
    <div key={team.id} className={`score-card${emphasizeTurn && team.id === room.turnTeamId ? ' active' : ''}`}>
      <div className="label">{team.name}</div>
      {scoreEditMode && isHost ? (
        <div className="score-editor">
          <input
            type="text"
            inputMode="numeric"
            value={scoreDrafts[team.id] ?? ''}
            maxLength={8}
            onChange={(event) => updateScoreDraft(team.id, event.target.value)}
          />
          <button type="button" className="subtle" disabled={Boolean(busy)} onClick={() => saveTeamScore(team.id)}>
            Save
          </button>
        </div>
      ) : (
        <div className="score-value">${team.score}</div>
      )}
    </div>
  );

  const timerTotalMs = (room.settings?.timerSeconds || 0) * 1000;
  const timerRemainingMs = deadline ? Math.max(0, deadline - now) : 0;
  const timerPct = timerTotalMs ? (timerRemainingMs / timerTotalMs) * 100 : 0;
  const timerSecondsLeft = Math.ceil(timerRemainingMs / 1000);

  return (
    <div className="app">
      <header className="topbar card">
        <div>
          <div className="label">Room code</div>
          <div className="room-code-row">
            <div className="room-code code-block">{room.code}</div>
            {typeof navigator !== 'undefined' && navigator.clipboard && (
              <button type="button" className="subtle" onClick={copyRoomCode}>
                Copy
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="label">You</div>
          <div>
            {me?.name} {isHost ? '(Host)' : ''}
          </div>
        </div>
        <div className="topbar-actions">
          {isHost && (
            <button type="button" className="secondary subtle" onClick={toggleMuted}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          <button type="button" className="secondary" onClick={resetToHome}>
            Go Home
          </button>
          <button type="button" className="secondary danger subtle" onClick={leaveCompletely}>
            Leave Completely
          </button>
        </div>
      </header>

      {notice && <div className="pill notice">{notice}</div>}

      {room.phase === 'lobby' && (
        <section className="card">
          <h2>Question Submission</h2>
          <p>Each player writes 5 questions, one per point value.</p>

          {!me?.submitted || editingQuestions ? (
            <>
              <div className="question-grid">
                {drafts.map((draft) => (
                  <div key={draft.localId} className={`question-card${invalidDraftIds.has(draft.localId) ? ' invalid' : ''}`}>
                    <div className="question-head">
                      <label>Value</label>
                      <select value={draft.value} onChange={(event) => updateDraftValue(draft.localId, event.target.value)}>
                        {QUESTION_VALUES.map((value) => (
                          <option key={value} value={value}>
                            ${value}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label>Question</label>
                    <textarea
                      rows={3}
                      maxLength={PROMPT_MAX}
                      value={draft.prompt}
                      placeholder="Write the clue/question"
                      onChange={(event) => updateDraft(draft.localId, 'prompt', event.target.value)}
                    />
                    {draft.prompt.length >= PROMPT_MAX * 0.8 && (
                      <div className={`char-count${draft.prompt.length >= PROMPT_MAX ? ' danger' : ''}`}>
                        {draft.prompt.length}/{PROMPT_MAX}
                      </div>
                    )}
                    <label>Answer</label>
                    <input
                      maxLength={ANSWER_MAX}
                      value={draft.answer}
                      placeholder="Expected answer"
                      onChange={(event) => updateDraft(draft.localId, 'answer', event.target.value)}
                    />
                    {draft.answer.length >= ANSWER_MAX * 0.8 && (
                      <div className={`char-count${draft.answer.length >= ANSWER_MAX ? ' danger' : ''}`}>
                        {draft.answer.length}/{ANSWER_MAX}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" disabled={Boolean(busy)} onClick={submitQuestions}>
                {busy === 'submit-questions' ? 'Submitting…' : 'Submit My Questions'}
              </button>
            </>
          ) : (
            <div className="lobby-ready">
              <div className="pill success">
                Questions submitted. {isHost ? 'Waiting for everyone else.' : 'Waiting for the host.'}
              </div>
              <button type="button" className="secondary subtle" onClick={() => setEditingQuestions(true)}>
                Edit My Questions
              </button>
            </div>
          )}

          <div className="players-list">
            {room.players.map((player) => (
              <div key={player.id} className={`pill ${player.submitted ? 'success' : ''}${!player.isConnected ? ' offline' : ''}`}>
                {player.name} - {player.submitted ? 'Ready' : 'Editing'}
                {!player.isConnected ? ' (offline)' : ''}
              </div>
            ))}
          </div>

          {isHost && (
            <button type="button" disabled={!allSubmitted || Boolean(busy)} onClick={continueToTeamSetup}>
              {busy === 'continue' ? 'Continuing…' : 'Continue to Team Setup'}
            </button>
          )}
        </section>
      )}

      {room.phase === 'team-setup' && (
        <section className="card team-layout">
          <h2>Team Setup</h2>

          <div className="inline-controls">
            <div className="control-field">
              <label>Number of teams</label>
              <input
                type="number"
                min="1"
                max={room.players.length}
                value={teamCountInput}
                onChange={(event) => regenerateTeams(event.target.value)}
              />
            </div>

            <div className="control-field">
              <label>Round mode</label>
              <select value={roundMode} onChange={(event) => setRoundMode(event.target.value)}>
                <option value="finite">Finite</option>
                <option value="infinite">Infinite</option>
              </select>
            </div>

            {roundMode === 'finite' && (
              <div className="control-field">
                <label>Rounds per team</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={roundCountInput}
                  onChange={(event) => setRoundCountInput(event.target.value)}
                />
              </div>
            )}

            <div className="control-field">
              <label>Answer timer</label>
              <select value={timerSecondsInput} onChange={(event) => setTimerSecondsInput(event.target.value)}>
                {TIMER_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds === 0 ? 'Off' : `${seconds}s`}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-field checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={dailyDoubleEnabled}
                  onChange={(event) => setDailyDoubleEnabled(event.target.checked)}
                />
                Enable Daily Double
              </label>
            </div>
          </div>

          <div className="player-pool">
            <h3>Players</h3>
            {room.players.map((player) => {
              const assignedTeam = teamConfig.find((team) => team.playerIds.includes(player.id));
              return (
                <div className="player-row" key={player.id}>
                  <span>
                    {player.name}
                    {!player.isConnected ? ' (offline)' : ''}
                  </span>
                  <select value={assignedTeam?.id || ''} onChange={(event) => movePlayerTeam(player.id, event.target.value)}>
                    {teamConfig.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="teams-preview">
            {teamConfig.map((team) => (
              <div className="team-card" key={team.id}>
                <input
                  value={team.name}
                  maxLength={NAME_MAX}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setTeamConfig((current) =>
                      current.map((entry) => (entry.id === team.id ? { ...entry, name: nextName } : entry))
                    );
                  }}
                />
                <div>{team.playerIds.length} player(s)</div>
              </div>
            ))}
          </div>

          {startGameBlocker && <div className="field-error">{startGameBlocker}</div>}
          {duplicateTeamNames.length > 0 && (
            <div className="field-error warn">Duplicate team names: {duplicateTeamNames.join(', ')}</div>
          )}

          {isHost && (
            <button type="button" disabled={Boolean(busy) || Boolean(startGameBlocker)} onClick={startGame}>
              {busy === 'start-game' ? 'Starting…' : 'Start Game'}
            </button>
          )}
        </section>
      )}

      {room.phase === 'playing' && (
        <section className="card">
          <div className="board-top">
            <h2>Board</h2>
            <div>{currentTeam ? `${currentTeam.name}'s turn to pick` : ''}</div>
            {isHost && (
              <button type="button" className="subtle" onClick={() => setScoreEditMode((current) => !current)}>
                {scoreEditMode ? 'Done Editing Scores' : 'Edit Scores'}
              </button>
            )}
          </div>

          <div className="score-row">{room.teams.map((team) => renderScoreCard(team, true))}</div>

          <div className="board-grid">
            {room.board.columns.map((column) => (
              <div key={column.playerId} className="board-column">
                <div className="board-header">{column.playerName}</div>
                {column.cells.map((cell) => (
                  <button
                    type="button"
                    key={`${column.playerId}-${cell.value}`}
                    className={`board-cell ${cell.status}${
                      cell.multiplier > 1 && cell.status !== 'open' ? ' daily-double-cell' : ''
                    }`}
                    disabled={!isHost || room.phase !== 'playing' || cell.status !== 'open' || Boolean(activeQuestion) || Boolean(busy)}
                    onClick={() => selectQuestion(column.playerId, cell.value)}
                  >
                    {cell.status === 'open' ? `$${cell.value}` : ''}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {activeQuestion && room.phase === 'playing' && (
        <div className="question-overlay">
          <div className={`question-overlay-card${isDailyDouble ? ' daily-double' : ''}`}>
            {isDailyDouble && <div className="pill daily-double-pill">DAILY DOUBLE ×{activeQuestion.multiplier}</div>}
            <div className="active-meta">
              <span>
                {activeQuestion.ownerPlayerName} -{' '}
                {isDailyDouble
                  ? `$${activeQuestion.value} → $${activeQuestion.value * activeQuestion.multiplier}`
                  : `$${activeQuestion.value}`}
              </span>
              <span>Answering team: {teamMap[activeQuestion.currentTeamId]?.name || '-'}</span>
            </div>

            <h2 className="question-prompt">{activeQuestion.prompt}</h2>

            {isHost && (
              <>
                {room.settings.timerSeconds > 0 && deadline && (
                  <div className="timer-block">
                    <div className={`timer-track${timerPct < 20 ? ' danger' : timerPct < 50 ? ' warn' : ''}`}>
                      <div className="timer-bar" style={{ width: `${timerPct}%` }} />
                    </div>
                    <div className="timer-count">{timerSecondsLeft}s</div>
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!activeAnswerInput.trim() || busy) return;
                    submitAttempt();
                  }}
                >
                  <input
                    value={activeAnswerInput}
                    maxLength={ATTEMPT_MAX}
                    placeholder="Type team answer"
                    autoFocus
                    onChange={(event) => setActiveAnswerInput(event.target.value)}
                  />
                  <div className="actions">
                    <button type="submit" disabled={!activeAnswerInput.trim() || Boolean(busy)}>
                      {busy === 'attempt' ? 'Submitting…' : 'Submit Attempt'}
                    </button>
                    <button type="button" className="secondary" disabled={Boolean(busy)} onClick={skipTeam}>
                      Can't Answer
                    </button>
                    {room.lastWrongAttempt && (
                      <button type="button" className="secondary" disabled={Boolean(busy)} onClick={overrideIncorrect}>
                        Override Last Incorrect
                      </button>
                    )}
                    <button type="button" className="secondary" disabled={Boolean(busy)} onClick={passQuestion}>
                      Pass Question
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {flashFragment}
      {error && <div className="error sticky">{error}</div>}
    </div>
  );
}

export default App;
