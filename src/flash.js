export const teamById = (teams) => Object.fromEntries(teams.map((team) => [team.id, team]));

export const tailSeq = (events) => (events && events.length ? events[events.length - 1].seq : 0);

export const toFlash = (event) => {
  switch (event.type) {
    case 'attempt-correct':
    case 'override-correct':
      return { tone: 'correct', headline: 'CORRECT!', detail: `${event.teamName} +$${event.points}`, closable: true };
    case 'attempt-incorrect':
      return {
        tone: 'incorrect',
        headline: 'INCORRECT',
        detail: `Passing to ${event.nextTeamName}`
      };
    case 'attempt-skipped':
      return {
        tone: 'incorrect',
        headline: "CAN'T ANSWER",
        detail: `Passing to ${event.nextTeamName}`
      };
    case 'question-passed':
      return {
        tone: 'incorrect',
        headline: 'PASSED',
        detail: `Answer: ${event.correctAnswer}`,
        closable: true
      };
    case 'question-exhausted':
      return {
        tone: 'incorrect',
        headline: 'QUESTION UNANSWERED',
        detail: `Answer: ${event.correctAnswer}`,
        closable: true
      };
    case 'daily-double':
      return {
        tone: 'daily-double',
        headline: 'DAILY DOUBLE!',
        detail: `$${event.value} → $${event.value * event.multiplier}`
      };
    case 'host-changed':
      return { tone: 'correct', headline: 'NEW HOST', detail: `${event.newHostName} is now the host` };
    case 'settings-changed':
      return {
        tone: 'incorrect',
        headline: 'SETTINGS CHANGED',
        detail: 'Review and resubmit your questions',
        compact: true
      };
    case 'player-kicked':
      return {
        tone: 'incorrect',
        headline: 'PLAYER REMOVED',
        detail: `${event.playerName} was removed by the host`,
        compact: true
      };
    default:
      return null;
  }
};

export const SOUND_BY_TYPE = {
  'attempt-correct': 'correct',
  'override-correct': 'correct',
  'attempt-incorrect': 'incorrect',
  'attempt-skipped': 'incorrect',
  'question-passed': 'incorrect',
  'question-exhausted': 'incorrect',
  'daily-double': 'dailyDouble',
  'game-over': 'gameOver',
  'host-changed': 'select',
  'settings-changed': 'incorrect',
  'player-kicked': 'incorrect'
};
