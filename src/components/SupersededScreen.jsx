export function SupersededScreen({ busy, onUseHere, onLeave }) {
  return (
    <div className="home-screen">
      <div className="card home-card">
        <h1>Jeopardy</h1>
        <p>This game is now open on another device.</p>
        <button type="button" disabled={Boolean(busy)} onClick={onUseHere}>
          {busy === 'use-here' ? 'Reclaiming…' : 'Use Here'}
        </button>
        <button type="button" className="subtle" onClick={onLeave}>
          Leave Game
        </button>
      </div>
    </div>
  );
}
