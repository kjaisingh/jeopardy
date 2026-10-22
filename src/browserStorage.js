export const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const removeStorage = (key) => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const loadSession = (key) => {
  try {
    const session = JSON.parse(readStorage(key));
    return session && /^[A-HJ-NP-Z2-9]{6}$/.test(session.code) &&
      typeof session.playerId === 'string' && session.playerId.length > 0 &&
      typeof session.sessionToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.sessionToken)
      ? { code: session.code, playerId: session.playerId, sessionToken: session.sessionToken }
      : null;
  } catch {
    return null;
  }
};
