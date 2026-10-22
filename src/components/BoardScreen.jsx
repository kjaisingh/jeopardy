import { QuestionRecap } from './QuestionRecap.jsx';

export function BoardScreen({
  room,
  currentTeam,
  isHost,
  scoreEditMode,
  onToggleScoreEdit,
  renderScoreCard,
  activeQuestion,
  busy,
  onSelectQuestion
}) {
  const cells = room.board.columns.flatMap((column) => column.cells);
  const completed = cells.filter((cell) => cell.status === 'closed').length;
  return (
    <section className="card">
      <div className="board-top">
        <div className="turn-indicator">{currentTeam ? `${currentTeam.name}'s turn to pick` : ''}</div>
        {isHost && (
          <button type="button" className="subtle" onClick={onToggleScoreEdit}>
            {scoreEditMode ? 'Done Editing Scores' : 'Edit Scores'}
          </button>
        )}
      </div>

      <div className="score-row">{room.teams.map((team) => renderScoreCard(team, true))}</div>
      <div className="board-progress">
        <span>{completed} of {cells.length} questions played</span>
        {!isHost && <span>The host selects questions and enters team answers.</span>}
      </div>

      <div className="board-scroll" role="region" aria-label="Question board" tabIndex={0}>
        <div className="board-grid">
        {room.board.columns.map((column) => (
          <div key={column.playerId} className="board-column">
            <div className="board-header">{column.playerName}</div>
            {column.cells.map((cell) => (
              <button
                type="button"
                key={`${column.playerId}-${cell.value}`}
                className={`board-cell ${cell.status}${
                  cell.multiplier > 1 && cell.status !== 'open' ? ' daily-double-cell' : ''
                }`}
                aria-label={`${column.playerName} for $${cell.value}, ${cell.status}`}
                disabled={!isHost || room.phase !== 'playing' || cell.status !== 'open' || Boolean(activeQuestion) || Boolean(busy)}
                onClick={() => onSelectQuestion(column.playerId, cell.value)}
              >
                {cell.status === 'open' ? `$${cell.value}` : ''}
              </button>
            ))}
          </div>
        ))}
        </div>
      </div>
      <QuestionRecap history={room.history} />
    </section>
  );
}
