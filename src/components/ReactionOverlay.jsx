export function ReactionOverlay({ reactions }) {
  if (!reactions.length) return null;
  return (
    <div className="reaction-overlay" aria-hidden="true">
      {reactions.map((reaction) => (
        <span key={reaction.id} className="reaction-float" style={{ left: `${reaction.left}%` }}>
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
