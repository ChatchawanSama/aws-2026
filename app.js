const {
  advanceMockSession,
  buildDomainOptions,
  buildExplanation,
  buildKeywordExplanations,
  createMockSession,
  getStats,
  gradeAnswer,
  recordMockAnswer,
  selectNextQuestion,
  summarizeWeakAreas,
  updateProgress,
} = globalThis.SaaTutorLogic;

const STORAGE_KEY = 'saa-c03-tutor-progress-v1';
const MOCK_STORAGE_KEY = 'saa-c03-mock-session-v1';
const MOCK_HISTORY_KEY = 'saa-c03-mock-history-v1';

const state = {
  questions: [],
  examDomains: [],
  progress: loadProgress(),
  current: null,
  mode: 'practice',
  answered: false,
  mockSession: loadMockSession(),
  timerId: null,
};

const el = {
  sourceStatus: document.querySelector('#sourceStatus'),
  answeredCount: document.querySelector('#answeredCount'),
  accuracyRate: document.querySelector('#accuracyRate'),
  wrongCount: document.querySelector('#wrongCount'),
  domainSelect: document.querySelector('#domainSelect'),
  practiceButton: document.querySelector('#practiceButton'),
  reviewButton: document.querySelector('#reviewButton'),
  mockButton: document.querySelector('#mockButton'),
  summaryButton: document.querySelector('#summaryButton'),
  revealButton: document.querySelector('#revealButton'),
  resetButton: document.querySelector('#resetButton'),
  questionId: document.querySelector('#questionId'),
  questionDomain: document.querySelector('#questionDomain'),
  questionType: document.querySelector('#questionType'),
  questionPrompt: document.querySelector('#questionPrompt'),
  keywordPanel: document.querySelector('#keywordPanel'),
  keywordList: document.querySelector('#keywordList'),
  choicesForm: document.querySelector('#choicesForm'),
  submitButton: document.querySelector('#submitButton'),
  nextButton: document.querySelector('#nextButton'),
  feedback: document.querySelector('#feedback'),
  sessionStatus: document.querySelector('#sessionStatus'),
  sessionProgress: document.querySelector('#sessionProgress'),
  sessionTimer: document.querySelector('#sessionTimer'),
  drawer: document.querySelector('#drawer'),
  drawerTitle: document.querySelector('#drawerTitle'),
  drawerBody: document.querySelector('#drawerBody'),
  drawerClose: document.querySelector('#drawerClose'),
};

init();

async function init() {
  try {
    const bankPromise = globalThis.SAA_C03_TUTOR_BANK
      ? Promise.resolve(globalThis.SAA_C03_TUTOR_BANK)
      : fetch('./saa_c03_tutor_bank.json').then((response) => response.json());
    const progressPromise = location.protocol === 'file:'
      ? Promise.resolve(null)
      : fetch('./saa_c03_tutor_progress.json')
          .then((response) => response.json())
          .catch(() => null);
    const [bank, fileProgress] = await Promise.all([
      bankPromise,
      progressPromise,
    ]);
    state.questions = bank.questions || [];
    state.examDomains = bank.exam_domains || [];
    if (!localStorage.getItem(STORAGE_KEY) && fileProgress) {
      state.progress = normalizeImportedProgress(fileProgress);
      saveProgress();
    }
    hydrateDomains();
    el.sourceStatus.textContent = `${state.questions.length.toLocaleString()} questions loaded from local bank`;
    bindEvents();
    if (canResumeMockSession()) {
      showMockQuestion();
    } else {
      localStorage.removeItem(MOCK_STORAGE_KEY);
      state.mockSession = null;
      nextQuestion('practice');
    }
  } catch (error) {
    el.sourceStatus.textContent = 'Cannot load the local question bank.';
    el.questionPrompt.textContent = error.message;
    el.submitButton.disabled = true;
    el.nextButton.disabled = true;
  }
}

function bindEvents() {
  el.practiceButton.addEventListener('click', () => nextQuestion('practice'));
  el.reviewButton.addEventListener('click', () => nextQuestion('review'));
  el.mockButton.addEventListener('click', startMockSession);
  el.nextButton.addEventListener('click', () => {
    if (state.mode === 'mock') advanceMockQuestion();
    else nextQuestion(state.mode);
  });
  el.submitButton.addEventListener('click', submitAnswer);
  el.summaryButton.addEventListener('click', showSummary);
  el.revealButton.addEventListener('click', showAnswers);
  el.resetButton.addEventListener('click', resetAllProgress);
  el.drawerClose.addEventListener('click', () => {
    el.drawer.hidden = true;
  });
  el.domainSelect.addEventListener('change', () => nextQuestion('practice'));
  el.choicesForm.addEventListener('change', () => {
    el.submitButton.disabled = !el.choicesForm.querySelector('input:checked');
  });
}

function hydrateDomains() {
  el.domainSelect.replaceChildren(
    ...buildDomainOptions(state.examDomains, state.questions).map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
}

function nextQuestion(mode) {
  const domain = el.domainSelect.value || 'all';
  state.mode = mode;
  state.current = selectNextQuestion(state.questions, {
    ...state.progress,
    domain,
    mode,
  });
  state.answered = false;
  el.feedback.hidden = true;
  el.feedback.className = 'feedback';
  el.submitButton.disabled = true;
  el.nextButton.dataset.emphasis = 'secondary';
  el.nextButton.disabled = false;
  renderModeControls();
  renderQuestion();
  document.querySelector('.question-scroll').scrollTop = 0;
  renderStats();
}

function renderQuestion() {
  const question = state.current;
  if (!question) {
    el.questionId.textContent = 'No question';
    el.questionDomain.textContent = el.domainSelect.selectedOptions[0]?.textContent || 'All official domains';
    el.questionType.textContent = state.mode === 'review' ? 'Review misses' : 'Practice';
    el.questionPrompt.textContent =
      state.mode === 'review' ? 'ยังไม่มีข้อผิดในหมวดนี้ให้ทวน' : 'No question available for this filter.';
    el.keywordPanel.hidden = true;
    el.choicesForm.replaceChildren();
    el.submitButton.disabled = true;
    return;
  }

  state.progress.lastQuestionId = question.id;
  saveProgress();

  el.questionId.textContent = `Question #${question.id}`;
  el.questionDomain.textContent = question.domain;
  el.questionType.textContent = question.question_type === 'multiple_select_choice' ? 'Choose multiple' : 'Choose one';
  el.questionPrompt.textContent = question.prompt;
  renderKeywords(question);
  el.submitButton.disabled = true;
  el.nextButton.disabled = false;
  el.choicesForm.replaceChildren(
    ...Object.entries(question.choices).map(([letter, text]) => makeChoice(question, letter, text)),
  );
}

function renderKeywords(question) {
  const keywords = state.mode === 'mock' ? [] : buildKeywordExplanations(question);
  if (!keywords.length) {
    el.keywordPanel.hidden = true;
    el.keywordPanel.open = false;
    el.keywordList.replaceChildren();
    return;
  }
  el.keywordPanel.hidden = false;
  el.keywordPanel.open = true;
  el.keywordList.replaceChildren(
    ...keywords.map(({ term, explanation }) => {
      const item = document.createElement('li');
      const termEl = document.createElement('strong');
      termEl.textContent = term;
      const description = document.createElement('span');
      description.textContent = explanation;
      item.append(termEl, document.createTextNode(' — '), description);
      return item;
    }),
  );
}

function makeChoice(question, letter, text) {
  const label = document.createElement('label');
  label.className = 'choice';
  const input = document.createElement('input');
  input.type = question.question_type === 'multiple_select_choice' ? 'checkbox' : 'radio';
  input.name = 'answer';
  input.value = letter;
  const body = document.createElement('span');
  body.innerHTML = `<span class="choice-letter">${letter}</span> ${escapeHtml(text)}`;
  label.append(input, body);
  return label;
}

function submitAnswer() {
  if (!state.current || state.answered) return;
  const selected = [...el.choicesForm.querySelectorAll('input:checked')].map((input) => input.value).join('');
  const result = gradeAnswer(state.current, selected);
  state.progress = updateProgress(state.progress, state.current, result);
  if (state.mode === 'mock') {
    state.mockSession = recordMockAnswer(state.mockSession, state.current.id, result);
    saveMockSession();
  }
  state.answered = true;
  saveProgress();
  markChoices(result);
  renderFeedback(result, selected);
  el.submitButton.disabled = true;
  el.nextButton.dataset.emphasis = 'primary';
  el.nextButton.disabled = false;
  renderStats();
}

function markChoices(result) {
  const correctLetters = new Set(result.correct.split(''));
  const selectedLetters = new Set(result.normalized.split(''));
  for (const label of el.choicesForm.querySelectorAll('.choice')) {
    const input = label.querySelector('input');
    input.disabled = true;
    if (correctLetters.has(input.value)) label.classList.add('correct');
    if (selectedLetters.has(input.value) && !correctLetters.has(input.value)) label.classList.add('wrong');
  }
}

function renderFeedback(result, selected) {
  el.feedback.hidden = false;
  el.feedback.className = `feedback ${result.isCorrect ? 'good' : 'bad'}`;
  const explanation = buildExplanation(state.current, selected);

  const title = document.createElement('strong');
  title.className = 'feedback-title';
  title.textContent = explanation.title;

  const answer = document.createElement('p');
  answer.className = 'feedback-answer';
  answer.textContent = explanation.answer;

  const content = [title, answer];
  for (const paragraph of explanation.paragraphs) {
    const text = document.createElement('p');
    text.className = 'feedback-reason';
    text.textContent = paragraph;
    content.push(text);
  }

  el.feedback.replaceChildren(...content);
}

function renderStats() {
  const stats = getStats(state.questions, state.progress);
  el.answeredCount.textContent = stats.answered.toLocaleString();
  el.accuracyRate.textContent = `${stats.accuracy}%`;
  el.wrongCount.textContent = stats.wrongAttempts.toLocaleString();
}

function showSummary() {
  const { domains, ambiguousMisses } = summarizeWeakAreas(state.questions, state.progress);
  el.drawerTitle.textContent = 'สรุปจุดที่ควรทวน';
  if (!domains.length && !ambiguousMisses) {
    el.drawerBody.innerHTML = '<p class="empty">ยังไม่มีข้อผิดให้สรุป</p>';
  } else {
    const officialSummary = domains.length
      ? `<table><thead><tr><th>Official exam domain</th><th>Misses</th></tr></thead><tbody>${domains
          .map((item) => `<tr><td>${escapeHtml(item.domain)}</td><td>${item.missed}</td></tr>`)
          .join('')}</tbody></table>`
      : '<p class="empty">ยังไม่มีข้อผิดใน official domains</p>';
    const ambiguousSummary = ambiguousMisses
      ? `<p class="ambiguous-summary"><strong>${ambiguousMisses} miss${ambiguousMisses === 1 ? '' : 'es'}</strong> · Ambiguous questions are shown separately and excluded from official-domain totals.</p>`
      : '';
    el.drawerBody.innerHTML = officialSummary + ambiguousSummary;
  }
  openDrawer();
}

function showAnswers() {
  const rows = state.questions
    .map(
      (q) =>
        `<tr><td class="question-number">#${q.id}</td><td><span class="answer-badge">${escapeHtml(q.correct_answer)}</span></td><td>${escapeHtml(q.domain)}</td></tr>`,
    )
    .join('');
  el.drawerTitle.textContent = 'เฉลยทั้งหมด';
  el.drawerBody.innerHTML = `<p class="drawer-summary">ทั้งหมด ${state.questions.length.toLocaleString()} ข้อ</p><div class="table-scroll"><table class="answer-key-table"><thead><tr><th>Question</th><th>Answer</th><th>Domain</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  openDrawer();
}

function startMockSession() {
  state.mockSession = createMockSession(state.questions, {
    previousQuestionIds: loadMockHistory(),
  });
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(state.mockSession.historyQuestionIds));
  saveMockSession();
  showMockQuestion();
}

function showMockQuestion() {
  const session = state.mockSession;
  if (!session || session.deadline <= Date.now()) {
    finishMockSession(true);
    return;
  }
  state.mode = 'mock';
  state.current = state.questions.find((question) => question.id === session.questionIds[session.index]) || null;
  state.answered = false;
  el.feedback.hidden = true;
  el.feedback.className = 'feedback';
  el.submitButton.disabled = true;
  el.nextButton.disabled = true;
  el.nextButton.dataset.emphasis = 'secondary';
  renderModeControls();
  renderQuestion();
  el.nextButton.disabled = true;
  el.sessionProgress.textContent = `${session.index + 1} / ${session.questionIds.length}`;
  document.querySelector('.question-scroll').scrollTop = 0;

  const savedResult = session.results[String(state.current?.id)];
  if (savedResult) restoreMockAnswer(savedResult.answer);
  startMockTimer();
}

function restoreMockAnswer(answer) {
  for (const input of el.choicesForm.querySelectorAll('input')) {
    input.checked = answer.includes(input.value);
  }
  const result = gradeAnswer(state.current, answer);
  state.answered = true;
  markChoices(result);
  renderFeedback(result, answer);
  el.submitButton.disabled = true;
  el.nextButton.disabled = false;
  el.nextButton.dataset.emphasis = 'primary';
}

function advanceMockQuestion() {
  const next = advanceMockSession(state.mockSession);
  if (next === state.mockSession) return;
  state.mockSession = next;
  saveMockSession();
  if (next.completed) finishMockSession(false);
  else showMockQuestion();
}

function finishMockSession(timedOut) {
  const session = state.mockSession;
  clearMockTimer();
  localStorage.removeItem(MOCK_STORAGE_KEY);
  state.mockSession = null;
  nextQuestion('practice');
  if (!session) return;

  const results = Object.entries(session.results || {});
  const correct = results.filter(([, result]) => result.isCorrect).length;
  const wrong = Object.fromEntries(results.filter(([, result]) => !result.isCorrect).map(([id]) => [id, 1]));
  const { domains, ambiguousMisses } = summarizeWeakAreas(state.questions, { wrong });
  el.drawerTitle.textContent = timedOut ? 'หมดเวลา Mock Exam' : 'สรุป Mock Exam';
  el.drawerBody.innerHTML = `<div class="session-result"><strong>${correct} / ${session.questionIds.length}</strong><span>${results.length} answered</span></div>${
    domains.length
      ? `<div class="table-scroll"><table><thead><tr><th>Official exam domain</th><th>Misses</th></tr></thead><tbody>${domains.map((item) => `<tr><td>${escapeHtml(item.domain)}</td><td>${item.missed}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">ไม่มีข้อผิดใน session นี้</p>'
  }${ambiguousMisses ? `<p class="ambiguous-summary"><strong>${ambiguousMisses}</strong> ambiguous misses</p>` : ''}`;
  openDrawer();
}

function openDrawer() {
  el.drawer.hidden = false;
  el.drawer.scrollIntoView({ block: 'start' });
}

function renderModeControls() {
  const isMock = state.mode === 'mock';
  el.practiceButton.setAttribute('aria-pressed', String(state.mode === 'practice'));
  el.reviewButton.setAttribute('aria-pressed', String(state.mode === 'review'));
  el.mockButton.setAttribute('aria-pressed', String(isMock));
  el.practiceButton.disabled = isMock;
  el.reviewButton.disabled = isMock;
  el.mockButton.disabled = isMock;
  el.domainSelect.disabled = isMock;
  el.revealButton.hidden = isMock;
  el.sessionStatus.hidden = !isMock;
  if (!isMock) clearMockTimer();
}

function startMockTimer() {
  clearMockTimer();
  updateMockTimer();
  state.timerId = window.setInterval(updateMockTimer, 1_000);
}

function updateMockTimer() {
  const remaining = Math.max(0, state.mockSession.deadline - Date.now());
  const totalSeconds = Math.ceil(remaining / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  el.sessionTimer.textContent = `${minutes}:${seconds}`;
  if (!remaining) finishMockSession(true);
}

function clearMockTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
}

function resetAllProgress() {
  if (!window.confirm('ล้าง progress, ข้อผิดที่บันทึกไว้ และ Mock Exam ที่กำลังทำทั้งหมด?')) return;
  state.progress = emptyProgress();
  saveProgress();
  localStorage.removeItem(MOCK_STORAGE_KEY);
  localStorage.removeItem(MOCK_HISTORY_KEY);
  state.mockSession = null;
  el.drawer.hidden = true;
  nextQuestion('practice');
  state.progress = emptyProgress();
  saveProgress();
  renderStats();
}

function canResumeMockSession() {
  return Boolean(
    state.mockSession &&
      !state.mockSession.completed &&
      state.mockSession.deadline > Date.now() &&
      state.mockSession.questionIds?.length === 65 &&
      state.mockSession.questionIds.every((id) => state.questions.some((question) => question.id === id)),
  );
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyProgress();
  } catch {
    return emptyProgress();
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function loadMockSession() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  } catch {
    return null;
  }
}

function loadMockHistory() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveMockSession() {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state.mockSession));
}

function emptyProgress() {
  return { asked: [], wrong: {}, correct: {}, answers: {}, lastQuestionId: null };
}

function normalizeImportedProgress(progress) {
  return {
    asked: progress.asked || [],
    wrong: progress.wrong || {},
    correct: progress.correct || {},
    answers: {},
    lastQuestionId: progress.lastQuestionId ?? progress.last_question_id ?? null,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
