import { useState } from 'react';
import { buildStandings, buildStats } from './gameStats.js';

const formatPoints = (value) => `$${value.toLocaleString()}`;

export function ResultsScreen({
  room,
  isHost,
  hostName,
  busy,
  scoreEditMode,
  scoreDrafts,
  onToggleScoreEdit,
  onScoreDraftChange,
  onSaveScore,
  onRestart,
  onLeave
}) {
  const [confirmingRestart, setConfirmingRestart] = useState(false);

  const standings = buildStandings(room.teams, room.history);
  const stats = buildStats(room.teams, room.history);
  const leaders = standings.filter((team) => team.isLeader);
  const heroText =
    leaders.length === 1 ? `${leaders[0].name} wins!` : `It's a tie! ${leaders.map((team) => team.name).join(' & ')}`;

  const requestRestart = () => {
    if (!confirmingRestart) {
      setConfirmingRestart(true);
      return;
    }
    setConfirmingRestart(false);
    onRestart();
  };

  return (
    <div className="card results-screen">
      <div className="results-hero">
        <div className="results-hero-label">Game Over</div>
        <h1>{heroText}</h1>
      </div>

      <div className="results-standings">
        {standings.map((team) => (
          <div key={team.id} className={`standings-row${team.isLeader ? ' leader' : ''}`}>
            <div className="standings-rank">#{team.rank}</div>
            <div className="standings-main">
              <div className="standings-name">{team.name}</div>
              <div className="standings-detail">
                {team.attempted
                  ? `${team.correct}/${team.attempted} correct · ${team.accuracyPct}% accuracy`
                  : 'No attempts'}
              </div>
            </div>
            <div className="standings-score-block">
              {scoreEditMode && isHost ? (
                <div className="score-editor">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={scoreDrafts[team.id] ?? ''}
                    maxLength={8}
                    onChange={(event) => onScoreDraftChange(team.id, event.target.value)}
                  />
                  <button
                    type="button"
                    className="subtle"
                    disabled={Boolean(busy)}
                    onClick={() => onSaveScore(team.id)}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <div className="standings-score">{formatPoints(team.score)}</div>
                  {!team.isLeader && <div className="standings-gap">-{formatPoints(team.gapToLeader)}</div>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-tile-value">
            {stats.questionsSolved}/{stats.totalQuestions}
          </div>
          <div className="stat-tile-label">Questions Solved</div>
        </div>
        {stats.biggestAnswer && (
          <div className="stat-tile">
            <div className="stat-tile-value">{formatPoints(stats.biggestAnswer.points)}</div>
            <div className="stat-tile-label">
              Biggest Answer{stats.biggestAnswer.isDailyDouble ? ' (Daily Double)' : ''} · {stats.biggestAnswer.teamName}
            </div>
          </div>
        )}
        {stats.mostSteals && (
          <div className="stat-tile">
            <div className="stat-tile-value">{stats.mostSteals.count}</div>
            <div className="stat-tile-label">Most Steals · {stats.mostSteals.teamName}</div>
          </div>
        )}
        {stats.dailyDouble && (
          <div className="stat-tile">
            <div className="stat-tile-value">
              {stats.dailyDouble.solved ? formatPoints(stats.dailyDouble.points) : 'Missed'}
            </div>
            <div className="stat-tile-label">
              Daily Double (${stats.dailyDouble.value}){stats.dailyDouble.teamName ? ` · ${stats.dailyDouble.teamName}` : ''}
            </div>
          </div>
        )}
      </div>

      <div className="stat-detail">
        {stats.toughestQuestion && (
          <div className="stat-detail-block">
            <h3>Toughest Question</h3>
            <p>
              {stats.toughestQuestion.ownerPlayerName}'s {formatPoints(stats.toughestQuestion.value)} question took{' '}
              {stats.toughestQuestion.attemptCount} attempts.
            </p>
          </div>
        )}

        {stats.unsolved.length > 0 && (
          <div className="stat-detail-block">
            <h3>Nobody Got These</h3>
            <div className="unsolved-list">
              {stats.unsolved.map((entry) => (
                <div className="unsolved-item" key={`${entry.ownerPlayerName}-${entry.value}`}>
                  <div className="unsolved-item-head">
                    <span className="unsolved-item-owner">{entry.ownerPlayerName}</span>
                    <span className="unsolved-item-value">{formatPoints(entry.value)}</span>
                  </div>
                  <div className="unsolved-item-prompt">{entry.prompt}</div>
                  <div className="unsolved-answer">Answer: {entry.answer}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.categoryRates.length > 0 && (
          <div className="stat-detail-block">
            <h3>Category Solve Rates</h3>
            <ul className="category-rates">
              {stats.categoryRates.map((entry) => (
                <li key={entry.ownerPlayerName}>
                  <span>{entry.ownerPlayerName}</span>
                  <span>
                    {entry.solved}/{entry.total} ({Math.round(entry.rate * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="results-actions">
        {isHost ? (
          <>
            <div className="results-actions-row">
              {confirmingRestart ? (
                <>
                  <button type="button" disabled={Boolean(busy)} onClick={requestRestart}>
                    Confirm New Game
                  </button>
                  <button type="button" className="subtle" onClick={() => setConfirmingRestart(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" disabled={Boolean(busy)} onClick={requestRestart}>
                  Play Again
                </button>
              )}
              <button type="button" className="secondary" onClick={onLeave}>
                Leave Game
              </button>
            </div>
            <button type="button" className="subtle" onClick={onToggleScoreEdit}>
              {scoreEditMode ? 'Done Adjusting Scores' : 'Adjust Final Scores'}
            </button>
          </>
        ) : (
          <>
            <p className="results-waiting">Waiting for {hostName} to start a new game.</p>
            <button type="button" className="secondary" onClick={onLeave}>
              Leave Game
            </button>
          </>
        )}
      </div>
    </div>
  );
}
