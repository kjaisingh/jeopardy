import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ResultsScreen } from './ResultsScreen.jsx';
import { HelpModal } from './components/HelpModal.jsx';
import { FlashBanner } from './components/FlashBanner.jsx';
import { QuestionOverlay } from './components/QuestionOverlay.jsx';
import { TopBar } from './components/TopBar.jsx';
import { SupersededScreen } from './components/SupersededScreen.jsx';
import { HomeScreen } from './components/HomeScreen.jsx';
import { LobbyScreen } from './components/LobbyScreen.jsx';
import { TeamSetupScreen } from './components/TeamSetupScreen.jsx';
import { BoardScreen } from './components/BoardScreen.jsx';
import { useSound } from './useSound.js';
import { teamById, tailSeq, toFlash, SOUND_BY_TYPE } from './flash.js';
import {
  PROMPT_MAX,
  ANSWER_MAX,
  ATTEMPT_MAX,
  normalizeRoomCodeInput,
  valuesForCount
} from './constants.js';
import {
  blankDraft,
  buildTeams,
  duplicateNames,
  reconcileDrafts,
  reconcileTeams,
  shuffleArray
} from './gameSetup.js';
import { clearDrafts, loadDrafts, saveDrafts } from './draftStorage.js';
import { formatMoney } from './format.js';
import { call, socket } from './clientTransport.js';
import { loadSession, writeStorage, removeStorage } from './browserStorage.js';

const STORAGE_KEY = 'jeopardy-session';

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.className = 'clipboard-fallback';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy is unavailable');
};

function App() {
  const [session, setSession] = useState(() => loadSession(STORAGE_KEY));
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [suppressAutoResume, setSuppressAutoResume] = useState(() =>
    new URLSearchParams(window.location.search).has('join')
  );

  const [busy, setBusy] = useState('');
  const busyRef = useRef('');
  const sessionRef = useRef(session);
  const suppressAutoResumeRef = useRef(suppressAutoResume);
  const pendingDetachRef = useRef(Promise.resolve());
  const pendingLeaveRef = useRef(Promise.resolve());
  const sessionGenerationRef = useRef(0);
  const resumingRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    suppressAutoResumeRef.current = suppressAutoResume;
  }, [suppressAutoResume]);

  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState(
    () => normalizeRoomCodeInput(new URLSearchParams(window.location.search).get('join') || '')
  );

  const [drafts, setDrafts] = useState(() => []);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [invalidDraftIds, setInvalidDraftIds] = useState(() => new Set());
  const prevQuestionsPerPlayerRef = useRef(null);

  const [questionsPerPlayerInput, setQuestionsPerPlayerInput] = useState('5');
  const [teamCountInput, setTeamCountInput] = useState('2');
  const [teamConfig, setTeamConfig] = useState([]);
  const [roundMode, setRoundMode] = useState('infinite');
  const [roundCountInput, setRoundCountInput] = useState('1');
  const [dailyDoubleEnabled, setDailyDoubleEnabled] = useState(false);
  const [timerSecondsInput, setTimerSecondsInput] = useState('0');

  const [settingsEditMode, setSettingsEditMode] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);

  const [activeAnswerInput, setActiveAnswerInput] = useState('');
  const [scoreEditMode, setScoreEditMode] = useState(false);
  const [scoreDrafts, setScoreDrafts] = useState({});

  const [flash, setFlash] = useState(null);
  const [flashCursor, setFlashCursor] = useState(null);

  const [superseded, setSuperseded] = useState(false);
  const supersededRef = useRef(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [everConnected, setEverConnected] = useState(socket.connected);

  const me = useMemo(() => room?.players.find((player) => player.id === session?.playerId) || null, [room, session]);
  const isHost = Boolean(room && session && room.hostPlayerId === session.playerId);
  const hostPlayer = useMemo(
    () => room?.players.find((player) => player.id === room.hostPlayerId) || null,
    [room]
  );

  const { available: soundAvailable, muted, toggleMuted, play } = useSound(isHost);

  const teamMap = useMemo(() => teamById(room?.teams || []), [room]);
  const activeQuestion = room?.activeQuestion || null;
  const deadline = activeQuestion?.deadlineAt || null;
  const questionKey = activeQuestion ? `${activeQuestion.ownerPlayerId}:${activeQuestion.value}` : null;
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
    if (resumingRef.current) return false;
    if (!nextSession?.code || !nextSession?.playerId) return false;
    if (!nextSession.sessionToken) {
      setSession(null);
      setError('Your saved session is invalid. Rejoin the room to continue.');
      return false;
    }
    const generation = sessionGenerationRef.current;
    resumingRef.current = true;
    try {
      const response = await call('room:reconnect', {
        code: nextSession.code,
        sessionToken: nextSession.sessionToken
      });
      if (generation !== sessionGenerationRef.current) return false;
      setRoom(response.room);
      setFlashCursor(tailSeq(response.room.events));
      const rejoinedMe = response.room.players.find((player) => player.id === nextSession.playerId);
      const savedDrafts = loadDrafts(nextSession);
      const submittedDrafts = (rejoinedMe?.questions || []).map((question) => ({ localId: crypto.randomUUID(), ...question }));
      setDrafts((current) => reconcileDrafts(
        current.length ? current : savedDrafts.length ? savedDrafts : submittedDrafts,
        response.room.settings.questionsPerPlayer
      ));
      if (savedDrafts.length && rejoinedMe?.submitted) setEditingQuestions(true);
      setError('');
      return true;
    } catch (requestError) {
      setError(`Could not rejoin ${nextSession.code}: ${requestError.message}`);
      return false;
    } finally {
      resumingRef.current = false;
    }
  };

  // Flash drain: promote the next unseen event to a banner, one at a time. Layout-timed so a
  // game-over preemption lands before paint and never bleeds a stale banner into Results.
  useLayoutEffect(() => {
    const events = room?.events || [];
    if (!events.length) return;
    const tail = tailSeq(events);
    if (flashCursor === null || tail < flashCursor) {
      setFlashCursor(tail);
      return;
    }
    // Game-over always preempts whatever's showing, so the last question's banner never bleeds into
    // Results. It clears any stale banner but shows none of its own — the Results screen's hero
    // heading already announces the winner, and a floating banner would just cover it.
    const gameOver = events.find((event) => event.seq > flashCursor && event.type === 'game-over');
    if (gameOver) {
      setFlashCursor(gameOver.seq);
      const soundName = SOUND_BY_TYPE[gameOver.type];
      if (soundName) play(soundName);
      setFlash(null);
      return;
    }
    if (flash) return;
    const pending = events.filter((event) => event.seq > flashCursor);
    if (!pending.length) return;
    const next = pending[pending.length - 1];
    setFlashCursor(tail);
    const mapped = toFlash(next);
    if (!mapped) return;
    const soundName = SOUND_BY_TYPE[next.type];
    if (soundName) play(soundName);
    setFlash({
      id: next.seq,
      ...mapped,
      questionKey: next.ownerPlayerId ? `${next.ownerPlayerId}:${next.value}` : null,
      visible: true
    });
  }, [room?.events, flash, flashCursor, play]);

  // Flash lifecycle: closable banners stay up until manually dismissed; others
  // auto-dismiss after a couple seconds. Either way, a short exit fade follows.
  useEffect(() => {
    if (!flash) return undefined;
    if (flash.visible) {
      if (flash.closable) return undefined;
      const autoDismiss = window.setTimeout(() => {
        setFlash((current) => (current?.id === flash.id ? { ...current, visible: false } : current));
      }, 1600);
      return () => window.clearTimeout(autoDismiss);
    }
    const exitTimeout = window.setTimeout(() => {
      setFlash((current) => (current?.id === flash.id ? null : current));
    }, 200);
    return () => window.clearTimeout(exitTimeout);
  }, [flash]);

  const dismissFlash = () => {
    setFlash((current) => (current ? { ...current, visible: false } : current));
  };

  // Kill a stale banner the instant a new question opens (before paint, so it never overlaps the new overlay).
  useLayoutEffect(() => {
    setFlash((current) => {
      if (!current?.questionKey || !questionKey) return current;
      return current.questionKey === questionKey ? current : null;
    });
  }, [questionKey, flash]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const saved = session ? writeStorage(STORAGE_KEY, JSON.stringify(session)) : removeStorage(STORAGE_KEY);
    setStorageUnavailable(Boolean(session) && !saved);
  }, [session]);

  useEffect(() => {
    const onRoom = (nextRoom) => {
      if (suppressAutoResumeRef.current || resumingRef.current) return;
      setRoom(nextRoom);
      setError('');
    };
    const onConnect = () => {
      setEverConnected(true);
      setConnected(true);
      if (!suppressAutoResumeRef.current && !supersededRef.current && sessionRef.current) reconnectSession(sessionRef.current);
    };
    const onDisconnect = () => setConnected(false);
    const onSuperseded = () => {
      supersededRef.current = true;
      setSuperseded(true);
    };
    const onKicked = () => {
      suppressAutoResumeRef.current = true;
      resetToHome();
      setSession(null);
      setNotice('You were removed from the room by the host.');
    };
    socket.on('room:updated', onRoom);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('session:superseded', onSuperseded);
    socket.on('room:kicked', onKicked);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:updated', onRoom);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('session:superseded', onSuperseded);
      socket.off('room:kicked', onKicked);
    };
  }, []);

  // Strip a ?join= deep-link param once it has been used to prefill the join form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('join')) return;
    params.delete('join');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);

  // Keep a saved session's code in sync after a restart hands out a new one.
  useEffect(() => {
    if (!room?.code || !session?.code) return;
    if (room.code !== session.code) {
      setSession((current) => (current ? { ...current, code: room.code } : current));
    }
  }, [room?.code, session?.code]);

  // A restart hands out a brand-new room code — drop any banner still fading from the old game.
  const prevRoomCodeRef = useRef(room?.code);
  useEffect(() => {
    if (room?.code && prevRoomCodeRef.current && room.code !== prevRoomCodeRef.current) {
      setFlash(null);
      setFlashCursor(null);
      clearDrafts({ code: prevRoomCodeRef.current, playerId: sessionRef.current?.playerId });
      setDrafts(blankDraft(room.settings.questionsPerPlayer));
      setEditingQuestions(false);
      setInvalidDraftIds(new Set());
      setTeamConfig([]);
    }
    prevRoomCodeRef.current = room?.code;
  }, [room?.code, room?.settings.questionsPerPlayer]);

  const teamCount = room?.players?.length
    ? Math.min(Math.max(Math.floor(Number(teamCountInput)) || 1, 1), room.players.length)
    : Math.max(Math.floor(Number(teamCountInput)) || 1, 1);

  useEffect(() => {
    if (!room || room.phase !== 'team-setup' || !isHost) return;
    setTeamConfig((current) => {
      const currentIds = new Set(room.players.map((player) => player.id));
      const configuredIds = new Set(current.flatMap((team) => team.playerIds));
      const coversRoomExactly =
        currentIds.size === configuredIds.size && [...currentIds].every((id) => configuredIds.has(id));
      if (coversRoomExactly && current.length === teamCount) return current;
      if (current.length === 0) return buildTeams(teamCount, room.players);
      return reconcileTeams(current, teamCount, room.players);
    });
  }, [room, isHost, teamCount]);

  useEffect(() => {
    if (scoreEditMode) return;
    setScoreDrafts(Object.fromEntries((room?.teams || []).map((team) => [team.id, String(team.score)])));
  }, [room, scoreEditMode]);

  useEffect(() => {
    const count = room?.settings?.questionsPerPlayer;
    if (!count) return;
    if (prevQuestionsPerPlayerRef.current === null) {
      prevQuestionsPerPlayerRef.current = count;
      setDrafts((current) => (current.length ? current : blankDraft(count)));
      return;
    }
    if (prevQuestionsPerPlayerRef.current === count) return;
    prevQuestionsPerPlayerRef.current = count;
    setDrafts((current) => reconcileDrafts(current, count));
  }, [room?.settings?.questionsPerPlayer]);

  useEffect(() => {
    if (!session || !room || session.code !== room.code || room.phase !== 'lobby' || (me?.submitted && !editingQuestions) || !drafts.length) return;
    saveDrafts(session, drafts);
  }, [drafts, me?.submitted, editingQuestions, room, session]);

  useEffect(() => {
    if (!isHost || room?.phase !== 'lobby') {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(`${window.location.origin}/?join=${room.code}`)
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [isHost, room?.phase, room?.code]);

  const resetToHome = () => {
    sessionGenerationRef.current += 1;
    setRoom(null);
    setError('');
    setNotice('');
    setDrafts([]);
    prevQuestionsPerPlayerRef.current = null;
    setEditingQuestions(false);
    setInvalidDraftIds(new Set());
    setTeamCountInput('2');
    setTeamConfig([]);
    setRoundMode('infinite');
    setRoundCountInput('1');
    setDailyDoubleEnabled(false);
    setTimerSecondsInput('0');
    setQuestionsPerPlayerInput('5');
    setSettingsEditMode(false);
    setSettingsDraft(null);
    setActiveAnswerInput('');
    setScoreEditMode(false);
    setFlash(null);
    setFlashCursor(null);
    setSuperseded(false);
    supersededRef.current = false;
    setQrDataUrl('');
    setSuppressAutoResume(true);
  };

  const leaveCompletely = () => {
    suppressAutoResumeRef.current = true;
    if (session?.code && !superseded) {
      const savedSession = session;
      const wasInRoom = Boolean(room);
      pendingLeaveRef.current = pendingDetachRef.current
        .then(() => call('room:forget', wasInRoom
          ? {}
          : { code: savedSession.code, sessionToken: savedSession.sessionToken }))
        .catch(() => {});
    }
    clearDrafts(session);
    resetToHome();
    setSession(null);
  };

  const createRoom = () => run('create', async () => {
    await pendingDetachRef.current;
    await pendingLeaveRef.current;
    suppressAutoResumeRef.current = false;
    setSuppressAutoResume(false);
    const response = await call('room:create', {
      name: createName.trim(),
      settings: {
        mode: roundMode,
        rounds: roundMode === 'finite' ? Number(roundCountInput) : null,
        dailyDouble: dailyDoubleEnabled,
        timerSeconds: Number(timerSecondsInput),
        questionsPerPlayer: Number(questionsPerPlayerInput)
      }
    });
    setSession({
      code: response.code,
      playerId: response.playerId,
      sessionToken: response.sessionToken
    });
    setRoom(response.room);
    setFlashCursor(tailSeq(response.room.events));
  });

  const joinRoom = () => run('join', async () => {
    await pendingDetachRef.current;
    await pendingLeaveRef.current;
    suppressAutoResumeRef.current = false;
    setSuppressAutoResume(false);
    const response = await call('room:join', { code: joinCode.trim().toUpperCase(), name: joinName.trim() });
    setSession({
      code: response.code,
      playerId: response.playerId,
      sessionToken: response.sessionToken
    });
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
    await pendingDetachRef.current;
    if (await reconnectSession(session)) {
      suppressAutoResumeRef.current = false;
      setSuppressAutoResume(false);
    }
  });

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
    const required = valuesForCount(room.settings.questionsPerPlayer);
    const missing = required.filter((value) => !drafts.some((draft) => draft.value === value));
    if (missing.length) {
      throw new Error(`Missing a ${missing.map((value) => `$${value}`).join(' and a ')} question.`);
    }
    setInvalidDraftIds(new Set());
    await call('questions:submit', { questions: drafts });
    clearDrafts(session);
    setEditingQuestions(false);
  });

  const continueToTeamSetup = () =>
    run('continue', () => call('lobby:continue', {}));

  const toggleSettingsEdit = () => {
    if (!settingsEditMode) {
      setSettingsDraft({
        mode: room.settings.mode,
        rounds: room.settings.rounds ?? 1,
        dailyDouble: room.settings.dailyDouble,
        timerSeconds: room.settings.timerSeconds,
        questionsPerPlayer: room.settings.questionsPerPlayer
      });
    }
    setSettingsEditMode((current) => !current);
  };

  const updateSettingsDraft = (key, value) => setSettingsDraft((current) => ({ ...current, [key]: value }));

  const saveSettings = () =>
    run('save-settings', async () => {
      await call('game:settings', {
        settings: {
          mode: settingsDraft.mode,
          rounds: settingsDraft.mode === 'finite' ? Number(settingsDraft.rounds) : null,
          dailyDouble: settingsDraft.dailyDouble,
          timerSeconds: Number(settingsDraft.timerSeconds),
          questionsPerPlayer: Number(settingsDraft.questionsPerPlayer)
        }
      });
      setSettingsEditMode(false);
    });

  const regenerateTeams = (nextCountInput) => {
    setTeamCountInput(nextCountInput);
    if (!room) return;
    const count = Math.min(Math.max(Math.floor(Number(nextCountInput)) || 1, 1), room.players.length);
    setTeamConfig(buildTeams(count, room.players));
  };

  const shuffleTeams = () => {
    if (!room || teamConfig.length === 0) return;
    const shuffled = shuffleArray(room.players);
    setTeamConfig((current) => {
      const teams = current.map((team) => ({ ...team, playerIds: [] }));
      shuffled.forEach((player, index) => {
        teams[index % teams.length].playerIds.push(player.id);
      });
      return teams;
    });
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
  const duplicateTeamNames = duplicateNames(teamConfig);
  const startGameBlocker = emptyTeam
    ? `"${emptyTeam.name || 'Unnamed team'}" has no players.`
    : blankNameTeam
    ? 'Every team needs a name.'
    : duplicateTeamNames.length
    ? `Team names must be unique: ${duplicateTeamNames.join(', ')}.`
    : null;

  const startGame = () =>
    run('start-game', () =>
      call('game:configure', {
        config: {
          teams: teamConfig.map((team) => ({ name: team.name, playerIds: team.playerIds }))
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
      await call('team:score:set', { teamId, score: Number(raw) });
      setNotice('Score updated.');
    });

  const selectQuestion = (ownerPlayerId, value) =>
    run('select', async () => {
      setActiveAnswerInput('');
      await call('question:select', { ownerPlayerId, value });
      play('select');
    });

  const submitAttempt = () =>
    run('attempt', async () => {
      const answer = activeAnswerInput;
      await call('question:attempt', { answer, ...attemptContext() });
      setActiveAnswerInput((current) => current === answer ? '' : current);
    });

  const attemptContext = () => ({
    questionId: activeQuestion?.id,
    attemptIndex: activeQuestion?.attemptIndex
  });

  const advanceTeam = () =>
    run('skip', () => call('question:skip', attemptContext()));

  const overrideIncorrect = () =>
    run('override', () => call('question:override', attemptContext()));

  const closeQuestion = () =>
    run('pass', () => call('question:pass', attemptContext()));

  const kickPlayer = (targetPlayerId, targetName) => {
    if (!window.confirm(`Remove ${targetName} from the game?`)) return undefined;
    return run('kick', () => call('player:kick', { targetPlayerId }));
  };

  const restartGame = () =>
    run('restart', async () => {
      await call('game:restart', {});
      clearDrafts(session);
      setDrafts(blankDraft(room.settings.questionsPerPlayer));
      setEditingQuestions(false);
      setInvalidDraftIds(new Set());
    });

  const copyRoomCode = async () => {
    try {
      await copyText(room.code);
      setNotice('Room code copied.');
    } catch {
      setError('Could not copy the room code.');
    }
  };

  const copyShareLink = async () => {
    try {
      await copyText(`${window.location.origin}/?join=${room.code}`);
      setNotice('Invite link copied.');
    } catch {
      setError('Could not copy the invite link.');
    }
  };

  const useHere = () => run('use-here', async () => {
    if (await reconnectSession(session)) {
      supersededRef.current = false;
      setSuperseded(false);
    }
  });

  const goHome = () => {
    suppressAutoResumeRef.current = true;
    setSuppressAutoResume(true);
    pendingDetachRef.current = call('room:leave', {}).catch(() => {});
    resetToHome();
  };

  const canResume = Boolean(session?.code && session?.playerId && session?.sessionToken && !room);

  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const helpFragment = helpOpen && <HelpModal onClose={closeHelp} />;
  const connectionFragment = <>
    {storageUnavailable && <div className="storage-warning" role="status">Browser storage unavailable. Keep this tab open to stay in your game.</div>}
    {!connected && (
    <div className="pill offline connection-pill" role="status">
      {everConnected ? 'Reconnecting… Your game will resume automatically.' : 'Connecting… The server may take a minute to wake up.'}
    </div>
    )}
  </>;

  if (superseded) {
    return (
      <div className="app">
        {connectionFragment}
        <SupersededScreen busy={busy} onUseHere={useHere} onLeave={leaveCompletely} />
      </div>
    );
  }

  if (!room || !session) {
    return (
      <div className="app">
        {connectionFragment}
        <HomeScreen
          onHelpOpen={() => setHelpOpen(true)}
          createName={createName}
          onCreateNameChange={setCreateName}
          questionsPerPlayer={questionsPerPlayerInput}
          onQuestionsPerPlayerChange={setQuestionsPerPlayerInput}
          roundMode={roundMode}
          onRoundModeChange={setRoundMode}
          roundCount={roundCountInput}
          onRoundCountChange={setRoundCountInput}
          timerSeconds={timerSecondsInput}
          onTimerSecondsChange={setTimerSecondsInput}
          dailyDouble={dailyDoubleEnabled}
          onDailyDoubleChange={setDailyDoubleEnabled}
          busy={busy}
          onCreateRoom={createRoom}
          joinCode={joinCode}
          onJoinCodeChange={setJoinCode}
          joinName={joinName}
          onJoinNameChange={setJoinName}
          onJoinRoom={joinRoom}
          canResume={canResume}
          session={session}
          onResumePreviousGame={resumePreviousGame}
          onLeaveCompletely={leaveCompletely}
        />
        {error && <div className="error sticky" role="alert">{error}</div>}
        {helpFragment}
      </div>
    );
  }

  const hostName = hostPlayer?.name || 'the host';

  if (room.phase === 'finished') {
    return (
      <div className="app">
        {connectionFragment}
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
        {notice && <div className="pill notice" role="status">{notice}</div>}
        <FlashBanner flash={flash} onDismiss={dismissFlash} />
        {error && <div className="error sticky" role="alert">{error}</div>}
        {helpFragment}
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
            aria-label={`Score for ${team.name}`}
            onChange={(event) => updateScoreDraft(team.id, event.target.value)}
          />
          <button type="button" className="subtle" disabled={Boolean(busy)} onClick={() => saveTeamScore(team.id)}>
            Save
          </button>
        </div>
      ) : (
        <div className="score-value">{formatMoney(team.score)}</div>
      )}
    </div>
  );

  return (
    <div className="app">
      {connectionFragment}
      <TopBar
        room={room}
        hostPlayer={hostPlayer}
        me={me}
        isHost={isHost}
        muted={muted}
        soundAvailable={soundAvailable}
        onHelpOpen={() => setHelpOpen(true)}
        onToggleMuted={toggleMuted}
        onGoHome={goHome}
        onLeave={leaveCompletely}
        onCopyRoomCode={copyRoomCode}
        onCopyShareLink={copyShareLink}
      />

      {notice && <div className="pill notice" role="status">{notice}</div>}

      {room.phase === 'lobby' && (
        <LobbyScreen
          room={room}
          isHost={isHost}
          session={session}
          qrDataUrl={qrDataUrl}
          me={me}
          editingQuestions={editingQuestions}
          onEditQuestions={setEditingQuestions}
          settingsEditMode={settingsEditMode}
          settingsDraft={settingsDraft}
          onSettingsDraftChange={updateSettingsDraft}
          onToggleSettingsEdit={toggleSettingsEdit}
          onSaveSettings={saveSettings}
          busy={busy}
          drafts={drafts}
          invalidDraftIds={invalidDraftIds}
          onUpdateDraft={updateDraft}
          onSubmitQuestions={submitQuestions}
          onKickPlayer={kickPlayer}
          allSubmitted={allSubmitted}
          onContinueToTeamSetup={continueToTeamSetup}
        />
      )}

      {room.phase === 'team-setup' && (
        <TeamSetupScreen
          room={room}
          isHost={isHost}
          hostName={hostName}
          teamCountInput={teamCountInput}
          onRegenerateTeams={regenerateTeams}
          teamConfig={teamConfig}
          onTeamConfigChange={setTeamConfig}
          onMovePlayerTeam={movePlayerTeam}
          onShuffleTeams={shuffleTeams}
          startGameBlocker={startGameBlocker}
          duplicateTeamNames={duplicateTeamNames}
          busy={busy}
          onStartGame={startGame}
        />
      )}

      {room.phase === 'playing' && (
        <BoardScreen
          room={room}
          currentTeam={currentTeam}
          isHost={isHost}
          scoreEditMode={scoreEditMode}
          onToggleScoreEdit={() => setScoreEditMode((current) => !current)}
          renderScoreCard={renderScoreCard}
          activeQuestion={activeQuestion}
          busy={busy}
          onSelectQuestion={selectQuestion}
        />
      )}

      {activeQuestion && room.phase === 'playing' && (
        <QuestionOverlay
          activeQuestion={activeQuestion}
          isDailyDouble={isDailyDouble}
          teamMap={teamMap}
          isHost={isHost}
          timerSeconds={room.settings.timerSeconds}
          deadline={deadline}
          activeAnswerInput={activeAnswerInput}
          onAnswerInputChange={setActiveAnswerInput}
          onSubmitAttempt={submitAttempt}
          onOverrideIncorrect={overrideIncorrect}
          onPassQuestion={advanceTeam}
          onSkipQuestion={closeQuestion}
          lastWrongAttempt={room.lastWrongAttempt}
          busy={busy}
          answerMax={ATTEMPT_MAX}
        />
      )}

      <FlashBanner flash={flash} onDismiss={dismissFlash} />
      {error && <div className="error sticky" role="alert">{error}</div>}
      {helpFragment}
    </div>
  );
}

export default App;
