import {
  isCompleteRoomCode,
  NAME_MAX,
  normalizeRoomCodeInput,
  ROOM_CODE_LENGTH
} from '../constants.js';
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
      <form
        className="card home-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (createName.trim() && !busy) onCreateRoom();
        }}
      >
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
          autoComplete="name"
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

        <button type="submit" disabled={!createName.trim() || Boolean(busy)}>
          {busy === 'create' ? 'Creating…' : 'Create Game'}
        </button>
      </form>

      <form
        className="card home-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (isCompleteRoomCode(joinCode) && joinName.trim() && !busy) onJoinRoom();
        }}
      >
        <h2>Join a Game</h2>
        <div className="field-stack">
          <input
            value={joinCode}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="Room code"
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => onJoinCodeChange(normalizeRoomCodeInput(event.target.value))}
          />
          <input
            value={joinName}
            maxLength={NAME_MAX}
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="name"
            onChange={(event) => onJoinNameChange(event.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={!isCompleteRoomCode(joinCode) || !joinName.trim() || Boolean(busy)}
        >
          {busy === 'join' ? 'Joining…' : 'Join Game'}
        </button>
      </form>

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
