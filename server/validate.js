export const LIMITS = {
  name: { min: 1, max: 24 },
  prompt: { min: 1, max: 300 },
  answer: { min: 1, max: 120 },
  attemptAnswer: { min: 1, max: 200 },
  players: { max: 10 },
  rounds: { min: 1, max: 10 },
  timerSeconds: { min: 0, max: 300 },
  score: { min: -1000000, max: 1000000 },
  questionsPerPlayer: { min: 1, max: 10 }
};

export const requiredText = (value, label, { min = 1, max = Infinity } = {}) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length < min) throw new Error(`${label} is required`);
  if (trimmed.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return trimmed;
};

export const requiredInteger = (value, label, { min = -Infinity, max = Infinity } = {}) => {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${label} must be a whole number`);
  if (number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return number;
};

export const requiredBoolean = (value, label) => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`);
  return value;
};

export const requiredOneOf = (value, label, options) => {
  if (!options.includes(value)) throw new Error(`${label} must be one of: ${options.join(', ')}`);
  return value;
};

export const normalizeRoomCode = (code) => requiredText(code, 'Room code').toUpperCase();

export const assertUniqueNames = (names, label) => {
  const seen = new Set();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) throw new Error(`${label} "${name.trim()}" is already taken`);
    seen.add(key);
  }
};
