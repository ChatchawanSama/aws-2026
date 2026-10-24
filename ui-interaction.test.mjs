import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.clear();
  const oldQuestionIds = globalThis.SAA_C03_TUTOR_BANK.questions
    .filter((question) => question.domain_key !== 'ambiguous')
    .slice(0, 33)
    .map((question) => question.id);
  localStorage.setItem(
    'saa-c03-mock-session-v1',
    JSON.stringify({
      questionIds: oldQuestionIds,
      index: 0,
      results: {},
      startedAt: Date.now(),
      deadline: Date.now() + 60_000,
      completed: false,
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.choice input');

assert.equal(
  await page.evaluate(() => localStorage.getItem('saa-c03-mock-session-v1')),
  null,
  'obsolete 33-question sessions are discarded instead of resumed',
);

assert.deepEqual(
  await page.locator('#domainSelect option').evaluateAll((options) =>
    options.map((option) => ({ value: option.value, text: option.textContent })),
  ),
  [
    { value: 'all', text: 'All official domains' },
    { value: 'secure', text: 'Domain 1 · Secure · 30%' },
    { value: 'resilient', text: 'Domain 2 · Resilient · 26%' },
    { value: 'high-performing', text: 'Domain 3 · High-Performing · 24%' },
    { value: 'cost-optimized', text: 'Domain 4 · Cost-Optimized · 20%' },
    { value: 'ambiguous', text: 'Ambiguous · Needs review (278)' },
  ],
  'domain filter follows the official exam order and separates ambiguous questions',
);

assert.deepEqual(
  await page.evaluate(() => {
    const progress = JSON.parse(localStorage.getItem('saa-c03-tutor-progress-v1'));
    return { asked: progress.asked, wrong: progress.wrong, correct: progress.correct };
  }),
  { asked: [596, 871], wrong: { 596: 1 }, correct: { 871: 1 } },
  'existing ID-keyed progress survives the taxonomy change',
);

await page.locator('#summaryButton').click();
assert.match(
  await page.locator('.ambiguous-summary').innerText(),
  /1 miss.*Ambiguous/i,
  'weak-area summary reports ambiguous misses outside official-domain totals',
);
await page.locator('#drawerClose').click();

assert.equal(await page.locator('#submitButton').isDisabled(), true, 'Submit stays disabled until an answer is selected');

await page.locator('.choice').first().click();
assert.equal(await page.locator('#submitButton').isEnabled(), true, 'Selecting an answer enables Submit');

await page.locator('#submitButton').click();
assert.equal(
  await page.locator('#nextButton').getAttribute('data-emphasis'),
  'primary',
  'Next becomes the primary action after grading',
);
assert.equal(await page.locator('.feedback-summary').isVisible(), true, 'Feedback separates the correct answer');
assert.equal(await page.locator('.feedback-reason').isVisible(), true, 'Feedback separates the direct reason');
assert.equal(
  await page.locator('.feedback-comparisons li').count(),
  3,
  'Feedback compares every incorrect option for a single-answer question',
);
assert.doesNotMatch(
  await page.locator('#feedback').innerText(),
  /วิธีนี้ตอบ requirement หลักโดยตรง/,
  'The first question uses a concrete explanation instead of the generic fallback',
);

await page.locator('#reviewButton').click();
assert.equal(await page.locator('#reviewButton').getAttribute('aria-pressed'), 'true', 'Review mode exposes its active state');
assert.equal(await page.locator('#practiceButton').getAttribute('aria-pressed'), 'false', 'Practice mode exposes its inactive state');

await page.locator('#revealButton').click();
assert.equal(await page.locator('.answer-key-table tbody tr').count(), 1019, 'Answer key formats every question as a table row');
assert.equal(await page.locator('.answer-badge').first().isVisible(), true, 'Answer key visually separates the correct answer');
await page.waitForTimeout(250);
assert.ok(
  await page.evaluate(() => document.querySelector('#drawer').getBoundingClientRect().top < window.innerHeight / 2),
  'Opening the Answer Key moves it into the visible viewport',
);
await page.locator('#drawerClose').click();

await page.locator('#mockButton').click();
assert.match(await page.locator('#sessionProgress').innerText(), /^1 \/ 65$/, 'Mock exam starts a 65-question session');
assert.match(
  await page.locator('#sessionTimer').innerText(),
  /^(?:130:00|129:\d{2})$/,
  'Mock exam starts with about 130 minutes',
);
assert.equal(await page.locator('#domainSelect').isDisabled(), true, 'Mock exam locks domain changes');
assert.equal(await page.locator('#nextButton').isDisabled(), true, 'Mock exam requires an answer before advancing');

const storedSession = await page.evaluate(() => JSON.parse(localStorage.getItem('saa-c03-mock-session-v1')));
assert.equal(storedSession.questionIds.length, 65, 'Mock session is persisted for reload recovery');
assert.equal(
  await page.evaluate(() => JSON.parse(localStorage.getItem('saa-c03-mock-history-v1')).length),
  65,
  'Mock history is persisted to avoid repeats in the next session',
);

await page.locator('.choice').first().click();
await page.locator('#submitButton').click();
assert.equal(await page.locator('#feedback').isVisible(), true, 'Mock exam explains the answer immediately');
assert.equal(await page.locator('#nextButton').isEnabled(), true, 'Mock exam allows the next question after grading');

page.once('dialog', (dialog) => dialog.accept());
await page.locator('#resetButton').click();
assert.deepEqual(
  await page.evaluate(() => JSON.parse(localStorage.getItem('saa-c03-tutor-progress-v1'))),
  { asked: [], wrong: {}, correct: {}, answers: {}, lastQuestionId: null },
  'Reset clears all tutor progress',
);
assert.equal(
  await page.evaluate(() => localStorage.getItem('saa-c03-mock-session-v1')),
  null,
  'Reset clears the active mock session',
);
assert.equal(
  await page.evaluate(() => localStorage.getItem('saa-c03-mock-history-v1')),
  null,
  'Reset clears mock question history',
);
assert.equal(await page.locator('#answeredCount').innerText(), '0', 'Reset refreshes progress stats');

await browser.close();
console.log('UI interaction tests passed');
