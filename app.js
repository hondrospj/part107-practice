import { BANK_VERSION, createAttempt, validateAttempt, remainingMs, setAnswer, toggleFlag, finishAttempt, gradeAttempt, formatDuration } from './core.js';

const $ = selector => document.querySelector(selector);
const CURRENT_KEY = 'part107-practice-current-v1';
const HISTORY_KEY = 'part107-practice-history-v1';
const DOMAIN_ORDER = ['Regulations', 'Airspace', 'Weather', 'Loading and performance', 'Operations'];
let bank = [], sources = new Map(), figures = new Map(), byId = new Map();
let attempt = null, history = [], page = 'home', pendingForm = 'a', noticeTimer, saveWarning = false;
let lastMilestone = Infinity;
let storedSnapshot = null;

function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
function safeLink(title, href) {
  const node = text('a', title);
  const url = new URL(href, document.baseURI);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid source link.');
  node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer';
  return node;
}
function notice(message) {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message; $('#notice').hidden = false;
  noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 6500);
}
function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function syncStoredState() {
  if (!bank.length) return false;
  let raw;
  try { raw = localStorage.getItem(CURRENT_KEY); } catch { return false; }
  if (raw === storedSnapshot) return false;
  storedSnapshot = raw;
  const latest = readStored(CURRENT_KEY, null), past = readStored(HISTORY_KEY, []);
  history = Array.isArray(past) ? past.filter(a => validateAttempt(a, bank) && a.finishedAt !== null).slice(-12) : [];
  if (latest !== null && !validateAttempt(latest, bank)) return false;
  attempt = latest;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  if (attempt && attempt.finishedAt !== null) renderResults();
  else if (attempt && page === 'exam') renderExam();
  else renderHome(false);
  notice('Progress updated from your other tab.');
  return true;
}
function save() {
  try {
    storedSnapshot = JSON.stringify(attempt);
    localStorage.setItem(CURRENT_KEY, storedSnapshot);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-12)));
  } catch {
    if (!saveWarning) { notice('Progress cannot be saved in this browser. Keep this tab open.'); saveWarning = true; }
  }
}
function setPage(name, focus = false) {
  page = name;
  for (const id of ['home', 'exam', 'results']) $(`#${id}`).hidden = id !== name;
  $('#loading').hidden = true;
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
function getResultHistory(form) {
  return history.filter(a => a.form === form && a.finishedAt !== null);
}
function renderHome(focus = true) {
  setPage('home', focus);
  for (const form of ['a', 'b']) {
    const past = getResultHistory(form), label = $(`#form${form.toUpperCase()}Status`);
    label.textContent = past.length ? `${past.length} completed · best ${Math.max(...past.map(a => gradeAttempt(bank, a).percent)).toFixed(0)}%` : 'Fresh exam';
  }
  const card = $('#resumeCard'); card.replaceChildren(); card.hidden = !attempt;
  if (attempt) {
    const copy = document.createElement('div');
    copy.append(text('strong', attempt.finishedAt === null ? `Exam ${attempt.form.toUpperCase()} in progress` : `Last result · Exam ${attempt.form.toUpperCase()}`));
    copy.append(text('p', attempt.finishedAt === null ? `${Object.keys(attempt.answers).length} of 65 answered · the timer is still running` : `${gradeAttempt(bank, attempt).percent.toFixed(1)}% · ${gradeAttempt(bank, attempt).correct} of 60 scored questions correct`));
    const button = text('button', attempt.finishedAt === null ? 'Resume exam →' : 'View results →', 'primary');
    button.addEventListener('click', () => attempt.finishedAt === null ? renderExam(true) : renderResults(true));
    card.append(copy, button);
  }
}
function openStart(form) {
  pendingForm = form;
  $('#startTitle').textContent = `Start Exam ${form.toUpperCase()}`;
  $('#replaceWarning').hidden = !attempt || attempt.finishedAt !== null;
  $('#startDialog').showModal();
}
function begin() {
  if (syncStoredState()) return;
  let seed = Date.now() >>> 0;
  if (window.crypto?.getRandomValues) seed = crypto.getRandomValues(new Uint32Array(1))[0];
  attempt = createAttempt(bank, pendingForm, Date.now(), seed);
  lastMilestone = Infinity; save(); $('#startDialog').close();
  $('#questionNavigator').open = window.innerWidth > 760;
  renderExam(true);
}
function updateProgress() {
  const answered = Object.keys(attempt.answers).length;
  $('#answeredCount').textContent = `${answered} of 65 answered`;
  $('#flaggedCount').textContent = `${attempt.flags.length} flagged`;
  $('#navigatorCount').textContent = `${answered}/65`;
  $('#progressFill').style.width = `${answered / 65 * 100}%`;
  const grid = $('#questionGrid'); grid.replaceChildren();
  attempt.questionIds.forEach((id, index) => {
    const answered = Number.isInteger(attempt.answers[id]), flagged = attempt.flags.includes(id);
    const button = text('button', String(index + 1));
    button.classList.toggle('answered', answered); button.classList.toggle('flagged', flagged);
    if (index === attempt.position) button.setAttribute('aria-current', 'true');
    button.setAttribute('aria-label', `Question ${index + 1}${answered ? ', answered' : ', unanswered'}${flagged ? ', flagged' : ''}`);
    button.addEventListener('click', () => goTo(index)); grid.append(button);
  });
}
function renderFigure(figureId) {
  const fig = figures.get(figureId);
  if (!fig) throw new Error('A required chart is missing.');
  const box = document.createElement('figure'); box.className = 'question-figure';
  const img = document.createElement('img'); img.src = fig.src; img.alt = fig.caption || fig.title; img.loading = 'lazy';
  const actions = document.createElement('div'); actions.className = 'figure-actions';
  actions.append(text('span', fig.title, 'figure-title'));
  const zoom = text('button', 'Enlarge chart ↗'); zoom.type = 'button';
  zoom.addEventListener('click', () => showFigure(fig)); actions.append(zoom);
  box.append(img, actions, text('figcaption', fig.caption));
  return box;
}
function showFigure(fig) {
  $('#figureTitle').textContent = fig.title;
  $('#largeFigure').src = fig.src; $('#largeFigure').alt = fig.caption || fig.title;
  $('#figureZoom').value = '100'; $('#largeFigure').style.width = '100%';
  $('#figureCaption').textContent = fig.caption;
  $('#figureFullLink').href = fig.src;
  $('#figureDialog').showModal();
}
function renderExam(focus = false) {
  if (!attempt || attempt.finishedAt !== null) return;
  if (remainingMs(attempt) === 0) { submit('time'); return; }
  setPage('exam', focus);
  const id = attempt.questionIds[attempt.position], q = byId.get(id);
  $('#examName').textContent = `EXAM ${attempt.form.toUpperCase()}`;
  $('#questionNumber').textContent = `QUESTION ${attempt.position + 1} OF 65`;
  $('#questionPrompt').textContent = q.prompt;
  const flag = $('#flagQuestion'), flagged = attempt.flags.includes(id);
  flag.setAttribute('aria-pressed', String(flagged)); flag.textContent = flagged ? '⚑ Flagged' : '⚑ Flag';
  const figure = $('#questionFigure'); figure.replaceChildren(); figure.hidden = !q.figureId;
  if (q.figureId) figure.append(renderFigure(q.figureId));
  const choices = $('#choiceList'); choices.replaceChildren();
  attempt.choiceOrder[id].forEach((originalIndex, displayedIndex) => {
    const label = document.createElement('label'); label.className = 'choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = `answer-${id}`; input.value = String(originalIndex);
    input.checked = attempt.answers[id] === originalIndex;
    input.addEventListener('change', () => {
      if (syncStoredState()) return;
      if (remainingMs(attempt) === 0) { submit('time'); return; }
      attempt = setAnswer(attempt, id, originalIndex); save(); updateProgress();
      $('#clearAnswer').disabled = false;
    });
    label.append(input, text('span', String.fromCharCode(65 + displayedIndex), 'choice-letter'), text('span', q.choices[originalIndex], 'choice-text'));
    choices.append(label);
  });
  $('#clearAnswer').disabled = !Number.isInteger(attempt.answers[id]);
  $('#previousQuestion').disabled = attempt.position === 0;
  $('#nextQuestion').textContent = attempt.position === 64 ? 'Finish exam →' : 'Next →';
  updateProgress(); tick();
  if (focus) $('#questionPrompt').focus({ preventScroll: true });
}
function goTo(position) {
  if (syncStoredState()) return;
  if (!attempt || attempt.finishedAt !== null || position < 0 || position >= 65) return;
  attempt = { ...attempt, position }; save(); renderExam(true);
}
function requestFinish() {
  if (!attempt || attempt.finishedAt !== null) return;
  const unanswered = 65 - Object.keys(attempt.answers).length;
  $('#finishSummary').textContent = unanswered ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered. Unanswered scored questions count as incorrect.` : 'All 65 questions are answered.';
  $('#finishDialog').showModal();
}
function submit(reason = 'submitted') {
  if (syncStoredState()) return;
  if (!attempt || attempt.finishedAt !== null) return;
  attempt = finishAttempt(attempt, Date.now(), reason);
  history = [...history.filter(a => a.id !== attempt.id), attempt].slice(-12);
  save();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('#reviewFilter').value = 'missed'; renderResults(true);
}
function tick() {
  if (!attempt || attempt.finishedAt !== null) return;
  const left = remainingMs(attempt);
  $('#timer').textContent = formatDuration(left); $('#timer').classList.toggle('low', left <= 600000);
  if (left === 0) { submit('time'); return; }
  const milestone = left <= 60000 ? 1 : left <= 600000 ? 10 : Infinity;
  if (milestone < lastMilestone) { $('#timerAnnouncement').textContent = `${milestone} minute${milestone === 1 ? '' : 's'} remaining.`; lastMilestone = milestone; }
}
function renderResults(focus = false) {
  if (!attempt || attempt.finishedAt === null) return;
  const result = gradeAttempt(bank, attempt), percent = result.percent.toFixed(1);
  setPage('results', focus);
  $('#resultExam').textContent = `EXAM ${attempt.form.toUpperCase()} · ${attempt.reason === 'time' ? 'TIME EXPIRED' : 'COMPLETE'}`;
  $('#scorePercent').replaceChildren(document.createTextNode(percent), text('span', '%'));
  $('#scoreStatus').textContent = result.passed ? 'Practice pass' : 'Below passing score';
  $('#scoreStatus').classList.toggle('fail', !result.passed);
  $('#scoreFraction').textContent = `${result.correct} of 60 scored questions correct · 42 needed to pass`;
  const repeats = getResultHistory(attempt.form).filter(a => a.startedAt < attempt.startedAt).length;
  $('#scoreAdvice').textContent = result.percent >= 85 ? 'A useful study buffer. Review the misses, then check yourself with a fresh exam.' : result.passed ? 'You reached 70%. Review the missed topics and aim for a stronger score on a fresh exam before booking.' : 'Review the explanations below, study the weaker topics, then take the other exam.';
  $('#timeUsed').textContent = `${formatDuration(result.elapsedMs)} used`;
  $('#extraScore').textContent = `${result.extraCorrect}/5 unscored practice questions correct`;
  $('#attemptContext').textContent = repeats ? `Repeat attempt on this form (${repeats + 1})` : 'First recorded attempt on this form';
  const topicHost = $('#topicScores'); topicHost.replaceChildren();
  const orderedDomains = [...DOMAIN_ORDER.filter(d => result.topics[d]), ...Object.keys(result.topics).filter(d => !DOMAIN_ORDER.includes(d))];
  for (const domain of orderedDomains) {
    const t = result.topics[domain], card = document.createElement('article'); card.className = 'topic-card';
    card.classList.toggle('weak', t.correct / t.total < .7);
    const fraction = document.createElement('strong'); fraction.append(String(t.correct), text('span', ` / ${t.total}`));
    const bar = document.createElement('div'); bar.className = 'topic-bar'; const fill = document.createElement('i'); fill.style.width = `${t.correct / t.total * 100}%`; bar.append(fill);
    card.append(text('h3', domain), fraction, bar); topicHost.append(card);
  }
  renderReview(result);
  if (focus) $('#resultsTitle').focus({ preventScroll: true });
}
function renderReview(result = gradeAttempt(bank, attempt)) {
  const mode = $('#reviewFilter').value;
  const reviews = result.review.filter(r => mode === 'all' || mode === 'missed' && !r.right || mode === 'flagged' && r.flagged || mode === 'extra' && !r.scored);
  const host = $('#answerReview'); host.replaceChildren(); $('#reviewCount').textContent = `(${reviews.length})`;
  if (!reviews.length) { host.append(text('p', mode === 'missed' ? 'No missed or unanswered questions.' : 'No questions match this filter.', 'empty-state')); return; }
  for (const review of reviews) {
    const q = byId.get(review.id), detail = document.createElement('details'); detail.className = 'review-item';
    const summary = document.createElement('summary');
    summary.append(text('span', String(review.number).padStart(2, '0'), 'review-number'), text('span', q.prompt), text('span', review.right ? 'Correct' : review.answered ? 'Incorrect' : 'Unanswered', `review-symbol${review.right ? ' right' : ''}`));
    const body = document.createElement('div'); body.className = 'review-body';
    if (!review.scored) body.append(text('p', 'Unscored · does not affect your percentage', 'unscored-label'));
    const selected = document.createElement('div'); selected.className = `review-choice ${review.right ? 'correct' : 'wrong'}`;
    selected.append(text('small', 'Your answer'), text('span', review.answered ? q.choices[review.selected] : 'No answer selected')); body.append(selected);
    if (!review.right) {
      const correct = document.createElement('div'); correct.className = 'review-choice correct'; correct.append(text('small', 'Correct answer'), text('span', q.choices[q.answer])); body.append(correct);
    }
    body.append(text('p', q.explanation, 'review-explanation'));
    if (q.figureId) body.append(renderFigure(q.figureId));
    const links = document.createElement('div'); links.className = 'source-links';
    for (const id of q.sourceIds) { const s = sources.get(id); if (s) links.append(safeLink(`${s.title} ↗`, s.url)); }
    body.append(links, text('p', `${q.domain} · ${q.topic}`, 'review-topic'));
    detail.append(summary, body); host.append(detail);
  }
}
function reportText() {
  const r = gradeAttempt(bank, attempt);
  const lines = [`Part 107 Practice — Exam ${attempt.form.toUpperCase()}`, `Score: ${r.percent.toFixed(1)}% (${r.correct}/60 scored) — ${r.passed ? 'practice pass' : 'below 70%'}`, `Time: ${formatDuration(r.elapsedMs)}; unanswered: ${r.unanswered}; unscored extras: ${r.extraCorrect}/5`, $('#attemptContext').textContent, '', 'Topics:'];
  for (const [name, t] of Object.entries(r.topics)) lines.push(`${name}: ${t.correct}/${t.total}`);
  const missed = r.review.filter(v => !v.right && v.scored).map(v => byId.get(v.id).topic);
  lines.push('', `Missed topics: ${[...new Set(missed)].join('; ') || 'None'}`, `Bank: ${BANK_VERSION}; attempt: ${attempt.id}`);
  return lines.join('\n');
}
async function copyResults() {
  try { await navigator.clipboard.writeText(reportText()); notice('Results copied. Paste them into the chat for review.'); }
  catch { notice('Copy is unavailable here. Use Download results instead.'); }
}
function downloadResults() {
  const payload = { app: 'Part 107 Practice', bankVersion: BANK_VERSION, attempt, result: gradeAttempt(bank, attempt), summary: reportText() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `part107-exam-${attempt.form}-results.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => openStart(b.dataset.start)));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('#beginExam').addEventListener('click', begin);
$('#finishTop').addEventListener('click', requestFinish); $('#submitExam').addEventListener('click', () => submit());
$('#previousQuestion').addEventListener('click', () => goTo(attempt.position - 1));
$('#nextQuestion').addEventListener('click', () => attempt.position === 64 ? requestFinish() : goTo(attempt.position + 1));
$('#flagQuestion').addEventListener('click', () => { if (syncStoredState()) return; attempt = toggleFlag(attempt, attempt.questionIds[attempt.position]); save(); renderExam(); });
$('#clearAnswer').addEventListener('click', () => {
  if (syncStoredState()) return;
  if (!attempt || attempt.finishedAt !== null) return;
  if (remainingMs(attempt) === 0) { submit('time'); return; }
  const answers = { ...attempt.answers }; delete answers[attempt.questionIds[attempt.position]]; attempt = { ...attempt, answers }; save(); renderExam();
});
$('#firstUnanswered').addEventListener('click', () => {
  const later = attempt.questionIds.findIndex((id, i) => i > attempt.position && !Number.isInteger(attempt.answers[id]));
  const any = later >= 0 ? later : attempt.questionIds.findIndex(id => !Number.isInteger(attempt.answers[id]));
  if (any >= 0) goTo(any); else notice('All questions are answered.');
});
$('#homeLink').addEventListener('click', () => renderHome()); $('#backToExams').addEventListener('click', () => renderHome());
$('#basicsLink').addEventListener('click', () => { renderHome(false); $('#basics').open = true; });
$('#reviewFilter').addEventListener('change', () => renderReview());
$('#copyResults').addEventListener('click', copyResults); $('#downloadResults').addEventListener('click', downloadResults);
$('#closeFigure').addEventListener('click', () => $('#figureDialog').close());
$('#figureZoom').addEventListener('input', e => { $('#largeFigure').style.width = `${e.target.value}%`; });
document.addEventListener('visibilitychange', () => { syncStoredState(); tick(); });
window.addEventListener('focus', () => { syncStoredState(); tick(); });
window.addEventListener('storage', event => {
  if (event.key === CURRENT_KEY || event.key === null) syncStoredState();
  if (event.key === HISTORY_KEY) {
    const past = readStored(HISTORY_KEY, []);
    history = Array.isArray(past) ? past.filter(a => validateAttempt(a, bank) && a.finishedAt !== null).slice(-12) : [];
    if (page === 'home') renderHome(false);
  }
});

async function load() {
  try {
    const get = async url => { const response = await fetch(url); if (!response.ok) throw new Error('Question files are unavailable.'); return response.json(); };
    const [questions, refs, images] = await Promise.all(['data/questions.json', 'data/sources.json', 'data/figures.json'].map(get));
    bank = questions; sources = new Map(refs.map(s => [s.id, s])); figures = new Map(images.map(f => [f.id, f])); byId = new Map(bank.map(q => [q.id, q]));
    for (const form of ['a', 'b']) createAttempt(bank, form);
    if (bank.some(q => q.figureId && !figures.has(q.figureId) || !q.sourceIds.every(id => sources.has(id)))) throw new Error('A reference file is incomplete.');
    const stored = readStored(CURRENT_KEY, null), past = readStored(HISTORY_KEY, []);
    try { storedSnapshot = localStorage.getItem(CURRENT_KEY); } catch { /* Saving may be unavailable. */ }
    history = Array.isArray(past) ? past.filter(a => validateAttempt(a, bank) && a.finishedAt !== null).slice(-12) : [];
    if (stored && validateAttempt(stored, bank)) attempt = stored;
    else if (stored) notice('The saved attempt could not be restored. Start a new exam.');
    for (const source of refs) $('#sourceList').append(safeLink(`${source.title} ↗`, source.url));
    if (attempt && attempt.finishedAt === null && remainingMs(attempt) === 0) submit('time');
    else if (attempt && attempt.finishedAt === null) renderExam(true);
    else renderHome(false);
    setInterval(tick, 1000);
  } catch (error) {
    $('#loading').replaceChildren(text('div', 'The exam could not load. Refresh the page to try again.'));
    console.error(error);
  }
}
load();
