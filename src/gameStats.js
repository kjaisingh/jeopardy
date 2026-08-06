const emptyAccuracy = () => ({ attempted: 0, correct: 0 });

const buildTeamAccuracy = (teams, history) => {
  const stats = Object.fromEntries(teams.map((team) => [team.id, emptyAccuracy()]));

  history.forEach((entry) => {
    entry.attempts.forEach((attempt) => {
      if (attempt.skipped) return;
      const bucket = stats[attempt.teamId];
      if (!bucket) return;
      bucket.attempted += 1;
      if (attempt.isCorrect) bucket.correct += 1;
    });

    if (entry.closedReason === 'overridden' && entry.solvedByTeamId) {
      const bucket = stats[entry.solvedByTeamId];
      if (bucket) bucket.correct += 1;
    }
  });

  return stats;
};

const buildSteals = (history) => {
  const counts = new Map();
  history.forEach((entry) => {
    const solved = entry.closedReason === 'solved' || entry.closedReason === 'overridden';
    if (!solved || entry.solvedByTeamId === entry.selectedByTeamId) return;
    counts.set(entry.solvedByTeamId, (counts.get(entry.solvedByTeamId) || 0) + 1);
  });
  return counts;
};

export const buildStandings = (teams, history) => {
  const accuracy = buildTeamAccuracy(teams, history);
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  const leaderScore = sorted[0]?.score ?? 0;

  let rank = 0;
  let previousScore = null;

  return sorted.map((team, index) => {
    if (team.score !== previousScore) {
      rank = index + 1;
      previousScore = team.score;
    }
    const acc = accuracy[team.id] || emptyAccuracy();
    return {
      id: team.id,
      name: team.name,
      score: team.score,
      rank,
      isLeader: team.score === leaderScore,
      gapToLeader: leaderScore - team.score,
      attempted: acc.attempted,
      correct: acc.correct,
      accuracyPct: acc.attempted ? Math.round((acc.correct / acc.attempted) * 100) : null
    };
  });
};

export const buildStats = (teams, history) => {
  const teamName = (teamId) => teams.find((team) => team.id === teamId)?.name || null;

  const solvedEntries = history.filter(
    (entry) => entry.closedReason === 'solved' || entry.closedReason === 'overridden'
  );

  const biggestAnswer = solvedEntries.reduce(
    (best, entry) => (!best || entry.pointsAwarded > best.pointsAwarded ? entry : best),
    null
  );

  const steals = buildSteals(history);
  let mostSteals = null;
  steals.forEach((count, teamId) => {
    if (!mostSteals || count > mostSteals.count) {
      mostSteals = { teamId, teamName: teamName(teamId), count };
    }
  });

  const dailyDoubleEntry = history.find((entry) => entry.multiplier > 1);
  const dailyDouble = dailyDoubleEntry
    ? {
        value: dailyDoubleEntry.value,
        points: dailyDoubleEntry.pointsAwarded,
        solved: solvedEntries.includes(dailyDoubleEntry),
        teamName: teamName(dailyDoubleEntry.solvedByTeamId)
      }
    : null;

  const toughestQuestion = history.reduce(
    (worst, entry) => (!worst || entry.attempts.length > worst.attempts.length ? entry : worst),
    null
  );

  const unsolved = history
    .filter((entry) => entry.closedReason === 'exhausted' || entry.closedReason === 'passed')
    .sort((a, b) => b.value - a.value)
    .map((entry) => ({
      ownerPlayerName: entry.ownerPlayerName,
      value: entry.value,
      prompt: entry.prompt,
      answer: entry.answer
    }));

  const byOwner = new Map();
  history.forEach((entry) => {
    const bucket = byOwner.get(entry.ownerPlayerId) || {
      ownerPlayerName: entry.ownerPlayerName,
      solved: 0,
      total: 0
    };
    bucket.total += 1;
    if (entry.closedReason === 'solved' || entry.closedReason === 'overridden') bucket.solved += 1;
    byOwner.set(entry.ownerPlayerId, bucket);
  });

  const categoryRates = [...byOwner.values()]
    .map((bucket) => ({ ...bucket, rate: bucket.total ? bucket.solved / bucket.total : 0 }))
    .sort((a, b) => a.rate - b.rate);

  return {
    questionsSolved: solvedEntries.length,
    totalQuestions: history.length,
    biggestAnswer: biggestAnswer && {
      value: biggestAnswer.value,
      points: biggestAnswer.pointsAwarded,
      isDailyDouble: biggestAnswer.multiplier > 1,
      teamName: teamName(biggestAnswer.solvedByTeamId)
    },
    mostSteals,
    dailyDouble,
    toughestQuestion: toughestQuestion && {
      ownerPlayerName: toughestQuestion.ownerPlayerName,
      value: toughestQuestion.value,
      attemptCount: toughestQuestion.attempts.length
    },
    unsolved,
    categoryRates
  };
};
