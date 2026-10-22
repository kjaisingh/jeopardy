import { useState } from 'react';
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
  const [joinFirst] = useState(() => Boolean(joinCode));
  const createForm = (
      <form
        className="card home-card create-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (createName.trim() && !busy) onCreateRoom();
        }}
      >
        <span className="eyebrow">Be the host</span>
        <h2>Create a Game</h2>
        <p className="subtitle">Make a room, share the code, and run the board.</p>
        <label htmlFor="create-name">Your name</label>
        <input
          id="create-name"
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
  );
  const joinForm = (
      <form
        className="card home-card join-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (isCompleteRoomCode(joinCode) && joinName.trim() && !busy) onJoinRoom();
        }}
      >
        <span className="eyebrow">Got an invite?</span>
        <h2>Join a Game</h2>
        <p className="subtitle">Enter your host's six-character room code.</p>
        <div className="field-stack">
          <label htmlFor="join-code">Room code</label>
          <input
            id="join-code"
            className="room-code-input"
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
          <label htmlFor="join-name">Your name</label>
          <input
            id="join-name"
            autoFocus={joinFirst}
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
        <p className="join-note">Everyone joins from their own device. No account needed.</p>
      </form>
  );
  return (
    <main className="home-screen">
      <header className="home-hero">
        <div className="home-title-row">
          <span className="eyebrow">Your friends. Your questions.</span>
          <button type="button" className="help-trigger" aria-label="How to play" onClick={onHelpOpen}>?</button>
        </div>
        <h1>Jeopardy<span className="hero-dot">.</span></h1>
        <p>Find out who knows your group best.</p>
        <ol className="home-steps" aria-label="How it works">
          <li>Invite your friends</li>
          <li>Write your questions</li>
          <li>Team up and play</li>
        </ol>
      </header>
      <div className="home-forms">
        {joinFirst ? <>{joinForm}{createForm}</> : <>{createForm}{joinForm}</>}
      </div>

      {canResume && (
        <section className="card home-card resume-card">
          <h2>Resume</h2>
          <p>Room {session.code}</p>
          <button type="button" disabled={Boolean(busy)} onClick={onResumePreviousGame}>
            Resume Previous Game
          </button>
          <button type="button" className="subtle" disabled={Boolean(busy)} onClick={onLeaveCompletely}>
            Forget Saved Session
          </button>
        </section>
      )}
    </main>
  );
}
