export function QuestionOverlay({
  activeQuestion,
  isDailyDouble,
  teamMap,
  isHost,
  timerSeconds,
  deadline,
  timerPct,
  timerSecondsLeft,
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
  return (
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
