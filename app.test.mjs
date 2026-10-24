import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advanceMockSession,
  analyzeExplanation,
  buildDomainOptions,
  buildExplanation,
  buildKeywordExplanations,
  createMockSession,
  gradeAnswer,
  normalizeAnswer,
  recordMockAnswer,
  selectNextQuestion,
  summarizeWeakAreas,
} from './app.logic.mjs';

assert.deepEqual(
  buildDomainOptions(
    [
      { key: 'secure', label: 'Design Secure Architectures', weight: 30 },
      { key: 'resilient', label: 'Design Resilient Architectures', weight: 26 },
      { key: 'high-performing', label: 'Design High-Performing Architectures', weight: 24 },
      { key: 'cost-optimized', label: 'Design Cost-Optimized Architectures', weight: 20 },
    ],
    [
      { domain_key: 'secure' },
      { domain_key: 'ambiguous' },
      { domain_key: 'ambiguous' },
    ],
  ),
  [
    { value: 'all', label: 'All official domains' },
    { value: 'secure', label: 'Domain 1 · Secure · 30%' },
    { value: 'resilient', label: 'Domain 2 · Resilient · 26%' },
    { value: 'high-performing', label: 'Domain 3 · High-Performing · 24%' },
    { value: 'cost-optimized', label: 'Domain 4 · Cost-Optimized · 20%' },
    { value: 'ambiguous', label: 'Ambiguous · Needs review (2)' },
  ],
  'builds an official ordered domain filter with ambiguous questions last',
);

const questions = [
  { id: 1, domain_key: 'secure', domain: 'Design Secure Architectures', question_type: 'single_select_choice', correct_answer: 'A' },
  { id: 2, domain_key: 'resilient', domain: 'Design Resilient Architectures', question_type: 'multiple_select_choice', correct_answer: 'BD' },
  { id: 3, domain_key: 'ambiguous', domain: 'Ambiguous — Needs Review', question_type: 'single_select_choice', correct_answer: 'C' },
];

assert.equal(normalizeAnswer(' b, d '), 'BD', 'normalizes multi-select answers for grading');

assert.deepEqual(
  gradeAnswer(questions[1], 'DB'),
  { isCorrect: true, normalized: 'BD', correct: 'BD' },
  'grades multi-select answers independent of letter order',
);

const next = selectNextQuestion(questions, {
  asked: [1, 3],
  wrong: { 2: 2 },
  lastQuestionId: 3,
  mode: 'review',
});
assert.equal(next.id, 2, 'review mode prioritizes missed questions and avoids immediate repeats');

const reviewQuestions = [3, 4, 13].map((id) => ({
  id,
  domain_key: 'secure',
  domain: 'Design Secure Architectures',
  question_type: 'single_select_choice',
  correct_answer: 'A',
}));
const reviewProgress = {
  wrong: { 3: 1, 4: 1, 13: 1 },
  domain: 'secure',
  mode: 'review',
};
assert.deepEqual(
  [3, 4, 13].map(
    (lastQuestionId) =>
      selectNextQuestion(reviewQuestions, { ...reviewProgress, lastQuestionId })?.id,
  ),
  [4, 13, 3],
  'review mode cycles through every equally missed question without starving higher IDs',
);

assert.equal(
  selectNextQuestion(questions, {
    wrong: { 2: 1 },
    domain: 'secure',
    mode: 'review',
  }),
  null,
  'review mode returns no question when the selected domain has no missed questions',
);

assert.equal(
  selectNextQuestion(questions, { domain: 'secure', mode: 'practice' })?.id,
  1,
  'domain filtering uses official domain keys instead of display labels',
);

const explanationText = (explanation) => [explanation.answer, ...explanation.paragraphs].join('\n');

const explanation = buildExplanation(
  {
    id: 10,
    domain: 'Database',
    correct_answer: 'A',
    choices: {
      A: 'Migrate the PostgreSQL database to Amazon Aurora Serverless v2.',
      B: 'Enable auto scaling for the PostgreSQL database on the EC2 instance.',
    },
  },
  'B',
);
assert.equal(explanation.title, 'คำตอบ', 'titles the explanation block');
assert.equal(explanation.answer, 'ข้อที่ถูกคือ A)', 'leads with the correct option letter');
assert.match(explanation.paragraphs[0], /^Aurora Serverless v2/, 'opens directly with the correct-answer reason');
assert.doesNotMatch(explanation.paragraphs[0], /จากคำถาม/, 'does not open with a boilerplate restatement phrase');
assert.match(explanation.paragraphs[1], /ตัวเลือก B ที่คุณเลือก ไม่ถูกต้อง เพราะ/, 'explains the wrong choice that was answered');
assert.doesNotMatch(explanationText(explanation), /คำตอบที่เลือก|Migrate the PostgreSQL database|Enable auto scaling/, 'does not repeat the submitted answer or full choice text');

const transferExplanation = buildExplanation(
  {
    id: 11,
    prompt:
      'A company collects data from multiple continents and wants to aggregate it as quickly as possible in a single S3 bucket. Each site has a high-speed Internet connection. The solution must use the least possible network bandwidth and minimize operational complexity.',
    correct_answer: 'A',
    choices: {
      A: 'Turn on S3 Transfer Acceleration and use multipart uploads to directly upload to the destination bucket.',
      B: 'Upload to regional buckets and use S3 Cross-Region Replication to copy to the destination bucket.',
      C: 'Schedule Snowball Edge device jobs daily to transfer the data.',
      D: 'Upload to EC2 and EBS, then copy snapshots and restore them in the destination Region.',
    },
  },
  'C',
);
const transferText = explanationText(transferExplanation);
assert.match(transferText, /S3 Transfer Acceleration/, 'names the correct service');
assert.match(transferText, /network bandwidth/, 'restates the bandwidth constraint');
assert.match(transferText, /ตัวเลือก C ที่คุณเลือก ไม่ถูกต้อง เพราะ.*high-speed Internet/, 'explains why the answered offline-transfer choice is wrong for a high-bandwidth site');
assert.doesNotMatch(transferText, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก D ที่คุณเลือก/, 'does not explain choices the user did not answer');

const athenaExplanation = buildExplanation(
  {
    id: 12,
    prompt:
      'JSON logs are stored in Amazon S3. Queries are simple and run on-demand. Use the least amount of operational overhead.',
    correct_answer: 'C',
    choices: {
      A: 'Load all content into Amazon Redshift and run SQL queries.',
      B: 'Store the logs in Amazon CloudWatch Logs and query them from the console.',
      C: 'Use Amazon Athena directly with Amazon S3.',
      D: 'Use AWS Glue and a transient Apache Spark cluster on Amazon EMR.',
    },
  },
  'A',
);
const athenaText = explanationText(athenaExplanation);
assert.match(athenaText, /Athena/, 'names the correct service');
assert.match(athenaText, /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ.*Redshift/, 'explains why the answered warehouse choice is wrong');
assert.doesNotMatch(athenaText, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก D ที่คุณเลือก/, 'does not explain choices the user did not answer');

const curatedText = explanationText(buildExplanation(
  {
    id: 1999,
    prompt: 'Choose the managed solution.',
    correct_answer: 'C',
    choices: {
      A: 'Create component one.',
      B: 'Create component two.',
      C: 'Use the managed solution.',
      D: 'Create component three.',
    },
    explanation: {
      status: 'verified',
      correct: 'verified correct reason',
      distractors: {
        A: 'verified reason A',
        B: 'verified reason B',
        D: 'verified reason D',
      },
    },
  },
  'A',
));
assert.match(curatedText, /verified correct reason/);
assert.match(curatedText, /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ verified reason A/);
assert.doesNotMatch(curatedText, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก D ที่คุณเลือก/, 'uses only the curated reason for the answered choice');

const unresolvedExplanation = buildExplanation(
  {
    id: 2000,
    prompt: 'Choose the most operationally efficient solution.',
    correct_answer: 'C',
    choices: {
      A: 'Create component one.',
      B: 'Create component two.',
      C: 'Use the managed solution.',
      D: 'Create component three.',
    },
  },
  'A',
);
assert.equal(unresolvedExplanation.answer, 'ข้อที่ถูกคือ C)');
assert.match(unresolvedExplanation.paragraphs[1], /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ ไม่ตอบโจทย์ ?ลด operational overhead/, 'falls back to a constraint-based reason for the answered choice');
assert.doesNotMatch(explanationText(unresolvedExplanation), /ต้องตรวจสอบเพิ่มเติม|ตัวเลือกนี้เลือก “|แทน “/);

const multiAzExplanation = buildExplanation(
  {
    id: 420,
    prompt:
      'A company wants an Amazon RDS for PostgreSQL database that is highly available, fails over in most scenarios in less than 40 seconds, offloads reads from the primary, and keeps costs low.',
    correct_answer: 'D',
    choices: {
      A: 'Use an Amazon RDS Multi-AZ DB instance deployment. Create one read replica and point the read workload to the read replica.',
      B: 'Use an Amazon RDS Multi-AZ DB duster deployment Create two read replicas and point the read workload to the read replicas.',
      C: 'Use an Amazon RDS Multi-AZ DB instance deployment. Point the read workload to the secondary instance in the Multi-AZ pair.',
      D: 'Use an Amazon RDS Multi-AZ DB cluster deployment Point the read workload to the reader endpoint.',
    },
  },
  'A',
);
const multiAzText = explanationText(multiAzExplanation);
assert.match(multiAzText, /reader endpoint.*35 วินาที/);
assert.match(multiAzText, /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ.*60.?120 วินาที.*40 วินาที/, 'explains the answered distractor with a distinct architectural reason');
assert.doesNotMatch(multiAzText, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก C ที่คุณเลือก/, 'does not explain choices the user did not answer');

const realBank = JSON.parse(
  readFileSync(new URL('./saa_c03_tutor_bank.json', import.meta.url), 'utf8'),
);
const deepArchiveExplanation = buildExplanation(
  realBank.questions.find((question) => question.id === 23),
  'C',
);
assert.equal(deepArchiveExplanation.answer, 'ข้อที่ถูกคือ B)');
assert.match(deepArchiveExplanation.paragraphs[0], /S3 Glacier Deep Archive.*คุมค่าใช้จ่าย/);
assert.match(deepArchiveExplanation.paragraphs[1], /ตัวเลือก C ที่คุณเลือก ไม่ถูกต้อง เพราะ ไม่ตอบโจทย์ คุมค่าใช้จ่าย/);
assert.doesNotMatch(explanationText(deepArchiveExplanation), /Create an S3 Lifecycle configuration|ตัวเลือกนี้เลือก “|แทน “/);

const queueScalingExplanation = buildExplanation(
  realBank.questions.find((question) => question.id === 8),
  'A',
);
assert.equal(queueScalingExplanation.answer, 'ข้อที่ถูกคือ B)');
assert.match(queueScalingExplanation.paragraphs[0], /SQS.*การรองรับการเติบโต/);
assert.match(queueScalingExplanation.paragraphs[1], /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ ไม่ตอบโจทย์ การรองรับการเติบโต/);

const natGatewayExplanation = buildExplanation(
  realBank.questions.find((question) => question.id === 370),
  'A',
);
const natText = explanationText(natGatewayExplanation);
assert.equal(natGatewayExplanation.answer, 'ข้อที่ถูกคือ C)');
assert.match(natText, /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ.*NAT instance.*ดูแล/);
assert.doesNotMatch(natText, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก D ที่คุณเลือก/, 'does not explain choices the user did not answer');

const certificateExplanation = buildExplanation(
  realBank.questions.find((question) => question.id === 577),
  'A',
);
const certText = explanationText(certificateExplanation);
assert.match(certText, /ข้อที่ถูกคือ C\)/);
assert.match(certText, /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ.*TLS protocol version.*cipher/);
assert.doesNotMatch(certText, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก D ที่คุณเลือก/);
assert.match(certText, /ACM.*DNS.*อัตโนมัติ/);

const privateS3Question = realBank.questions.find((question) => question.id === 612);
const inferredPrivateS3 = analyzeExplanation(privateS3Question);
assert.ok(
  inferredPrivateS3.comparisons.every(({ reason }) => !reason.includes('organization')),
  'an S3 bucket-policy update must not trigger an AWS Organizations explanation',
);
const privateS3Explanation = buildExplanation(privateS3Question, 'A');
const privateS3Text = explanationText(privateS3Explanation);
assert.match(privateS3Text, /ข้อที่ถูกคือ D\)/);
assert.match(privateS3Text, /S3 gateway VPC endpoint.*internet gateway.*NAT/);
assert.match(privateS3Text, /ตัวเลือก A ที่คุณเลือก ไม่ถูกต้อง เพราะ.*internet gateway.*private subnet/i);
assert.doesNotMatch(privateS3Text, /ตัวเลือก B ที่คุณเลือก|ตัวเลือก C ที่คุณเลือก/);
assert.doesNotMatch(privateS3Text, /ต้องตรวจสอบเพิ่มเติม/);

const natKeywords = buildKeywordExplanations(realBank.questions.find((question) => question.id === 370));
const natTerms = natKeywords.map(({ term }) => term);
assert.ok(natTerms.some((term) => /VPC/i.test(term)), 'surfaces VPC terminology from the scenario');
assert.ok(natTerms.some((term) => /EC2/i.test(term)), 'surfaces EC2 terminology from the scenario');
assert.ok(natTerms.some((term) => /subnet/i.test(term)), 'surfaces subnet terminology from the choices');
assert.ok(
  natKeywords.every(({ term, explanation }) => term && explanation),
  'every keyword carries both a term and an explanation',
);
assert.equal(
  buildKeywordExplanations({ prompt: 'A plain prompt with no cloud terms at all.', choices: { A: 'Do something.' } }).length,
  0,
  'returns no keywords when the question has no AWS terms',
);

assert.deepEqual(
  summarizeWeakAreas(questions, { wrong: { 1: 2, 2: 1 }, correct: { 3: 1 } }),
  {
    domains: [
      { domain: 'Design Secure Architectures', missed: 2 },
      { domain: 'Design Resilient Architectures', missed: 1 },
    ],
    ambiguousMisses: 0,
  },
  'summarizes weak areas from missed questions by domain',
);

assert.deepEqual(
  summarizeWeakAreas(questions, { wrong: { 1: 1, 3: 2 } }),
  {
    domains: [{ domain: 'Design Secure Architectures', missed: 1 }],
    ambiguousMisses: 2,
  },
  'keeps ambiguous misses separate from official-domain totals',
);

const mockQuestions = Array.from({ length: 140 }, (_, index) => ({
  id: index + 1,
  domain_key: ['secure', 'resilient', 'high-performing', 'cost-optimized'][index % 4],
  domain: [
    'Design Secure Architectures',
    'Design Resilient Architectures',
    'Design High-Performing Architectures',
    'Design Cost-Optimized Architectures',
  ][index % 4],
  question_type: index === 0 ? 'multiple_select_choice' : 'single_select_choice',
  correct_answer: index === 0 ? 'AB' : 'A',
}));
mockQuestions.push({
  id: 141,
  domain_key: 'ambiguous',
  domain: 'Ambiguous — Needs Review',
  question_type: 'single_select_choice',
  correct_answer: 'A',
});

const mockSession = createMockSession(mockQuestions, {
  now: 1_000,
  random: () => 0.42,
});
assert.equal(mockSession.questionIds.length, 65, 'mock exam contains all 65 exam questions');
assert.equal(new Set(mockSession.questionIds).size, 65, 'mock exam does not repeat questions');
assert.equal(mockSession.deadline, 7_801_000, 'mock exam allows the official 130-minute duration');
assert.deepEqual(
  [...new Set(mockSession.questionIds.map((id) => mockQuestions.find((question) => question.id === id).domain))]
    .sort(),
  [
    'Design Cost-Optimized Architectures',
    'Design High-Performing Architectures',
    'Design Resilient Architectures',
    'Design Secure Architectures',
  ],
  'mock exam covers every named domain available in the bank',
);
assert.ok(
  mockSession.questionIds.every((id) => mockQuestions.find((question) => question.id === id).domain_key !== 'ambiguous'),
  'mock exam excludes ambiguous questions',
);
assert.ok(
  mockSession.questionIds.some(
    (id) => mockQuestions.find((question) => question.id === id).question_type === 'multiple_select_choice',
  ),
  'mock exam includes a multiple-response question when the bank contains one',
);

const previousQuestionIds = mockQuestions.slice(0, 65).map((question) => question.id);
const freshSession = createMockSession(mockQuestions, {
  previousQuestionIds,
  random: () => 0.42,
});
assert.equal(
  freshSession.questionIds.some((id) => previousQuestionIds.includes(id)),
  false,
  'the next mock avoids previously used questions while enough unseen questions remain',
);
assert.equal(freshSession.historyQuestionIds.length, 130, 'mock history accumulates across a cycle');

const almostExhaustedIds = mockQuestions.slice(0, 120).map((question) => question.id);
const rolloverSession = createMockSession(mockQuestions, {
  previousQuestionIds: almostExhaustedIds,
  random: () => 0.42,
});
const finalUnseenIds = mockQuestions.slice(120, 140).map((question) => question.id);
assert.ok(
  finalUnseenIds.every((id) => rolloverSession.questionIds.includes(id)),
  'cycle rollover uses every remaining unseen question before repeating old questions',
);
assert.deepEqual(
  [...rolloverSession.historyQuestionIds].sort((a, b) => a - b),
  [...rolloverSession.questionIds].sort((a, b) => a - b),
  'cycle rollover starts new history from the current mock set',
);

const answeredSession = recordMockAnswer(mockSession, mockSession.questionIds[0], {
  normalized: 'A',
  isCorrect: true,
});
assert.deepEqual(answeredSession.results[String(mockSession.questionIds[0])], { answer: 'A', isCorrect: true });
assert.equal(advanceMockSession(answeredSession).index, 1, 'mock exam advances only after recording an answer');

console.log('app logic tests passed');
