function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function TopBar({
  room,
  hostPlayer,
  me,
  isHost,
  muted,
  onHelpOpen,
  onToggleMuted,
  onGoHome,
  onLeave,
  onCopyRoomCode,
  onCopyShareLink
}) {
  return (
    <header className="topbar card">
      <div>
        <div className="label">Room Code</div>
        <div className="room-code-row">
          <div className="room-code code-block">{room.code}</div>
          {typeof navigator !== 'undefined' && navigator.clipboard && (
            <>
              <button type="button" className="subtle" onClick={onCopyRoomCode}>
                <CopyIcon /> Code
              </button>
              <button type="button" className="subtle" onClick={onCopyShareLink}>
                <CopyIcon /> Link
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
          <button type="button" className="secondary subtle" onClick={onToggleMuted}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
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
