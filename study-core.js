export const STUDY_VERSION = '2026-10-19.1';
export const DAY_MS = 86400000;

export function emptyStudyState() {
  return { version: STUDY_VERSION, completed: [], cards: {}, drills: {} };
}

export function validStudyState(value, lessons) {
  if (!value || value.version !== STUDY_VERSION || !Array.isArray(value.completed) ||
      !value.cards || Array.isArray(value.cards) || typeof value.cards !== 'object' ||
      !value.drills || Array.isArray(value.drills) || typeof value.drills !== 'object') return false;
  const days = new Set(lessons.map(d => d.day));
  const cards = new Set(lessons.flatMap(d => d.cards.map(c => c.id)));
  const questions = new Map(lessons.flatMap(d => d.drills.map(q => [q.id, q])));
  return value.completed.every(d => days.has(d)) && new Set(value.completed).size === value.completed.length &&
    Object.entries(value.cards).every(([id, c]) => cards.has(id) && c &&
      Number.isInteger(c.streak) && c.streak >= 0 && c.streak <= 100 &&
      Number.isFinite(c.dueAt) && c.dueAt >= 0 && Number.isFinite(c.lastRated) && c.lastRated >= 0 &&
      typeof c.known === 'boolean') &&
    Object.entries(value.drills).every(([id, r]) => questions.has(id) && r &&
      Number.isInteger(r.selected) && r.selected >= 0 && r.selected < 3 &&
      r.correct === (r.selected === questions.get(id).answer) && typeof r.guessed === 'boolean' &&
      Number.isInteger(r.attempts) && r.attempts >= 1 && Number.isFinite(r.lastAttempt) && r.lastAttempt >= 0);
}

export function rateStudyCard(state, id, known, now = Date.now()) {
  if (typeof known !== 'boolean' || !Number.isFinite(now) || now < 0) throw new Error('Invalid card rating.');
  const streak = known ? Math.min((state.cards[id]?.streak || 0) + 1, 100) : 0;
  const interval = known ? (streak === 1 ? 1 : streak === 2 ? 3 : 7) * DAY_MS : 0;
  return { ...state, cards: { ...state.cards, [id]: { known, streak, dueAt: now + interval, lastRated: now } } };
}

export function recordStudyAnswer(state, question, selected, guessed, now = Date.now()) {
  if (!Number.isInteger(selected) || selected < 0 || selected >= question.choices.length ||
      typeof guessed !== 'boolean' || !Number.isFinite(now) || now < 0) throw new Error('Invalid practice answer.');
  return { ...state, drills: { ...state.drills, [question.id]: {
    selected, correct: selected === question.answer, guessed,
    attempts: (state.drills[question.id]?.attempts || 0) + 1, lastAttempt: now
  } } };
}

export function cardsDue(cards, state, now = Date.now()) {
  return cards.filter(c => state.cards[c.id] && state.cards[c.id].dueAt <= now)
    .sort((a, b) => state.cards[a.id].dueAt - state.cards[b.id].dueAt);
}

export function needsReview(result) {
  return Boolean(result && (!result.correct || result.guessed));
}

export function setLessonReviewed(state, day, reviewed) {
  if (!Number.isInteger(day) || day < 1 || day > 7 || typeof reviewed !== 'boolean') throw new Error('Invalid lesson.');
  return { ...state, completed: reviewed ? [...new Set([...state.completed, day])].sort((a, b) => a - b) : state.completed.filter(d => d !== day) };
}
