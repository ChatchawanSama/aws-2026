import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeExplanation, buildExplanation } from './app.logic.mjs';

const bank = JSON.parse(readFileSync(new URL('./saa_c03_tutor_bank.json', import.meta.url), 'utf8'));
const genericCorrectReason = 'วิธีนี้ตอบ requirement หลักโดยตรงและไม่เพิ่มขั้นตอนที่โจทย์ไม่ได้ต้องการ';
let genericCorrectCount = 0;
let genericDistractorCount = 0;

for (const question of bank.questions) {
  const explanation = buildExplanation(question, '');
  const analysis = analyzeExplanation(question);
  const text = [explanation.title, explanation.answer, ...explanation.paragraphs].join('\n');

  assert.equal(explanation.title, 'คำตอบ', `Question ${question.id} must open with a titled answer block`);
  assert.match(explanation.answer, /ข้อที่ถูกคือ /, `Question ${question.id} must state the correct answer`);
  assert.ok(
    explanation.paragraphs[0] && explanation.paragraphs[0].length > 0,
    `Question ${question.id} must include a correct-answer explanation`,
  );
  assert.doesNotMatch(
    text,
    /จากคำถามจะเห็นได้ว่า|คำตอบที่ถูกคือ |เหมาะที่สุดเพราะ |เมื่อเทียบกับตัวเลือกอื่น|ตัวเลือกนี้เลือก “|แทน “/,
    `Question ${question.id} must not use the legacy explanation phrasing`,
  );

  if (explanation.paragraphs.some((paragraph) => paragraph.includes(genericCorrectReason))) {
    genericCorrectCount += 1;
  }
  genericDistractorCount += analysis.genericLetters.length;
  if (analysis.genericLetters.length) {
    assert.equal(
      analysis.status,
      'needs_review',
      `Question ${question.id} must flag generic distractor reasons for review`,
    );
  }
}

assert.ok(
  genericCorrectCount / bank.questions.length <= 0.1,
  `At least 90% of correct answers need concrete reasons; ${genericCorrectCount} remained generic`,
);
console.log(
  `explanation coverage tests passed (${genericCorrectCount} generic correct reasons; ${genericDistractorCount} generic distractors flagged for review)`,
);