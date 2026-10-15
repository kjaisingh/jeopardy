import { valuesForCount } from './constants.js';

export const blankDraft = (count) =>
  valuesForCount(count).map((value) => ({
    localId: crypto.randomUUID(),
    value,
    prompt: '',
    answer: ''
  }));

export const shuffleArray = (input) => {
  const output = [...input];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
};

export const buildTeams = (count, players) => {
  const teams = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Team ${index + 1}`,
    playerIds: []
  }));
  players.forEach((player, index) => {
    teams[index % count].playerIds.push(player.id);
  });
  return teams;
};

export const reconcileTeams = (current, targetCount, players) => {
  const validIds = new Set(players.map((player) => player.id));
  const assigned = new Set();
  let teams = current.map((team) => ({
    ...team,
    playerIds: team.playerIds.filter((id) => validIds.has(id))
  }));
  teams.forEach((team) => team.playerIds.forEach((id) => assigned.add(id)));

  while (teams.length < targetCount) {
    teams.push({ id: crypto.randomUUID(), name: `Team ${teams.length + 1}`, playerIds: [] });
  }
  if (teams.length > targetCount) {
    const overflow = teams.slice(targetCount);
    teams = teams.slice(0, targetCount);
    overflow.forEach((team) => {
      team.playerIds.forEach((id) => {
        const smallest = teams.reduce(
          (min, entry) => (entry.playerIds.length < min.playerIds.length ? entry : min),
          teams[0]
        );
        smallest.playerIds.push(id);
      });
    });
  }

  players.forEach((player) => {
    if (assigned.has(player.id)) return;
    const smallest = teams.reduce(
      (min, entry) => (entry.playerIds.length < min.playerIds.length ? entry : min),
      teams[0]
    );
    smallest.playerIds.push(player.id);
  });
  return teams;
};

export const reconcileDrafts = (current, targetCount) => {
  const byValue = new Map(current.map((draft) => [draft.value, draft]));
  return valuesForCount(targetCount).map(
    (value) =>
      byValue.get(value) || {
        localId: crypto.randomUUID(),
        value,
        prompt: '',
        answer: ''
      }
  );
};

export const duplicateNames = (teams) => {
  const seen = new Set();
  const duplicates = new Set();
  teams.forEach((team) => {
    const name = team.name.trim();
    const key = name.toLocaleLowerCase();
    if (key && seen.has(key)) duplicates.add(name);
    seen.add(key);
  });
  return [...duplicates];
};
