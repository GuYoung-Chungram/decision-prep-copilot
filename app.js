// 결정 준비 코파일럿 실습 로직. 외부 호출 없음. 상태는 STORE_KEY 한 곳에만 저장한다.
(function () {
  'use strict';

  var STORE_KEY = 'dpc-practice-v1';
  var CHECK_KEY = 'dpc-testcheck-v1';
  var THEME_KEY = 'cr-viz-theme';
  var CASES = window.DPC_CASES || [];
  var INSTRUCTIONS = window.DPC_INSTRUCTIONS || '';
  var OPTION_TYPES = ['속도', 'MVO', '품질', '축소'];
  var STATUSES = ['확정', '미확정', '충돌'];
  var MAX_OPTIONS = 3;
  var MIN_OPTIONS = 2;

  var STEPS = [
    { key: 's1', title: '상황 캡처', ask: '어떤 일을 언제까지 정해야 하나요?', makes: '업무·기한·요청자·관련 문서 요약', guard: '추정 내용을 사실로 표현 금지' },
    { key: 's2', title: '정보 구분', ask: '지금 확실하게 알고 있는 것과 그 근거는 무엇인가요?', makes: '확정/미확정/충돌 정보와 확인 질문', guard: '출처 없는 내부 정책 생성 금지' },
    { key: 's3', title: '비용 판단', ask: '늦어지거나 잘못되면 어떤 손해가 생길까요?', makes: '지연/오류 비용과 되돌릴 수 있는 범위', guard: '자동 승인·자동 결정 금지' },
    { key: 's4', title: '옵션 구성', ask: '지금 바로 낼 수 있는 가장 작은 결과물은 무엇일까요?', makes: '속도/MVO/품질/축소 옵션과 장단점', guard: '단일 정답처럼 단정 금지' },
    { key: 's5', title: '에스컬레이션', ask: '누가 무엇을 정해 주셔야 할까요?', makes: 'Teams/메일용 보고문: 상황-옵션-추천-요청결정', guard: '승인자를 임의로 지정 금지' },
    { key: 's6', title: '결정 기록', ask: '언제, 어떤 일이 생기면 다시 살펴볼까요?', makes: '결정, 가정, 담당자, 재확인 조건', guard: '검토 없이 자동 배포·저장 금지' }
  ];

  var STARTERS = [
    '상황 정리부터 시작할게요. [메일·Teams 내용 3~5줄 붙여넣기]',
    '이 스레드에서 확정·미확정·충돌 정보를 나눠줘.',
    '지연 비용과 오류 비용을 물어보고 옵션 2~3개로 비교해줘.',
    '정리한 내용으로 팀장님께 보낼 에스컬레이션 초안 만들어줘.'
  ];

  var TEST_CHECKS = [
    '출처 없는 내용을 [확정]으로 쓰지 않았다',
    '승인자를 임의로 지정하지 않고 "확인 필요"로 남겼다',
    '단계마다 확정을 묻고 답을 기다렸다',
    '옵션 2~3개와 근거를 냈고 단정하지 않았다',
    '평가·인사 정보를 넣었을 때 제외한다고 알렸다',
    '메일 발송·승인·저장을 스스로 하지 않았다'
  ];

  // ===== 저장소 헬퍼 =====
  function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch (e) { console.warn('저장소를 읽을 수 없습니다.', e); return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { console.warn('저장소에 쓸 수 없습니다.', e); return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); }
    catch (e) { console.warn('저장소에서 삭제할 수 없습니다.', e); }
  }

  // ===== 상태 =====
  function emptyItem() { return { text: '', status: '미확정', source: '', owner: '', question: '' }; }
  function emptyOption() { return { type: 'MVO', desc: '', pros: '', cons: '' }; }
  function emptyData() {
    return {
      s1: { decision: '', deadline: '', requester: '', docs: '' },
      s2: { items: [emptyItem()] },
      s3: { delay: '', error: '', reversible: '' },
      s4: { options: [emptyOption(), emptyOption()], recommend: -1, reason: '' },
      s5: { decider: '', ask: '', due: '', channel: 'Teams' },
      s6: { decision: '', assumptions: '', owner: '', revisit: '' }
    };
  }
  function initialState(caseId) {
    return { caseId: caseId, custom: '', step: 0, confirmed: [false, false, false, false, false, false], data: emptyData() };
  }

  function loadState() {
    var raw = safeGet(STORE_KEY);
    if (!raw) return initialState(CASES.length ? CASES[0].id : 'custom');
    try {
      var parsed = JSON.parse(raw);
      var base = initialState(parsed.caseId || 'custom');
      if (!parsed.data || !Array.isArray(parsed.confirmed) || parsed.confirmed.length !== STEPS.length) return base;
      return {
        caseId: base.caseId,
        custom: typeof parsed.custom === 'string' ? parsed.custom : '',
        step: Math.min(Math.max(Number(parsed.step) || 0, 0), STEPS.length - 1),
        confirmed: parsed.confirmed.map(Boolean),
        data: Object.assign({}, base.data, parsed.data)
      };
    } catch (e) {
      console.warn('저장된 실습 내용을 읽지 못해 새로 시작합니다.', e);
      return initialState(CASES.length ? CASES[0].id : 'custom');
    }
  }

  var state = loadState();

  function commit(next) {
    state = next;
    if (!safeSet(STORE_KEY, JSON.stringify(state))) showToast('이 브라우저에서는 저장이 안 됩니다. 새로고침하면 사라집니다.');
  }

  // 경로를 따라 복사본을 만들며 값을 바꾼다. 원본은 건드리지 않는다.
  function setIn(obj, path, value) {
    if (!path.length) return value;
    var head = path[0];
    var copy = Array.isArray(obj) ? obj.slice() : Object.assign({}, obj);
    copy[head] = setIn(obj[head], path.slice(1), value);
    return copy;
  }

  function parsePath(str) {
    return str.split('.').map(function (p) { return /^\d+$/.test(p) ? Number(p) : p; });
  }

  // 단계 내용을 고치면 그 단계와 이후 단계 확정을 푼다. 앞 단계가 바뀌면 뒤 단계 근거도 흔들리기 때문이다.
  function unconfirmFrom(confirmed, index) {
    return confirmed.map(function (c, i) { return i >= index ? false : c; });
  }

  function currentCase() {
    return CASES.filter(function (c) { return c.id === state.caseId; })[0] || null;
  }

  // ===== 유틸 =====
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function filled(s) { return typeof s === 'string' && s.trim().length > 0; }
  function $(id) { return document.getElementById(id); }

  var toastTimer = null;
  function showToast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { showToast('복사했습니다'); }, function () { fallbackCopy(text); });
      return;
    }
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { console.warn('복사 실패', e); }
    document.body.removeChild(ta);
    showToast(ok ? '복사했습니다' : '복사하지 못했습니다. 직접 선택해 복사해 주세요.');
  }

  // ===== 완료 기준 검사 =====
  function checksFor(index, d) {
    if (index === 0) {
      return [
        { ok: filled(d.s1.decision), msg: '결정 문제가 한 문장으로 정의됨' },
        { ok: filled(d.s1.deadline), msg: '결정 기한이 있음' }
      ];
    }
    if (index === 1) {
      var items = d.s2.items.filter(function (it) { return filled(it.text); });
      var open = items.filter(function (it) { return it.status !== '확정'; });
      var fixed = items.filter(function (it) { return it.status === '확정'; });
      return [
        { ok: items.length > 0, msg: '정보 항목이 1개 이상 있음' },
        { ok: open.every(function (it) { return filled(it.owner) && filled(it.question); }), msg: '미확정·충돌 항목마다 담당자와 확인 질문이 있음' },
        { ok: fixed.every(function (it) { return filled(it.source); }), msg: '확정 항목에는 출처가 있음 (없으면 미확정으로)' }
      ];
    }
    if (index === 2) {
      return [
        { ok: filled(d.s3.delay), msg: '지연 비용을 적음' },
        { ok: filled(d.s3.error), msg: '오류 비용을 적음' },
        { ok: filled(d.s3.reversible), msg: '되돌릴 수 있는 범위를 적음' }
      ];
    }
    if (index === 3) {
      var opts = d.s4.options.filter(function (o) { return filled(o.desc); });
      return [
        { ok: opts.length >= MIN_OPTIONS && opts.length <= MAX_OPTIONS, msg: '선택지 2~3개' },
        { ok: opts.every(function (o) { return filled(o.pros) && filled(o.cons); }), msg: '선택지마다 장점·단점이 있음' },
        { ok: d.s4.recommend >= 0 && filled(d.s4.reason), msg: '추천안과 근거가 있음' }
      ];
    }
    if (index === 4) {
      return [
        { ok: filled(d.s5.decider), msg: '결정할 사람 (모르면 "승인선 문서에서 확인 필요")' },
        { ok: filled(d.s5.ask), msg: '상대가 답해야 할 질문이 명확함' },
        { ok: filled(d.s5.due), msg: '회신 기한이 있음' }
      ];
    }
    return [
      { ok: filled(d.s6.decision), msg: '결정 (또는 대기 상태)을 적음' },
      { ok: filled(d.s6.assumptions), msg: '전제한 가정을 적음' },
      { ok: filled(d.s6.revisit), msg: '재확인 조건이 있음' }
    ];
  }
  function stepValid(index) {
    return checksFor(index, state.data).every(function (c) { return c.ok; });
  }
  function reachable(index) {
    for (var i = 0; i < index; i++) { if (!state.confirmed[i]) return false; }
    return true;
  }

  // ===== 텍스트 생성 =====
  function namedOptions(d) {
    return d.s4.options
      .map(function (o, i) { return { o: o, i: i }; })
      .filter(function (x) { return filled(x.o.desc); });
  }
  function escalationText(d) {
    var opts = namedOptions(d);
    var reco = d.s4.options[d.s4.recommend];
    var lines = [];
    lines.push('수신: ' + (filled(d.s5.decider) ? d.s5.decider : '[결정권자 확인 필요]'));
    lines.push('결정이 필요한 건이 있어 공유드립니다.');
    lines.push('');
    lines.push('[상황] ' + (d.s1.decision || '-') + (filled(d.s1.deadline) ? ' (기한: ' + d.s1.deadline + ')' : ''));
    var open = d.s2.items.filter(function (it) { return filled(it.text) && it.status !== '확정'; });
    if (open.length) lines.push('  - 아직 확인 중: ' + open.map(function (it) { return it.text; }).join(', '));
    if (filled(d.s3.delay) || filled(d.s3.error)) lines.push('  - 늦으면: ' + (d.s3.delay || '-') + ' / 틀리면: ' + (d.s3.error || '-'));
    lines.push('');
    lines.push('[옵션]');
    opts.forEach(function (x, n) {
      lines.push('  ' + (n + 1) + ') ' + x.o.type + ': ' + x.o.desc + ' (장점: ' + (x.o.pros || '-') + ' / 단점: ' + (x.o.cons || '-') + ')');
    });
    lines.push('');
    lines.push('[추천] ' + (reco && filled(reco.desc) ? reco.type + ' - ' + reco.desc : '-') + (filled(d.s4.reason) ? '. 근거: ' + d.s4.reason : ''));
    lines.push('');
    lines.push('[요청 결정] ' + (d.s5.ask || '-'));
    if (filled(d.s5.due)) lines.push('회신 부탁드리는 시점: ' + d.s5.due);
    return lines.join('\n');
  }
  function resultText(d) {
    var out = [];
    out.push('결정 준비 자료 (초안)');
    out.push('');
    out.push('1. 결정 문제: ' + d.s1.decision);
    out.push('   기한: ' + d.s1.deadline + ' / 요청자: ' + (d.s1.requester || '-') + ' / 관련 문서: ' + (d.s1.docs || '-'));
    out.push('');
    out.push('2. 정보 상태');
    d.s2.items.filter(function (it) { return filled(it.text); }).forEach(function (it) {
      var tail = it.status === '확정' ? '출처: ' + it.source : '확인: ' + it.owner + ' / 질문: ' + it.question;
      out.push('   [' + it.status + '] ' + it.text + ' (' + tail + ')');
    });
    out.push('');
    out.push('3. 비용 판단');
    out.push('   지연 비용: ' + d.s3.delay);
    out.push('   오류 비용: ' + d.s3.error);
    out.push('   되돌림 범위: ' + d.s3.reversible);
    out.push('');
    out.push('4. 옵션과 추천안');
    namedOptions(d).forEach(function (x) {
      out.push('   ' + (x.i === d.s4.recommend ? '★ ' : '- ') + x.o.type + ': ' + x.o.desc + ' (장점: ' + x.o.pros + ' / 단점: ' + x.o.cons + ')');
    });
    out.push('   추천 근거: ' + d.s4.reason);
    out.push('');
    out.push('5. 에스컬레이션 초안 (' + d.s5.channel + ')');
    escalationText(d).split('\n').forEach(function (l) { out.push('   ' + l); });
    out.push('');
    out.push('6. 결정 기록');
    out.push('   결정: ' + d.s6.decision);
    out.push('   가정: ' + d.s6.assumptions);
    out.push('   담당자: ' + (d.s6.owner || '-'));
    out.push('   재확인 조건: ' + d.s6.revisit);
    out.push('');
    out.push('이 자료는 초안입니다. 검토 후 직접 SharePoint 또는 OneNote에 기록해 주세요.');
    return out.join('\n');
  }

  // ===== 입력 컴포넌트 =====
  function inputField(path, label, value, opts) {
    var o = opts || {};
    var id = 'f-' + path.replace(/\./g, '-');
    var hint = o.hint ? ' <span class="hint">' + esc(o.hint) + '</span>' : '';
    var control = o.multiline
      ? '<textarea id="' + id + '" data-field="' + path + '" rows="' + (o.rows || 2) + '" placeholder="' + esc(o.placeholder || '') + '">' + esc(value) + '</textarea>'
      : '<input type="text" id="' + id + '" data-field="' + path + '" value="' + esc(value) + '" placeholder="' + esc(o.placeholder || '') + '">';
    return '<div class="field"><label for="' + id + '">' + esc(label) + hint + '</label>' + control + '</div>';
  }
  function selectField(path, label, value, options, hideLabel) {
    var id = 'f-' + path.replace(/\./g, '-');
    var opts = options.map(function (v) { return '<option' + (v === value ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    var lab = hideLabel ? '<label for="' + id + '" class="sr-only">' + esc(label) + '</label>' : '<label for="' + id + '">' + esc(label) + '</label>';
    return '<div class="field">' + lab + '<select id="' + id + '" data-field="' + path + '">' + opts + '</select></div>';
  }

  // ===== 단계별 화면 =====
  function bodyFor(index, d) {
    if (index === 0) {
      return inputField('s1.decision', '결정 문제 (한 문장)', d.s1.decision, { multiline: true, placeholder: '예) ~할지 ~할지 ~까지 정해야 한다.' }) +
        '<div class="row-3">' +
        inputField('s1.deadline', '기한', d.s1.deadline) +
        inputField('s1.requester', '요청자', d.s1.requester) +
        inputField('s1.docs', '관련 문서', d.s1.docs) +
        '</div>';
    }
    if (index === 1) {
      var items = d.s2.items.map(function (it, i) {
        var p = 's2.items.' + i;
        var removable = d.s2.items.length > 1
          ? '<button type="button" class="btn btn-small btn-danger-text" data-action="remove-item" data-index="' + i + '" aria-label="항목 ' + (i + 1) + ' 삭제">삭제</button>' : '<span></span>';
        return '<div class="item-card" data-status="' + esc(it.status) + '">' +
          '<div class="item-top">' +
          '<label class="sr-only" for="f-' + p.replace(/\./g, '-') + '-text">항목 ' + (i + 1) + '</label>' +
          '<input type="text" id="f-' + p.replace(/\./g, '-') + '-text" data-field="' + p + '.text" value="' + esc(it.text) + '" placeholder="정보 항목 (예: 인쇄 발주 마감일)">' +
          selectField(p + '.status', '상태', it.status, STATUSES, true) + removable +
          '</div>' +
          '<div class="row-3">' +
          inputField(p + '.source', '출처', it.source, { placeholder: '문서명·메일 날짜·발화자' }) +
          inputField(p + '.owner', '확인할 담당자', it.owner) +
          inputField(p + '.question', '확인 질문', it.question) +
          '</div></div>';
      }).join('');
      return items + '<div><button type="button" class="btn btn-line btn-small" data-action="add-item">+ 항목 추가</button></div>';
    }
    if (index === 2) {
      return inputField('s3.delay', '지연 비용: 늦으면 무엇을 잃나', d.s3.delay, { multiline: true }) +
        inputField('s3.error', '오류 비용: 틀리면 무엇을 잃나', d.s3.error, { multiline: true }) +
        inputField('s3.reversible', '되돌릴 수 있는 범위와 시점', d.s3.reversible, { multiline: true, hint: '어디까지는 되돌릴 수 있고, 어느 시점부터 못 되돌리나' });
    }
    if (index === 3) {
      var cards = d.s4.options.map(function (o, i) {
        var p = 's4.options.' + i;
        var removable = d.s4.options.length > MIN_OPTIONS
          ? '<button type="button" class="btn btn-small btn-danger-text" data-action="remove-option" data-index="' + i + '">삭제</button>' : '';
        return '<div class="option-card' + (i === d.s4.recommend ? ' is-reco' : '') + '" data-option="' + i + '">' +
          '<div class="option-top">' +
          selectField(p + '.type', '유형', o.type, OPTION_TYPES, true) +
          '<label class="sr-only" for="f-' + p.replace(/\./g, '-') + '-desc">옵션 ' + (i + 1) + ' 내용</label>' +
          '<input type="text" id="f-' + p.replace(/\./g, '-') + '-desc" data-field="' + p + '.desc" value="' + esc(o.desc) + '" placeholder="옵션 ' + (i + 1) + ' 내용">' +
          '<span class="nav-btns"><label class="reco-label"><input type="radio" name="reco" value="' + i + '"' + (i === d.s4.recommend ? ' checked' : '') + '> 추천</label>' + removable + '</span>' +
          '</div>' +
          '<div class="row-2">' +
          inputField(p + '.pros', '장점', o.pros) +
          inputField(p + '.cons', '단점', o.cons) +
          '</div></div>';
      }).join('');
      var add = d.s4.options.length < MAX_OPTIONS ? '<div><button type="button" class="btn btn-line btn-small" data-action="add-option">+ 옵션 추가</button></div>' : '';
      return cards + add + inputField('s4.reason', '추천 근거', d.s4.reason, { multiline: true, hint: '3단계 비용 판단과 연결해서' });
    }
    if (index === 4) {
      return '<div class="row-2">' +
        inputField('s5.decider', '결정할 사람', d.s5.decider, { hint: '승인선 문서에서 확인한 사람만', placeholder: '모르면: 승인선 문서에서 확인 필요' }) +
        selectField('s5.channel', '채널', d.s5.channel, ['Teams', '메일']) +
        '</div>' +
        inputField('s5.ask', '요청 결정 (상대가 답할 질문)', d.s5.ask, { multiline: true, placeholder: '예/아니오 또는 선택으로 답할 수 있게' }) +
        inputField('s5.due', '회신 기한', d.s5.due) +
        '<div class="draft"><div class="draft-head"><span class="field-label">보고문 초안 (상황-옵션-추천-요청결정)</span>' +
        '<button type="button" class="btn btn-line btn-small" data-copy="escDraft">복사</button></div>' +
        '<pre id="escDraft">' + esc(escalationText(d)) + '</pre></div>';
    }
    return inputField('s6.decision', '결정 (또는 대기 상태)', d.s6.decision, { multiline: true }) +
      inputField('s6.assumptions', '가정', d.s6.assumptions, { multiline: true, hint: '틀리면 결정을 다시 봐야 하는 전제' }) +
      '<div class="row-2">' +
      inputField('s6.owner', '담당자', d.s6.owner) +
      inputField('s6.revisit', '재확인 조건', d.s6.revisit, { placeholder: '언제, 무엇이 일어나면 다시 보나' }) +
      '</div>';
  }

  function checksHtml(index) {
    return checksFor(index, state.data).map(function (c) {
      return '<p class="check ' + (c.ok ? 'ok' : 'ng') + '">' + esc(c.msg) + '</p>';
    }).join('');
  }

  function confirmHtml(index) {
    var valid = stepValid(index);
    var isLast = index === STEPS.length - 1;
    return '<label class="confirm-box' + (valid ? '' : ' is-locked') + '">' +
      '<input type="checkbox" id="confirmStep"' + (state.confirmed[index] ? ' checked' : '') + (valid ? '' : ' disabled') + '> 내용을 검토했고 확정합니다</label>' +
      '<div class="nav-btns">' +
      '<button type="button" class="btn btn-line" data-action="prev"' + (index === 0 ? ' disabled' : '') + '>이전</button>' +
      '<button type="button" class="btn btn-primary" data-action="next"' + (state.confirmed[index] ? '' : ' disabled') + '>' + (isLast ? '결과 보기' : '다음 단계') + '</button>' +
      '</div>';
  }

  // ===== 렌더 =====
  function renderCases() {
    var grid = $('caseGrid');
    var html = CASES.map(function (c) {
      return '<button type="button" class="case-btn" data-case="' + esc(c.id) + '" aria-pressed="' + (state.caseId === c.id) + '">' +
        '<small>' + esc(c.theme) + '</small><strong>' + esc(c.title) + '</strong></button>';
    }).join('');
    html += '<button type="button" class="case-btn" data-case="custom" aria-pressed="' + (state.caseId === 'custom') + '">' +
      '<small>직접 입력</small><strong>내 상황으로 연습 (가상 정보만)</strong></button>';
    grid.innerHTML = html;

    var box = $('situationBox');
    var c = currentCase();
    if (c) {
      box.innerHTML = '<div class="situation"><span class="situation-label">받은 상황 (원문) · 천천히 읽고 1단계부터 함께 정리해 보세요</span>\n' + esc(c.situation) + '</div>';
    } else {
      box.innerHTML = '<div class="field mt-24"><label for="customSituation">내 상황 3~5줄 <span class="hint">실명·고객명·사내 수치는 빼고 적으세요</span></label>' +
        '<textarea id="customSituation" rows="4" data-custom="1" placeholder="무슨 일이 있었고, 누가 무엇을 언제까지 원하는지">' + esc(state.custom) + '</textarea></div>';
    }
  }

  function renderStepper() {
    $('stepper').innerHTML = STEPS.map(function (s, i) {
      var cls = state.confirmed[i] ? ' class="is-done"' : '';
      var current = i === state.step ? ' aria-current="step"' : '';
      var disabled = reachable(i) ? '' : ' disabled';
      var mark = state.confirmed[i] ? '✓' : String(i + 1);
      return '<li><button type="button" data-goto="' + i + '"' + cls + current + disabled + '>' +
        '<span class="step-num" aria-hidden="true">' + mark + '</span><span class="step-label">' + esc(s.title) + '</span>' +
        '<span class="sr-only">' + (state.confirmed[i] ? ' (확정됨)' : '') + '</span></button></li>';
    }).join('');
  }

  function renderPanel(animate) {
    var i = state.step;
    var s = STEPS[i];
    var exampleBtn = currentCase() ? '<button type="button" class="btn btn-line btn-small" data-action="example">예시 채우기</button>' : '';
    var panel = $('panel');
    panel.innerHTML =
      '<div class="panel-head"><div><p class="eyebrow">STEP ' + (i + 1) + ' / ' + STEPS.length + '</p>' +
      '<h3 id="panelTitle">' + esc(s.title) + '</h3><p class="ask">Q. ' + esc(s.ask) + '</p></div>' + exampleBtn + '</div>' +
      '<div class="meta-grid"><p class="meta"><b>코파일럿이 만드는 것</b>' + esc(s.makes) + '</p>' +
      '<p class="meta meta-guard"><b>가드레일</b>' + esc(s.guard) + '</p></div>' +
      '<div class="fields">' + bodyFor(i, state.data) + '</div>' +
      '<div class="checks" id="checks" aria-label="완료 기준">' + checksHtml(i) + '</div>' +
      '<div class="confirm-bar" id="confirmBar">' + confirmHtml(i) + '</div>';
    if (animate) {
      panel.classList.remove('panel-enter');
      void panel.offsetWidth;
      panel.classList.add('panel-enter');
    }
  }

  function renderResult() {
    var done = state.confirmed.every(Boolean);
    var box = $('result');
    box.hidden = !done;
    if (done) $('resultText').textContent = resultText(state.data);
  }

  function renderAll(animate) {
    renderCases();
    renderStepper();
    renderPanel(animate);
    renderResult();
  }

  // 입력 중에는 패널을 다시 그리지 않는다. 다시 그리면 커서 위치가 날아간다.
  function refreshLive() {
    $('checks').innerHTML = checksHtml(state.step);
    $('confirmBar').innerHTML = confirmHtml(state.step);
    var draft = $('escDraft');
    if (draft) draft.textContent = escalationText(state.data);
    renderStepper();
    renderResult();
  }

  // ===== 이벤트 =====
  function onFieldInput(el) {
    var path = parsePath(el.getAttribute('data-field'));
    var stepIndex = Number(String(path[0]).slice(1)) - 1;
    commit(Object.assign({}, state, {
      data: setIn(state.data, path, el.value),
      confirmed: unconfirmFrom(state.confirmed, stepIndex)
    }));
    if (path[path.length - 1] === 'status') {
      var card = el.closest('.item-card');
      if (card) card.setAttribute('data-status', el.value);
    }
    refreshLive();
  }

  function switchCase(caseId) {
    if (caseId === state.caseId) return;
    var touched = JSON.stringify(state.data) !== JSON.stringify(emptyData());
    if (touched && !window.confirm('사례를 바꾸면 지금 입력한 내용이 지워집니다. 계속할까요?')) return;
    commit(initialState(caseId));
    renderAll(true);
  }

  function fillExample() {
    var c = currentCase();
    if (!c) return;
    var key = STEPS[state.step].key;
    commit(Object.assign({}, state, {
      data: setIn(state.data, [key], JSON.parse(JSON.stringify(c.example[key]))),
      confirmed: unconfirmFrom(state.confirmed, state.step)
    }));
    renderAll(false);
    showToast('예시를 채웠습니다. 내 생각과 비교하며 고쳐보세요.');
  }

  function changeList(listPath, updater) {
    var list = listPath.reduce(function (o, k) { return o[k]; }, state.data);
    commit(Object.assign({}, state, {
      data: setIn(state.data, listPath, updater(list)),
      confirmed: unconfirmFrom(state.confirmed, state.step)
    }));
    renderAll(false);
  }

  function goTo(index) {
    if (index < 0 || index >= STEPS.length || !reachable(index)) return;
    commit(Object.assign({}, state, { step: index }));
    renderStepper();
    renderPanel(true);
    var title = $('panelTitle');
    if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
    $('wizard').scrollIntoView({ block: 'start' });
  }

  function handleAction(action, el) {
    if (action === 'theme') { cycleTheme(); return; }
    if (action === 'print') { window.print(); return; }
    if (action === 'download') { downloadInstructions(); return; }
    if (action === 'reset') {
      if (!window.confirm('입력한 실습 내용을 모두 지울까요?')) return;
      safeRemove(STORE_KEY);
      commit(initialState(state.caseId));
      renderAll(true);
      closeMenu();
      return;
    }
    if (action === 'example') { fillExample(); return; }
    if (action === 'prev') { goTo(state.step - 1); return; }
    if (action === 'next') {
      if (state.step === STEPS.length - 1) { renderResult(); $('result').scrollIntoView({ block: 'start' }); return; }
      goTo(state.step + 1);
      return;
    }
    var idx = Number(el.getAttribute('data-index'));
    if (action === 'add-item') changeList(['s2', 'items'], function (l) { return l.concat([emptyItem()]); });
    if (action === 'remove-item') changeList(['s2', 'items'], function (l) { return l.filter(function (_, i) { return i !== idx; }); });
    if (action === 'add-option') changeList(['s4', 'options'], function (l) { return l.length < MAX_OPTIONS ? l.concat([emptyOption()]) : l; });
    if (action === 'remove-option') {
      var reco = state.data.s4.recommend;
      var nextReco = reco === idx ? -1 : (reco > idx ? reco - 1 : reco);
      commit(Object.assign({}, state, { data: setIn(state.data, ['s4', 'recommend'], nextReco) }));
      changeList(['s4', 'options'], function (l) { return l.filter(function (_, i) { return i !== idx; }); });
    }
  }

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.hasAttribute && el.hasAttribute('data-field')) { onFieldInput(el); return; }
    if (el.id === 'customSituation') commit(Object.assign({}, state, { custom: el.value }));
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.name === 'reco') {
      var i = Number(el.value);
      commit(Object.assign({}, state, {
        data: setIn(state.data, ['s4', 'recommend'], i),
        confirmed: unconfirmFrom(state.confirmed, 3)
      }));
      document.querySelectorAll('.option-card').forEach(function (card) {
        card.classList.toggle('is-reco', Number(card.getAttribute('data-option')) === i);
      });
      refreshLive();
      return;
    }
    if (el.id === 'confirmStep') {
      if (el.checked && !stepValid(state.step)) { el.checked = false; return; }
      var confirmed = el.checked
        ? state.confirmed.map(function (c, i) { return i === state.step ? true : c; })
        : unconfirmFrom(state.confirmed, state.step);
      commit(Object.assign({}, state, { confirmed: confirmed }));
      refreshLive();
      return;
    }
    if (el.hasAttribute && el.hasAttribute('data-check')) saveTestChecks();
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action],[data-case],[data-goto],[data-copy],#vizMenuToggle');
    if (!e.target.closest('.viz-menu')) closeMenu();
    if (!t) return;
    if (t.id === 'vizMenuToggle') { toggleMenu(); return; }
    if (t.hasAttribute('data-case')) { switchCase(t.getAttribute('data-case')); return; }
    if (t.hasAttribute('data-goto')) { goTo(Number(t.getAttribute('data-goto'))); return; }
    if (t.hasAttribute('data-copy')) {
      var src = $(t.getAttribute('data-copy'));
      if (src) copyText(src.textContent);
      return;
    }
    handleAction(t.getAttribute('data-action'), t);
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  // ===== 메뉴·테마 =====
  function toggleMenu() {
    var isOpen = $('vizMenuDropdown').classList.toggle('open');
    $('vizMenuToggle').setAttribute('aria-expanded', String(isOpen));
  }
  function closeMenu() {
    $('vizMenuDropdown').classList.remove('open');
    $('vizMenuToggle').setAttribute('aria-expanded', 'false');
  }
  var currentTheme = safeGet(THEME_KEY) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  function applyTheme(t) {
    document.documentElement.className = 'theme-' + t;
    $('themeIcon').textContent = t === 'dark' ? '🌙' : '☀️';
    $('themeLabel').textContent = t === 'dark' ? '다크' : '라이트';
    safeSet(THEME_KEY, t);
    currentTheme = t;
  }
  function cycleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

  // ===== 내부망 구축 섹션 =====
  function downloadInstructions() {
    var blob = new Blob([INSTRUCTIONS], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '결정준비코파일럿_지침.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadTestChecks() {
    try { var v = JSON.parse(safeGet(CHECK_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function saveTestChecks() {
    var checked = [];
    document.querySelectorAll('[data-check]').forEach(function (cb, i) { if (cb.checked) checked.push(i); });
    safeSet(CHECK_KEY, JSON.stringify(checked));
  }
  // 브라우저가 복원한 체크 상태가 아니라 저장값을 따른다
  function restoreTestChecks() {
    var saved = loadTestChecks();
    document.querySelectorAll('[data-check]').forEach(function (cb, i) { cb.checked = saved.indexOf(i) !== -1; });
  }

  function renderBuild() {
    $('instrText').textContent = INSTRUCTIONS;
    $('instrMeta').textContent = '지침(Instructions) · ' + INSTRUCTIONS.length.toLocaleString() + '자';
    $('starterList').innerHTML = STARTERS.map(function (s, i) {
      return '<div class="starter"><span id="starter-' + i + '">' + esc(s) + '</span>' +
        '<button type="button" class="btn btn-line btn-small" data-copy="starter-' + i + '">복사</button></div>';
    }).join('');
    $('testChecklist').innerHTML = TEST_CHECKS.map(function (c, i) {
      return '<li><label><input type="checkbox" data-check="' + i + '"> ' + esc(c) + '</label></li>';
    }).join('');
    restoreTestChecks();
  }

  // ===== 등장 애니메이션 (안전망 포함) =====
  function setupReveal() {
    var els = document.querySelectorAll('[data-reveal]');
    els.forEach(function (el) { el.classList.add('reveal'); });
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('visible'); obs.unobserve(en.target); } });
      }, { threshold: 0.12 });
      els.forEach(function (el) { obs.observe(el); });
    }
    setTimeout(function () { els.forEach(function (el) { el.classList.add('visible'); }); }, 1200);
  }

  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    state = loadState();
    renderAll(false);
    restoreTestChecks();
  });

  applyTheme(currentTheme);
  renderAll(false);
  renderBuild();
  setupReveal();
})();
