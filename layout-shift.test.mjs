import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const bank = JSON.parse(await readFile(new URL('./saa_c03_tutor_bank.json', import.meta.url), 'utf8')).questions;
const byLength = [...bank].sort((a, b) => questionLength(a) - questionLength(b));
const targetQuestions = [byLength[0], byLength[Math.floor(byLength.length / 2)], byLength.at(-1)];

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const layouts = [];
for (const question of targetQuestions) {
  const asked = bank.map((item) => item.id).filter((id) => id !== question.id);
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(
    ({ askedIds }) => {
      localStorage.setItem(
        'saa-c03-tutor-progress-v1',
        JSON.stringify({ asked: askedIds, wrong: {}, correct: {}, answers: {}, lastQuestionId: null }),
      );
    },
    { askedIds: asked },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.choice input');
  layouts.push(
    await page.evaluate(({ id, length }) => {
      const panel = document.querySelector('.quiz-panel');
      const scrollArea = document.querySelector('.question-scroll');
      const prompt = document.querySelector('#questionPrompt');
      const choices = document.querySelector('.choices');
      return {
        id,
        length,
        height: Math.round(panel.getBoundingClientRect().height),
        scrollOverflow: getComputedStyle(scrollArea).overflowY,
        scrollable: scrollArea.scrollHeight > scrollArea.clientHeight,
        promptHasNestedScroll: prompt.scrollHeight > prompt.clientHeight,
        choicesHaveNestedScroll: choices.scrollHeight > choices.clientHeight,
        actionsBottom: document.querySelector('.actions').getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
      };
    }, { id: question.id, length: questionLength(question) }),
  );
}

await browser.close();

const values = layouts.map((item) => item.height);
const maxShift = Math.max(...values) - Math.min(...values);
assert.ok(maxShift <= 80, `quiz panel shifts by ${maxShift}px across short/median/long questions: ${JSON.stringify(layouts)}`);
assert.ok(
  layouts.every((item) => item.scrollOverflow === 'auto'),
  `question content should use one predictable scroll area: ${JSON.stringify(layouts)}`,
);
assert.ok(
  layouts.every((item) => !item.promptHasNestedScroll && !item.choicesHaveNestedScroll),
  `prompt and choices should not create nested scroll areas: ${JSON.stringify(layouts)}`,
);
assert.ok(
  layouts.every((item) => item.actionsBottom <= item.viewportHeight),
  `answer actions should stay inside the first mobile viewport: ${JSON.stringify(layouts)}`,
);
console.log('layout shift test passed');

function questionLength(question) {
  return question.prompt.length + Object.values(question.choices).join('').length;
}
