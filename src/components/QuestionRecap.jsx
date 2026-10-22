import { formatMoney } from '../format.js';

export function QuestionRecap({ history }) {
  const latest = history.at(-1);
  if (!latest) return null;
  return (
    <section className="question-recap" aria-label="Last question">
      <div className="recap-heading">
        <h3>Last question</h3>
        <span>{latest.ownerPlayerName} · {formatMoney(latest.value * latest.multiplier)}</span>
      </div>
      <p className="recap-prompt">{latest.prompt}</p>
      <p><span className="label">Answer</span> <strong>{latest.answer}</strong></p>
      <p className="recap-outcome">
        {latest.solvedByTeamName
          ? `${latest.solvedByTeamName} earned ${formatMoney(latest.pointsAwarded)}${latest.closedReason === 'overridden' ? ' (host override)' : ''}.`
          : latest.closedReason === 'passed' ? 'Question skipped. No points awarded.' : 'No correct answer. No points awarded.'}
      </p>
      {latest.attempts.length > 0 && (
        <details>
          <summary>View {latest.attempts.length} attempt{latest.attempts.length === 1 ? '' : 's'}</summary>
          <ul className="recap-attempts">
            {latest.attempts.map((attempt, index) => (
              <li key={index}>
                <strong>{attempt.teamName}:</strong> {attempt.skipped ? 'Passed / timed out' : attempt.answer}
                {!attempt.skipped && <span className="subtitle"> · {attempt.isCorrect || (latest.closedReason === 'overridden' && index === latest.attempts.length - 1) ? 'Correct' : 'Incorrect'}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
