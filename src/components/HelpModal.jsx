import { useEffect, useRef } from 'react';

export function HelpModal({ onClose }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card" role="dialog" aria-modal="true" aria-label="How to play" onClick={(event) => event.stopPropagation()}>
        <div className="help-head">
          <h2>How to Play</h2>
          <button type="button" className="help-close" aria-label="Close help" ref={closeButtonRef} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="help-section">
          <h3>Game Flow</h3>
          <p>
            Every player writes their own questions, one per point value. Once everyone has submitted, the host
            starts team setup, players are grouped into teams, and the board is built from everyone's questions.
            Teams take turns picking a cell on the board to answer.
          </p>
        </div>

        <div className="help-section">
          <h3>Answering a Question</h3>
          <ul>
            <li>
              <strong>Submit:</strong> lock in your team's typed answer for judging.
            </li>
            <li>
              <strong>Override Previous:</strong> appears after an incorrect attempt, lets the host mark that
              attempt correct instead if it was judged wrong by mistake.
            </li>
            <li>
              <strong>Pass:</strong> close out the question entirely with no team credited.
            </li>
            <li>
              <strong>Skip Question:</strong> give up the current team's turn on this question without ending
              it, so another team can attempt it.
            </li>
          </ul>
        </div>

        <div className="help-section">
          <h3>Daily Double</h3>
          <p>
            If enabled, one question on the board is a secret Daily Double. The team that selects it can wager
            points before seeing the prompt.
          </p>
        </div>

        <div className="help-section">
          <h3>Timer &amp; Rounds</h3>
          <p>
            The host can set an answer timer (or leave it off) and choose a round mode: <strong>Finite</strong>{' '}
            plays a fixed number of rounds per team, while <strong>Infinite</strong> keeps the board open until
            the host ends the game.
          </p>
        </div>

        <div className="help-section">
          <h3>Host Powers</h3>
          <p>
            The host can edit settings mid-lobby, remove a player before the game starts, adjust final scores, and
            start a new game after results.
          </p>
        </div>
      </div>
    </div>
  );
}
