import { REACTIONS } from '../constants.js';

export function BoardScreen({
  room,
  currentTeam,
  isHost,
  scoreEditMode,
  onToggleScoreEdit,
  renderScoreCard,
  activeQuestion,
  busy,
  onSelectQuestion,
  onSendReaction
}) {
  return (
    <section className="card">
      <div className="board-top">
        <h2>Board</h2>
        <div>{currentTeam ? `${currentTeam.name}'s turn to pick` : ''}</div>
        {isHost && (
          <button type="button" className="subtle" onClick={onToggleScoreEdit}>
            {scoreEditMode ? 'Done Editing Scores' : 'Edit Scores'}
          </button>
        )}
      </div>

      <div className="score-row">{room.teams.map((team) => renderScoreCard(team, true))}</div>

      <div className="reaction-bar">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="reaction-button"
            aria-label={`React with ${emoji}`}
            onClick={() => onSendReaction(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

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
                disabled={!isHost || room.phase !== 'playing' || cell.status !== 'open' || Boolean(activeQuestion) || Boolean(busy)}
                onClick={() => onSelectQuestion(column.playerId, cell.value)}
              >
                {cell.status === 'open' ? `$${cell.value}` : ''}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
