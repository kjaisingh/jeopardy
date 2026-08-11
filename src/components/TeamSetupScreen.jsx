import { NAME_MAX } from '../constants.js';

export function TeamSetupScreen({
  room,
  isHost,
  hostName,
  teamCountInput,
  onRegenerateTeams,
  teamConfig,
  onTeamConfigChange,
  onMovePlayerTeam,
  startGameBlocker,
  duplicateTeamNames,
  busy,
  onStartGame
}) {
  return (
    <section className="card team-layout">
      <h2>Team Setup</h2>

      <p className="settings-summary">
        {room.settings.questionsPerPlayer} questions/player ·{' '}
        {room.settings.mode === 'finite' ? `${room.settings.rounds} round(s)` : 'Infinite rounds'} ·{' '}
        Timer {room.settings.timerSeconds > 0 ? `${room.settings.timerSeconds}s` : 'off'} ·{' '}
        Daily Double {room.settings.dailyDouble ? 'on' : 'off'}
      </p>

      {isHost ? (
        <div className="team-columns">
          <div className="team-column">
            <div className="inline-controls">
              <div className="control-field">
                <label>Number of teams</label>
                <input
                  type="number"
                  min="1"
                  max={room.players.length}
                  value={teamCountInput}
                  onChange={(event) => onRegenerateTeams(event.target.value)}
                />
              </div>
            </div>

            <div className="player-pool">
              <h3>Players</h3>
              {room.players.map((player) => {
                const assignedTeam = teamConfig.find((team) => team.playerIds.includes(player.id));
                return (
                  <div className="player-row" key={player.id}>
                    <span>
                      {player.name}
                      {!player.isConnected ? ' (offline)' : ''}
                    </span>
                    <select value={assignedTeam?.id || ''} onChange={(event) => onMovePlayerTeam(player.id, event.target.value)}>
                      {teamConfig.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="team-column">
            <div className="teams-preview">
              {teamConfig.map((team) => (
                <div className="team-card" key={team.id}>
                  <input
                    value={team.name}
                    maxLength={NAME_MAX}
                    aria-label="Team name"
                    onChange={(event) => {
                      const nextName = event.target.value;
                      onTeamConfigChange((current) =>
                        current.map((entry) => (entry.id === team.id ? { ...entry, name: nextName } : entry))
                      );
                    }}
                  />
                  <div>{team.playerIds.length} player(s)</div>
                </div>
              ))}
            </div>

            {startGameBlocker && <div className="field-error">{startGameBlocker}</div>}
            {duplicateTeamNames.length > 0 && (
              <div className="field-error warn">Duplicate team names: {duplicateTeamNames.join(', ')}</div>
            )}

            <button type="button" disabled={Boolean(busy) || Boolean(startGameBlocker)} onClick={onStartGame}>
              {busy === 'start-game' ? 'Starting…' : 'Start Game'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="player-pool">
            <h3>Players</h3>
            {room.players.map((player) => (
              <div className="player-row" key={player.id}>
                <span>
                  {player.name}
                  {!player.isConnected ? ' (offline)' : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="pill">{hostName} is setting up teams…</p>
        </>
      )}
    </section>
  );
}
