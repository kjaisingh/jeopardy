const normalize = (value) =>
  (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const levenshtein = (left, right) => {
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[left.length][right.length];
};

const jaccardTokens = (left, right) => {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return union.size ? intersection.length / union.size : 0;
};

export const isAnswerCorrect = (submitted, expected) => {
  const candidate = normalize(submitted);
  const answer = normalize(expected);

  if (!candidate || !answer) return false;
  if (candidate === answer) return true;
  if (candidate.includes(answer) || answer.includes(candidate)) return true;

  const tokenSimilarity = jaccardTokens(candidate, answer);
  if (tokenSimilarity >= 0.7) return true;

  const distance = levenshtein(candidate, answer);
  const similarity = 1 - distance / Math.max(candidate.length, answer.length);
  return similarity >= 0.82;
};