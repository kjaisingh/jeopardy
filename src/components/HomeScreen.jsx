import { NAME_MAX } from '../constants.js';
import { SettingsForm } from './SettingsForm.jsx';

export function HomeScreen({
  onHelpOpen,
  createName,
  onCreateNameChange,
  questionsPerPlayer,
  onQuestionsPerPlayerChange,
  roundMode,
  onRoundModeChange,
  roundCount,
  onRoundCountChange,
  timerSeconds,
  onTimerSecondsChange,
  dailyDouble,
  onDailyDoubleChange,
  busy,
  onCreateRoom,
  joinCode,
  onJoinCodeChange,
  joinName,
  onJoinNameChange,
  onJoinRoom,
  canResume,
  session,
  onResumePreviousGame,
  onLeaveCompletely
}) {
  return (
    <div className="home-screen">
      <div className="card home-card">
        <div className="home-title-row">
          <h1>Jeopardy</h1>
          <button type="button" className="help-trigger" aria-label="How to play" onClick={onHelpOpen}>
            ?
          </button>
        </div>
        <h2>Create a Game</h2>
        <input
          value={createName}
          maxLength={NAME_MAX}
          placeholder="Your name"
          aria-label="Your name"
          onChange={(event) => onCreateNameChange(event.target.value)}
        />

        <SettingsForm
          questionsPerPlayer={questionsPerPlayer}
          onQuestionsPerPlayerChange={onQuestionsPerPlayerChange}
          mode={roundMode}
          onModeChange={onRoundModeChange}
          rounds={roundCount}
          onRoundsChange={onRoundCountChange}
          timerSeconds={timerSeconds}
          onTimerSecondsChange={onTimerSecondsChange}
          dailyDouble={dailyDouble}
          onDailyDoubleChange={onDailyDoubleChange}
        />

        <button type="button" disabled={!createName.trim() || Boolean(busy)} onClick={onCreateRoom}>
          {busy === 'create' ? 'Creating…' : 'Create Game'}
        </button>
      </div>

      <div className="card home-card">
        <h2>Join a Game</h2>
        <div className="field-stack">
          <input
            value={joinCode}
            maxLength={6}
            placeholder="Room code"
            aria-label="Room code"
            onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())}
          />
          <input
            value={joinName}
            maxLength={NAME_MAX}
            placeholder="Your name"
            aria-label="Your name"
            onChange={(event) => onJoinNameChange(event.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={!joinCode.trim() || !joinName.trim() || Boolean(busy)}
          onClick={onJoinRoom}
        >
          {busy === 'join' ? 'Joining…' : 'Join Game'}
        </button>
      </div>

      {canResume && (
        <div className="card home-card">
          <h2>Resume</h2>
          <p>Room {session.code}</p>
          <button type="button" disabled={Boolean(busy)} onClick={onResumePreviousGame}>
            Resume Previous Game
          </button>
          <button type="button" className="subtle" disabled={Boolean(busy)} onClick={onLeaveCompletely}>
            Forget Saved Session
          </button>
        </div>
      )}
    </div>
  );
}
