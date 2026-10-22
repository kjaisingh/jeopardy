import { readStorage, writeStorage, removeStorage } from './browserStorage.js';
import { ANSWER_MAX, PROMPT_MAX } from './constants.js';

const PREFIX = 'jeopardy-drafts';

const keyFor = (session) => `${PREFIX}:${session.code}:${session.playerId}`;

export const loadDrafts = (session) => {
  if (!session?.code || !session?.playerId) return [];
  try {
    const parsed = JSON.parse(readStorage(keyFor(session)) || '[]');
    if (!Array.isArray(parsed) || parsed.length > 10) return [];
    const values = new Set();
    return parsed.filter((draft) => {
      if (!draft || typeof draft.localId !== 'string' || !draft.localId ||
        !Number.isInteger(draft.value) || draft.value < 100 || draft.value > 1000 || draft.value % 100 ||
        typeof draft.prompt !== 'string' || draft.prompt.length > PROMPT_MAX ||
        typeof draft.answer !== 'string' || draft.answer.length > ANSWER_MAX || values.has(draft.value)) return false;
      values.add(draft.value);
      return true;
    });
  } catch {
    return [];
  }
};

export const saveDrafts = (session, drafts) => {
  if (!session?.code || !session?.playerId || !Array.isArray(drafts)) return;
  return writeStorage(keyFor(session), JSON.stringify(drafts));
};

export const clearDrafts = (session) => {
  if (!session?.code || !session?.playerId) return;
  return removeStorage(keyFor(session));
};
