import { useEffect, useId, useRef, useState } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  onSkipQuestion,
  lastWrongAttempt,
  busy,
  answerMax
}) {
  const titleId = useId();
  const cardRef = useRef(null);
  // Own the 100ms timer tick locally so a running countdown only re-renders this
  // overlay, not the whole app tree.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [deadline]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const initialFocus = isHost ? cardRef.current?.querySelector('input') : cardRef.current;
    initialFocus?.focus();
    const onKeyDown = (event) => {
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
      if (!focusable.length) {
        event.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !cardRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !cardRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [activeQuestion.id, isHost]);

  const timerTotalMs = timerSeconds * 1000;
  const timerRemainingMs = deadline ? Math.max(0, deadline - now) : 0;
  const timerPct = timerTotalMs ? (timerRemainingMs / timerTotalMs) * 100 : 0;
  const timerSecondsLeft = Math.ceil(timerRemainingMs / 1000);

  return (
    <div className="question-overlay">
      <div
        className={`question-overlay-card${isDailyDouble ? ' daily-double' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={cardRef}
      >
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

        <h2 id={titleId} className="question-prompt">
          {activeQuestion.prompt}
        </h2>

        {timerSeconds > 0 && deadline && (
          <div className="timer-block">
            <progress
              className={`timer-track${timerPct < 20 ? ' danger' : timerPct < 50 ? ' warn' : ''}`}
              aria-label="Answer time remaining"
              aria-valuetext={`${timerSecondsLeft} seconds remaining`}
              max={timerSeconds}
              value={timerSecondsLeft}
            >
              {timerSecondsLeft} seconds remaining
            </progress>
            <div className="timer-count" aria-hidden="true">
              {timerSecondsLeft}s
            </div>
          </div>
        )}

        {isHost && (
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
                <button type="button" className="secondary" disabled={Boolean(busy)} onClick={onSkipQuestion}>
                  Skip Question
                </button>
              </div>
          </form>
        )}
      </div>
    </div>
  );
}
