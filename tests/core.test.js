import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANK_VERSION, EXAM_MS, PASS_CORRECT, createAttempt, finishAttempt,
  formQuestions, gradeAttempt, remainingMs, seededRandom, setAnswer,
  shuffle, toggleFlag, validateAttempt
} from '../core.js';

const START = Date.UTC(2026, 9, 19, 16);

function makeBank() {
  const domains = [
    ...Array(29).fill('Regulations'), ...Array(12).fill('Airspace'),
    ...Array(3).fill('Weather'), 'Loading and performance', ...Array(15).fill('Operations')
  ];
  return ['a', 'b'].flatMap(form => Array.from({ length: 65 }, (_, i) => ({
    id: `${form}-${i + 1}`, form, scored: i < 60,
    domain: domains[i] || 'Operations', topic: `Topic ${i % 7}`,
    prompt: `Synthetic question ${form}-${i + 1}`,
    choices: ['First answer', 'Second answer', 'Third answer'],
    answer: i % 3, explanation: 'Synthetic explanation.', sourceIds: ['test-source']
  })));
}

function fixture(form = 'a', seed = 829) {
  const bank = makeBank();
  return { bank, attempt: createAttempt(bank, form, START, seed) };
}

function answerCount(bank, attempt, count, { extrasRight = false, leaveRestBlank = false } = {}) {
  let result = attempt;
  let scoredIndex = 0;
  for (const q of formQuestions(bank, attempt.form)) {
    if (q.scored) {
      if (scoredIndex < count) result = setAnswer(result, q.id, q.answer, START + 1000);
      else if (!leaveRestBlank) result = setAnswer(result, q.id, (q.answer + 1) % 3, START + 1000);
      scoredIndex++;
    } else {
      result = setAnswer(result, q.id, extrasRight ? q.answer : (q.answer + 1) % 3, START + 1000);
    }
  }
  return result;
}

test('70% is exactly 42 scored answers; 41 does not pass', () => {
  const { bank, attempt } = fixture();
  const passing = gradeAttempt(bank, finishAttempt(answerCount(bank, attempt, 42), START + 5000));
  const failing = gradeAttempt(bank, finishAttempt(answerCount(bank, attempt, 41), START + 5000));
  assert.equal(PASS_CORRECT, 42);
  assert.equal(passing.total, 60);
  assert.equal(passing.correct, 42);
  assert.equal(passing.percent, 70);
  assert.equal(passing.passed, true);
  assert.equal(failing.correct, 41);
  assert.equal(failing.percent, 41 / 60 * 100);
  assert.equal(failing.passed, false);
});

test('all five unscored answers can change without affecting score or pass status', () => {
  const { bank, attempt } = fixture();
  for (const correct of [0, 41, 42, 60]) {
    const extraWrong = gradeAttempt(bank, finishAttempt(answerCount(bank, attempt, correct), START + 5000));
    const extraRight = gradeAttempt(bank, finishAttempt(answerCount(bank, attempt, correct, { extrasRight: true }), START + 5000));
    for (const field of ['correct', 'total', 'percent', 'passed', 'scoredAnswered']) {
      assert.equal(extraWrong[field], extraRight[field], `${field} changed because of unscored questions`);
    }
    assert.deepEqual(extraWrong.topics, extraRight.topics);
    assert.equal(extraWrong.extraTotal, 5);
    assert.equal(extraWrong.extraCorrect, 0);
    assert.equal(extraRight.extraCorrect, 5);
  }
});

test('unanswered scored questions count as wrong and remain visible in review', () => {
  const { bank, attempt } = fixture();
  const blank = gradeAttempt(bank, finishAttempt(answerCount(bank, attempt, 41, { leaveRestBlank: true }), START + 5000));
  const wrong = gradeAttempt(bank, finishAttempt(answerCount(bank, attempt, 41), START + 5000));
  assert.equal(blank.correct, wrong.correct);
  assert.equal(blank.percent, wrong.percent);
  assert.equal(blank.passed, false);
  assert.equal(blank.scoredAnswered, 41);
  assert.equal(blank.unanswered, 19);
  assert.equal(blank.review.filter(q => q.scored && !q.answered).length, 19);
  assert.ok(blank.review.filter(q => !q.answered).every(q => !q.right && q.selected === null));
  assert.equal(Object.values(blank.topics).reduce((sum, domain) => sum + domain.total, 0), 60);
  assert.equal(Object.values(blank.topics).reduce((sum, domain) => sum + domain.answered, 0), 41);
});

test('a completely unanswered exam scores zero rather than omitting questions', () => {
  const { bank, attempt } = fixture();
  const result = gradeAttempt(bank, finishAttempt(attempt, START + 5000));
  assert.equal(result.correct, 0);
  assert.equal(result.total, 60);
  assert.equal(result.percent, 0);
  assert.equal(result.passed, false);
  assert.equal(result.unanswered, 65);
  assert.equal(result.review.length, 65);
});

test('shuffled displayed choices map back to original answer indices', () => {
  const { bank, attempt } = fixture();
  const questions = formQuestions(bank, 'a');
  let answered = attempt;
  let actuallyReordered = 0;
  for (const q of questions) {
    const displayOrder = attempt.choiceOrder[q.id];
    assert.deepEqual([...displayOrder].sort(), [0, 1, 2]);
    const displayIndex = displayOrder.indexOf(q.answer);
    if (displayIndex !== q.answer) actuallyReordered++;
    answered = setAnswer(answered, q.id, displayOrder[displayIndex], START + 1000);
  }
  assert.ok(actuallyReordered > 20, 'fixture must exercise reordered answers');
  const result = gradeAttempt(bank, finishAttempt(answered, START + 5000));
  assert.equal(result.correct, 60);
  assert.equal(result.extraCorrect, 5);
  assert.ok(result.review.every(q => q.right));

  const changed = questions.find(q => attempt.choiceOrder[q.id].indexOf(q.answer) !== q.answer);
  const wrongDisplayIndex = attempt.choiceOrder[changed.id].indexOf(changed.answer);
  const indexMistake = setAnswer(attempt, changed.id, wrongDisplayIndex, START + 1000);
  const mistakenReview = gradeAttempt(bank, finishAttempt(indexMistake, START + 5000)).review.find(q => q.id === changed.id);
  assert.equal(mistakenReview.right, false, 'grading must compare original indices, not displayed position');
});

test('seeded shuffles are reproducible permutations and do not mutate inputs', () => {
  const source = Array.from({ length: 65 }, (_, i) => i);
  const original = [...source];
  const first = shuffle(source, seededRandom(15));
  assert.deepEqual(shuffle(source, seededRandom(15)), first);
  assert.notDeepEqual(shuffle(source, seededRandom(16)), first);
  assert.deepEqual([...first].sort((a, b) => a - b), original);
  assert.deepEqual(source, original);
  assert.deepEqual(fixture('a', 15).attempt, fixture('a', 15).attempt);
});

test('persisting and resuming preserves order, answers, flags, and the original deadline', () => {
  const { bank, attempt } = fixture('b');
  const id = attempt.questionIds[18];
  let progress = setAnswer(attempt, id, 2, START + 1000);
  progress = toggleFlag(progress, id);
  progress = { ...progress, position: 18 };
  const restored = JSON.parse(JSON.stringify(progress));
  assert.equal(validateAttempt(restored, bank), true);
  assert.deepEqual(restored, progress);
  assert.equal(restored.version, BANK_VERSION);
  assert.equal(restored.deadline, START + EXAM_MS);
  assert.equal(remainingMs(restored, START + 35 * 60000), 85 * 60000);
  assert.equal(remainingMs(restored, START + EXAM_MS + 1), 0);
  assert.equal(setAnswer(restored, id, 0, restored.deadline), restored);
  const expired = finishAttempt(restored, restored.deadline + 60000);
  assert.equal(expired.finishedAt, restored.deadline);
  assert.equal(expired.reason, 'time');
  assert.equal(gradeAttempt(bank, expired).elapsedMs, EXAM_MS);
});

test('answer changes are immutable and cannot alter a finished attempt', () => {
  const { bank, attempt } = fixture();
  const id = attempt.questionIds[0];
  const answered = setAnswer(attempt, id, 2, START + 1000);
  assert.notEqual(answered, attempt);
  assert.deepEqual(attempt.answers, {});
  assert.equal(answered.answers[id], 2);
  const finished = finishAttempt(answered, START + 2000);
  assert.equal(setAnswer(finished, id, 1, START + 3000), finished);
  assert.equal(toggleFlag(finished, id), finished);
  assert.deepEqual(finished.answers, { [id]: 2 });
  assert.equal(validateAttempt(finished, bank), true);
});

test('changing an answer replaces its previous credit instead of adding another response', () => {
  const { bank, attempt } = fixture();
  const question = bank.find(q => q.form === 'a' && q.scored);
  const right = setAnswer(attempt, question.id, question.answer, START + 1000);
  const wrong = setAnswer(right, question.id, (question.answer + 1) % 3, START + 2000);
  assert.equal(Object.keys(wrong.answers).length, 1);
  assert.equal(right.answers[question.id], question.answer, 'earlier state must remain immutable');
  const correctGrade = gradeAttempt(bank, finishAttempt(right, START + 3000));
  const changedGrade = gradeAttempt(bank, finishAttempt(wrong, START + 3000));
  assert.equal(correctGrade.correct, 1);
  assert.equal(changedGrade.correct, 0);
  assert.equal(changedGrade.scoredAnswered, 1);
  assert.equal(changedGrade.unanswered, 64);
});

test('finishing is idempotent and never restarts or extends the clock', () => {
  const { attempt } = fixture();
  const finished = finishAttempt(attempt, START + 12000);
  assert.equal(finished.finishedAt, START + 12000);
  assert.equal(finished.reason, 'submitted');
  assert.equal(finishAttempt(finished, START + EXAM_MS + 1, 'time'), finished);
  assert.equal(finishAttempt(finished, START + 1, 'different'), finished);
  assert.equal(finishAttempt(attempt, START - 1).finishedAt, START);
});

test('incomplete forms, invalid input answers, and unfinished grading fail explicitly', () => {
  const { bank, attempt } = fixture();
  assert.throws(() => formQuestions(bank.slice(1), 'a'), /incomplete/);
  assert.throws(() => createAttempt(bank, 'unknown', START), /incomplete/);
  assert.throws(() => gradeAttempt(bank, attempt), /Finish/);
  for (const answer of [-1, 3, 0.5, NaN, '1', null]) {
    assert.throws(() => setAnswer(attempt, attempt.questionIds[0], answer, START + 1), /Invalid answer/);
  }
  assert.throws(() => setAnswer(attempt, 'b-1', 1, START + 1), /Invalid answer/);
});

test('corrupt or incompatible saved attempts are rejected', async t => {
  const { bank, attempt } = fixture();
  const first = attempt.questionIds[0];
  const invalid = {
    'missing saved attempt': () => null,
    'wrong bank version': a => { a.version = 'old'; },
    'missing identifier': a => { delete a.id; },
    'wrong form': a => { a.form = 'c'; },
    'missing question': a => { a.questionIds.pop(); },
    'duplicate question': a => { a.questionIds[1] = first; },
    'question from another form': a => { a.questionIds[1] = 'b-1'; },
    'invalid start': a => { a.startedAt = null; },
    'extended deadline': a => { a.deadline++; },
    'finish before start': a => { a.finishedAt = a.startedAt - 1; },
    'finish after deadline': a => { a.finishedAt = a.deadline + 1; },
    'invalid position': a => { a.position = 65; },
    'fractional position': a => { a.position = 1.5; },
    'answers stored as array': a => { a.answers = []; },
    'answer to foreign question': a => { a.answers['b-1'] = 1; },
    'out of range answer': a => { a.answers[first] = 3; },
    'string answer': a => { a.answers[first] = '1'; },
    'invalid flag': a => { a.flags = ['b-1']; },
    'missing choice order': a => { delete a.choiceOrder[first]; },
    'duplicate choice indices': a => { a.choiceOrder[first] = [0, 0, 2]; },
    'string choice indices': a => { a.choiceOrder[first] = ['0', '1', '2']; }
  };
  for (const [name, mutate] of Object.entries(invalid)) {
    await t.test(name, () => {
      let saved = JSON.parse(JSON.stringify(attempt));
      const result = mutate(saved);
      if (result === null) saved = null;
      assert.equal(validateAttempt(saved, bank), false);
      assert.throws(() => gradeAttempt(bank, saved), /Saved exam/);
    });
  }
});
