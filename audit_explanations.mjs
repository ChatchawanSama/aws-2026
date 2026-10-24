import { readFile, writeFile } from 'node:fs/promises';
import { analyzeExplanation } from './app.logic.mjs';

const bankUrl = new URL('./saa_c03_tutor_bank.json', import.meta.url);
const reportUrl = new URL('./explanation_review.json', import.meta.url);
const bank = JSON.parse(await readFile(bankUrl, 'utf8'));
const questions = [];

for (const question of bank.questions) {
  const analysis = analyzeExplanation(question);
  if (!analysis.identicalUncuratedLetters.length && !analysis.genericLetters.length) continue;

  const identicalCreateConfigure =
    analysis.identicalUncuratedLetters.length > 0 &&
    analysis.comparisons.every(({ reason }) =>
      reason.startsWith('ตัวเลือกนี้เพิ่มการเพิ่ม component และ configuration'),
    );

  questions.push({
    id: question.id,
    domain_key: question.domain_key,
    reason: analysis.identicalUncuratedLetters.length
      ? 'identical_distractors'
      : 'generic_fallback',
    letters: analysis.identicalUncuratedLetters.length
      ? analysis.identicalUncuratedLetters
      : analysis.genericLetters,
    category: identicalCreateConfigure ? 'create_configure' : 'other',
  });
}

questions.sort((left, right) => left.id - right.id);
const report = {
  generated_from_questions: bank.questions.length,
  needs_review_count: questions.length,
  identical_count: questions.filter(({ reason }) => reason === 'identical_distractors').length,
  generic_count: questions.filter(({ reason }) => reason === 'generic_fallback').length,
  create_configure_identical_count: questions.filter(
    ({ category }) => category === 'create_configure',
  ).length,
  questions,
};

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  `Explanation audit: ${report.needs_review_count} questions need review ` +
    `(${report.identical_count} identical; ${report.create_configure_identical_count} create/configure).`,
);
