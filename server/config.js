export const positiveNumber = (rawValue, fallback) => {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const positiveInteger = (rawValue, fallback) => {
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const positiveNumberFromEnv = (name, fallback) =>
  positiveNumber(process.env[name], fallback);

export const positiveIntegerFromEnv = (name, fallback) =>
  positiveInteger(process.env[name], fallback);
