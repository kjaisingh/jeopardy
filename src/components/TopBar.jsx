export function TopBar({
  room,
  hostPlayer,
  me,
  isHost,
  muted,
  musicOn,
  onHelpOpen,
  onToggleMuted,
  onToggleMusic,
  onGoHome,
  onLeave,
  onCopyRoomCode,
  onCopyShareLink
}) {
  return (
    <header className="topbar card">
      <div>
        <div className="label">Room code</div>
        <div className="room-code-row">
          <div className="room-code code-block">{room.code}</div>
          {typeof navigator !== 'undefined' && navigator.clipboard && (
            <>
              <button type="button" className="subtle" onClick={onCopyRoomCode}>
                Copy
              </button>
              <button type="button" className="subtle" onClick={onCopyShareLink}>
                Copy Link
              </button>
            </>
          )}
        </div>
        {!hostPlayer?.isConnected && (
          <div className="pill offline">Host disconnected, promoting a new host shortly</div>
        )}
      </div>
      <div>
        <div className="label">You</div>
        <div>
          {me?.name} {isHost ? '(Host)' : ''}
        </div>
      </div>
      <div className="topbar-actions">
        <button type="button" className="help-trigger" aria-label="How to play" onClick={onHelpOpen}>
          ?
        </button>
        {isHost && (
          <>
            <button type="button" className="secondary subtle" onClick={onToggleMuted}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="secondary subtle" onClick={onToggleMusic}>
              {musicOn ? 'Music: On' : 'Music: Off'}
            </button>
          </>
        )}
        <button type="button" className="secondary" onClick={onGoHome}>
          Go Home
        </button>
        <button type="button" className="secondary danger subtle" onClick={onLeave}>
          Leave
        </button>
      </div>
    </header>
  );
}
