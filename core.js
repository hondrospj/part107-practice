export const BANK_VERSION = '2026-10-19.1';
export const EXAM_MS = 120 * 60 * 1000;
export const PASS_CORRECT = 42;

export function seededRandom(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6D2B79F5;
    let t = n;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function shuffle(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function formQuestions(bank, form) {
  const questions = bank.filter(q => q.form === form);
  if (questions.length !== 65 || questions.filter(q => q.scored).length !== 60) {
    throw new Error('This exam form is incomplete.');
  }
  return questions;
}
export function createAttempt(bank, form, now = Date.now(), seed = now >>> 0) {
  const questions = formQuestions(bank, form);
  const random = seededRandom(seed);
  return {
    version: BANK_VERSION,
    id: `${now}-${seed >>> 0}`,
    form,
    startedAt: now,
    deadline: now + EXAM_MS,
    finishedAt: null,
    reason: null,
    questionIds: shuffle(questions.map(q => q.id), random),
    choiceOrder: Object.fromEntries(questions.map(q => [q.id, shuffle([0, 1, 2], random)])),
    answers: {},
    flags: [],
    position: 0
  };
}
export function remainingMs(attempt, now = Date.now()) {
  return Math.max(0, Math.min(EXAM_MS, attempt.deadline - now));
}
export function validateAttempt(attempt, bank) {
  if (!attempt || attempt.version !== BANK_VERSION || typeof attempt.id !== 'string') return false;
  if (!['a', 'b'].includes(attempt.form)) return false;
  let expected;
  try { expected = new Set(formQuestions(bank, attempt.form).map(q => q.id)); } catch { return false; }
  if (!Array.isArray(attempt.questionIds) || attempt.questionIds.length !== 65 || new Set(attempt.questionIds).size !== 65) return false;
  if (!attempt.questionIds.every(id => expected.has(id))) return false;
  if (!Number.isFinite(attempt.startedAt) || attempt.deadline !== attempt.startedAt + EXAM_MS) return false;
  if (attempt.finishedAt !== null && (!Number.isFinite(attempt.finishedAt) || attempt.finishedAt < attempt.startedAt || attempt.finishedAt > attempt.deadline)) return false;
  if (!Number.isInteger(attempt.position) || attempt.position < 0 || attempt.position >= 65) return false;
  if (!attempt.answers || typeof attempt.answers !== 'object' || Array.isArray(attempt.answers)) return false;
  if (!Object.entries(attempt.answers).every(([id, answer]) => expected.has(id) && Number.isInteger(answer) && answer >= 0 && answer < 3)) return false;
  if (!Array.isArray(attempt.flags) || !attempt.flags.every(id => expected.has(id))) return false;
  if (!attempt.choiceOrder || !attempt.questionIds.every(id => Array.isArray(attempt.choiceOrder[id]) && attempt.choiceOrder[id].every(Number.isInteger) && [...attempt.choiceOrder[id]].sort().join(',') === '0,1,2')) return false;
  return true;
}
export function setAnswer(attempt, id, answer, now = Date.now()) {
  if (attempt.finishedAt !== null || remainingMs(attempt, now) <= 0) return attempt;
  if (!attempt.questionIds.includes(id) || !Number.isInteger(answer) || answer < 0 || answer > 2) throw new Error('Invalid answer.');
  return { ...attempt, answers: { ...attempt.answers, [id]: answer } };
}
export function toggleFlag(attempt, id) {
  if (attempt.finishedAt !== null || !attempt.questionIds.includes(id)) return attempt;
  const flags = new Set(attempt.flags);
  flags.has(id) ? flags.delete(id) : flags.add(id);
  return { ...attempt, flags: [...flags] };
}
export function finishAttempt(attempt, now = Date.now(), reason = 'submitted') {
  if (attempt.finishedAt !== null) return attempt;
  const at = Math.max(attempt.startedAt, Math.min(now, attempt.deadline));
  return { ...attempt, finishedAt: at, reason: now >= attempt.deadline ? 'time' : reason };
}
export function gradeAttempt(bank, attempt) {
  if (!validateAttempt(attempt, bank)) throw new Error('Saved exam does not match this question bank.');
  if (attempt.finishedAt === null) throw new Error('Finish the exam before grading.');
  const byId = new Map(bank.map(q => [q.id, q]));
  const topics = {};
  let correct = 0, scoredAnswered = 0, extraCorrect = 0, extraAnswered = 0;
  const review = attempt.questionIds.map((id, index) => {
    const q = byId.get(id), answer = attempt.answers[id];
    const answered = Number.isInteger(answer), right = answered && answer === q.answer;
    if (q.scored) {
      correct += Number(right); scoredAnswered += Number(answered);
      topics[q.domain] ||= { total: 0, correct: 0, answered: 0 };
      topics[q.domain].total++; topics[q.domain].correct += Number(right); topics[q.domain].answered += Number(answered);
    } else { extraCorrect += Number(right); extraAnswered += Number(answered); }
    return { id, number: index + 1, answered, right, selected: answered ? answer : null, scored: q.scored, flagged: attempt.flags.includes(id) };
  });
  return {
    correct, total: 60, percent: correct / 60 * 100, passed: correct >= PASS_CORRECT,
    scoredAnswered, unanswered: 65 - Object.keys(attempt.answers).length,
    extraCorrect, extraAnswered, extraTotal: 5, topics, review,
    elapsedMs: Math.max(0, Math.min(EXAM_MS, attempt.finishedAt - attempt.startedAt))
  };
}
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
