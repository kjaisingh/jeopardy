import { useEffect, useState } from 'react';

export function QuestionOverlay({
  activeQuestion,
  isDailyDouble,
  teamMap,
  isHost,
  timerSeconds,
  deadline,
  activeAnswerInput,
  onAnswerInputChange,
  onSubmitAttempt,
  onOverrideIncorrect,
  onPassQuestion,
  onSkipTeam,
  lastWrongAttempt,
  busy,
  answerMax
}) {
  // Own the 100ms timer tick locally so a running countdown only re-renders this
  // overlay, not the whole app tree.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [deadline]);

  const timerTotalMs = timerSeconds * 1000;
  const timerRemainingMs = deadline ? Math.max(0, deadline - now) : 0;
  const timerPct = timerTotalMs ? (timerRemainingMs / timerTotalMs) * 100 : 0;
  const timerSecondsLeft = Math.ceil(timerRemainingMs / 1000);

  return (
    <div className="question-overlay">
      <div className={`question-overlay-card${isDailyDouble ? ' daily-double' : ''}`}>
        {isDailyDouble && <div className="pill daily-double-pill">DAILY DOUBLE ×{activeQuestion.multiplier}</div>}
        <div className="active-meta">
          <span>
            {activeQuestion.ownerPlayerName} ·{' '}
            {isDailyDouble
              ? `$${activeQuestion.value} → $${activeQuestion.value * activeQuestion.multiplier}`
              : `$${activeQuestion.value}`}
          </span>
          <span>Answering team: {teamMap[activeQuestion.currentTeamId]?.name || '-'}</span>
        </div>

        <h2 className="question-prompt">{activeQuestion.prompt}</h2>

        {isHost && (
          <>
            {timerSeconds > 0 && deadline && (
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
                onSubmitAttempt();
              }}
            >
              <input
                value={activeAnswerInput}
                maxLength={answerMax}
                placeholder="Type team answer"
                aria-label="Team answer"
                autoFocus
                onChange={(event) => onAnswerInputChange(event.target.value)}
              />
              <div className="actions">
                <button type="submit" disabled={!activeAnswerInput.trim() || Boolean(busy)}>
                  {busy === 'attempt' ? 'Submitting…' : 'Submit'}
                </button>
                {lastWrongAttempt && (
                  <button type="button" className="secondary" disabled={Boolean(busy)} onClick={onOverrideIncorrect}>
                    Override Previous
                  </button>
                )}
                <button type="button" className="secondary" disabled={Boolean(busy)} onClick={onPassQuestion}>
                  Pass
                </button>
                <button type="button" className="secondary" disabled={Boolean(busy)} onClick={onSkipTeam}>
                  Skip Question
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
