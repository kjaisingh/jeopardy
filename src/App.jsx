import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const QUESTION_VALUES = [100, 200, 300, 400, 500];
const STORAGE_KEY = 'jeopardy-session';

const socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001', {
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

function App() {
  const [session, setSession] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [homeName, setHomeName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [drafts, setDrafts] = useState(blankDraft);
  const [submittingQuestions, setSubmittingQuestions] = useState(false);

  const [teamCount, setTeamCount] = useState(2);
  const [teamConfig, setTeamConfig] = useState([]);
  const [roundMode, setRoundMode] = useState('finite');
  const [roundCount, setRoundCount] = useState(1);

  const [activeAnswerInput, setActiveAnswerInput] = useState('');
  const [lastResult, setLastResult] = useState('');

  const me = useMemo(
    () => room?.players.find((player) => player.id === session?.playerId) || null,
    [room, session]
  );
  const isHost = Boolean(room && session && room.hostPlayerId === session.playerId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    const onRoom = (nextRoom) => {
      setRoom(nextRoom);
      setError('');
    };

    const onError = (payload) => {
      setError(payload?.message || 'Unexpected error');
    };

    socket.on('room:updated', onRoom);
    socket.on('room:error', onError);

    if (session?.code && session?.playerId) {
      call('room:reconnect', { code: session.code, playerId: session.playerId })
        .then((response) => {
          setRoom(response.room);
        })
        .catch(() => {
          setSession(null);
          setRoom(null);
        });
    }

    return () => {
      socket.off('room:updated', onRoom);
      socket.off('room:error', onError);
    };
  }, []);

  useEffect(() => {
    if (room?.phase === 'team-setup' && isHost) {
      setTeamConfig((current) => {
        if (current.length) return current;
        const players = room.players.map((player) => player.id);
        const teams = Array.from({ length: 2 }, (_, index) => ({
          id: crypto.randomUUID(),
          name: `Team ${index + 1}`,
          playerIds: []
        }));

        players.forEach((playerId, index) => {
          teams[index % 2].playerIds.push(playerId);
        });
        return teams;
      });
    }
  }, [room, isHost]);

  const resetToHome = () => {
    setSession(null);
    setRoom(null);
    setError('');
    setHomeName('');
    setJoinCode('');
    setDrafts(blankDraft());
    setLastResult('');
    setActiveAnswerInput('');
  };

  const createRoom = async () => {
    try {
      setError('');
      setLoading(true);
      const response = await call('room:create', { name: homeName.trim() });
      setSession({ code: response.code, playerId: response.playerId });
      setRoom(response.room);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    try {
      setError('');
      setLoading(true);
      const response = await call('room:join', { code: joinCode.trim().toUpperCase(), name: homeName.trim() });
      setSession({ code: response.code, playerId: response.playerId });
      setRoom(response.room);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const updateDraft = (localId, key, value) => {
    setDrafts((current) => current.map((entry) => (entry.localId === localId ? { ...entry, [key]: value } : entry)));
  };

  const updateDraftValue = (localId, value) => {
    setDrafts((current) => {
      const target = current.find((entry) => entry.localId === localId);
      const existing = current.find((entry) => entry.value === Number(value));
      if (!target || !existing || existing.localId === localId) {
        return current.map((entry) => (entry.localId === localId ? { ...entry, value: Number(value) } : entry));
      }

      return current.map((entry) => {
        if (entry.localId === localId) return { ...entry, value: Number(value) };
        if (entry.localId === existing.localId) return { ...entry, value: target.value };
        return entry;
      });
    });
  };

  const submitQuestions = async () => {
    try {
      setError('');
      setSubmittingQuestions(true);
      await call('questions:submit', {
        code: room.code,
        playerId: session.playerId,
        questions: drafts
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmittingQuestions(false);
    }
  };

  const regenerateTeams = (nextCount) => {
    if (!room) return;
    const count = Math.max(1, Number(nextCount));
    setTeamCount(count);
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
    setTeamConfig((current) => {
      const stripped = current.map((team) => ({
        ...team,
        playerIds: team.playerIds.filter((id) => id !== playerId)
      }));
      return stripped.map((team) =>
        team.id === teamId ? { ...team, playerIds: [...team.playerIds, playerId] } : team
      );
    });
  };

  const startGame = async () => {
    try {
      setError('');
      await call('game:configure', {
        code: room.code,
        playerId: session.playerId,
        config: {
          teams: teamConfig.map((team) => ({ name: team.name, playerIds: team.playerIds })),
          mode: roundMode,
          rounds: roundMode === 'finite' ? Number(roundCount) : null
        }
      });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const selectQuestion = async (ownerPlayerId, value) => {
    try {
      setError('');
      setLastResult('');
      setActiveAnswerInput('');
      await call('question:select', { code: room.code, playerId: session.playerId, ownerPlayerId, value });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const submitAttempt = async () => {
    try {
      setError('');
      const response = await call('question:attempt', {
        code: room.code,
        playerId: session.playerId,
        answer: activeAnswerInput
      });

      if (response.result.isCorrect) {
        setLastResult(`${response.result.teamName} is correct! +${response.result.value}`);
      } else if (response.result.exhausted) {
        setLastResult('No team answered correctly. Question expired.');
      } else {
        const nextTeam = room.teams.find((team) => team.id === response.result.nextTeamId);
        setLastResult(`Incorrect. Passing to ${nextTeam?.name || 'next team'}.`);
      }
      setActiveAnswerInput('');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const overrideIncorrect = async () => {
    try {
      setError('');
      await call('question:override', { code: room.code, playerId: session.playerId });
      setLastResult('Override accepted. Points awarded.');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const passQuestion = async () => {
    try {
      setError('');
      await call('question:pass', { code: room.code, playerId: session.playerId });
      setLastResult('Question passed with no points.');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const restartGame = async () => {
    try {
      setError('');
      setDrafts(blankDraft());
      const response = await call('game:restart', { code: room.code, playerId: session.playerId });
      setSession((current) => ({ ...current, code: response.newCode }));
      setLastResult('Game restarted with a new room code.');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const teamMap = useMemo(() => teamById(room?.teams || []), [room]);
  const activeQuestion = room?.activeQuestion;
  const nextTeamId = activeQuestion
    ? room.settings.mode === 'infinite'
      ? activeQuestion.attemptOrder[activeQuestion.attemptIndex % activeQuestion.attemptOrder.length]
      : activeQuestion.attemptOrder[activeQuestion.attemptIndex]
    : null;

  if (!room || !session) {
    const ready = homeName.trim().length > 1;

    return (
      <div className="app home-screen">
        <div className="card home-card">
          <h1>Jeopardy</h1>
          <p className="subtitle">Create a room, share the code, and play on one host screen.</p>

          <label>Name</label>
          <input value={homeName} onChange={(event) => setHomeName(event.target.value)} placeholder="Your name" />

          <div className="actions">
            <button disabled={!ready || loading} onClick={createRoom}>
              Create Game
            </button>
          </div>

          <div className="join-divider">or join existing game</div>

          <label>Room code</label>
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
          />
          <button className="secondary" disabled={!ready || joinCode.length < 6 || loading} onClick={joinRoom}>
            Join Game
          </button>

          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  const allSubmitted = room.players.every((player) => player.submitted);
  const currentTeam = room.turnTeamId ? teamMap[room.turnTeamId] : null;
  const winnerTeam = room.winnerTeamId ? teamMap[room.winnerTeamId] : null;

  return (
    <div className="app">
      <header className="topbar card">
        <div>
          <div className="label">Room code</div>
          <div className="room-code">{room.code}</div>
        </div>
        <div>
          <div className="label">You</div>
          <div className="player-name">
            {me?.name} {isHost ? '(Host)' : ''}
          </div>
        </div>
        <button className="secondary" onClick={resetToHome}>
          Leave
        </button>
      </header>

      {room.phase === 'lobby' && (
        <section className="card">
          <h2>Question Submission</h2>
          <p className="subtitle">
            Enter your 5 question/answer pairs and assign each one a unique value from 100 to 500.
          </p>

          <div className="question-grid">
            {drafts.map((draft) => (
              <div key={draft.localId} className="question-card">
                <div className="question-head">
                  <label>Value</label>
                  <select value={draft.value} onChange={(event) => updateDraftValue(draft.localId, event.target.value)}>
                    {QUESTION_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <label>Question</label>
                <textarea
                  rows={3}
                  value={draft.prompt}
                  onChange={(event) => updateDraft(draft.localId, 'prompt', event.target.value)}
                  placeholder="Write the clue/question"
                />
                <label>Answer</label>
                <input
                  value={draft.answer}
                  onChange={(event) => updateDraft(draft.localId, 'answer', event.target.value)}
                  placeholder="Expected answer"
                />
              </div>
            ))}
          </div>

          {!me?.submitted ? (
            <button onClick={submitQuestions} disabled={submittingQuestions}>
              Submit My Questions
            </button>
          ) : (
            <div className="pill success">Questions submitted. Waiting for others.</div>
          )}

          <div className="players-list">
            {room.players.map((player) => (
              <div key={player.id} className={`pill ${player.submitted ? 'success' : ''}`}>
                {player.name} - {player.submitted ? 'Ready' : 'Editing'}
              </div>
            ))}
          </div>

          {allSubmitted && <div className="pill">All players submitted. Moving to team setup.</div>}
        </section>
      )}

      {room.phase === 'team-setup' && (
        <section className="card">
          <h2>Team Setup</h2>
          {!isHost ? (
            <p className="subtitle">Waiting for the host to assign teams and start the game.</p>
          ) : (
            <>
              <div className="inline-controls">
                <div className="control-field">
                  <label>Number of teams</label>
                  <input
                    type="number"
                    min="1"
                    value={teamCount}
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
                    <label>Rounds per other team</label>
                    <input
                      type="number"
                      min="1"
                      value={roundCount}
                      onChange={(event) => setRoundCount(Number(event.target.value))}
                    />
                  </div>
                )}
              </div>

              <div className="team-layout">
                <div className="player-pool">
                  <h3>Assign players</h3>
                  {room.players.map((player) => {
                    const assignedTeam = teamConfig.find((team) => team.playerIds.includes(player.id));
                    return (
                      <div className="player-row" key={player.id}>
                        <span>{player.name}</span>
                        <select
                          value={assignedTeam?.id || ''}
                          onChange={(event) => movePlayerTeam(player.id, event.target.value)}
                        >
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
                  <h3>Team list</h3>
                  {teamConfig.map((team) => (
                    <div key={team.id} className="team-card">
                      <input
                        value={team.name}
                        onChange={(event) =>
                          setTeamConfig((current) =>
                            current.map((entry) =>
                              entry.id === team.id ? { ...entry, name: event.target.value } : entry
                            )
                          )
                        }
                      />
                      <div className="team-members">
                        {team.playerIds.map((playerId) => room.players.find((player) => player.id === playerId)?.name).join(', ') ||
                          'No players'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={startGame}>Start Game</button>
            </>
          )}
        </section>
      )}

      {(room.phase === 'playing' || room.phase === 'finished') && (
        <section className="card board-shell">
          <div className="board-top">
            <div>
              <h2>Game Board</h2>
              <div className="subtitle">Turn to choose: {currentTeam?.name || '-'}</div>
            </div>
            <div className="score-row">
              {room.teams.map((team) => (
                <div key={team.id} className={`score-card ${room.turnTeamId === team.id ? 'active' : ''}`}>
                  <div>{team.name}</div>
                  <strong>{team.score}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="board-grid" style={{ gridTemplateColumns: `repeat(${room.board.columns.length}, minmax(0, 1fr))` }}>
            {room.board.columns.map((column) => (
              <div key={column.playerId} className="board-column">
                <div className="board-header">{column.playerName}</div>
                {column.cells.map((cell) => (
                  <button
                    key={`${column.playerId}-${cell.value}`}
                    className={`board-cell ${cell.status}`}
                    disabled={!isHost || room.phase !== 'playing' || cell.status !== 'open' || Boolean(activeQuestion)}
                    onClick={() => selectQuestion(column.playerId, cell.value)}
                  >
                    {cell.status === 'open' ? `$${cell.value}` : ''}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {lastResult && <div className="pill">{lastResult}</div>}

          {room.phase === 'finished' && (
            <div className="card nested">
              <h3>Game Complete</h3>
              <p className="subtitle">
                Winner: <strong>{winnerTeam?.name || 'Tie'}</strong>
              </p>
              <div className="score-row">
                {room.teams.map((team) => (
                  <div key={team.id} className="score-card">
                    <div>{team.name}</div>
                    <strong>{team.score}</strong>
                  </div>
                ))}
              </div>
              {isHost && <button onClick={restartGame}>Restart with New Code</button>}
            </div>
          )}
        </section>
      )}

      {activeQuestion && room.phase === 'playing' && (
        <section className="question-overlay">
          <div className="question-overlay-card">
            <div className="active-meta">
              <span>
                {activeQuestion.ownerPlayerName} - ${activeQuestion.value}
              </span>
              <span>Answering team: {teamMap[nextTeamId]?.name || '-'}</span>
            </div>

            <h2 className="question-prompt">{activeQuestion.prompt}</h2>

            {isHost && (
              <>
                <input
                  value={activeAnswerInput}
                  onChange={(event) => setActiveAnswerInput(event.target.value)}
                  placeholder="Type team answer"
                />
                <div className="actions">
                  <button onClick={submitAttempt}>Submit Attempt</button>
                  {room.lastWrongAttempt && (
                    <button className="secondary" onClick={overrideIncorrect}>
                      Override Last Incorrect
                    </button>
                  )}
                  <button className="secondary" onClick={passQuestion}>
                    Pass Question
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {error && <div className="error sticky">{error}</div>}
    </div>
  );
}

export default App;