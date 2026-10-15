const PREFIX = 'jeopardy-drafts';

const keyFor = (session) => `${PREFIX}:${session.code}:${session.playerId}`;

export const loadDrafts = (session) => {
  if (!session?.code || !session?.playerId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(session)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveDrafts = (session, drafts) => {
  if (!session?.code || !session?.playerId || !Array.isArray(drafts)) return;
  localStorage.setItem(keyFor(session), JSON.stringify(drafts));
};

export const clearDrafts = (session) => {
  if (!session?.code || !session?.playerId) return;
  localStorage.removeItem(keyFor(session));
};
