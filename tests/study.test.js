import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STUDY_VERSION, DAY_MS, emptyStudyState, validStudyState, rateStudyCard,
  recordStudyAnswer, cardsDue, needsReview, setLessonReviewed
} from '../study-core.js';

const readJson = async name => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const [guide, questions, sources, figures] = await Promise.all([
  readJson('study.json'), readJson('questions.json'), readJson('sources.json'), readJson('figures.json')
]);
const lessons = guide.lessons;
const allCards = lessons.flatMap(lesson => lesson.cards);
const allDrills = lessons.flatMap(lesson => lesson.drills);
const sourceIds = new Set(sources.map(source => source.id));
const figureIds = new Set(figures.map(figure => figure.id));
const text = value => typeof value === 'string' && value.trim().length > 0;
const normalized = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const now = Date.UTC(2026, 9, 19, 13);

function refs(item) {
  assert.ok(Array.isArray(item.sourceIds) && item.sourceIds.length > 0, `${item.id}: missing sources`);
  assert.equal(new Set(item.sourceIds).size, item.sourceIds.length, `${item.id}: repeated source`);
  assert.ok(item.sourceIds.every(id => sourceIds.has(id)), `${item.id}: unknown source`);
  if (item.figureId !== undefined) assert.ok(figureIds.has(item.figureId), `${item.id}: unknown figure`);
}

function populatedState() {
  let state = emptyStudyState();
  state = rateStudyCard(state, allCards[0].id, true, now);
  state = recordStudyAnswer(state, allDrills[0], allDrills[0].answer, false, now);
  return setLessonReviewed(state, 1, true);
}

test('seven-day guide has one hour per lesson and the promised study material', () => {
  assert.equal(guide.version, STUDY_VERSION);
  assert.deepEqual(lessons.map(lesson => lesson.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(lessons.map(lesson => lesson.slug)).size, 7);
  assert.equal(allCards.length, 70);
  assert.equal(allDrills.length, 68);
  const ids = [];
  for (const lesson of lessons) {
    assert.ok(text(lesson.title) && text(lesson.focus));
    assert.equal(lesson.objectives.length, 3, `Day ${lesson.day}: three objectives required`);
    assert.ok(lesson.objectives.every(text));
    assert.equal(lesson.schedule.reduce((sum, block) => sum + block.minutes, 0), 60);
    assert.ok(lesson.schedule.every(block => Number.isInteger(block.minutes) && block.minutes > 0 && text(block.label) && text(block.task)));
    assert.equal(lesson.cards.length, 10);
    assert.equal(lesson.drills.length, lesson.day === 7 ? 20 : 8);
    assert.ok(lesson.sections.length > 0);
    for (const section of lesson.sections) {
      ids.push(section.id);
      assert.ok(text(section.id) && text(section.title));
      assert.ok(Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && section.paragraphs.every(text));
      refs(section);
      if (section.table) {
        assert.ok(section.table.headers.length > 0 && section.table.headers.every(text));
        assert.ok(section.table.rows.length > 0);
        for (const row of section.table.rows) {
          assert.equal(row.length, section.table.headers.length, `${section.id}: incomplete table row`);
          assert.ok(row.every(text));
        }
      }
      if (section.worked) {
        assert.ok(text(section.worked.prompt) && text(section.worked.answer) && text(section.worked.trap));
        assert.ok(section.worked.steps.length > 0 && section.worked.steps.every(text));
      }
    }
    for (const card of lesson.cards) {
      ids.push(card.id);
      assert.ok(text(card.front) && text(card.back));
      refs(card);
    }
    for (const question of lesson.drills) {
      ids.push(question.id);
      assert.ok(text(question.prompt) && text(question.explanation));
      assert.equal(question.choices.length, 3);
      assert.ok(question.choices.every(text));
      assert.equal(new Set(question.choices.map(normalized)).size, 3, `${question.id}: duplicate alternatives`);
      assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 3, `${question.id}: invalid answer`);
      refs(question);
    }
  }
  assert.equal(new Set(ids).size, ids.length, 'section, card, and question IDs must be globally unique');
});

test('study drills remain separate from the fresh full-exam question prompts', () => {
  const fullExamPrompts = new Set(questions.map(question => normalized(question.prompt)));
  const drillPrompts = allDrills.map(question => normalized(question.prompt));
  assert.equal(new Set(drillPrompts).size, allDrills.length, 'study drills repeat an identical prompt');
  for (const question of allDrills) {
    assert.ok(!fullExamPrompts.has(normalized(question.prompt)), `${question.id}: exact full-exam prompt reused`);
  }
});

test('Quizlet TSV contains all 70 matching fronts and backs with exactly two fields', async () => {
  const tsv = await readFile(new URL('../downloads/part107-quizlet-cards.tsv', import.meta.url), 'utf8');
  const lines = tsv.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const expected = lessons.flatMap(lesson => lesson.cards.map(card => [`Day ${lesson.day} | ${card.front}`, card.back]));
  assert.equal(lines.length, 70);
  assert.deepEqual(lines.map(line => line.split('\t')), expected);
});

test('empty and populated study progress survive a JSON round trip', () => {
  assert.equal(validStudyState(emptyStudyState(), lessons), true);
  const state = populatedState();
  assert.equal(validStudyState(state, lessons), true);
  assert.equal(validStudyState(JSON.parse(JSON.stringify(state)), lessons), true);
  assert.deepEqual(emptyStudyState(), { version: STUDY_VERSION, completed: [], cards: {}, drills: {} });
});

test('saved progress rejects unknown lesson, card, or drill IDs', () => {
  for (const change of [
    state => { state.completed = [8]; },
    state => { state.completed = [1, 1]; },
    state => { state.cards.UNKNOWN = state.cards[allCards[0].id]; },
    state => { state.drills.UNKNOWN = state.drills[allDrills[0].id]; }
  ]) {
    const state = populatedState();
    change(state);
    assert.equal(validStudyState(state, lessons), false);
  }
});

test('saved progress rejects malformed values and dishonest correct flags', () => {
  for (const change of [
    state => { state.version = 'old-version'; },
    state => { state.completed = '1'; },
    state => { state.cards = []; },
    state => { state.drills = []; },
    state => { state.cards[allCards[0].id].streak = -1; },
    state => { state.cards[allCards[0].id].streak = 101; },
    state => { state.cards[allCards[0].id].dueAt = Infinity; },
    state => { state.cards[allCards[0].id].lastRated = -1; },
    state => { state.cards[allCards[0].id].known = 'true'; },
    state => { state.drills[allDrills[0].id].selected = '0'; },
    state => { state.drills[allDrills[0].id].selected = 3; },
    state => { state.drills[allDrills[0].id].correct = false; },
    state => { state.drills[allDrills[0].id].guessed = 'false'; },
    state => { state.drills[allDrills[0].id].attempts = 0; },
    state => { state.drills[allDrills[0].id].lastAttempt = NaN; }
  ]) {
    const state = populatedState();
    change(state);
    assert.equal(validStudyState(state, lessons), false);
  }
  assert.equal(validStudyState(null, lessons), false);
  assert.equal(validStudyState({}, lessons), false);
});

test('successive known card ratings schedule 1, 3, then 7 days', () => {
  const id = allCards[0].id;
  let state = rateStudyCard(emptyStudyState(), id, true, now);
  assert.deepEqual(state.cards[id], { known: true, streak: 1, dueAt: now + DAY_MS, lastRated: now });
  const secondReview = now + DAY_MS;
  state = rateStudyCard(state, id, true, secondReview);
  assert.equal(state.cards[id].streak, 2);
  assert.equal(state.cards[id].dueAt, secondReview + 3 * DAY_MS);
  const thirdReview = secondReview + 3 * DAY_MS;
  state = rateStudyCard(state, id, true, thirdReview);
  assert.equal(state.cards[id].streak, 3);
  assert.equal(state.cards[id].dueAt, thirdReview + 7 * DAY_MS);
  state = rateStudyCard(state, id, true, thirdReview + 7 * DAY_MS);
  assert.equal(state.cards[id].dueAt, thirdReview + 14 * DAY_MS);
  assert.equal(validStudyState(state, lessons), true);
});

test('a missed card becomes due immediately and restarts its next interval', () => {
  const id = allCards[0].id;
  let state = rateStudyCard(emptyStudyState(), id, true, now);
  state = rateStudyCard(state, id, true, now + DAY_MS);
  const missedAt = now + 4 * DAY_MS;
  state = rateStudyCard(state, id, false, missedAt);
  assert.deepEqual(state.cards[id], { known: false, streak: 0, dueAt: missedAt, lastRated: missedAt });
  state = rateStudyCard(state, id, true, missedAt + 1000);
  assert.equal(state.cards[id].streak, 1);
  assert.equal(state.cards[id].dueAt, missedAt + 1000 + DAY_MS);
});

test('due cards include the exact deadline and are sorted without changing the source list', () => {
  const [first, second, untouched] = allCards;
  let state = rateStudyCard(emptyStudyState(), first.id, true, now);
  state = rateStudyCard(state, second.id, false, now);
  const cards = [first, untouched, second];
  assert.deepEqual(cardsDue(cards, state, now).map(card => card.id), [second.id]);
  assert.deepEqual(cardsDue(cards, state, now + DAY_MS).map(card => card.id), [second.id, first.id]);
  assert.deepEqual(cards, [first, untouched, second]);
});

test('correct guesses remain in review until a confident correct answer replaces them', () => {
  const question = allDrills[0];
  let state = recordStudyAnswer(emptyStudyState(), question, question.answer, true, now);
  assert.equal(state.drills[question.id].correct, true);
  assert.equal(needsReview(state.drills[question.id]), true);
  state = recordStudyAnswer(state, question, question.answer, false, now + 1000);
  assert.equal(state.drills[question.id].attempts, 2);
  assert.equal(needsReview(state.drills[question.id]), false);
  state = recordStudyAnswer(state, question, (question.answer + 1) % 3, false, now + 2000);
  assert.equal(state.drills[question.id].correct, false);
  assert.equal(state.drills[question.id].attempts, 3);
  assert.equal(needsReview(state.drills[question.id]), true);
  assert.equal(needsReview(undefined), false);
});

test('study updates preserve their input and unrelated cards, answers, and lesson progress', () => {
  const input = populatedState();
  const before = structuredClone(input);
  const cardUpdate = rateStudyCard(input, allCards[1].id, false, now + 1000);
  const answerUpdate = recordStudyAnswer(input, allDrills[1], allDrills[1].answer, false, now + 1000);
  const lessonUpdate = setLessonReviewed(input, 2, true);
  assert.deepEqual(input, before);
  assert.notEqual(cardUpdate, input);
  assert.notEqual(cardUpdate.cards, input.cards);
  assert.deepEqual(cardUpdate.drills, input.drills);
  assert.deepEqual(cardUpdate.completed, input.completed);
  assert.deepEqual(answerUpdate.cards, input.cards);
  assert.deepEqual(answerUpdate.completed, input.completed);
  assert.deepEqual(lessonUpdate.cards, input.cards);
  assert.deepEqual(lessonUpdate.drills, input.drills);
  assert.ok(!Object.hasOwn(input.cards, allCards[1].id));
  assert.ok(!Object.hasOwn(input.drills, allDrills[1].id));
});

test('lesson completion is sorted, idempotent, and reversible', () => {
  let state = setLessonReviewed(emptyStudyState(), 7, true);
  state = setLessonReviewed(state, 2, true);
  state = setLessonReviewed(state, 2, true);
  assert.deepEqual(state.completed, [2, 7]);
  state = setLessonReviewed(state, 2, false);
  assert.deepEqual(state.completed, [7]);
  assert.equal(validStudyState(state, lessons), true);
});

test('invalid rating and answer inputs cannot change progress', () => {
  const state = populatedState();
  const before = structuredClone(state);
  for (const known of [null, 'true', 1]) assert.throws(() => rateStudyCard(state, allCards[0].id, known, now));
  for (const time of [-1, NaN, Infinity]) {
    assert.throws(() => rateStudyCard(state, allCards[0].id, true, time));
    assert.throws(() => recordStudyAnswer(state, allDrills[0], 0, false, time));
  }
  for (const selected of [-1, 3, 0.5, '0']) assert.throws(() => recordStudyAnswer(state, allDrills[0], selected, false, now));
  assert.throws(() => recordStudyAnswer(state, allDrills[0], 0, 'false', now));
  for (const day of [0, 8, 1.5, '1']) assert.throws(() => setLessonReviewed(state, day, true));
  assert.throws(() => setLessonReviewed(state, 1, 'true'));
  assert.deepEqual(state, before);
});
