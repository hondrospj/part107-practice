import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAttempt, finishAttempt, gradeAttempt, setAnswer } from '../core.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataFiles = ['questions.json', 'sources.json', 'figures.json'];

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpsUrl(value, label) {
  assert.ok(nonempty(value), `${label} must be a URL`);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'https:', `${label} must use HTTPS`);
  assert.ok(parsed.hostname, `${label} must include a hostname`);
}

function domainCategory(value) {
  const name = String(value).toLowerCase();
  if (/regulation/.test(name)) return 'regulations';
  if (/airspace/.test(name)) return 'airspace';
  if (/weather/.test(name)) return 'weather';
  if (/loading|performance/.test(name)) return 'loading';
  if (/operation/.test(name)) return 'operations';
  throw new Error(`Unknown ACS domain: ${value}`);
}

test('published bank contains two complete, valid, independently scorable forms', async t => {
  const paths = dataFiles.map(name => path.join(root, 'data', name));
  try {
    await Promise.all(paths.map(filename => access(filename)));
  } catch (error) {
    if (error.code === 'ENOENT') {
      t.skip('Question bank and manifests are still being prepared.');
      return;
    }
    throw error;
  }

  const [questions, sources, figures] = await Promise.all(paths.map(async filename => JSON.parse(await readFile(filename, 'utf8'))));
  assert.ok(Array.isArray(questions), 'questions.json must be an array');
  assert.equal(questions.length, 130);
  assert.equal(new Set(questions.map(q => q.id)).size, 130, 'question IDs must be unique');
  assert.equal(new Set(questions.map(q => q.prompt.trim().replace(/\s+/g, ' '))).size, 130, 'forms must not repeat identical prompts');
  assert.ok(Array.isArray(sources) && sources.length > 0, 'sources manifest must not be empty');
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length, 'source IDs must be unique');
  const sourceIds = new Set(sources.map(source => source.id));
  for (const source of sources) {
    assert.ok(nonempty(source.id));
    assert.ok(nonempty(source.title), `${source.id}: missing source title`);
    httpsUrl(source.url, `${source.id}: source`);
    assert.match(source.verified, /^\d{4}-\d{2}-\d{2}$/, `${source.id}: missing verification date`);
  }

  assert.ok(Array.isArray(figures) && figures.length > 0, 'figures manifest must not be empty');
  assert.equal(new Set(figures.map(figure => figure.id)).size, figures.length, 'figure IDs must be unique');
  const figureIds = new Set(figures.map(figure => figure.id));
  for (const figure of figures) {
    assert.ok(nonempty(figure.id));
    assert.ok(nonempty(figure.title), `${figure.id}: missing title`);
    assert.ok(nonempty(figure.caption), `${figure.id}: missing caption`);
    assert.ok(sourceIds.has(figure.sourceId), `${figure.id}: unknown figure source`);
    httpsUrl(figure.fullUrl, `${figure.id}: full figure source`);
    assert.ok(nonempty(figure.src), `${figure.id}: missing local image path`);
    assert.ok(!path.isAbsolute(figure.src), `${figure.id}: image path must be relative`);
    const localPath = path.resolve(root, figure.src);
    assert.ok(localPath.startsWith(`${root}${path.sep}`), `${figure.id}: image must stay inside the project`);
    const image = await readFile(localPath);
    assert.ok(image.length > 1024, `${figure.id}: image file is empty or implausibly small`);
    if (/\.png$/i.test(localPath)) {
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${figure.id}: invalid PNG signature`);
    }
  }

  for (const q of questions) {
    assert.ok(nonempty(q.id));
    assert.ok(['a', 'b'].includes(q.form), `${q.id}: invalid form`);
    assert.equal(typeof q.scored, 'boolean', `${q.id}: scored flag must be explicit`);
    assert.ok(nonempty(q.domain), `${q.id}: missing domain`);
    assert.ok(nonempty(q.topic), `${q.id}: missing topic`);
    assert.ok(nonempty(q.prompt), `${q.id}: missing prompt`);
    assert.ok(Array.isArray(q.choices) && q.choices.length === 3, `${q.id}: exactly three choices required`);
    assert.ok(q.choices.every(nonempty), `${q.id}: choices must contain text`);
    assert.equal(new Set(q.choices.map(choice => choice.trim().toLowerCase())).size, 3, `${q.id}: duplicate choices`);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 3, `${q.id}: invalid correct-answer index`);
    assert.ok(nonempty(q.explanation), `${q.id}: missing explanation`);
    assert.ok(Array.isArray(q.sourceIds) && q.sourceIds.length > 0, `${q.id}: missing sources`);
    assert.equal(new Set(q.sourceIds).size, q.sourceIds.length, `${q.id}: duplicate source IDs`);
    assert.ok(q.sourceIds.every(id => sourceIds.has(id)), `${q.id}: unknown source ID`);
    if (q.figureId !== undefined && q.figureId !== null) {
      assert.ok(figureIds.has(q.figureId), `${q.id}: unknown figure ID`);
    }
  }

  for (const form of ['a', 'b']) {
    const formBank = questions.filter(q => q.form === form);
    assert.equal(formBank.length, 65, `form ${form}: 65 questions required`);
    assert.equal(formBank.filter(q => q.scored).length, 60, `form ${form}: exactly 60 scored required`);
    assert.equal(formBank.filter(q => !q.scored).length, 5, `form ${form}: exactly five unscored required`);
    const weights = {};
    for (const q of formBank.filter(q => q.scored)) {
      const category = domainCategory(q.domain);
      weights[category] = (weights[category] || 0) + 1;
    }
    assert.deepEqual(weights, { regulations: 29, airspace: 12, weather: 3, loading: 1, operations: 15 }, `form ${form}: wrong scored domain weights`);

    const now = Date.UTC(2026, 9, 19, 15);
    let attempt = createAttempt(questions, form, now, 107);
    for (const q of formBank) attempt = setAnswer(attempt, q.id, q.answer, now + 1000);
    const grade = gradeAttempt(questions, finishAttempt(attempt, now + 2000));
    assert.equal(grade.correct, 60);
    assert.equal(grade.extraCorrect, 5);
    assert.equal(grade.percent, 100);
    assert.equal(grade.passed, true);
  }
});
