const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for']);

const normalize = (value) =>
  (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value) => value.split(' ').filter(Boolean);

const stripStopWords = (tokens) => tokens.filter((token) => !STOP_WORDS.has(token));

const tokensEqual = (left, right) =>
  left.length === right.length && left.every((token, index) => token === right[index]);

const containsTokenSequence = (haystack, needle) => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) return true;
  }
  return false;
};

// Guards a false positive like "Jerome" containing "Rome" as raw characters:
// containment only counts whole tokens, and only when the needle carries
// enough content (>=4 chars) and the longer side isn't mostly unrelated text
// (at most 2 extra tokens).
const guardedContainment = (candidateTokens, answerTokens) => {
  const [shorter, longer] = candidateTokens.length <= answerTokens.length
    ? [candidateTokens, answerTokens]
    : [answerTokens, candidateTokens];

  if (shorter.join(' ').length < 4) return false;
  if (longer.length - shorter.length > 2) return false;

  return containsTokenSequence(longer, shorter);
};

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

  const candidateContent = stripStopWords(tokenize(candidate));
  const answerContent = stripStopWords(tokenize(answer));

  if (candidateContent.length && tokensEqual(candidateContent, answerContent)) return true;
  if (candidateContent.length && answerContent.length && guardedContainment(candidateContent, answerContent)) {
    return true;
  }

  const candidateJoined = candidateContent.join(' ');
  const answerJoined = answerContent.join(' ');

  const tokenSimilarity = jaccardTokens(candidateJoined, answerJoined);
  if (tokenSimilarity >= 0.7) return true;

  const maxLength = Math.max(candidateJoined.length, answerJoined.length);
  if (!maxLength) return false;

  const distance = levenshtein(candidateJoined, answerJoined);
  const similarity = 1 - distance / maxLength;
  return similarity >= 0.82;
};
