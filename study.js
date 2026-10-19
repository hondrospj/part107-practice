import { shuffle } from './core.js';
import { emptyStudyState, validStudyState, rateStudyCard, recordStudyAnswer, cardsDue, needsReview, setLessonReviewed } from './study-core.js';

const $ = s => document.querySelector(s);
const KEY = 'part107-study-v1';
let guide, lessons = [], refs = new Map(), figures = new Map(), allCards = [], allQuestions = [];
let state = emptyStudyState(), selectedDay = 1, mode = 'read', noticeTimer, storageWarning = false;
let deck = [], cardPosition = 0, cardRevealed = false, dueMode = false, repeatedCards = new Set();
let practice = null;

function el(tag, value, className) {
  const n = document.createElement(tag);
  if (value !== undefined) n.textContent = value;
  if (className) n.className = className;
  return n;
}
function button(label, action, className = 'outline') {
  const n = el('button', label, className); n.type = 'button'; n.addEventListener('click', action); return n;
}
function notice(message) {
  clearTimeout(noticeTimer); $('#studyNotice').textContent = message; $('#studyNotice').hidden = false;
  noticeTimer = setTimeout(() => { $('#studyNotice').hidden = true; }, 6500);
}
function loadState() {
  if (storageWarning) return state;
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return validStudyState(value, lessons) ? value : emptyStudyState();
  } catch { return state; }
}
function updateState(transform) {
  state = transform(loadState());
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { if (!storageWarning) { storageWarning = true; notice('Progress cannot be saved in this browser. Keep this tab open.'); } }
  renderProgress();
}
function referenceLinks(ids = [], sections = []) {
  const host = el('div', undefined, 'source-links');
  for (const id of [...new Set(ids)]) {
    const s = refs.get(id); if (!s) continue;
    const a = el('a', `${s.title} ↗`); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; host.append(a);
  }
  if (sections.length) host.append(el('span', `Reference: ${sections.join('; ')}`, 'source-sections'));
  return host;
}
function showFigure(f) {
  $('#figureTitle').textContent = f.title; $('#largeFigure').src = f.src;
  $('#largeFigure').alt = f.caption; $('#largeFigure').style.width = '100%';
  $('#figureZoom').value = '100'; $('#figureCaption').textContent = f.caption;
  $('#figureFullLink').href = f.src; $('#figureDialog').showModal();
}
function figure(id, note) {
  const f = figures.get(id); if (!f) throw new Error(`Missing chart: ${id}`);
  const host = el('figure', undefined, 'question-figure');
  const img = el('img'); img.src = f.src; img.alt = f.caption; img.loading = 'lazy';
  const actions = el('div', undefined, 'figure-actions');
  actions.append(el('span', f.title, 'figure-title'), button('Enlarge chart ↗', () => showFigure(f), 'text-button'));
  host.append(img, actions, el('figcaption', note ? `${note} ${f.caption}` : f.caption)); return host;
}
function currentLesson() { return lessons.find(d => d.day === selectedDay); }
function renderProgress() {
  $('#lessonProgress').textContent = `${state.completed.length} of 7 lessons reviewed`;
  $('#dueCount').textContent = cardsDue(allCards, state).length;
  $('#lessonReviewed').checked = state.completed.includes(selectedDay);
  const nav = $('#dayNav'); nav.replaceChildren();
  for (const d of lessons) {
    const a = el('a'); a.href = `#day-${d.day}`;
    if (d.day === selectedDay) a.setAttribute('aria-current', 'step');
    const done = state.completed.includes(d.day); a.classList.toggle('reviewed', done);
    a.append(el('small', `DAY ${d.day}${done ? ' · reviewed' : ' · 60 MIN'}`), el('strong', d.shortTitle || d.title)); nav.append(a);
  }
}
function openDay(day, focus = false) {
  if (!lessons.length) return;
  if (!lessons.some(d => d.day === day)) day = 1;
  selectedDay = day; practice = null;
  $('#mistakesPanel').hidden = true; $('#lessonPanel').hidden = false;
  const d = currentLesson();
  $('#lessonDay').textContent = `DAY ${day} · 60 MINUTES`;
  $('#lessonTitle').textContent = d.title; $('#lessonFocus').textContent = d.focus;
  const schedule = $('#lessonSchedule'); schedule.replaceChildren();
  for (const s of d.schedule) {
    const article = el('article'); article.append(el('strong', `${s.minutes} min · ${s.label}`), el('span', s.task)); schedule.append(article);
  }
  $('#lessonObjectives').replaceChildren(...d.objectives.map(t => el('li', t)));
  const content = $('#lessonContent'); content.replaceChildren();
  for (const section of d.sections) {
    const article = el('article', undefined, 'concept'); article.id = section.id;
    article.append(el('h3', section.title));
    for (const p of section.paragraphs || []) article.append(el('p', p));
    if (section.points?.length) { const list = el('ul'); list.append(...section.points.map(p => el('li', p))); article.append(list); }
    if (section.table) {
      const wrap = el('div', undefined, 'table-scroll'), table = el('table', undefined, 'study-table');
      const head = el('thead'), tr = el('tr');
      for (const t of section.table.headers) { const th = el('th', t); th.scope = 'col'; tr.append(th); } head.append(tr);
      const body = el('tbody');
      for (const row of section.table.rows) { const r = el('tr'); r.append(...row.map(c => el('td', c))); body.append(r); }
      table.append(head, body); wrap.append(table); article.append(wrap);
    }
    if (section.figureId) article.append(figure(section.figureId, section.figureNote));
    if (section.worked) {
      const w = section.worked, box = el('div', undefined, 'worked-example');
      box.append(el('p', 'TRY IT FIRST'), el('h4', w.prompt));
      const detail = el('details'), summary = el('summary', 'Show the worked answer'), answer = el('div');
      if (w.steps?.length) { const list = el('ol'); list.append(...w.steps.map(t => el('li', t))); answer.append(list); }
      answer.append(el('p', w.answer, 'answer'));
      if (w.trap) answer.append(el('p', w.trap, 'trap'));
      detail.append(summary, answer); box.append(detail); article.append(box);
    }
    article.append(referenceLinks(section.sourceIds, section.sourceSections)); content.append(article);
  }
  setMode('read'); renderProgress();
  if (focus) { $('#lessonTitle').focus({ preventScroll: true }); $('#lessonPanel').scrollIntoView({ behavior: 'instant', block: 'start' }); }
}
function setMode(next) {
  if (!lessons.length) return;
  mode = next;
  for (const key of ['read', 'cards', 'practice']) {
    $(`#${key}Panel`).hidden = key !== next;
    $(`#${key}Tab`).setAttribute('aria-selected', String(key === next));
    $(`#${key}Tab`).tabIndex = key === next ? 0 : -1;
  }
  $('#lessonPanel').hidden = false; $('#mistakesPanel').hidden = true;
  if (next === 'cards') startCards(false);
  if (next === 'practice') renderPracticeStart();
}
function startCards(due = false) {
  dueMode = due; deck = due ? cardsDue(allCards, state) : [...currentLesson().cards];
  cardPosition = 0; cardRevealed = false; repeatedCards = new Set();
  renderCard();
}
function renderCard() {
  const host = $('#cardHost'); host.replaceChildren();
  const c = deck[cardPosition];
  if (!c) {
    const box = el('div', undefined, 'study-empty');
    const title = el('h3', deck.length ? 'Card session finished.' : 'No cards are due yet.'); title.id = 'recallPrompt'; title.tabIndex = -1;
    box.append(title,
      el('p', deck.length ? 'Self-ratings organize your next review. Practice questions check whether you can apply the rule.' : 'Start with today’s cards. Once you rate them, the review schedule begins.'));
    box.append(button('Practice this lesson →', () => setMode('practice'), 'primary'), button('Review lesson cards', () => startCards(false)));
    host.append(box); return;
  }
  const meta = el('div', undefined, 'recall-meta');
  meta.append(el('span', `${dueMode ? 'DUE REVIEW' : 'LESSON CARDS'} · ${cardPosition + 1} OF ${deck.length}`), el('span', 'Say the answer before turning the card.'));
  const card = el('div', undefined, 'recall-card'), title = el('h3', c.front); title.id = 'recallPrompt'; title.tabIndex = -1; card.append(title);
  if (!cardRevealed) card.append(button('Show answer', () => { cardRevealed = true; renderCard(); $('#recallAnswer').focus({ preventScroll: true }); }, 'primary'));
  else {
    const back = el('div', undefined, 'card-back'); back.id = 'recallAnswer'; back.tabIndex = -1; back.append(el('p', c.back), referenceLinks(c.sourceIds));
    const ratings = el('div', undefined, 'card-rating');
    const rate = known => {
      updateState(s => rateStudyCard(s, c.id, known));
      if (!known && !repeatedCards.has(c.id)) { repeatedCards.add(c.id); deck.push(c); }
      cardPosition++; cardRevealed = false; renderCard(); $('#recallPrompt').focus({ preventScroll: true });
    };
    ratings.append(button('Need practice', () => rate(false)), button('Got it', () => rate(true), 'primary'));
    back.append(ratings, el('p', 'These ratings are your own recall check, not an exam score.', 'rating-note')); card.append(back);
  }
  host.append(meta, card);
}
function renderPracticeStart() {
  const d = currentLesson(), host = $('#practiceHost'); host.replaceChildren();
  const box = el('div', undefined, 'study-empty');
  box.append(el('h3', d.day === 7 ? 'Mixed checkpoint' : 'Apply the lesson.'),
    el('p', `${d.drills.length} questions. ${d.day === 7 ? 'Answers and explanations appear after all twenty questions.' : 'Explanations appear after each answer.'} Work without notes. Mark “I’m guessing” whenever you are unsure, even if your answer turns out correct.`),
    button('Start practice →', () => startPractice(d.drills), 'primary'));
  if (d.day === 7) box.append(el('p', 'Finish this checkpoint in one session. Leaving or refreshing before completion clears its unfinished answers. Use a fresh two-hour exam afterward to assess readiness.', 'checkpoint-note'));
  host.append(box);
}
function startPractice(questions) {
  const shuffled = shuffle(questions, Math.random);
  practice = { questions: shuffled, orders: Object.fromEntries(shuffled.map(q => [q.id, shuffle([0, 1, 2], Math.random)])), index: 0, selected: null, checked: false, guessed: false, answers: {}, delayed: selectedDay === 7 && questions.length === 20, saved: false };
  renderPractice();
}
function nextPracticeQuestion() {
  practice.index++; practice.selected = null; practice.checked = false; practice.guessed = false; renderPractice();
  $('#studyQuestionPrompt')?.focus({ preventScroll: true });
}
function renderPractice() {
  const host = $('#practiceHost'); host.replaceChildren();
  const q = practice.questions[practice.index];
  if (!q) { renderPracticeResult(); return; }
  const box = el('div', undefined, 'drill');
  const meta = el('div', undefined, 'drill-meta'); meta.append(el('span', `QUESTION ${practice.index + 1} OF ${practice.questions.length}`), el('span', practice.delayed ? 'Original practice · feedback at the end' : 'Original practice · feedback after checking'));
  const title = el('h3', q.prompt); title.tabIndex = -1; title.id = 'studyQuestionPrompt';
  box.append(meta, title); if (q.figureId) box.append(figure(q.figureId));
  const group = el('div'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Choose one answer');
  practice.orders[q.id].forEach((original, index) => {
    const choice = button('', () => { practice.selected = original; renderPractice(); $(`#choice-${index}`).focus({ preventScroll: true }); }, 'choice'); choice.id = `choice-${index}`;
    choice.setAttribute('aria-pressed', String(practice.selected === original));
    choice.append(el('span', String.fromCharCode(65 + index), 'choice-letter'), el('span', q.choices[original], 'choice-text'));
    choice.disabled = practice.checked;
    choice.classList.toggle('right-choice', practice.checked && original === q.answer);
    choice.classList.toggle('wrong-choice', practice.checked && practice.selected === original && original !== q.answer);
    group.append(choice);
  });
  box.append(group);
  const guess = el('label', undefined, 'guess-toggle'), input = el('input'); input.type = 'checkbox'; input.checked = practice.guessed; input.disabled = practice.checked;
  input.addEventListener('change', () => { practice.guessed = input.checked; }); guess.append(input, el('span', 'I’m guessing')); box.append(guess);
  const actions = el('div', undefined, 'drill-actions');
  if (!practice.checked) {
    const check = button(practice.delayed ? (practice.index === practice.questions.length - 1 ? 'Finish checkpoint →' : 'Answer & next →') : 'Check answer', () => {
      if (practice.selected === null) return;
      practice.answers[q.id] = { selected: practice.selected, correct: practice.selected === q.answer, guessed: practice.guessed };
      if (practice.delayed) { nextPracticeQuestion(); return; }
      updateState(s => recordStudyAnswer(s, q, practice.selected, practice.guessed));
      practice.checked = true; renderPractice(); $('#practiceFeedback').focus();
    }, 'primary'); check.disabled = practice.selected === null; actions.append(check);
  } else {
    const r = practice.answers[q.id], feedback = el('div', undefined, `drill-feedback${r.correct ? '' : ' incorrect'}`);
    feedback.id = 'practiceFeedback'; feedback.tabIndex = -1;
    feedback.append(el('h4', r.correct ? (r.guessed ? 'Correct guess — keep reviewing this.' : 'Correct.') : 'Review this rule.'),
      el('p', `Correct answer: ${q.choices[q.answer]}`), el('p', q.explanation), referenceLinks(q.sourceIds));
    box.append(feedback);
    actions.append(button(practice.index === practice.questions.length - 1 ? 'See practice results →' : 'Next question →', nextPracticeQuestion, 'primary'));
  }
  box.append(actions); host.append(box);
}
function renderPracticeResult() {
  if (practice.delayed && !practice.saved) {
    updateState(s => practice.questions.reduce((next, q) => {
      const r = practice.answers[q.id];
      return recordStudyAnswer(next, q, r.selected, r.guessed);
    }, s));
    practice.saved = true;
  }
  const records = Object.values(practice.answers), correct = records.filter(r => r.correct).length, guesses = records.filter(r => r.guessed).length;
  const box = el('div', undefined, 'study-empty');
  box.append(el('h3', `${correct} of ${records.length} correct`), el('p', `${guesses} answer${guesses === 1 ? ' was' : 's were'} marked as guesses. Mistakes and guesses stay in your review list. This lesson score is not a full-exam readiness score.`),
    button('Review mistakes & guesses', showMistakes, 'primary'), button('Try lesson again', () => startPractice(currentLesson().drills)));
  if (selectedDay < 7) { const a = el('a', 'Next lesson →', 'outline'); a.href = `#day-${selectedDay + 1}`; box.append(a); }
  else { const a = el('a', 'Take a full practice exam →', 'outline'); a.href = './'; box.append(a); }
  if (practice.delayed) {
    box.append(el('h3', 'Checkpoint answer review'));
    practice.questions.forEach((q, index) => {
      const r = practice.answers[q.id], detail = el('details', undefined, 'review-row');
      detail.append(el('summary', `${index + 1}. ${r.correct ? 'Correct' : 'Incorrect'}${r.guessed ? ' · guessed' : ''} — ${q.prompt}`),
        el('p', `Your answer: ${q.choices[r.selected]}`), el('p', `Correct answer: ${q.choices[q.answer]}`), el('p', q.explanation));
      if (q.figureId) detail.append(figure(q.figureId));
      detail.append(referenceLinks(q.sourceIds)); box.append(detail);
    });
  }
  $('#practiceHost').replaceChildren(box);
}
function showMistakes() {
  $('#lessonPanel').hidden = true; $('#mistakesPanel').hidden = false;
  const host = $('#mistakesList'); host.replaceChildren();
  const questions = allQuestions.filter(q => needsReview(state.drills[q.id]));
  if (!questions.length) host.append(el('p', 'No practice mistakes or guesses recorded yet. Complete a lesson quiz to check your understanding.', 'study-empty'));
  for (const q of questions) {
    const r = state.drills[q.id], row = el('article', undefined, 'review-row');
    const tag = r.correct ? 'Correct but guessed' : r.guessed ? 'Incorrect · guessed' : 'Incorrect · not marked as a guess';
    row.append(el('span', tag, 'review-tag'), el('h3', q.prompt), el('p', `Your answer: ${q.choices[r.selected]}`), el('p', `Correct rule: ${q.choices[q.answer]} ${q.explanation}`, 'correct-rule'));
    if (q.figureId) row.append(figure(q.figureId)); row.append(referenceLinks(q.sourceIds));
    const retry = button('Try this question again', () => {
      const owner = lessons.find(d => d.drills.some(item => item.id === q.id));
      openDay(owner.day);
      history.replaceState(null, '', `#day-${owner.day}`);
      for (const key of ['read', 'cards', 'practice']) { $(`#${key}Panel`).hidden = key !== 'practice'; $(`#${key}Tab`).setAttribute('aria-selected', String(key === 'practice')); $(`#${key}Tab`).tabIndex = key === 'practice' ? 0 : -1; }
      mode = 'practice'; startPractice([q]);
    }); row.append(retry); host.append(row);
  }
  $('#mistakesTitle').focus({ preventScroll: true }); $('#mistakesPanel').scrollIntoView({ behavior: 'instant', block: 'start' });
}

$('#readTab').addEventListener('click', () => setMode('read'));
$('.study-actions a').addEventListener('click', () => { if (location.hash === '#day-1') openDay(1, true); });
$('#cardsTab').addEventListener('click', () => setMode('cards'));
$('#practiceTab').addEventListener('click', () => setMode('practice'));
$('.study-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const keys = ['read', 'cards', 'practice'];
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (keys.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
  setMode(keys[index]); $(`#${keys[index]}Tab`).focus();
});
$('#readToCards').addEventListener('click', () => { setMode('cards'); $('#cardsTab').focus(); });
$('#lessonReviewed').addEventListener('change', event => updateState(s => setLessonReviewed(s, selectedDay, event.target.checked)));
$('#reviewDue').addEventListener('click', () => { setMode('cards'); startCards(true); $('#cardsTab').focus(); $('#lessonPanel').scrollIntoView({ block: 'start' }); });
$('#mistakesButton').addEventListener('click', showMistakes);
$('#backToLesson').addEventListener('click', () => { $('#mistakesPanel').hidden = true; $('#lessonPanel').hidden = false; });
$('#closeFigure').addEventListener('click', () => $('#figureDialog').close());
$('#figureZoom').addEventListener('input', e => { $('#largeFigure').style.width = `${e.target.value}%`; });
window.addEventListener('hashchange', () => openDay(Number(location.hash.match(/^#day-([1-7])$/)?.[1]) || 1, true));
window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) { state = loadState(); renderProgress(); if (!$('#mistakesPanel').hidden) showMistakes(); } });
window.addEventListener('focus', () => { if (lessons.length) { state = loadState(); renderProgress(); } });

async function load() {
  try {
    const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`Could not load ${url}`); return r.json(); };
    const [content, sources, images] = await Promise.all(['data/study.json', 'data/sources.json', 'data/figures.json'].map(get));
    guide = content; lessons = guide.lessons; refs = new Map(sources.map(s => [s.id, s])); figures = new Map(images.map(f => [f.id, f]));
    if (!Array.isArray(lessons) || lessons.length !== 7 || lessons.some(d => d.schedule.reduce((a, s) => a + s.minutes, 0) !== 60)) throw new Error('Incomplete study plan.');
    for (const lesson of lessons) for (const item of [...lesson.sections, ...lesson.cards, ...lesson.drills]) {
      if (!item.sourceIds?.length || item.sourceIds.some(id => !refs.has(id)) || item.figureId && !figures.has(item.figureId)) throw new Error('A study reference is missing.');
    }
    allCards = lessons.flatMap(d => d.cards); allQuestions = lessons.flatMap(d => d.drills);
    state = loadState(); $('#studyLoading').hidden = true; $('#studyApp').hidden = false;
    $('#reviewDue').disabled = false; $('#mistakesButton').disabled = false;
    openDay(Number(location.hash.match(/^#day-([1-7])$/)?.[1]) || 1);
  } catch (error) {
    $('#studyLoading').textContent = 'The study guide could not load. Refresh, or use the PDF download.'; console.error(error);
  }
}
load();
