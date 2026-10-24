export function normalizeAnswer(answer) {
  return String(answer || '')
    .toUpperCase()
    .replace(/[^A-E]/g, '')
    .split('')
    .sort()
    .join('');
}

export function gradeAnswer(question, answer) {
  const normalized = normalizeAnswer(answer);
  const correct = normalizeAnswer(question.correct_answer);
  return {
    isCorrect: normalized === correct,
    normalized,
    correct,
  };
}

export function buildDomainOptions(examDomains, questions) {
  const options = [
    { value: 'all', label: 'All official domains' },
    ...examDomains.map((domain, index) => ({
      value: domain.key,
      label: `Domain ${index + 1} · ${domain.label.replace('Design ', '').replace(' Architectures', '')} · ${domain.weight}%`,
    })),
  ];
  const ambiguousCount = questions.filter((question) => question.domain_key === 'ambiguous').length;
  if (ambiguousCount) {
    options.push({ value: 'ambiguous', label: `Ambiguous · Needs review (${ambiguousCount})` });
  }
  return options;
}

export function selectNextQuestion(questions, progress = {}) {
  const lastId = progress.lastQuestionId ?? progress.last_question_id;
  const asked = new Set(progress.asked || []);
  const wrongIds = Object.entries(progress.wrong || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([id]) => Number(id));

  let pool = questions;
  if (progress.domain && progress.domain !== 'all') {
    pool = pool.filter((q) => q.domain_key === progress.domain || q.domain === progress.domain);
  }

  if (progress.mode === 'review' && wrongIds.length) {
    pool = pool.filter((q) => wrongIds.includes(q.id));
    if (!pool.length) return null;
    const ordered = [...pool].sort((left, right) => left.id - right.id);
    return ordered.find((question) => question.id > lastId) || ordered[0];
  }

  const withoutLast = pool.filter((q) => q.id !== lastId);
  const unseen = withoutLast.filter((q) => !asked.has(q.id));
  const review = withoutLast.filter((q) => wrongIds.includes(q.id));
  const candidates = progress.mode === 'review' ? withoutLast : unseen.length ? unseen : review.length ? review : withoutLast;

  if (!candidates.length) return pool[0] || null;

  return candidates.reduce((best, item) => {
    const itemWeight = Number(progress.wrong?.[item.id] || 0) * 3 + (asked.has(item.id) ? 0 : 1);
    const bestWeight = Number(progress.wrong?.[best.id] || 0) * 3 + (asked.has(best.id) ? 0 : 1);
    if (itemWeight > bestWeight) return item;
    if (itemWeight < bestWeight) return best;
    return item.id < best.id ? item : best;
  }, candidates[0]);
}

export function updateProgress(progress, question, result) {
  const next = {
    asked: [...new Set([...(progress.asked || []), question.id])],
    wrong: { ...(progress.wrong || {}) },
    correct: { ...(progress.correct || {}) },
    lastQuestionId: question.id,
    answers: { ...(progress.answers || {}) },
  };
  const key = String(question.id);
  next.answers[key] = result.normalized;
  if (result.isCorrect) {
    next.correct[key] = Number(next.correct[key] || 0) + 1;
  } else {
    next.wrong[key] = Number(next.wrong[key] || 0) + 1;
  }
  return next;
}

export function summarizeWeakAreas(questions, progress = {}) {
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  const summary = new Map();
  let ambiguousMisses = 0;
  for (const [id, count] of Object.entries(progress.wrong || {})) {
    const question = byId.get(id);
    if (!question || Number(count) <= 0) continue;
    if (question.domain_key === 'ambiguous') {
      ambiguousMisses += Number(count);
      continue;
    }
    summary.set(question.domain, (summary.get(question.domain) || 0) + Number(count));
  }
  return {
    domains: [...summary.entries()]
      .map(([domain, missed]) => ({ domain, missed }))
      .sort((a, b) => b.missed - a.missed || a.domain.localeCompare(b.domain)),
    ambiguousMisses,
  };
}

export function getStats(questions, progress = {}) {
  const answeredIds = new Set(Object.keys(progress.answers || {}));
  const wrongAttempts = Object.values(progress.wrong || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  const correctAttempts = Object.values(progress.correct || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  return {
    total: questions.length,
    answered: answeredIds.size,
    wrongAttempts,
    correctAttempts,
    accuracy: correctAttempts + wrongAttempts ? Math.round((correctAttempts / (correctAttempts + wrongAttempts)) * 100) : 0,
  };
}

export function createMockSession(
  questions,
  {
    size = 65,
    durationMinutes = 130,
    now = Date.now(),
    random = Math.random,
    previousQuestionIds = [],
  } = {},
) {
  const eligible = questions.filter((question) => question.domain_key !== 'ambiguous');
  const targetSize = Math.min(size, eligible.length);
  const eligibleIds = new Set(eligible.map((question) => question.id));
  const previousIds = new Set(previousQuestionIds.filter((id) => eligibleIds.has(id)));
  const unseen = eligible.filter((question) => !previousIds.has(question.id));
  const cycleReset = unseen.length < targetSize;
  const selectionPool = cycleReset ? eligible : unseen;
  const selected = cycleReset ? [...unseen] : [];
  const selectedIds = new Set(selected.map((question) => question.id));
  const byDomain = new Map();
  for (const question of selectionPool) {
    byDomain.set(question.domain, [...(byDomain.get(question.domain) || []), question]);
  }
  for (const domainQuestions of byDomain.values()) {
    if (selected.length >= targetSize || domainQuestions.some((question) => selectedIds.has(question.id))) continue;
    const question = shuffle(domainQuestions, random)[0];
    selected.push(question);
    selectedIds.add(question.id);
  }
  const multipleResponse = selectionPool.find(
    (question) => question.question_type === 'multiple_select_choice' && !selectedIds.has(question.id),
  );
  if (multipleResponse && selected.length < targetSize) {
    selected.push(multipleResponse);
    selectedIds.add(multipleResponse.id);
  }
  const remaining = shuffle(
    selectionPool.filter((question) => !selectedIds.has(question.id)),
    random,
  );
  selected.push(...remaining.slice(0, targetSize - selected.length));
  const questionIds = shuffle(selected, random).map((question) => question.id);

  return {
    questionIds,
    historyQuestionIds: cycleReset
      ? questionIds
      : [...new Set([...previousIds, ...questionIds])],
    index: 0,
    results: {},
    startedAt: now,
    deadline: now + durationMinutes * 60_000,
    completed: false,
  };
}

export function recordMockAnswer(session, questionId, result) {
  return {
    ...session,
    results: {
      ...session.results,
      [String(questionId)]: { answer: result.normalized, isCorrect: result.isCorrect },
    },
  };
}

export function advanceMockSession(session) {
  const currentId = session.questionIds[session.index];
  if (!session.results[String(currentId)]) return session;
  if (session.index >= session.questionIds.length - 1) return { ...session, completed: true };
  return { ...session, index: session.index + 1 };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

const THAI_COUNT_WORDS = { 2: 'สอง', 3: 'สาม', 4: 'สี่', 5: 'ห้า' };

function joinThaiList(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} และ ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} และ ${items[items.length - 1]}`;
}

function cleanChoiceText(text) {
  return String(text || '')
    .split(/Most Voted/i)[0]
    .replace(/^[A-F]\.\s*/, '')
    .trim();
}

function formatAnswerLine(question, correctLetters) {
  if (correctLetters.length === 1) return `ข้อที่ถูกคือ ${correctLetters[0]})`;
  const countWord = THAI_COUNT_WORDS[correctLetters.length] || String(correctLetters.length);
  const texts = correctLetters.map((letter) => cleanChoiceText(question.choices?.[letter]));
  return `${countWord}ข้อที่ถูกคือ ${joinThaiList(texts)}`;
}

export function buildExplanation(question, submittedAnswer) {
  const result = gradeAnswer(question, submittedAnswer);
  const correct = result.correct;
  const correctLetters = correct.split('');
  const submittedLetters = result.normalized.split('');
  const prompt = question.prompt || '';
  const constraintHint = inferConstraintHint(prompt);

  const answer = formatAnswerLine(question, correctLetters);

  const correctText = answerText(question, correct);
  const inferredCorrectReason = inferServiceHint(correctText || prompt);
  const reason = question.explanation?.correct ||
    (constraintHint && !inferredCorrectReason.toLowerCase().includes(constraintHint.toLowerCase())
      ? `${inferredCorrectReason} และตอบโจทย์ ${constraintHint}`
      : inferredCorrectReason);

  const paragraphs = [reason];

  const analysis = analyzeExplanation(question);
  const wrongLetters = submittedLetters.filter((letter) => !correctLetters.includes(letter));
  if (wrongLetters.length) {
    const wrongLines = wrongLetters.map((letter) => {
      const comparison = analysis.comparisons.find((item) => item.letter === letter);
      const comparisonReason = comparison?.reason;
      const reasonText =
        comparisonReason &&
        !isGenericDistractorReason(comparisonReason) &&
        !comparisonReason.startsWith(inferredCorrectReason) &&
        !comparisonReason.startsWith('คำตอบ ')
          ? comparisonReason
          : constraintHint
            ? `ไม่ตอบโจทย์ ${constraintHint}`
            : 'ไม่ตอบ requirement หลักของโจทย์';
      return `ตัวเลือก ${letter} ที่คุณเลือก ไม่ถูกต้อง เพราะ ${reasonText}.`;
    });
    paragraphs.push(wrongLines.join(' '));
  }

  return { title: 'คำตอบ', answer, paragraphs };
}

export function analyzeExplanation(question) {
  const correct = normalizeAnswer(question.correct_answer);
  const prompt = question.prompt || '';
  const constraintHint = inferConstraintHint(prompt);
  const correctText = answerText(question, correct);
  const initialComparisons = Object.keys(question.choices || {})
    .filter((letter) => !correct.includes(letter))
    .map((letter) => {
      const curatedReason = question.explanation?.distractors?.[letter];
      return {
        letter,
        reason:
          curatedReason ||
          inferDistractorReason(question.choices[letter], prompt, constraintHint),
        curated: Boolean(curatedReason),
      };
    });
  const reasonCounts = new Map();
  for (const { reason, curated } of initialComparisons) {
    if (!curated) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  const repeatedInitialReasons = new Set(
    [...reasonCounts].filter(([, count]) => count > 1).map(([reason]) => reason),
  );
  const sharedComparisonReason = repeatedInitialReasons.size
    ? inferSharedComparisonReason(correctText, constraintHint, correct)
    : '';
  const comparisons = sharedComparisonReason
    ? initialComparisons.map((comparison) => ({
        ...comparison,
        reason: repeatedInitialReasons.has(comparison.reason)
          ? sharedComparisonReason
          : comparison.reason,
      }))
    : initialComparisons;
  const identical =
    comparisons.length > 1 && new Set(comparisons.map(({ reason }) => reason)).size === 1;
  const identicalUncuratedLetters =
    identical && !sharedComparisonReason && comparisons.every(({ curated }) => !curated)
      ? comparisons.map(({ letter }) => letter)
      : [];
  const genericLetters = comparisons
    .filter(({ reason, curated }) => !curated && isGenericDistractorReason(reason))
    .map(({ letter }) => letter);

  return {
    comparisons,
    genericLetters,
    identicalUncuratedLetters,
    status:
      question.explanation?.status ||
      (identicalUncuratedLetters.length || genericLetters.length ? 'needs_review' : 'inferred'),
  };
}

function answerText(question, letters) {
  return letters
    .split('')
    .map((letter) => `${letter}. ${question.choices?.[letter] || ''}`.trim())
    .join(' + ');
}

const SERVICE_HINTS = [
    ['aurora serverless v2', 'Aurora Serverless v2 เหมาะกับ workload ที่ traffic ขึ้นลงและต้อง scale อัตโนมัติแบบ managed'],
    ['aurora serverless', 'Aurora Serverless เหมาะกับ workload ที่ traffic ขึ้นลงและต้อง scale อัตโนมัติแบบ managed'],
    ['gateway load balancer', 'Gateway Load Balancer กระจาย traffic ผ่าน virtual appliance แบบโปร่งใสและ scale inspection layer ได้โดยไม่ต้องผูก route กับ appliance รายเครื่อง'],
    ['gateway vpc endpoint', 'Gateway VPC endpoint ให้ S3 หรือ DynamoDB traffic อยู่บนเครือข่าย AWS โดยไม่ต้องผ่าน internet หรือเสียค่า NAT Gateway'],
    ['s3 vpc gateway endpoint', 'S3 gateway endpoint เชื่อม workload ใน VPC ไปยัง S3 แบบ private ผ่าน route table และควบคุมขอบเขตด้วย endpoint policy ได้'],
    ['interface vpc endpoint', 'Interface VPC endpoint ใช้ AWS PrivateLink เพื่อเข้าถึง service ผ่าน private IP ภายใน VPC โดยไม่ออก internet'],
    ['s3 file gateway', 'S3 File Gateway คง interface แบบ NFS/SMB พร้อม cache ข้อมูลที่ใช้บ่อยใน local และเก็บข้อมูลหลักบน S3 ที่ใช้ lifecycle policy ได้'],
    ['fsx file gateway', 'FSx File Gateway ให้ on-premises เข้าถึง FSx for Windows ผ่าน SMB พร้อม local cache โดยไม่ต้องสร้าง file server เอง'],
    ['fsx for windows file server', 'FSx for Windows File Server ให้ shared SMB storage ที่ผูกกับ Active Directory และรองรับ Multi-AZ แบบ managed'],
    ['fsx for lustre', 'FSx for Lustre ให้ parallel file system throughput สูงและเชื่อมกับ S3 ได้ เหมาะกับงานประมวลผลข้อมูลขนาดใหญ่'],
    ['s3 intelligent-tiering', 'S3 Intelligent-Tiering ย้ายข้อมูลระหว่าง access tiers อัตโนมัติตามรูปแบบการใช้งาน จึงเหมาะเมื่อคาดเดาความถี่การเข้าถึงไม่ได้'],
    ['glacier deep archive', 'S3 Glacier Deep Archive มีต้นทุนจัดเก็บต่ำที่สุดสำหรับข้อมูลระยะยาวที่แทบไม่เรียกใช้และยอมรับเวลาคืนข้อมูลได้'],
    ['glacier instant retrieval', 'S3 Glacier Instant Retrieval ลดค่าจัดเก็บสำหรับข้อมูลที่เข้าถึงน้อยแต่ยังต้องอ่านได้ในระดับมิลลิวินาที'],
    ['standard-infrequent access', 'S3 Standard-IA เหมาะกับข้อมูลที่เข้าถึงน้อยแต่ยังต้องการ multi-AZ resilience และเรียกคืนได้ทันที'],
    ['s3 standard-ia', 'S3 Standard-IA เหมาะกับข้อมูลที่เข้าถึงน้อยแต่ยังต้องการ multi-AZ resilience และเรียกคืนได้ทันที'],
    ['s3 lifecycle', 'S3 Lifecycle ย้ายหรือลบ object ตามอายุโดยอัตโนมัติ จึงลดทั้ง storage cost และงานดูแลระยะยาว'],
    ['mfa delete', 'S3 Versioning ร่วมกับ MFA Delete ป้องกันการลบหรือเปลี่ยน version โดยไม่ตั้งใจและเพิ่มการยืนยันสำหรับการลบถาวร'],
    ['requester pays', 'S3 Requester Pays ทำให้ผู้ดาวน์โหลดรับผิดชอบค่า data transfer และ request แทนเจ้าของ bucket'],
    ['presigned url', 'S3 presigned URL ให้ client อัปโหลดหรือดาวน์โหลดตรงกับ S3 ด้วยสิทธิ์และอายุที่จำกัด ลดภาระและ bandwidth ของ application server'],
    ['s3 batch operations', 'S3 Batch Operations ใช้ action เดียวกับ object จำนวนมากจาก manifest จึงเหมาะกับการแก้ไขข้อมูลเดิมเป็นชุดโดยไม่ต้องเขียน worker เอง'],
    ['s3 inventory', 'S3 Inventory สร้างรายการ object และสถานะเป็นรอบ ๆ สำหรับ audit หรือ batch remediation โดยไม่ต้อง list bucket เอง'],
    ['fast snapshot restore', 'EBS Fast Snapshot Restore ทำให้ volume ที่สร้างจาก snapshot มี performance เต็มทันทีโดยไม่ต้องรอ lazy initialization'],
    ['ebs snapshot', 'EBS snapshot เป็น incremental backup ที่นำไปสร้าง volume ใหม่หรือคัดลอกข้าม Region ได้โดยไม่ต้องดูแล backup server'],
    ['provisioned iops', 'Provisioned IOPS ให้ IOPS และ throughput ที่คาดการณ์ได้ เหมาะกับ database workload ที่ต้องการ latency สม่ำเสมอ'],
    ['instance store', 'EC2 instance store ให้ I/O latency ต่ำมากสำหรับข้อมูลชั่วคราว ส่วนข้อมูลถาวรควรแยกไปยัง durable storage'],
    ['on-demand capacity reservation', 'On-Demand Capacity Reservation รับประกัน capacity ของ EC2 ใน Availability Zone ที่กำหนดโดยไม่ผูกกับสัญญาระยะยาว'],
    ['compute savings plan', 'Compute Savings Plans ลดค่า compute จาก commitment ระยะยาวแต่ยังย้ายข้าม instance family, Region หรือ Fargate ได้ยืดหยุ่น'],
    ['reserved instances', 'Reserved Instances ลดต้นทุนสำหรับ baseline workload ที่ใช้งานสม่ำเสมอและคาดการณ์ capacity ได้'],
    ['spot instances', 'Spot Instances ลดค่า compute สำหรับงานที่ยืดหยุ่นและทนต่อ interruption ได้ เช่น batch หรือ capacity ส่วนเพิ่ม'],
    ['cost explorer', 'Cost Explorer ใช้ filter และ grouping เพื่อวิเคราะห์ค่าใช้จ่ายย้อนหลังตาม service, instance type หรือ tag ได้โดยไม่สร้าง reporting pipeline เพิ่ม'],
    ['aws budgets', 'AWS Budgets ติดตามค่าใช้จ่ายหรือ usage เทียบ threshold และแจ้งเตือนก่อนเกินงบที่กำหนด'],
    ['compute optimizer', 'AWS Compute Optimizer วิเคราะห์ utilization เพื่อแนะนำขนาด resource ที่เหมาะสมและลดการ provision เกินจำเป็น'],
    ['composite alarm', 'CloudWatch composite alarm รวมสถานะ alarm หลายตัว ลดการแจ้งเตือนซ้ำและบอกเหตุการณ์ระดับระบบได้ชัดกว่า alarm เดี่ยว'],
    ['cloudwatch logs subscription', 'CloudWatch Logs subscription ส่ง log แบบต่อเนื่องไปยัง Lambda, Kinesis หรือ OpenSearch เพื่อวิเคราะห์ใกล้ real time'],
    ['cloudwatch', 'CloudWatch รวบรวม metric, log และ alarm สำหรับ monitoring และ automation โดยไม่ต้องติดตั้งระบบสังเกตการณ์แยก'],
    ['aws config', 'AWS Config บันทึก configuration history และประเมิน resource เทียบ compliance rules ได้ต่อเนื่อง'],
    ['cloudtrail', 'CloudTrail บันทึก API activity เพื่อ audit ว่าใครทำอะไรกับ resource และใช้ตรวจสอบเหตุการณ์ย้อนหลังได้'],
    ['systems manager session manager', 'Session Manager ให้เข้าถึง instance ผ่าน IAM และ audit log โดยไม่เปิด inbound SSH/RDP หรือดูแล bastion host'],
    ['systems manager run command', 'Systems Manager Run Command สั่งงาน instance หลายเครื่องจากส่วนกลางและเก็บผลลัพธ์ โดยไม่ต้อง SSH เข้าแต่ละเครื่อง'],
    ['patch manager', 'Systems Manager Patch Manager จัดตารางและตรวจ compliance ของ patch บน instance จากส่วนกลาง'],
    ['aws backup', 'AWS Backup รวม schedule, retention และ policy ของ backup หลายบริการไว้ที่เดียว พร้อมรองรับ cross-account หรือ cross-Region copy'],
    ['cloudformation', 'CloudFormation ทำให้ infrastructure ทำซ้ำและตรวจสอบ version ได้ ลด configuration drift จากการสร้าง resource ด้วยมือ'],
    ['control tower', 'AWS Control Tower สร้าง multi-account landing zone พร้อม guardrails และ account governance แบบรวมศูนย์'],
    ['service control policy', 'Service control policy กำหนด permission boundary สูงสุดให้หลาย account หรือ OU จาก AWS Organizations ได้จากส่วนกลาง'],
    ['organizations', 'AWS Organizations จัดกลุ่ม account และบังคับ governance, billing หรือ policy จากส่วนกลางแทนการตั้งค่าทีละ account'],
    ['iam identity center', 'IAM Identity Center รวม workforce access หลาย AWS accounts และ applications พร้อม federation โดยไม่ต้องสร้าง IAM user ซ้ำ'],
    ['single sign-on', 'AWS Single Sign-On เชื่อม workforce identity กับหลาย AWS accounts จากจุดเดียว ลดการดูแล user และ credential ซ้ำ'],
    ['aws sso', 'AWS SSO เชื่อม workforce identity กับหลาย AWS accounts จากจุดเดียว ลดการดูแล user และ credential ซ้ำ'],
    ['iam role', 'IAM role ให้ temporary credentials แก่ workload หรือผู้ใช้โดยไม่ต้องฝังและหมุนเวียน long-term access key'],
    ['multi-region kms', 'Multi-Region KMS key ใช้ key material ที่สัมพันธ์กันข้าม Region ช่วยให้ encrypted data ทำงานในหลาย Region โดยไม่ต้อง re-encrypt ด้วย key คนละชุด'],
    ['key management service', 'AWS KMS ควบคุม encryption key, key policy และ audit integration แบบ managed แทนการเก็บ key ใน application'],
    ['sse-kms', 'SSE-KMS เข้ารหัสข้อมูลฝั่ง server พร้อมควบคุมสิทธิ์ผ่าน KMS key policy และมี audit trail ผ่าน CloudTrail'],
    ['sse-s3', 'SSE-S3 เข้ารหัส object ฝั่ง server ด้วย key ที่ S3 จัดการทั้งหมด จึงลดงานดูแล key'],
    ['certificate manager', 'AWS Certificate Manager ออกหรือ import TLS certificate และต่ออายุ certificate ที่รองรับแบบ managed กับบริการ AWS'],
    ['shield advanced', 'AWS Shield Advanced เพิ่ม DDoS protection, detection และ cost protection สำหรับ resource ที่เปิดรับ traffic จาก internet'],
    ['firewall manager', 'AWS Firewall Manager บังคับใช้ WAF, Shield หรือ network security policy ข้ามหลาย accounts และ Regions จากส่วนกลาง'],
    ['aws waf', 'AWS WAF กรอง HTTP/S requests ตาม IP, header, rate หรือ managed rules ที่หน้า web endpoint ก่อนถึง application'],
    ['security hub', 'Security Hub รวมและจัดลำดับ security findings จากหลายบริการและหลาย accounts เพื่อให้ remediation จากส่วนกลาง'],
    ['amazon inspector', 'Amazon Inspector สแกน vulnerability และ exposure ของ EC2, container image และ Lambda package แบบต่อเนื่อง'],
    ['amazon macie', 'Amazon Macie ใช้ machine learning ค้นหา sensitive data ใน S3 และแจ้งความเสี่ยงจากการเปิดเผยข้อมูล'],
    ['security group', 'Security group เป็น stateful firewall ระดับ resource และอ้างอิง security group อื่นได้เพื่อจำกัด traffic ระหว่าง application tiers'],
    ['global accelerator', 'AWS Global Accelerator ใช้ static anycast IP และเครือข่าย AWS พา TCP/UDP traffic ไปยัง healthy regional endpoint ที่ใกล้ที่สุด'],
    ['transit gateway', 'AWS Transit Gateway เป็น hub สำหรับเชื่อมหลาย VPC และ on-premises networks ลดจำนวน peering connections ที่ต้องดูแล'],
    ['privatelink', 'AWS PrivateLink เปิด service ให้ consumer VPC เข้าถึงผ่าน private endpoint โดยไม่ต้อง peering, NAT หรือ public IP'],
    ['direct connect', 'AWS Direct Connect ให้ private dedicated connectivity ที่ bandwidth และ latency สม่ำเสมอกว่า internet สำหรับ hybrid workload ระยะยาว'],
    ['site-to-site vpn', 'Site-to-Site VPN ให้ encrypted connectivity ระหว่าง on-premises กับ VPC และใช้เป็นเส้นทางสำรองของ Direct Connect ได้'],
    ['route 53', 'Route 53 ทำ DNS routing และ health-check failover เพื่อพา traffic ไปยัง endpoint ที่พร้อมใช้งาน'],
    ['application load balancer', 'Application Load Balancer กระจาย HTTP/S traffic ตาม host หรือ path และทำ health checks ให้ application targets'],
    ['network load balancer', 'Network Load Balancer รองรับ TCP/UDP throughput สูงและ static IP พร้อมกระจาย traffic ไปยัง healthy targets'],
    ['elastic container registry', 'Amazon ECR เก็บและสแกน container images แบบ managed พร้อมสิทธิ์ผ่าน IAM และเชื่อมกับ ECS/EKS โดยตรง'],
    ['aws fargate', 'AWS Fargate รัน container โดยไม่ต้อง provision หรือ patch worker nodes และ scale task ตาม demand ได้'],
    ['fargate', 'AWS Fargate รัน container โดยไม่ต้อง provision หรือ patch worker nodes และ scale task ตาม demand ได้'],
    ['elastic container service', 'Amazon ECS จัด scheduling, service health และ scaling ของ containers โดยเชื่อมกับ load balancer และ IAM ได้โดยตรง'],
    ['amazon ecs', 'Amazon ECS จัด scheduling, service health และ scaling ของ containers โดยเชื่อมกับ load balancer และ IAM ได้โดยตรง'],
    ['elastic kubernetes service', 'Amazon EKS ให้ Kubernetes control plane แบบ managed และรองรับ managed node groups หรือ Fargate เพื่อลดงานดูแล cluster'],
    ['amazon eks', 'Amazon EKS ให้ Kubernetes control plane แบบ managed และรองรับ managed node groups หรือ Fargate เพื่อลดงานดูแล cluster'],
    ['elastic beanstalk', 'Elastic Beanstalk จัด deployment, capacity, load balancing และ health monitoring ของ application โดยยังให้ควบคุม resource ใต้ระบบได้'],
    ['aws lambda', 'AWS Lambda รันโค้ดตาม event และ scale อัตโนมัติโดยไม่ต้อง provision server เหมาะกับงานสั้นหรือ asynchronous processing'],
    ['s3 event notification', 'S3 Event Notifications เรียก Lambda, SNS หรือ SQS เมื่อ object เปลี่ยน จึงสร้าง event-driven pipeline โดยไม่ต้อง polling'],
    ['kinesis data firehose', 'Kinesis Data Firehose buffer, transform และส่ง streaming data ไปยัง S3, Redshift หรือ OpenSearch แบบ managed'],
    ['kinesis data streams', 'Kinesis Data Streams รับ event throughput สูงและให้หลาย consumers อ่านข้อมูลแบบ near real time พร้อมควบคุม retention ได้'],
    ['step functions', 'Step Functions ประสาน workflow หลายขั้นตอนด้วย state, retry และ error handling โดยไม่ต้องเขียน orchestration service เอง'],
    ['api gateway', 'API Gateway ให้ managed API endpoint พร้อม authentication, throttling และ integration กับ Lambda หรือ AWS services'],
    ['change message visibility', 'ChangeMessageVisibility ขยายเวลาซ่อน SQS message ที่กำลังประมวลผล ป้องกัน consumer อื่นรับงานซ้ำก่อนงานเดิมเสร็จ'],
    ['opensearch', 'Amazon OpenSearch Service เหมาะกับการค้นหาและวิเคราะห์ log แบบ near real time พร้อม dashboard โดยไม่ต้องดูแล search cluster เองทั้งหมด'],
    ['aws glue', 'AWS Glue จัด catalog และ ETL แบบ serverless เพื่อค้น schema และแปลงข้อมูลก่อนนำไปวิเคราะห์'],
    ['redshift', 'Amazon Redshift เป็น data warehouse แบบ columnar สำหรับ SQL analytics บนข้อมูลขนาดใหญ่และรองรับ workload เชิงรายงาน'],
    ['quicksight', 'Amazon QuickSight สร้าง dashboard และ BI visualization แบบ managed พร้อม scale ผู้ใช้อ่านรายงานได้'],
    ['elasticache', 'ElastiCache เก็บข้อมูลที่เรียกบ่อยหรือ session ใน memory เพื่อลด latency และลด load บนฐานข้อมูลหลัก'],
    ['read replica', 'Read replica แยก read-heavy หรือ reporting workload ออกจาก writer จึงลดภาระฐานข้อมูลหลักและ scale การอ่านได้'],
    ['database cloning', 'Aurora cloning สร้าง database copy แบบ copy-on-write ได้รวดเร็วและประหยัดพื้นที่สำหรับ test หรือ staging'],
    ['multi-az', 'Multi-AZ วางสำเนาใน Availability Zone อื่นและรองรับ failover จึงลด downtime จาก instance หรือ AZ failure'],
    ['database migration service', 'AWS DMS ย้ายหรือ replicate database ต่อเนื่องด้วย change data capture เพื่อลด downtime ระหว่าง migration'],
    ['aws dms', 'AWS DMS ย้ายหรือ replicate database ต่อเนื่องด้วย change data capture เพื่อลด downtime ระหว่าง migration'],
    ['datasync', 'AWS DataSync เร่งและตรวจสอบการย้ายไฟล์ระหว่าง on-premises กับ AWS storage พร้อม schedule และ encryption แบบ managed'],
    ['transfer family', 'AWS Transfer Family ให้ SFTP/FTPS/FTP endpoint ที่เขียนตรงไปยัง S3 หรือ EFS โดยไม่ต้องดูแล transfer server'],
    ['storage gateway', 'AWS Storage Gateway เชื่อม on-premises application กับ AWS storage พร้อม local cache และ protocol เดิมสำหรับ hybrid workload'],
    ['rekognition', 'Amazon Rekognition วิเคราะห์ภาพหรือวิดีโอด้วย managed ML API และใช้ confidence score ส่งเฉพาะเคสไม่แน่ใจให้มนุษย์ตรวจได้'],
    ['textract', 'Amazon Textract ดึงข้อความ ตาราง และฟอร์มจากเอกสาร ส่วน Comprehend วิเคราะห์ entity ต่อได้โดยไม่สร้าง OCR/ML model เอง'],
    ['comprehend', 'Amazon Comprehend วิเคราะห์ entity, sentiment หรือข้อมูลเฉพาะโดเมนจากข้อความด้วย managed NLP'],
    ['pinpoint', 'Amazon Pinpoint สร้าง targeted messaging journey และส่ง event ไปวิเคราะห์ต่อได้โดยไม่สร้าง campaign engine เอง'],
    ['resource groups tag editor', 'Resource Groups Tag Editor ค้นหาและรายงาน resource ตาม tag ข้าม Regions ได้จากจุดเดียว'],
    ['changevisibility', 'ChangeMessageVisibility ขยายเวลาซ่อน SQS message ที่กำลังประมวลผล ป้องกัน consumer อื่นรับงานซ้ำก่อนงานเดิมเสร็จ'],
    ['changemessagevisibility', 'ChangeMessageVisibility ขยายเวลาซ่อน SQS message ที่กำลังประมวลผล ป้องกัน consumer อื่นรับงานซ้ำก่อนงานเดิมเสร็จ'],
    ['launchpermission', 'AMI launch permission แชร์ image ให้เฉพาะ AWS account ที่กำหนด ส่วน KMS key policy ต้องอนุญาต account นั้นถ้า AMI เข้ารหัส'],
    ['job bookmarks', 'AWS Glue job bookmarks จดจำข้อมูลที่ประมวลผลแล้ว เพื่อให้รอบถัดไปอ่านเฉพาะข้อมูลใหม่และไม่ทำงานซ้ำ'],
    ['resource-based policy', 'Resource-based policy อนุญาต service principal เรียก resource ได้โดยตรงและจำกัด action/source ตาม trust boundary'],
    ['amazon s3 bucket and host the website', 'S3 static website hosting ให้บริการไฟล์ HTML/CSS/JavaScript โดยไม่ต้อง provision web server และ scale การอ่านอัตโนมัติ'],
    ['amazon s3 standard', 'S3 Standard ให้ latency ต่ำและความทนทานแบบหลาย Availability Zones สำหรับข้อมูลที่เข้าถึงบ่อยหรือรูปแบบการใช้ยังไม่แน่นอน'],
    ['listener rule', 'ALB listener rule redirect HTTP ไป HTTPS ที่ load balancer ได้จากส่วนกลาง จึงไม่ต้องแก้ redirect logic บนทุก application instance'],
    ['nat gateways in different availability zones', 'NAT Gateway แยกต่อ Availability Zone ลด single point of failure และให้ private subnets ออก internet โดยไม่เปิด inbound access'],
    ['nat gateway', 'NAT Gateway ให้ instances ใน private subnet ออก internet ได้โดยยังไม่รับ inbound connection จาก internet และไม่ต้องดูแล NAT instance'],
    ['vpc peering', 'VPC peering เชื่อม private IP ระหว่างสอง VPC โดยตรง เหมาะกับ topology ขนาดเล็กที่ไม่มี transitive routing'],
    ['multi-factor authentication', 'MFA เพิ่มปัจจัยยืนยันอีกชั้น โดยเฉพาะ root user หรือ privileged action จึงลดผลกระทบจาก password รั่ว'],
    ['logged in with multi-factor authentication', 'IAM condition ที่ตรวจ MFA บังคับให้ privileged action ทำได้เฉพาะ session ที่ผ่านการยืนยันหลายปัจจัย'],
    ['multivalue routing', 'Route 53 multivalue answer routing ส่งหลาย healthy records จาก health checks เพื่อกระจายคำขอแบบ DNS โดยไม่ต้องใช้ load balancer'],
    ['geolocation routing', 'Route 53 geolocation routing เลือก endpoint ตามตำแหน่งของผู้ใช้ เหมาะกับข้อกำหนดด้าน locality หรือการแบ่งบริการตามพื้นที่'],
    ['public subnets', 'Public subnet ที่มี route ไป internet gateway เหมาะกับ internet-facing load balancer ขณะที่ backend อยู่ private subnet แยกขอบเขตการเข้าถึง'],
    ['active directory', 'การผูกบริการกับ Active Directory ใช้ identity และ group เดิมควบคุม file access จากส่วนกลางแทนการสร้างบัญชีแยก'],
    ['scheduled scaling', 'Scheduled scaling เพิ่ม capacity ล่วงหน้าตามช่วงเวลาที่คาดการณ์ได้ จึงหลีกเลี่ยงการรอ metric หลัง traffic เริ่มขึ้น'],
    ['target tracking', 'Target tracking ปรับ capacity อัตโนมัติเพื่อรักษา metric เป้าหมาย และลดการตั้ง step thresholds หลายชุดด้วยมือ'],
    ['provisioned concurrency', 'Lambda provisioned concurrency เตรียม execution environments ไว้ล่วงหน้าเพื่อลด cold-start latency สำหรับ traffic ที่คาดการณ์ได้'],
    ['lambda snapstart', 'Lambda SnapStart คืน execution environment จาก snapshot ที่เตรียมไว้เพื่อลด cold start ของ Java functions'],
    ['signed cookies', 'CloudFront signed cookies เหมาะกับการให้สิทธิ์หลาย protected files ส่วน signed URL จำกัดสิทธิ์เป็นราย URL และช่วงเวลา'],
    ['signed urls', 'CloudFront signed URL ให้สิทธิ์เข้าถึง private content เป็นราย URL และหมดอายุอัตโนมัติโดยไม่เปิด origin ต่อสาธารณะ'],
    ['object lambda', 'S3 Object Lambda แปลงหรือกรอง object ระหว่าง GetObject ตามผู้เรียก โดยไม่ต้องสร้างและเก็บสำเนาหลายรูปแบบ'],
    ['cluster placement group', 'Cluster placement group วาง EC2 instances ใกล้กันในเครือข่าย latency ต่ำและ throughput สูง เหมาะกับ tightly coupled compute'],
    ['spread placement group', 'Spread placement group แยก instances ไปคนละ hardware rack เพื่อลด correlated failure สำหรับ node จำนวนน้อยที่สำคัญ'],
    ['s3 storage lens', 'S3 Storage Lens รวม usage และ activity metrics ข้าม buckets/accounts เพื่อหา cost, protection และ incomplete-upload issues จากส่วนกลาง'],
    ['x-amz-server-side-encryption', 'Bucket policy ที่บังคับ encryption header ปฏิเสธ PutObject ที่ไม่ได้ขอ server-side encryption ตั้งแต่จุดรับข้อมูล'],
    ['aurora global database', 'Aurora Global Database replicate ข้าม Region ด้วย latency ต่ำและมี secondary cluster สำหรับอ่านหรือ disaster recovery'],
    ['aurora replica', 'Aurora Replica แยก read/reporting workload จาก writer และใช้เป็น failover target ภายใน cluster ได้'],
    ['provisioned mode', 'DynamoDB provisioned mode เหมาะเมื่อ throughput คาดการณ์ได้และกำหนด RCU/WCU ให้ตรงโหลดเพื่อควบคุมต้นทุน'],
    ['aws batch', 'AWS Batch จัด queue, scheduling และ compute environment สำหรับ batch jobs พร้อม scale capacity ตามงานค้าง'],
    ['usage plans', 'API Gateway usage plan และ API key กำหนด quota/throttling แยกตาม consumer เพื่อควบคุมการใช้ API'],
    ['password policy', 'IAM account password policy บังคับความยาว ความซับซ้อน และอายุรหัสผ่านกับ IAM users ได้จากจุดเดียว'],
    ['tls listener', 'TLS listener บน load balancer ยุติการเข้ารหัสด้วย certificate จากส่วนกลางและส่งต่อเฉพาะ traffic ที่ผ่าน TLS policy'],
    ['dedicated reserved hosts', 'Dedicated Host ให้ physical server เฉพาะ account และ Reserved pricing เหมาะกับ license ที่ผูก socket/core พร้อม usage ระยะยาว'],
    ['dedicated hosts', 'Dedicated Host ให้ physical server เฉพาะ account เหมาะกับ compliance หรือ software license ที่ผูกกับ socket/core'],
    ['simple email service', 'Amazon SES เป็น managed email service สำหรับส่ง transactional หรือ bulk email โดยไม่ต้องดูแล mail server และ reputation pipeline เอง'],
    ['amazon ses', 'Amazon SES เป็น managed email service สำหรับส่ง transactional หรือ bulk email โดยไม่ต้องดูแล mail server และ reputation pipeline เอง'],
    ['trust policy', 'IAM role trust policy ระบุว่า principal ใด assume role ได้ จึงรองรับ cross-account access ด้วย temporary credentials'],
    ['least privilege', 'Least-privilege IAM policy ให้เฉพาะ actions และ resources ที่งานต้องใช้ ลด blast radius หาก credential ถูกใช้ผิด'],
    ['gp3', 'EBS gp3 แยกการกำหนด IOPS/throughput จากขนาด volume จึงปรับ performance และต้นทุนได้ยืดหยุ่นกว่า gp2'],
    ['lake formation', 'Lake Formation tag-based access control จัดสิทธิ์ data lake ตาม LF-tags และแชร์ข้าม accounts โดยไม่ต้องให้สิทธิ์ทีละ table'],
    ['amazon appflow', 'Amazon AppFlow โอนข้อมูลระหว่าง SaaS กับ AWS services ตาม schedule/event พร้อม mapping และ encryption โดยไม่ต้องสร้าง integration code เอง'],
    ['egress-only internet gateway', 'Egress-only internet gateway ให้ IPv6 workload ออก internet ได้โดยปฏิเสธ connection ที่เริ่มจากภายนอก'],
    ['write-through caching', 'Write-through cache อัปเดต cache พร้อมกับ data store ทำให้ค่าที่อ่านหลังเขียนเป็นปัจจุบันและลด cache miss สำหรับข้อมูลใหม่'],
    ['network acl', 'Network ACL เป็น stateless subnet boundary ที่ใช้ explicit deny ได้ เหมาะกับการบล็อก CIDR ก่อน traffic ถึง resources ใน subnet'],
    ['service catalog', 'AWS Service Catalog ให้ทีมใช้ infrastructure products ที่องค์กรอนุมัติและ version ไว้แล้ว จึงรักษามาตรฐานโดยไม่เปิดสิทธิ์สร้างทุก resource'],
    ['horizontal pod autoscaling', 'Kubernetes HPA ปรับจำนวน pods ตาม metric ส่วน Cluster Autoscaler เพิ่มหรือลด nodes เมื่อ pod capacity ไม่พอ'],
    ['appsync', 'AWS AppSync ให้ managed GraphQL API พร้อม resolver pipeline, authorization และ real-time subscriptions โดยไม่ต้องสร้าง GraphQL server เอง'],
    ['function url', 'Lambda Function URL เปิด HTTPS endpoint ให้ function โดยตรง เหมาะกับ webhook เรียบง่ายที่ไม่ต้องการ API management เต็มรูปแบบ'],
    ['edge-optimized endpoint', 'API Gateway edge-optimized endpoint ใช้ CloudFront distribution ที่ AWS จัดการเพื่อรับคำขอจากผู้ใช้หลายภูมิภาคด้วย latency ต่ำ'],
    ['instance scheduler', 'Instance Scheduler เปิดปิด EC2/RDS ตามตารางอัตโนมัติ เพื่อลดค่าใช้จ่ายของ environment ที่ไม่ต้องทำงานตลอดเวลา'],
    ['capacity reservation', 'Capacity Reservation กัน EC2 capacity ใน Availability Zone เป้าหมายไว้ล่วงหน้า เหมาะกับ failover ที่ต้องมั่นใจว่า launch ได้ทันที'],
    ['cross-region replication', 'S3 Cross-Region Replication คัดลอก object ใหม่ไปอีก Region อัตโนมัติ เหมาะกับ compliance, locality หรือ disaster recovery'],
    ['saml', 'SAML federation ให้ผู้ใช้ Active Directory assume IAM roles ด้วย corporate identity และ temporary credentials โดยไม่สร้าง IAM user รายคน'],
    ['amazon neptune', 'Amazon Neptune เป็น graph database ที่ query ความสัมพันธ์หลายชั้นได้ตรงกว่า relational joins และ Neptune Streams ส่ง change events ต่อได้'],
    ['fsx for netapp ontap', 'FSx for NetApp ONTAP ให้ managed shared storage พร้อม snapshots, cloning และ SnapMirror replication สำหรับ workload ที่ต้องใช้ ONTAP features'],
    ['data lifecycle manager', 'Amazon Data Lifecycle Manager สร้างและลบ EBS snapshots/AMIs ตาม policy อัตโนมัติ ลด snapshot ค้างและงาน schedule ด้วยมือ'],
    ['lambda@edge', 'Lambda@Edge ทำงานใกล้ผู้ใช้ผ่าน CloudFront จึงเหมาะกับ authorization latency ต่ำใน global web app'],
    ['cloudfront', 'CloudFront ช่วยกระจาย content แบบ global และลด latency ให้ผู้ใช้ปลายทาง'],
    ['cognito', 'Cognito เป็น managed authentication ที่ scale ได้โดยไม่ต้องดูแล identity server เอง'],
    ['snowball', 'Snowball Edge เหมาะกับการย้ายข้อมูลปริมาณมากแบบ offline จึงลดการใช้ network bandwidth'],
    ['s3 transfer acceleration', 'S3 Transfer Acceleration เหมาะกับ upload ข้ามภูมิภาคจากผู้ใช้หรือ site หลายพื้นที่ และส่งตรงเข้า S3 ได้เร็วโดยไม่ต้องทำ replication เอง'],
    ['athena', 'Athena query ข้อมูลบน S3 ได้โดยตรง ลด operational overhead'],
    ['efs', 'EFS เป็น shared file system ที่ scale และรองรับหลาย instance/AZ ได้'],
    ['object lock', 'S3 Object Lock compliance mode ป้องกันการลบแม้โดย admin/root ตาม retention ที่ตั้งไว้'],
    ['dynamodb', 'DynamoDB เหมาะกับ key-value/serverless scale และลดภาระจัดการฐานข้อมูล'],
    ['rds', 'RDS ลดงานดูแล database เมื่อเทียบกับการรัน database เองบน EC2'],
    ['sqs', 'SQS ช่วย decouple ระบบและ buffer งานเมื่อ traffic ไม่สม่ำเสมอ'],
    ['sns', 'SNS เหมาะกับ pub/sub fan-out และ notification'],
    ['eventbridge', 'EventBridge เหมาะกับ event-driven integration และ scheduled events'],
    ['principalorgid', 'aws:PrincipalOrgID จำกัด access ให้เฉพาะ accounts ใน AWS Organization ได้โดยตรง จึงไม่ต้องแก้ policy ตามแต่ละ account'],
    ['secrets manager', 'Secrets Manager เก็บ secret และรองรับการ rotation แบบ managed โดยไม่ต้องเขียนระบบหมุนเวียนเอง'],
    ['network firewall', 'AWS Network Firewall รองรับการกรอง traffic ตามกฎในระดับ network แบบ managed'],
    ['auto scaling', 'Auto Scaling เหมาะกับ compute stateless มากกว่า database stateful ที่ต้อง scale ด้วยบริการ managed'],
    ['amazon s3', 'Amazon S3 เป็น object storage ที่ durable, scale อัตโนมัติ และแยกการจัดเก็บข้อมูลออกจาก compute จึงลดการดูแล storage server'],
];

function inferServiceHint(text) {
  const lower = text.toLowerCase();
  if (lower.includes('multi-az db cluster deployment') && lower.includes('reader endpoint')) {
    return 'RDS Multi-AZ DB cluster มี writer และ readable standby สองตัว โดย reader endpoint กระจาย read workload ออกจาก writer และการ failover โดยทั่วไปใช้เวลาต่ำกว่า 35 วินาที';
  }
  const hit = SERVICE_HINTS.find(([needle]) => lower.includes(needle));
  return hit ? hit[1] : 'วิธีนี้ตอบ requirement หลักโดยตรงและไม่เพิ่มขั้นตอนที่โจทย์ไม่ได้ต้องการ';
}

const KEYWORD_CLOSER_HINTS = [
  ['amazon ec2', 'Amazon EC2 ให้ virtual server แบบ on-demand ปรับ instance type, capacity และ Region ได้ตาม workload'],
  ['ec2', 'EC2 instance เป็น virtual server ที่ AWS จัดการ hardware ให้ แต่ผู้ใช้ดูแล OS, patch และ capacity เอง'],
  ['vpc', 'VPC เป็น network เสมือนส่วนตัว กำหนด CIDR, subnets, route tables และ gateways ของคุณเอง'],
  ['availability zone', 'Availability Zone คือ data center ที่แยกอิสระภายใน Region ลด correlated failure และเพิ่ม availability'],
  ['availability zones', 'Availability Zones คือ data center ที่แยกอิสระภายใน Region ลด correlated failure และเพิ่ม availability'],
  ['internet gateway', 'Internet Gateway เชื่อม VPC กับ internet และเป็นทางออกของ public subnet'],
  ['public subnet', 'Public subnet มี route ไปยัง Internet Gateway จึงเข้าถึง internet ได้โดยตรง'],
  ['private subnet', 'Private subnet ไม่มี route ตรงไป internet ต้องใช้ NAT Gateway หรือ VPC endpoint เมื่อออกภายนอก'],
  ['iam', 'IAM จัดการ user, role และ policy ตามหลัก least privilege สำหรับควบคุมการเข้าถึง AWS resources'],
  ['kms', 'AWS KMS จัดการ encryption key และควบคุมสิทธิ์การใช้งานผ่าน key policy'],
  ['encryption at rest', 'Encryption at rest เข้ารหัสข้อมูลที่จัดเก็บไว้ ป้องกันการอ่านข้อมูลดิบหาก storage ถูกเข้าถึง'],
  ['encryption in transit', 'Encryption in transit เข้ารหัสข้อมูลระหว่างส่งผ่านเครือข่าย เช่น TLS/SSL'],
  ['encrypted at rest', 'Encrypted at rest หมายถึงข้อมูลถูกเข้ารหัสขณะจัดเก็บ ป้องกันการอ่านข้อมูลดิบ'],
  ['on-premises', 'On-premises หมายถึงระบบที่ run ใน data center ขององค์กรเอง ไม่ใช่บน cloud'],
  ['rto', 'RTO คือเวลาสูงสุดที่ยอมให้ระบบกลับมาใช้งานได้หลังเกิดเหตุ'],
  ['rpo', 'RPO คือปริมาณข้อมูลที่ยอมเสียได้สูงสุด วัดเป็นช่วงเวลาย้อนหลัง'],
];
const KEYWORD_HINTS = [...SERVICE_HINTS, ...KEYWORD_CLOSER_HINTS];
const KEYWORD_LIMIT = 5;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatchIndexes(lowerText, needle) {
  if (/^[a-z0-9][a-z0-9-]{0,4}$/.test(needle)) {
    const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'g');
    const indexes = [];
    let match;
    while ((match = re.exec(lowerText)) !== null) indexes.push(match.index);
    return indexes;
  }
  const indexes = [];
  let index = lowerText.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = lowerText.indexOf(needle, index + needle.length);
  }
  return indexes;
}

export function buildKeywordExplanations(question) {
  const prompt = question.prompt || '';
  const choicesText = Object.values(question.choices || {}).join(' ');
  const fullText = `${prompt} ${choicesText}`;
  const lower = fullText.toLowerCase();
  const matches = [];
  for (const [needle, explanation] of KEYWORD_HINTS) {
    for (const index of keywordMatchIndexes(lower, needle)) {
      matches.push({ needle, explanation, index, term: fullText.slice(index, index + needle.length) });
    }
  }
  matches.sort((a, b) => a.index - b.index || b.needle.length - a.needle.length);
  const kept = [];
  const seen = new Set();
  for (const match of matches) {
    const termKey = match.term.toLowerCase();
    if (seen.has(termKey)) continue;
    const subsumed = kept.some(
      (existing) =>
        match.index >= existing.index &&
        match.index + match.needle.length <= existing.index + existing.needle.length,
    );
    if (subsumed) continue;
    kept.push(match);
    seen.add(termKey);
    if (kept.length >= KEYWORD_LIMIT) break;
  }
  const deduped = kept.filter(
    (match) =>
      !kept.some(
        (other) =>
          other !== match &&
          other.term.length > match.term.length &&
          other.term.toLowerCase().includes(match.term.toLowerCase()),
      ),
  );
  return deduped.map(({ term, explanation }) => ({ term, explanation }));
}

function inferConstraintHint(prompt) {
  const lower = prompt.toLowerCase();
  const constraints = [
    [/least (?:amount of )?operational overhead|operationally efficient|minimize operational complexity/, 'ลด operational overhead'],
    [/most cost-effective|minimal costs/, 'คุมค่าใช้จ่าย'],
    [/least possible network bandwidth|minimum network bandwidth|low network bandwidth/, 'ใช้ network bandwidth ให้น้อยที่สุด'],
    [/as quickly as possible|quick solution|low latency|quickly/, 'ความเร็วในการตอบสนองหรือส่งข้อมูล'],
    [/high availability|fault tolerance|least downtime|minimal downtime/, 'ความพร้อมใช้งานสูง'],
    [/scalability|scalable|scale|traffic.*increases|growing number/, 'การรองรับการเติบโต'],
    [/without connectivity to the internet|private network connectivity/, 'private connectivity'],
  ];
  return constraints
    .filter(([pattern]) => pattern.test(lower))
    .map(([, description]) => description)
    .filter((description, index, descriptions) => descriptions.indexOf(description) === index)
    .join(' และ');
}

function inferDistractorReason(optionText, prompt, constraintHint) {
  const lower = String(optionText || '').toLowerCase();
  const promptLower = prompt.toLowerCase();
  if (
    /aws organizations?|organization membership/.test(promptLower) &&
    /cloudtrail|monitor.*event|update.*policy/.test(lower)
  ) {
    return 'ต้อง monitor event และปรับ policy เองเมื่อสมาชิกใน organization เปลี่ยน ทำให้มีงานดูแลต่อเนื่อง';
  }
  const rules = [
    [
      /multi-az db instance deployment.*read replica/,
      /less than 40 seconds|under 40 seconds/.test(promptLower)
        ? 'Multi-AZ DB instance มีเวลา failover โดยทั่วไปประมาณ 60–120 วินาที จึงไม่ผ่านเงื่อนไขต่ำกว่า 40 วินาที แม้ read replica จะแยกภาระอ่านได้'
        : 'read replica แยกภาระอ่านได้ แต่ไม่ได้เปลี่ยนเวลา failover ของ Multi-AZ DB instance และยังเป็น resource เพิ่มที่ต้องเสียค่าใช้จ่าย',
    ],
    [
      /multi-az db (?:cluster|duster) deployment.*(?:create )?two read replicas/,
      'Multi-AZ DB cluster มี readable standby สองตัวและ reader endpoint อยู่แล้ว การสร้าง read replicas เพิ่มอีกสองตัวจึงซ้ำซ้อนและเพิ่มค่าใช้จ่าย',
    ],
    [
      /multi-az db instance deployment.*(?:secondary|standby) instance/,
      'standby ของ Multi-AZ DB instance มีไว้สำหรับ failover และไม่รองรับ read traffic จึงไม่สามารถส่ง read workload ไปยัง instance นั้นได้',
    ],
    [/principalorgpaths|principalorgid|principaltag|organizational unit/, 'ต้องเพิ่มโครงสร้าง OU หรือ tag และดูแล policy condition เอง จึงซับซ้อนกว่าการจำกัดด้วย organization โดยตรง'],
    [/file gateway/, 'S3 File Gateway เหมาะกับการใช้งานไฟล์แบบ hybrid แต่ต้องติดตั้ง gateway และใช้ network ในการย้ายข้อมูลเพิ่ม'],
    [
      /snowball/,
      promptLower.includes('high-speed internet')
        ? 'เหมาะเมื่อ network ไม่พอหรือจำเป็นต้องส่งข้อมูลแบบ offline มากกว่า แต่โจทย์มี high-speed Internet อยู่แล้ว'
        : 'เพิ่มขั้นตอนจัดส่งและจัดการอุปกรณ์ จึงมี operational overhead สูงกว่า',
    ],
    [/cross-region replication|replication/, 'การใช้ replication ต้องมี bucket หรือระบบเพิ่ม และต้องดูแลข้อมูลต้นทางกับปลายทางแยกกัน'],
    [/snapshot|restore/, 'การใช้ snapshot ต้องทำ copy และ restore หลายขั้นตอน ไม่ได้ส่งข้อมูลเข้า service ปลายทางโดยตรง'],
    [/parameter store/, 'Parameter Store ไม่ได้ให้ secret rotation แบบ managed ครบเท่า Secrets Manager จึงต้องเพิ่มงานหมุนเวียน secret เอง'],
    [/cloudfront.*global accelerator|global accelerator/, 'การใช้ CloudFront ร่วมกับ Global Accelerator เพิ่ม distribution, accelerator และ DNS configuration ที่ต้องดูแลหลายส่วน'],
    [/redshift/, 'การใช้ Redshift ต้อง load ข้อมูลเข้า warehouse และดูแล cluster ทั้งที่โจทย์เป็น query แบบง่ายหรือ on-demand'],
    [/cloudwatch logs/, 'การใช้ CloudWatch Logs ไม่ตรงกับแหล่งข้อมูลใน S3 และทำให้ต้องย้ายหรือส่ง log ไปยังระบบอื่นก่อน'],
    [/glue/, 'การใช้ Glue เพิ่มขั้นตอน catalog หรือ crawler ซึ่งไม่จำเป็นกับ requirement ที่ต้องการ query แบบง่าย'],
    [/emr|spark/, 'การใช้ EMR/Spark ต้อง provision และดูแล cluster เพิ่ม จึงมี operational overhead สูงกว่า'],
    [/s3 transfer acceleration/, 'ช่วยเรื่องการอัปโหลดข้ามภูมิภาค แต่ไม่ใช่คำตอบเมื่อโจทย์ต้อง query หรือจัดการข้อมูลที่อยู่ใน S3 แล้ว'],
    [/athena/, 'เหมาะกับการ query ข้อมูลบน S3 โดยตรง แต่ตัวเลือกนี้ไม่ตอบ requirement อื่นของโจทย์ได้ครบเท่าคำตอบที่ถูก'],
    [/amazon ec2|ec2 instance|\bec2\b/, 'ต้องดูแล instance, capacity และระบบปฏิบัติการเอง จึงมีภาระมากกว่าบริการ managed'],
    [/amazon ebs|ebs volume|\bebs\b/, 'เป็น block storage ที่ผูกกับ instance และไม่ใช่ shared หรือ direct service ที่โจทย์ต้องการ'],
    [/direct connect/, 'ต้องจัดเตรียม dedicated connection และ network configuration เพิ่ม ซึ่งเกินความจำเป็นสำหรับ requirement นี้'],
    [/api gateway/, 'เป็น API layer ไม่ใช่กลไกหลักสำหรับ requirement ด้าน storage หรือ network connectivity นี้'],
    [/instance profile/, 'ช่วยเรื่องสิทธิ์ของ EC2 แต่ไม่ได้สร้าง private network connectivity ให้ service'],
    [/guardduty/, 'GuardDuty เน้นตรวจจับภัยคุกคาม ไม่ใช่กลไก inline traffic filtering ตาม requirement นี้'],
    [/traffic mirroring/, 'Traffic Mirroring ช่วยส่งสำเนา traffic ไปตรวจสอบ แต่ไม่ได้บังคับใช้กฎเพื่อกรอง traffic โดยตรง'],
    [/iam user|login credentials|bastion|rdp credentials/, 'เพิ่มการจัดการ user, credential หรือ bastion แบบเฉพาะกิจ ซึ่งมีความเสี่ยงและภาระดูแลมากกว่า identity federation'],
    [/single-az|reader instances/, 'ยังมีข้อจำกัดด้าน Availability Zone หรือ failover และไม่ตรงกับ requirement เรื่องความพร้อมใช้งานเท่าคำตอบที่ถูก'],
    [/cost and usage reports/, 'เป็นรายงานแบบ batch และต้องสร้าง pipeline เพิ่ม จึงไม่เหมาะกับการดูข้อมูลเชิงโต้ตอบแบบทันที'],
    [/auto scaling/, 'เหมาะกับการ scale compute แบบ stateless มากกว่า requirement ที่ต้องจัดการข้อมูลหรือ database stateful'],
    [/custom script|cron|crontab|scheduled script/, 'ต้องพัฒนาและดูแล custom script หรือ schedule เอง ทำให้ operational overhead สูงขึ้น'],
    [/copy|migrate|\bload\b|multiple (?:steps|components)|several/, 'เพิ่มขั้นตอนหรือ component ที่ต้องดูแล และไม่ตรงกับเป้าหมายเรื่องความเรียบง่ายเท่าคำตอบที่ถูก'],
  ];
  const match = rules.find(([pattern]) => pattern.test(lower));
  if (match) return match[1];

  // ponytail: keyword fallback covers the local bank; add curated per-question notes if exam-level nuance is needed.
  const optionFocus = [
    [/monitor|log|event|update/, 'การ monitor และปรับ configuration เอง'],
    [/credential|password|secret|user|login/, 'การจัดการ identity หรือ credential เอง'],
    [/deploy|launch|create|configure/, 'การเพิ่ม component และ configuration'],
    [/copy|migrate|transfer|upload|\bload\b/, 'การย้ายหรือ copy ข้อมูลเพิ่ม'],
    [/store|bucket|database|volume/, 'การเพิ่ม storage หรือ data layer'],
  ].find(([pattern]) => pattern.test(lower));
  if (optionFocus) {
    return `ตัวเลือกนี้เพิ่ม${optionFocus[1]} และไม่ตอบโจทย์${constraintHint || 'requirement หลัก'}ได้ตรงเท่าคำตอบที่ถูก`;
  }

  return constraintHint
    ? `ไม่ตอบโจทย์${constraintHint}ได้ตรงเท่าคำตอบที่ถูก`
    : 'ไม่ตอบ requirement หลักได้ตรงเท่าคำตอบที่ถูก หรือเพิ่มภาระที่ไม่จำเป็น';
}

function inferSharedComparisonReason(correctText, constraintHint, correct) {
  const correctHint = inferServiceHint(correctText);
  if (correctHint.startsWith('วิธีนี้ตอบ requirement หลัก')) {
    return constraintHint
      ? `คำตอบ ${correct} ตอบโจทย์${constraintHint}ได้ตรงกว่า`
      : `คำตอบ ${correct} ตอบ requirement หลักได้ตรงกว่าโดยไม่เพิ่มขั้นตอนที่ไม่จำเป็น`;
  }
  return constraintHint
    ? `${correctHint} จึงไม่ตรงกับเป้าหมายเรื่อง${constraintHint}`
    : `${correctHint} จึงไม่ตรงกับ requirement หลักของโจทย์`;
}

function isGenericDistractorReason(reason) {
  return [
    'เพิ่มขั้นตอนหรือ component ที่ต้องดูแล และไม่ตรงกับเป้าหมายเรื่องความเรียบง่ายเท่าคำตอบที่ถูก',
    'ไม่ตอบ requirement หลักได้ตรงเท่าคำตอบที่ถูก หรือเพิ่มภาระที่ไม่จำเป็น',
  ].includes(reason) || reason.startsWith('ตัวเลือกนี้เพิ่มการเพิ่ม component และ configuration');
}
