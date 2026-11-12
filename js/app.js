// 같은 버전 번호로 config·api 도 새로 불러오기
const V = new URL(import.meta.url).searchParams.get('v') || '';
const { SUPABASE_URL, SUPABASE_KEY, CENTER_NAME } = await import('./config.js?v=' + V);
const { SupaApi, MockApi } = await import('./api.js?v=' + V);

// =============================================================
// 기본 도구
// =============================================================
const $app = document.getElementById('app');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const COLORS = ['#23634A', '#2F6DB0', '#B4561A', '#7A4BB0', '#A23B5C', '#3F6F73', '#6B5B2E'];
const CAL_START = 6;
const CAL_END = 23;
const HOUR_PX = 56;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const addMonths = (s, n) => { const d = parseYmd(s); d.setDate(1); d.setMonth(d.getMonth() + n); return ymd(d); };
// 시작일 + n개월 - 1일 (예: 3/15 + 3개월 → 6/14). 말일 보정 포함
const passEnd = (start, n) => { const d = parseYmd(start); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); d.setDate(d.getDate() - 1); return ymd(d); };
const todayStr = () => ymd(new Date());
const dowOf = (s) => parseYmd(s).getDay();
const weekStart = (s) => addDays(s, -((dowOf(s) + 6) % 7));
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const md = (s) => Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10));
const longDay = (s) => Number(s.slice(5, 7)) + '월 ' + Number(s.slice(8, 10)) + '일 (' + DOW[dowOf(s)] + ')';
const localDate = (iso) => ymd(new Date(iso));
const localTime = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const minutesOf = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const toIso = (date, time) => new Date(date + 'T' + time + ':00').toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const timeOptions = () => { const out = []; for (let h = CAL_START; h < CAL_END; h++) for (const m of ['00', '30']) out.push(pad(h) + ':' + m); return out; };

// =============================================================
// 상태
// =============================================================
const params = new URLSearchParams(location.search);
const demoWanted = params.has('demo') || localStorage.getItem('joeum_demo') === '1' || !SUPABASE_URL || !SUPABASE_KEY;
let api = demoWanted ? new MockApi() : new SupaApi(SUPABASE_URL, SUPABASE_KEY);

const S = {
  booting: true,
  authView: 'login', // login | signup | forgot | sent | newpw
  authMsg: '',
  authErr: '',
  user: null,
  me: null,
  screen: 'home',
  busy: false,
  toast: '',
  // 데이터
  profiles: [],
  members: [],
  passes: [],
  usage: {},
  payments: [],
  posts: [],
  blocks: [], // 강사 개인 고정 스케줄 (매주 반복)
  blockOwner: null,
  tasks: [],
  sessions: [],
  sessionsRange: '',
  todaySessions: [],
  unchecked: [], // 시간이 지났는데 출석 처리 안 된 예약 (최근 30일)
  // 화면 상태
  calView: 'week',
  calDate: todayStr(),
  tFilter: 'all',
  selSessionId: null,
  composer: null, // { sessionId, journalId, rows: [{exercise, check, video, file, fileName}] }
  memberId: null,
  memberSearch: '',
  memberFilter: 'all',
  memberDetail: null, // { journals, sessions }
  journals: null,
  jFilter: 'all',
  jSearch: '',
  jMember: null,
  jDate: null,
  jDetail: null,
  salesMonth: todayStr().slice(0, 7),
  monthDone: null, // 이번 달 출석 처리된 수업 (수업료 계산용)
  openPost: null,
  modal: null,
};

const isAdmin = () => S.me && S.me.role === 'admin';
const profileById = (id) => S.profiles.find((p) => p.id === id);
const memberById = (id) => S.members.find((m) => m.id === id);
const staffName = (id) => { const p = profileById(id); return p ? p.name : '미지정'; };
const staffColor = (id) => { const p = profileById(id); return (p && p.color) || '#5D625F'; };
const trainers = () => S.profiles.filter((p) => p.role === 'admin' || p.role === 'trainer');

function tint(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c * a + 255 * (1 - a));
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
}

// ---------- 수강권 계산 ----------
function passInfo(p) {
  const used = (p.used_before || 0) + (S.usage[p.id] || 0);
  const remain = Math.max(0, p.total_count - used);
  const dleft = daysBetween(todayStr(), p.end_date);
  const key = remain <= 0 || dleft < 0 ? 'expired' : remain <= 3 || dleft <= 14 ? 'soon' : 'ok';
  return { used, remain, dleft, key };
}
function memberPasses(memberId) {
  return S.passes.filter((p) => p.member_id === memberId).sort((a, b) => (a.end_date < b.end_date ? 1 : -1));
}
function activePass(memberId) {
  const list = memberPasses(memberId);
  return list.find((p) => passInfo(p).key !== 'expired') || list[0] || null;
}
const STATUS = {
  ok: { label: '이용중', cls: 'pill-ok' },
  soon: { label: '만료임박', cls: 'pill-warn' },
  expired: { label: '만료', cls: 'pill-mute' },
  none: { label: '수강권 없음', cls: 'pill-mute' },
};
function memberState(memberId) {
  const p = activePass(memberId);
  if (!p) return { key: 'none', pass: null, info: null };
  const info = passInfo(p);
  return { key: info.key, pass: p, info };
}
const SESSION_STATUS = {
  reserved: { label: '예약', cls: 'pill-blue' },
  done: { label: '출석', cls: 'pill-ok' },
  noshow: { label: '노쇼', cls: 'pill-warn' },
  canceled: { label: '취소', cls: 'pill-mute' },
};
const journalOf = (s) => (Array.isArray(s.journals) ? s.journals[0] : s.journals) || null;

// =============================================================
// 렌더링
// =============================================================
let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNow(); });
}
function renderNow() {
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const sel = focusId && active.setSelectionRange && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scrollers = {};
  document.querySelectorAll('[data-scroll-key]').forEach((el) => { scrollers[el.dataset.scrollKey] = el.scrollTop; });
  const winY = window.scrollY;
  $app.innerHTML = view();
  document.querySelectorAll('[data-scroll-key]').forEach((el) => { if (scrollers[el.dataset.scrollKey] != null) el.scrollTop = scrollers[el.dataset.scrollKey]; });
  window.scrollTo(0, winY);
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* */ } } }
  }
}

let toastTimer;
function toast(msg) {
  S.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ''; render(); }, 3000);
}

async function run(fn, okMsg) {
  if (S.busy) return;
  S.busy = true;
  render();
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (e) {
    console.error(e);
    toast(e.message || '오류가 났어요.');
  } finally {
    S.busy = false;
    render();
  }
}

function view() {
  if (S.shared) return sharedView();
  if (S.booting) return '<div class="center-screen"><div class="spinner" aria-label="불러오는 중"></div></div>';
  if (!S.user || S.authView === 'newpw') return authView();
  if (!S.me || S.me.role === 'pending') return pendingView();
  return layoutView();
}

// ---------- 회원용 공유 화면 (로그인 없이) ----------
function sharedView() {
  const sh = S.shared;
  let body;
  if (sh.loading) body = '<div class="center-screen" style="min-height:40vh"><div class="spinner" aria-label="불러오는 중"></div></div>';
  else if (!sh.data) body = '<div class="card"><h1 class="h2">일지를 찾을 수 없어요</h1><p class="muted">링크가 잘못됐거나, 강사님이 공유를 끈 일지예요.</p></div>';
  else {
    const d = sh.data;
    const when = d.starts_at ? longDay(localDate(d.starts_at)) + ' ' + localTime(d.starts_at) : '';
    const items = (d.items || []).map((it, i) => {
      const v = it.video ? (sh.urls[it.video] ? '<video src="' + esc(sh.urls[it.video]) + '" controls playsinline preload="metadata" class="share-video"></video>' : sh.urls[it.video] === null ? '<p class="muted small">영상을 불러오지 못했어요.</p>' : '<p class="muted small">영상 불러오는 중…</p>') : '';
      return '<section class="card share-item"><div class="row gap8"><span class="share-no">' + (i + 1) + '</span><h2 class="h2 grow">' + esc(it.exercise) + '</h2></div>' +
        (doseText(it) ? '<div class="share-sets">' + esc(doseText(it)) + '</div>' : '') +
        (it.check ? '<p class="pre share-check">' + esc(it.check) + '</p>' : '') + v + '</section>';
    }).join('');
    body = '<header class="share-head"><div class="brand-lg">' + esc(CENTER_NAME) + '</div><h1 class="h1">' + esc(d.member) + ' 회원님 수업일지</h1><div class="muted">' + when + (d.trainer ? ' · 담당 ' + esc(d.trainer) + ' 강사' : '') + '</div>' + journalMetaView(d) + '</header>' + items +
      '<p class="muted small center">' + esc(CENTER_NAME) + '에서 보낸 수업 기록이에요.</p>';
  }
  return '<div class="share-page">' + body + '</div>';
}

async function loadShared(token) {
  S.shared = { loading: true, data: null, urls: {} };
  renderNow();
  try {
    S.shared.data = await api.rpc('get_shared_journal', { p_token: token });
  } catch (e) {
    console.error(e);
    S.shared.data = null;
  }
  S.shared.loading = false;
  renderNow();
  const items = (S.shared.data && S.shared.data.items) || [];
  for (const it of items) {
    if (!it.video) continue;
    try { S.shared.urls[it.video] = await api.videoUrl(it.video); } catch (e) { S.shared.urls[it.video] = null; }
    render();
  }
}

function shareUrl(token) {
  return location.origin + location.pathname + '?j=' + encodeURIComponent(token);
}

function shareText(memberName, startsAt, items, url, cond, inten) {
  const when = startsAt ? md(localDate(startsAt)) + '(' + DOW[dowOf(localDate(startsAt))] + ')' : '';
  const lines = (items || []).map((it, i) => {
    const st = doseText(it);
    return (i + 1) + '. ' + it.exercise + (st ? ' ' + st : '');
  });
  const meta = [cond ? '컨디션: ' + cond : '', inten ? '강도: ' + inten : ''].filter(Boolean).join(' · ');
  return '[' + CENTER_NAME + ' 수업일지] ' + when + ' ' + memberName + ' 회원님\n' + (meta ? meta + '\n' : '') + lines.join('\n') + '\n\n자세히 보기 (영상·체크사항): ' + url;
}

// ---------- 로그인 ----------
function authView() {
  const demo = api.mode === 'demo';
  const head = '<div class="auth-head"><div class="brand-lg">' + esc(CENTER_NAME) + '</div><div class="muted">센터 통합 관리 · 직원·강사용</div></div>';
  const err = S.authErr ? '<div class="form-err" role="alert">' + esc(S.authErr) + '</div>' : '';
  const msg = S.authMsg ? '<div class="form-ok" role="status">' + esc(S.authMsg) + '</div>' : '';
  const busy = S.busy ? ' disabled' : '';
  let body = '';
  if (S.authView === 'signup') {
    body = '<form class="stack" data-submit="signup">' +
      '<label for="su-name">이름</label><input id="su-name" name="name" required autocomplete="name" placeholder="예: 장정웅">' +
      '<label for="su-email">이메일</label><input id="su-email" name="email" type="email" required autocomplete="email">' +
      '<label for="su-pw">비밀번호 (6자 이상)</label><input id="su-pw" name="password" type="password" minlength="6" required autocomplete="new-password">' +
      err + msg + '<button class="btn btn-primary btn-lg" type="submit"' + busy + '>가입 신청</button>' +
      '<p class="hint">가입하면 관리자가 승인한 뒤에 쓸 수 있어요. 맨 처음 가입한 사람은 자동으로 관리자가 돼요.</p>' +
      '<button type="button" class="link" data-act="authView" data-v="login">이미 계정이 있어요 · 로그인</button></form>';
  } else if (S.authView === 'forgot') {
    body = '<form class="stack" data-submit="forgot">' +
      '<label for="fg-email">가입한 이메일</label><input id="fg-email" name="email" type="email" required autocomplete="email">' +
      err + msg + '<button class="btn btn-primary btn-lg" type="submit"' + busy + '>재설정 메일 받기</button>' +
      '<button type="button" class="link" data-act="authView" data-v="login">로그인으로 돌아가기</button></form>';
  } else if (S.authView === 'newpw') {
    body = '<form class="stack" data-submit="newpw">' +
      '<label for="np-pw">새 비밀번호 (6자 이상)</label><input id="np-pw" name="password" type="password" minlength="6" required autocomplete="new-password">' +
      err + msg + '<button class="btn btn-primary btn-lg" type="submit"' + busy + '>비밀번호 바꾸기</button></form>';
  } else if (S.authView === 'sent') {
    body = '<div class="stack">' + msg + '<button type="button" class="btn btn-lg" data-act="authView" data-v="login">로그인 화면으로</button></div>';
  } else {
    body = '<form class="stack" data-submit="login">' +
      '<label for="li-email">이메일</label><input id="li-email" name="email" type="email" required autocomplete="username"' + (demo ? ' value="admin@demo"' : '') + '>' +
      '<label for="li-pw">비밀번호</label><input id="li-pw" name="password" type="password" ' + (demo ? '' : 'required ') + 'autocomplete="current-password">' +
      err + msg + '<button class="btn btn-primary btn-lg" type="submit"' + busy + '>' + (S.busy ? '로그인 중…' : '로그인') + '</button>' +
      '<div class="row-between"><button type="button" class="link" data-act="authView" data-v="signup">처음이에요 · 가입 신청</button>' +
      '<button type="button" class="link" data-act="authView" data-v="forgot">비밀번호 찾기</button></div></form>';
  }
  const foot = demo
    ? '<div class="demo-box"><b>체험 모드</b> · 이 브라우저에만 저장돼요.<br>관리자: admin@demo · 강사: trainer@demo (비밀번호 아무거나)<div class="row gap8 mt8"><button type="button" class="btn btn-sm" data-act="demoReset">체험 데이터 초기화</button>' + (SUPABASE_URL ? '<button type="button" class="btn btn-sm" data-act="leaveDemo">실제 DB로 로그인</button>' : '') + '</div></div>'
    : '<div class="auth-foot"><button type="button" class="link small" data-act="enterDemo">체험 모드로 둘러보기</button></div>';
  return '<div class="center-screen"><div class="auth-card">' + head + body + foot + '</div></div>' + toastView();
}

function pendingView() {
  return '<div class="center-screen"><div class="auth-card stack">' +
    '<div class="auth-head"><div class="brand-lg">' + esc(CENTER_NAME) + '</div></div>' +
    '<h1 class="h2">관리자 승인 대기 중</h1>' +
    '<p class="muted">' + esc(S.me ? S.me.name : '') + '님 가입 신청이 접수됐어요. 관리자가 <b>직원 관리</b>에서 승인하면 바로 쓸 수 있어요.</p>' +
    '<div class="row gap8"><button class="btn" data-act="reloadMe">승인됐는지 확인</button><button class="btn" data-act="logout">로그아웃</button></div>' +
    '</div></div>' + toastView();
}

// ---------- 레이아웃 ----------
const NAV = [
  { key: 'home', label: '대시보드' },
  { key: 'schedule', label: '예약·출석' },
  { key: 'members', label: '회원·수강권' },
  { key: 'journal', label: '수업일지' },
  { key: 'sales', label: '매출·결제', trainerLabel: '내 매출' },
  { key: 'board', label: '공지·매뉴얼·할 일' },
  { key: 'blocks', label: '고정 스케줄' },
  { key: 'staff', label: '직원 관리', adminOnly: true },
  { key: 'myinfo', label: '내 정보' },
];
const TITLES = { blocks: '개인 고정 스케줄', home: '오늘의 센터', schedule: '예약·출석', members: '회원·수강권', journal: '수업일지', sales: '매출·결제', board: '공지·매뉴얼·할 일', staff: '직원 관리', myinfo: '내 정보' };

function layoutView() {
  const today = todayStr();
  const pendingToday = S.todaySessions.filter((s) => s.status === 'reserved').length + S.unchecked.filter((s) => localDate(s.starts_at) !== todayStr() && (isAdmin() || s.trainer_id === S.me.id)).length;
  const missing = S.todaySessions.filter((s) => s.status === 'done' && !journalOf(s)).length;
  const pendingStaff = S.profiles.filter((p) => p.role === 'pending').length;
  const nav = NAV.filter((n) => !n.adminOnly || isAdmin()).map((n) => {
    let badge = 0;
    if (n.key === 'schedule') badge = pendingToday;
    if (n.key === 'journal') badge = missing;
    if (n.key === 'staff') badge = pendingStaff;
    const label = !isAdmin() && n.trainerLabel ? n.trainerLabel : n.label;
    return '<button type="button" class="nav-item' + (S.screen === n.key ? ' on' : '') + '" data-act="go" data-v="' + n.key + '"' + (S.screen === n.key ? ' aria-current="page"' : '') + '><span>' + esc(label) + '</span>' + (badge ? '<span class="badge">' + badge + '</span>' : '') + '</button>';
  }).join('');
  const title = S.screen === 'sales' && !isAdmin() ? '내 매출' : TITLES[S.screen];
  return '<div class="shell">' +
    '<nav class="side" aria-label="주 메뉴">' +
      '<div class="brand"><div class="brand-name">' + esc(CENTER_NAME) + '</div><div class="brand-sub">통합 관리' + (api.mode === 'demo' ? ' · <b class="demo-tag">체험 모드</b>' : '') + '</div></div>' +
      '<div class="nav">' + nav + '</div>' +
      '<div class="me-card"><div><div class="me-name">' + esc(S.me.name) + '</div><div class="me-role">' + (isAdmin() ? '관리자 · 전체 매출' : '강사 · 본인 매출만') + '</div></div><button type="button" class="btn btn-ghost-dark btn-sm" data-act="logout">로그아웃</button></div>' +
    '</nav>' +
    '<main class="main">' +
      '<header class="page-head"><div><div class="muted small">' + longDay(today).replace(/^/, today.slice(0, 4) + '년 ') + '</div><h1 class="h1">' + esc(title) + '</h1></div>' +
      '<button type="button" class="btn btn-sm" data-act="refresh"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '저장 중…' : '새로고침') + '</button></header>' +
      screenView() +
    '</main>' +
  '</div>' + (S.composer && S.screen !== 'schedule' ? '<div class="modal-back"><div class="modal wide" role="dialog" aria-modal="true" aria-label="수업일지 수정">' + composerView() + '</div></div>' : '') + modalView() + toastView();
}

function toastView() {
  return S.toast ? '<div class="toast" role="status">' + esc(S.toast) + '</div>' : '';
}

function screenView() {
  switch (S.screen) {
    case 'schedule': return scheduleView();
    case 'members': return membersView();
    case 'journal': return journalListView();
    case 'sales': return salesView();
    case 'board': return boardView();
    case 'staff': return isAdmin() ? staffView() : '';
    case 'myinfo': return myInfoView();
    case 'blocks': return blocksView();
    default: return homeView();
  }
}

// ---------- 대시보드 ----------
function homeView() {
  const list = S.todaySessions.slice().sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const done = list.filter((s) => s.status === 'done').length;
  const reserved = list.filter((s) => s.status === 'reserved').length;
  const missing = list.filter((s) => s.status === 'done' && !journalOf(s));
  const unchecked = S.unchecked.filter((s) => isAdmin() || s.trainer_id === S.me.id);
  const expiring = S.members.map((m) => ({ m, st: memberState(m.id) })).filter((x) => x.st.key === 'soon' || x.st.key === 'expired');
  const month = todayStr().slice(0, 7);
  const monthPays = S.payments.filter((p) => p.paid_on.slice(0, 7) === month);
  const monthTotal = monthPays.reduce((a, p) => a + p.amount, 0);
  const kpis = [
    ['오늘 수업', list.length + '건', '출석 ' + done + ' · 남은 예약 ' + reserved],
    ['일지 미작성', missing.length + '건', '오늘 출석한 수업 기준'],
    ['만료·임박 회원', expiring.length + '명', '잔여 3회 이하 또는 14일 이내'],
    [isAdmin() ? '이번 달 매출' : '내 이번 달 매출', won(monthTotal), '결제 ' + monthPays.length + '건'],
  ];
  const todayRows = list.length ? list.map((s) => {
    const m = memberById(s.member_id);
    const st = SESSION_STATUS[s.status];
    return '<button type="button" class="list-row" data-act="openSession" data-id="' + s.id + '"><span class="t-time">' + localTime(s.starts_at) + '</span><span class="grow"><b>' + esc(m ? m.name : '?') + '</b><span class="muted small"> · ' + esc(staffName(s.trainer_id)) + '</span></span><span class="pill ' + st.cls + '">' + st.label + '</span></button>';
  }).join('') : '<p class="muted small">오늘 예약이 없어요.</p>';
  const missRows = missing.length ? missing.map((s) => {
    const m = memberById(s.member_id);
    return '<div class="list-row"><span class="grow"><b>' + esc(m ? m.name : '?') + '</b> <span class="muted small">' + localTime(s.starts_at) + ' · ' + esc(staffName(s.trainer_id)) + '</span></span><button type="button" class="btn btn-sm btn-outline" data-act="writeJournal" data-id="' + s.id + '">일지 쓰기</button></div>';
  }).join('') : '<p class="muted small">오늘 출석한 수업의 일지를 모두 썼어요.</p>';
  const expRows = expiring.length ? expiring.map(({ m, st }) => {
    const s = STATUS[st.key];
    return '<button type="button" class="list-row" data-act="openMember" data-id="' + m.id + '"><span class="grow"><b>' + esc(m.name) + '</b> <span class="pill ' + s.cls + '">' + s.label + '</span><br><span class="muted small">' + esc(st.pass.name) + ' · 잔여 ' + st.info.remain + '회 · 만료 ' + st.pass.end_date + '</span></span><span class="muted small">' + esc(staffName(m.trainer_id)) + '</span></button>';
  }).join('') : '<p class="muted small">해당 회원이 없어요.</p>';
  const myTasks = S.tasks.filter((t) => !t.done).slice(0, 6);
  const taskRows = myTasks.length ? myTasks.map(taskRow).join('') : '<p class="muted small">남은 할 일이 없어요.</p>';
  const notices = S.posts.filter((p) => p.kind === 'notice').slice(0, 3);
  const noticeRows = notices.length ? notices.map((p) => '<button type="button" class="list-row" data-act="openPost" data-id="' + p.id + '"><span class="grow"><b>' + esc(p.title) + '</b></span><span class="muted small">' + md(localDate(p.created_at)) + '</span></button>').join('') : '<p class="muted small">공지가 없어요.</p>';
  return '<div class="stack16">' +
    '<div class="kpis">' + kpis.map((k) => '<div class="card kpi"><div class="muted small">' + k[0] + '</div><div class="kpi-v">' + k[1] + '</div><div class="muted small">' + k[2] + '</div></div>').join('') + '</div>' +
    '<div class="grid2">' +
      '<section class="card"><div class="card-head"><h2 class="h3">오늘 수업</h2><button type="button" class="link" data-act="go" data-v="schedule">예약·출석 열기</button></div>' + todayRows + '</section>' +
      '<div class="stack16">' +
        (unchecked.length ? '<section class="card warn-card"><h2 class="h3">출석 처리 안 된 지난 수업 ' + unchecked.length + '건</h2><p class="muted small">출석 처리해야 수강권이 차감되고 수업료에 들어가요.</p>' + unchecked.map((s) => { const m = memberById(s.member_id); return '<div class="list-row"><span class="grow"><b>' + esc(m ? m.name : '?') + '</b> <span class="muted small">' + longDay(localDate(s.starts_at)) + ' ' + localTime(s.starts_at) + ' · ' + esc(staffName(s.trainer_id)) + '</span></span><button type="button" class="btn btn-sm btn-primary" data-act="setStatus" data-id="' + s.id + '" data-v="done">출석</button><button type="button" class="btn btn-sm" data-act="setStatus" data-id="' + s.id + '" data-v="noshow">노쇼</button></div>'; }).join('') + '</section>' : '') +
        '<section class="card"><h2 class="h3">수업일지 미작성</h2>' + missRows + '</section>' +
        '<section class="card"><h2 class="h3">수강권 만료·임박 회원</h2>' + expRows + '</section>' +
        '<section class="card"><div class="card-head"><h2 class="h3">할 일</h2><button type="button" class="link" data-act="go" data-v="board">전체 보기</button></div>' + taskRows + '</section>' +
        '<section class="card"><h2 class="h3">공지</h2>' + noticeRows + '</section>' +
      '</div>' +
    '</div></div>';
}

// ---------- 예약·출석 ----------
function visibleSessions() {
  return S.sessions.filter((s) => S.tFilter === 'all' || s.trainer_id === S.tFilter);
}

function sessionBlockStyle(s, selected) {
  const c = staffColor(s.trainer_id);
  let bg = '#fff', fg = '#1D2120', border = '1.5px solid ' + c;
  if (s.status === 'done') { bg = tint(c, 0.18); border = '1px solid ' + tint(c, 0.3); }
  if (s.status === 'noshow') { bg = '#FBEADF'; fg = '#8F360B'; border = '1px dashed #B4561A'; }
  if (s.status === 'canceled') { bg = '#F3F2EE'; fg = '#5D625F'; border = '1px dashed #C9C6BB'; }
  if (selected) border = '2px solid #1D2120';
  return 'background:' + bg + ';color:' + fg + ';border:' + border + ';';
}

function scheduleView() {
  const ws = weekStart(S.calDate);
  let title;
  if (S.calView === 'week') {
    const we = addDays(ws, 6);
    title = ws.slice(0, 4) + '년 ' + Number(ws.slice(5, 7)) + '월 ' + Number(ws.slice(8)) + '일 – ' + (we.slice(5, 7) === ws.slice(5, 7) ? '' : Number(we.slice(5, 7)) + '월 ') + Number(we.slice(8)) + '일';
  } else {
    title = S.calDate.slice(0, 4) + '년 ' + Number(S.calDate.slice(5, 7)) + '월';
  }
  const chips = [['all', '전체 강사', '#1D2120']].concat(trainers().map((p) => [p.id, p.name, p.color])).map(([id, label, color]) =>
    '<button type="button" class="chip' + (S.tFilter === id ? ' on' : '') + '" data-act="tFilter" data-v="' + id + '" aria-pressed="' + (S.tFilter === id) + '"><span class="dot" style="background:' + esc(color) + '"></span>' + esc(label) + '</button>').join('');
  const toolbar = '<div class="toolbar">' +
    '<div class="row gap8 wrap"><button type="button" class="btn icon" data-act="calMove" data-v="-1" aria-label="이전">‹</button><button type="button" class="btn icon" data-act="calMove" data-v="1" aria-label="다음">›</button><button type="button" class="btn" data-act="calToday">오늘</button><h2 class="h2 ml8">' + title + '</h2></div>' +
    '<div class="row gap8 wrap"><div class="seg" role="group" aria-label="보기">' +
      '<button type="button" class="' + (S.calView === 'week' ? 'on' : '') + '" data-act="calView" data-v="week" aria-pressed="' + (S.calView === 'week') + '">주간</button>' +
      '<button type="button" class="' + (S.calView === 'month' ? 'on' : '') + '" data-act="calView" data-v="month" aria-pressed="' + (S.calView === 'month') + '">월간</button></div>' +
      '<button type="button" class="btn" data-act="go" data-v="blocks">고정 스케줄</button><button type="button" class="btn btn-primary" data-act="newSession">+ 예약 추가</button></div></div>' +
    '<div class="row gap6 wrap">' + chips + '<span class="muted small ml8">흰 칸 예약 · 색칠된 칸 출석 · 빈 시간 클릭하면 예약 추가</span></div>';
  const cal = S.calView === 'week' ? weekView(ws) : monthView();
  return '<div class="stack16">' + toolbar + '<div class="sched"><section class="card cal" aria-label="달력">' + cal + '</section><aside class="side-panel">' + sidePanel() + '</aside></div></div>';
}

function weekView(ws) {
  const today = todayStr();
  const vis = visibleSessions();
  let head = '<div class="wk-head"><div></div>';
  let cols = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const w = dowOf(d);
    head += '<button type="button" class="wk-day' + (d === S.calDate ? ' sel' : '') + '" data-act="pickDay" data-v="' + d + '"><span class="small" style="color:' + (w === 0 ? '#B42318' : w === 6 ? '#1F4E80' : '#5D625F') + '">' + DOW[w] + '</span><span class="daynum' + (d === today ? ' today' : '') + '">' + Number(d.slice(8)) + '</span></button>';
    const evs = vis.filter((s) => localDate(s.starts_at) === d);
    let inner = '';
    for (let h = CAL_START; h < CAL_END; h++) {
      inner += '<button type="button" class="slot" style="top:' + ((h - CAL_START) * HOUR_PX) + 'px" data-act="slot" data-d="' + d + '" data-t="' + pad(h) + ':00" aria-label="' + longDay(d) + ' ' + h + '시 예약 추가"></button>';
    }
    if (d === today) {
      const now = new Date();
      const top = ((now.getHours() * 60 + now.getMinutes()) - CAL_START * 60) / 60 * HOUR_PX;
      if (top > 0 && top < (CAL_END - CAL_START) * HOUR_PX) inner += '<div class="now-line" style="top:' + top + 'px" aria-hidden="true"></div>';
    }
    for (const b of blocksOn(d)) {
      const top = (timeMin(b.start_time) - CAL_START * 60) / 60 * HOUR_PX;
      const h = Math.max(20, (timeMin(b.end_time) - timeMin(b.start_time)) / 60 * HOUR_PX);
      inner += '<button type="button" class="blk" data-act="blockBook" data-id="' + b.id + '" data-d="' + d + '" style="top:' + top + 'px;height:' + h + 'px;border-color:' + esc(staffColor(b.owner_id)) + '" title="눌러서 예약으로 넣기 · ' + esc(staffName(b.owner_id) + ' · ' + b.title) + '" aria-label="' + esc(b.title + ' ' + hm(b.start_time) + ' 고정 스케줄, 눌러서 예약으로 넣기') + '"><b>' + esc(b.title) + '</b><span>' + esc(staffName(b.owner_id)) + ' · ' + hm(b.start_time) + '–' + hm(b.end_time) + '</span></button>';
    }
    for (const s of evs) {
      const top = (minutesOf(s.starts_at) - CAL_START * 60) / 60 * HOUR_PX + 2;
      const h = Math.max(28, (s.duration_min || 60) / 60 * HOUR_PX - 4);
      const m = memberById(s.member_id);
      const tag = s.status === 'done' ? ' · 출석' : s.status === 'noshow' ? ' · 노쇼' : s.status === 'canceled' ? ' · 취소' : '';
      inner += '<button type="button" class="ev" data-act="openSession" data-id="' + s.id + '" style="top:' + top + 'px;height:' + h + 'px;' + sessionBlockStyle(s, s.id === S.selSessionId) + '"><b' + (s.status === 'canceled' ? ' class="strike"' : '') + '>' + localTime(s.starts_at) + ' ' + esc(m ? m.name : '?') + '</b><span>' + esc(staffName(s.trainer_id)) + tag + '</span></button>';
    }
    cols += '<div class="wk-col' + (d === S.calDate ? ' sel' : '') + '" style="height:' + ((CAL_END - CAL_START) * HOUR_PX) + 'px">' + inner + '</div>';
  }
  head += '</div>';
  let hours = '<div class="wk-hours">';
  for (let h = CAL_START; h < CAL_END; h++) hours += '<div class="hour">' + pad(h) + ':00</div>';
  hours += '</div>';
  return '<div class="hscroll"><div class="wk">' + head + '<div class="wk-body" data-scroll-key="wk">' + hours + cols + '</div></div></div>';
}

function monthView() {
  const today = todayStr();
  const first = S.calDate.slice(0, 8) + '01';
  const gs = weekStart(first);
  const cur = S.calDate.slice(0, 7);
  const vis = visibleSessions();
  const lastDay = addDays(addMonths(first, 1), -1);
  const cells = daysBetween(gs, lastDay) + 1 > 35 ? 42 : 35;
  let html = '<div class="hscroll"><div class="mo"><div class="mo-head">' + ['월', '화', '수', '목', '금', '토', '일'].map((d, i) => '<div style="color:' + (i === 6 ? '#B42318' : i === 5 ? '#1F4E80' : '#5D625F') + '">' + d + '</div>').join('') + '</div><div class="mo-grid">';
  for (let i = 0; i < cells; i++) {
    const d = addDays(gs, i);
    const evs = vis.filter((s) => localDate(s.starts_at) === d).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    const chips = evs.slice(0, 3).map((s) => { const m = memberById(s.member_id); return '<span class="mo-chip' + (s.status === 'canceled' ? ' strike' : '') + '" style="' + sessionBlockStyle(s, false) + '">' + localTime(s.starts_at) + ' ' + esc(m ? m.name : '?') + '</span>'; }).join('');
    html += '<button type="button" class="mo-cell' + (d.slice(0, 7) !== cur ? ' out' : '') + (d === S.calDate ? ' sel' : '') + '" data-act="pickDay" data-v="' + d + '" aria-label="' + longDay(d) + ' 일정 ' + evs.length + '건"><span class="daynum sm' + (d === today ? ' today' : '') + '">' + Number(d.slice(8)) + '</span>' + chips + (evs.length > 3 ? '<span class="muted small">+' + (evs.length - 3) + '건 더</span>' : '') + '</button>';
  }
  return html + '</div></div></div>';
}

// ---------- 개인 고정 스케줄 ----------
const hm = (t) => String(t || '').slice(0, 5);
const timeMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
function blocksOn(d) {
  const w = dowOf(d);
  return S.blocks.filter((b) => (b.days || []).includes(w) && (S.tFilter === 'all' || b.owner_id === S.tFilter)).sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
}
function blockConflicts(trainerId, date, time, dur) {
  const w = dowOf(date), st = timeMin(time), en = st + (Number(dur) || 60);
  return S.blocks.filter((b) => b.owner_id === trainerId && (b.days || []).includes(w) && timeMin(b.start_time) < en && st < timeMin(b.end_time));
}
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
function daysLabel(days) {
  const d = (days || []).slice().sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  if (d.length === 7) return '매일';
  if (d.join() === '1,2,3,4,5') return '평일';
  if (d.join() === '6,0') return '주말';
  return d.map((x) => DOW[x]).join('·');
}

function blocksView() {
  const people = trainers();
  if (!S.blockOwner || !people.some((p) => p.id === S.blockOwner)) S.blockOwner = S.me.id;
  const owner = profileById(S.blockOwner) || S.me;
  const canEdit = isAdmin() || owner.id === S.me.id;
  const color = owner.color || '#23634A';
  const names = people.map((p) => '<button type="button" class="chip' + (p.id === owner.id ? ' on dark' : '') + '" data-act="blockOwner" data-v="' + p.id + '" aria-pressed="' + (p.id === owner.id) + '"><span class="dot" style="background:' + esc(p.color) + '"></span>' + esc(p.name) + (p.id === S.me.id ? ' (나)' : '') + '</button>').join('');
  const mine = S.blocks.filter((b) => b.owner_id === owner.id);
  let head = '<div class="wk-head"><div></div>';
  let cols = '';
  for (const w of DAY_ORDER) {
    head += '<div class="tt-day" style="color:' + (w === 0 ? '#B42318' : w === 6 ? '#1F4E80' : '#1D2120') + '">' + DOW[w] + '</div>';
    let inner = '';
    if (canEdit) for (let h = CAL_START; h < CAL_END; h++) inner += '<button type="button" class="slot" style="top:' + ((h - CAL_START) * HOUR_PX) + 'px" data-act="blockSlot" data-w="' + w + '" data-t="' + pad(h) + ':00" aria-label="' + DOW[w] + '요일 ' + h + '시 고정 스케줄 추가"></button>';
    for (const b of mine.filter((x) => (x.days || []).includes(w))) {
      const top = (timeMin(b.start_time) - CAL_START * 60) / 60 * HOUR_PX + 1;
      const hgt = Math.max(22, (timeMin(b.end_time) - timeMin(b.start_time)) / 60 * HOUR_PX - 2);
      const style = 'top:' + top + 'px;height:' + hgt + 'px;background:' + tint(color, 0.2) + ';border:1px solid ' + tint(color, 0.45) + ';color:#1D2120';
      const label = '<b>' + esc(b.title) + '</b><span>' + hm(b.start_time) + '–' + hm(b.end_time) + '</span>';
      inner += canEdit ? '<button type="button" class="ev" style="' + style + '" data-act="editBlock" data-id="' + b.id + '" aria-label="' + esc(DOW[w] + ' ' + b.title + ' ' + hm(b.start_time) + '–' + hm(b.end_time) + ' 수정') + '">' + label + '</button>' : '<div class="ev" style="' + style + '">' + label + '</div>';
    }
    cols += '<div class="wk-col" style="height:' + ((CAL_END - CAL_START) * HOUR_PX) + 'px">' + inner + '</div>';
  }
  head += '</div>';
  let hours = '<div class="wk-hours">';
  for (let h = CAL_START; h < CAL_END; h++) hours += '<div class="hour">' + pad(h) + ':00</div>';
  hours += '</div>';
  return '<div class="stack16">' +
    '<div class="row gap6 wrap">' + names + '</div>' +
    '<div class="row-between wrap gap8"><p class="muted small" style="margin:0">' + (canEdit ? '빈 칸을 누르면 그 요일·시간에 고정 스케줄이 들어가요. 들어간 칸을 누르면 시간·요일을 고치거나 지울 수 있어요. 예약·출석 달력에는 회색 빗금으로 보여요.' : esc(owner.name) + ' 강사님의 고정 스케줄이에요. 보기만 할 수 있어요.') + '</p>' +
      (canEdit ? '<button type="button" class="btn btn-primary" data-act="newBlock">+ 여러 요일 한 번에 추가</button>' : '') + '</div>' +
    '<section class="card cal" aria-label="' + esc(owner.name) + ' 고정 스케줄 시간표"><div class="hscroll"><div class="wk">' + head + '<div class="wk-body" data-scroll-key="tt">' + hours + cols + '</div></div></div></section></div>';
}

function sidePanel() {
  let html = '';
  if (S.composer) html += composerView();
  const s = S.selSessionId ? S.sessions.find((x) => x.id === S.selSessionId) || S.todaySessions.find((x) => x.id === S.selSessionId) : null;
  if (s && !S.composer) {
    const m = memberById(s.member_id);
    const st = SESSION_STATUS[s.status];
    const d = localDate(s.starts_at);
    const pass = s.pass_id ? S.passes.find((p) => p.id === s.pass_id) : null;
    const info = pass ? passInfo(pass) : null;
    const j = journalOf(s);
    let actions = '';
    if (s.status === 'reserved') {
      actions = '<div class="row gap8"><button type="button" class="btn btn-primary grow" data-act="setStatus" data-id="' + s.id + '" data-v="done">출석</button><button type="button" class="btn grow" data-act="setStatus" data-id="' + s.id + '" data-v="noshow">노쇼</button></div>' +
        '<div class="row gap8"><button type="button" class="btn grow" data-act="editSession" data-id="' + s.id + '">예약 변경</button><button type="button" class="btn grow danger-text" data-act="setStatus" data-id="' + s.id + '" data-v="canceled">예약 취소</button></div>';
    } else {
      actions = '<button type="button" class="link small left" data-act="setStatus" data-id="' + s.id + '" data-v="reserved">예약 상태로 되돌리기</button>';
    }
    let jhtml = '';
    if (s.status === 'done') {
      jhtml = (j ? journalMetaView(j) + journalItemsView(j.items) + '<button type="button" class="btn btn-primary" data-act="shareJournal" data-id="' + j.id + '">회원에게 보내기</button>' : '<p class="muted small">아직 일지가 없어요.</p>') +
        '<button type="button" class="btn ' + (j ? 'btn-outline' : 'btn-primary') + '" data-act="writeJournal" data-id="' + s.id + '" data-d="' + d + '">' + (j ? '일지 수정' : '일지 쓰기') + '</button>';
    } else if (s.status === 'reserved') {
      jhtml = (j ? '<div class="small b">미리 써 둔 수업일지</div>' + journalMetaView(j) + journalItemsView(j.items) : '') +
        '<button type="button" class="btn btn-outline" data-act="writeJournal" data-id="' + s.id + '" data-d="' + d + '">' + (j ? '미리 쓴 일지 수정' : '수업일지 미리 쓰기') + '</button>';
    }
    const canDelete = isAdmin() || s.trainer_id === S.me.id;
    if (canDelete) jhtml += '<button type="button" class="link small left danger-text" data-act="deleteSession" data-id="' + s.id + '">이 일정 삭제</button>';
    html += '<section class="card stack" aria-label="선택한 일정">' +
      '<div class="row-between"><span class="pill ' + st.cls + '">' + st.label + '</span><button type="button" class="btn icon sm" data-act="closeSession" aria-label="닫기">×</button></div>' +
      '<div><button type="button" class="link big" data-act="openMember" data-id="' + s.member_id + '">' + esc(m ? m.name : '?') + '</button>' +
      '<div class="muted small">' + longDay(d) + ' ' + localTime(s.starts_at) + ' · ' + esc(staffName(s.trainer_id)) + ' · ' + (s.duration_min || 60) + '분</div>' +
      '<div class="muted small">' + (pass ? esc(pass.name) + ' · 잔여 ' + info.remain + '회' : '연결된 수강권 없음') + '</div></div>' +
      actions + jhtml + '</section>';
  }
  const dayList = visibleSessions().filter((x) => localDate(x.starts_at) === S.calDate).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  html += '<section class="card"><div class="row-between mb8"><h2 class="h3">' + longDay(S.calDate) + (S.calDate === todayStr() ? ' · 오늘' : '') + '</h2><span class="muted small">' + dayList.length + '건</span></div>' +
    (dayList.length ? dayList.map((x) => {
      const m = memberById(x.member_id); const st = SESSION_STATUS[x.status];
      return '<button type="button" class="list-row' + (x.id === S.selSessionId ? ' sel' : '') + '" data-act="openSession" data-id="' + x.id + '"><span class="dot" style="background:' + esc(staffColor(x.trainer_id)) + '"></span><span class="t-time">' + localTime(x.starts_at) + '</span><span class="grow"><b>' + esc(m ? m.name : '?') + '</b> <span class="muted small">' + esc(staffName(x.trainer_id)) + '</span></span><span class="pill ' + st.cls + '">' + st.label + '</span></button>';
    }).join('') : '<p class="muted small">이 날은 예약이 없어요.</p>') +
    (blocksOn(S.calDate).length ? '<div class="small b mt8">고정 스케줄 <span class="muted small">· 누르면 예약으로 들어가요</span></div>' + blocksOn(S.calDate).map((b) => '<button type="button" class="list-row" data-act="blockBook" data-id="' + b.id + '" data-d="' + S.calDate + '"><span class="dot" style="background:' + esc(staffColor(b.owner_id)) + '"></span><span class="t-time">' + hm(b.start_time) + '</span><span class="grow">' + esc(b.title) + ' <span class="muted small">' + esc(staffName(b.owner_id)) + ' · ~' + hm(b.end_time) + '</span></span><span class="pill pill-ok">+ 예약</span></button>').join('') : '') +
    '<button type="button" class="btn btn-sm mt8" data-act="slot" data-d="' + S.calDate + '" data-t="10:00">+ 이 날 예약 추가</button></section>';
  return html;
}

function composerView() {
  const c = S.composer;
  const s = composerSession();
  const m = s ? memberById(s.member_id) : null;
  const rows = c.rows.map((r, i) => {
    const video = r.file
      ? '<div class="video-chip"><span class="grow ellipsis">' + esc(r.fileName) + ' (저장할 때 올라가요)</span><button type="button" class="btn btn-ghost-dark btn-sm" data-act="clearVideo" data-i="' + i + '">빼기</button></div>'
      : r.video
        ? '<div class="video-chip"><button type="button" class="btn btn-ghost-dark btn-sm" data-act="playVideo" data-path="' + esc(r.video) + '">▶ 재생</button><span class="grow ellipsis">저장된 영상</span><button type="button" class="btn btn-ghost-dark btn-sm" data-act="clearVideo" data-i="' + i + '">빼기</button></div>'
        : '<label class="upload"><input type="file" accept="video/*" data-video-row="' + i + '">영상 올리기 (휴대폰 촬영본, 50MB 이하)</label>';
    const n = c.rows.length;
    const tools = n > 1
      ? '<div class="row gap6">' +
          '<button type="button" class="btn icon sm" data-act="moveRow" data-i="' + i + '" data-v="-1" aria-label="운동 ' + (i + 1) + ' 위로"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button type="button" class="btn icon sm" data-act="moveRow" data-i="' + i + '" data-v="1" aria-label="운동 ' + (i + 1) + ' 아래로"' + (i === n - 1 ? ' disabled' : '') + '>▼</button>' +
          '<button type="button" class="link small danger-text" data-act="removeRow" data-i="' + i + '">삭제</button></div>'
      : '';
    return '<div class="ex-row"><div class="row-between"><b class="small muted">운동 ' + (i + 1) + (r.exercise ? ' · ' + esc(r.exercise) : '') + '</b>' + tools + '</div>' +
      '<label for="ex-name-' + i + '">운동 이름</label><input id="ex-name-' + i + '" list="exercise-list" data-row="' + i + '" data-field="exercise" value="' + esc(r.exercise) + '" placeholder="예: 스쿼트">' +
      '<div class="row gap8"><div class="grow stack4"><label for="ex-sets-' + i + '">세트</label><input id="ex-sets-' + i + '" type="number" inputmode="numeric" min="0" max="99" data-row="' + i + '" data-field="sets" value="' + esc(r.sets || '') + '" placeholder="3"></div>' +
      '<div class="grow stack4"><label for="ex-reps-' + i + '">횟수</label><input id="ex-reps-' + i + '" type="number" inputmode="numeric" min="0" max="999" data-row="' + i + '" data-field="reps" value="' + esc(r.reps || '') + '" placeholder="12"></div></div>' +
      '<div class="row gap8"><div class="grow stack4"><label for="ex-min-' + i + '">분</label><input id="ex-min-' + i + '" type="number" inputmode="numeric" min="0" max="999" data-row="' + i + '" data-field="min" value="' + esc(r.min || '') + '" placeholder="1"></div>' +
      '<div class="grow stack4"><label for="ex-sec-' + i + '">초</label><input id="ex-sec-' + i + '" type="number" inputmode="numeric" min="0" max="59" data-row="' + i + '" data-field="sec" value="' + esc(r.sec || '') + '" placeholder="30"></div></div>' +
      '<span class="lbl">운동 영상</span>' + video +
      '<label for="ex-check-' + i + '">체크사항</label><textarea id="ex-check-' + i + '" rows="2" data-row="' + i + '" data-field="check" placeholder="자세 피드백, 중량, 다음에 볼 점">' + esc(r.check) + '</textarea></div>';
  }).join('');
  return '<section class="card stack composer" aria-label="수업일지 작성">' +
    '<div class="row-between"><div><h2 class="h3">' + (s && s.status === 'reserved' ? '수업일지 미리 쓰기 · ' : '수업일지 · ') + esc(m ? m.name : '') + '</h2><div class="muted small">' + (s ? longDay(localDate(s.starts_at)) + ' ' + localTime(s.starts_at) + ' · ' + esc(staffName(s.trainer_id)) : '') + '</div>' + (m && m.goal ? '<div class="muted small">목표: ' + esc(m.goal) + '</div>' : '') + '</div><button type="button" class="btn btn-sm" data-act="closeComposer">닫기</button></div>' +
    '<datalist id="exercise-list">' + ['스쿼트', '데드리프트', '벤치프레스', '랫풀다운', '시티드 로우', '런지', '힙브릿지', '플랭크', '레그프레스', '숄더프레스'].map((x) => '<option value="' + x + '"></option>').join('') + '</datalist>' +
    choiceRow('오늘의 컨디션', 'setCondition', CONDITIONS, c.condition) +
    choiceRow('운동 강도', 'setIntensity', INTENSITIES, c.intensity) +
    '<button type="button" class="btn btn-sm left" data-act="loadLastJournal">지난 일지 불러오기</button>' +
    rows +
    '<button type="button" class="btn btn-outline" data-act="addRow">+ 운동 추가</button>' +
    '<button type="button" class="btn btn-primary btn-lg" data-act="saveJournal"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '저장 중…' : '일지 저장') + '</button></section>';
}

function journalTools(j) {
  const canDel = isAdmin() || j.trainer_id === S.me.id;
  return '<div class="row gap8 mt8">' +
    '<button type="button" class="btn btn-sm btn-primary" data-act="shareJournal" data-id="' + j.id + '">회원에게 보내기' + (j.share_token ? ' (링크 있음)' : '') + '</button>' +
    '<button type="button" class="btn btn-sm btn-outline" data-act="editJournalHere" data-id="' + j.session_id + '">수정</button>' +
    (canDel ? '<button type="button" class="btn btn-sm danger-text" data-act="deleteJournal" data-id="' + j.id + '">삭제</button>' : '') + '</div>';
}

// "3세트 × 12회 · 1분 30초"
function doseText(it) {
  const s = Number(it.sets) || 0, r = Number(it.reps) || 0, mi = Number(it.min) || 0, se = Number(it.sec) || 0;
  const a = (s ? s + '세트' : '') + (s && r ? ' × ' : '') + (r ? r + '회' : '');
  const t = (mi ? mi + '분' : '') + (mi && se ? ' ' : '') + (se ? se + '초' : '');
  return a + (a && t ? ' · ' : '') + t;
}
function setsText(it) {
  const t = doseText(it);
  return t ? ' <span class="pill pill-blue">' + t + '</span>' : '';
}

const CONDITIONS = ['아주 좋음', '좋음', '보통', '피곤함', '안 좋음'];
const INTENSITIES = ['가볍게', '보통', '힘들게', '매우 힘들게'];
function journalMetaView(j) {
  if (!j || (!j.condition && !j.intensity)) return '';
  return '<div class="row gap6 wrap mt8">' + (j.condition ? '<span class="pill pill-ok">컨디션 · ' + esc(j.condition) + '</span>' : '') + (j.intensity ? '<span class="pill pill-warn">강도 · ' + esc(j.intensity) + '</span>' : '') + '</div>';
}
function choiceRow(label, act, options, current) {
  return '<div class="stack4"><span class="lbl">' + label + '</span><div class="row gap6 wrap" role="group" aria-label="' + label + '">' +
    options.map((o) => '<button type="button" class="chip' + (current === o ? ' on dark' : '') + '" data-act="' + act + '" data-v="' + esc(o) + '" aria-pressed="' + (current === o) + '">' + esc(o) + '</button>').join('') + '</div></div>';
}

function journalItemsView(items) {
  return '<div class="j-items">' + (items || []).map((it) =>
    '<div class="j-item">' + (it.video ? '<button type="button" class="play" data-act="playVideo" data-path="' + esc(it.video) + '" aria-label="' + esc(it.exercise) + ' 영상 재생">▶</button>' : '') +
    '<div class="grow"><b>' + esc(it.exercise) + '</b>' + setsText(it) + (it.check ? '<div class="small pre">' + esc(it.check) + '</div>' : '') + '</div></div>').join('') + '</div>';
}

// ---------- 회원 ----------
function membersView() {
  const q = S.memberSearch.trim();
  const list = S.members.map((m) => ({ m, st: memberState(m.id) })).filter(({ m, st }) => {
    if (S.memberFilter !== 'all' && st.key !== S.memberFilter) return false;
    if (q && !m.name.includes(q) && !staffName(m.trainer_id).includes(q) && !(m.phone || '').includes(q)) return false;
    return true;
  }).sort((a, b) => a.m.name.localeCompare(b.m.name, 'ko'));
  const filters = [['all', '전체'], ['ok', '이용중'], ['soon', '만료임박'], ['expired', '만료'], ['none', '수강권 없음']].map(([k, l]) =>
    '<button type="button" class="chip' + (S.memberFilter === k ? ' on dark' : '') + '" data-act="memberFilter" data-v="' + k + '" aria-pressed="' + (S.memberFilter === k) + '">' + l + '</button>').join('');
  const rows = list.length ? list.map(({ m, st }) => {
    const s = STATUS[st.key];
    return '<button type="button" class="list-row tall' + (m.id === S.memberId ? ' sel' : '') + '" data-act="openMember" data-id="' + m.id + '"><span class="avatar">' + esc(m.name.slice(0, 1)) + '</span><span class="grow"><b>' + esc(m.name) + '</b><br><span class="muted small">' + esc(staffName(m.trainer_id)) + (st.pass ? ' · ' + esc(st.pass.name) + ' · 잔여 ' + st.info.remain + '회' : '') + '</span></span><span class="pill ' + s.cls + '">' + s.label + '</span></button>';
  }).join('') : '<p class="muted small">' + (S.members.length ? '조건에 맞는 회원이 없어요.' : '아직 회원이 없어요. 회원 추가를 눌러 등록하세요.') + '</p>';
  return '<div class="split">' +
    '<section class="card list-pane"><div class="row-between mb8"><h2 class="h3">회원 ' + S.members.length + '명</h2><button type="button" class="btn btn-primary btn-sm" data-act="newMember">+ 회원 추가</button></div>' +
    '<label for="member-search" class="small b">검색</label><input id="member-search" type="search" data-model="memberSearch" value="' + esc(S.memberSearch) + '" placeholder="이름, 담당 강사, 전화번호">' +
    '<div class="row gap6 wrap mt8 mb8">' + filters + '</div>' + rows + '</section>' +
    '<section class="detail-pane">' + memberDetailView() + '</section></div>';
}

function memberDetailView() {
  const m = S.memberId ? memberById(S.memberId) : null;
  if (!m) return '<div class="card muted">왼쪽에서 회원을 고르세요.</div>';
  const st = memberState(m.id);
  const s = STATUS[st.key];
  const passes = memberPasses(m.id);
  const det = S.memberDetail && S.memberDetail.memberId === m.id ? S.memberDetail : null;
  const pays = S.payments.filter((p) => p.member_id === m.id).sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1));
  const canSeeAllPay = isAdmin() || m.trainer_id === S.me.id;
  const passCards = passes.length ? passes.map((p) => {
    const info = passInfo(p);
    const ps = STATUS[info.key];
    const pct = Math.min(100, Math.round(info.used / p.total_count * 100));
    return '<div class="card pass"><div class="row-between"><b>' + esc(p.name) + '</b><span class="pill ' + ps.cls + '">' + ps.label + '</span></div>' +
      '<div class="kpi-v sm">잔여 ' + info.remain + '회 <span class="muted small">/ ' + p.total_count + '회</span></div>' +
      '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
      '<div class="muted small">' + p.start_date + ' ~ ' + p.end_date + (info.dleft >= 0 ? ' · ' + info.dleft + '일 남음' : ' · 기간 만료') + '</div>' +
      '<div class="row gap8"><button type="button" class="link small" data-act="editPass" data-id="' + p.id + '">수정</button>' + (isAdmin() ? '<button type="button" class="link small danger-text" data-act="deletePass" data-id="' + p.id + '">삭제</button>' : '') + '</div></div>';
  }).join('') : '<div class="card muted small">등록된 수강권이 없어요.</div>';
  const upcoming = det ? det.sessions.filter((x) => x.starts_at >= new Date(new Date().setHours(0, 0, 0, 0)).toISOString() && x.status === 'reserved') : [];
  const journals = det ? det.journals : null;
  return '<div class="stack16">' +
    '<div class="card row-between wrap gap16"><div class="row gap16"><span class="avatar lg">' + esc(m.name.slice(0, 1)) + '</span><div><div class="row gap8"><h2 class="h2">' + esc(m.name) + '</h2><span class="pill ' + s.cls + '">' + s.label + '</span></div>' +
      '<div class="muted small">' + esc(m.phone || '전화번호 없음') + ' · 담당 ' + esc(staffName(m.trainer_id)) + '</div>' + (m.goal ? '<div class="muted small">목표: ' + esc(m.goal) + '</div>' : '') + (m.memo ? '<div class="muted small pre">메모: ' + esc(m.memo) + '</div>' : '') + '</div></div>' +
      '<div class="row gap8 wrap"><button type="button" class="btn btn-sm" data-act="editMember" data-id="' + m.id + '">정보 수정</button><button type="button" class="btn btn-sm" data-act="newSessionFor" data-id="' + m.id + '">예약 추가</button><button type="button" class="btn btn-primary btn-sm" data-act="newPass" data-id="' + m.id + '">수강권 등록</button>' + (isAdmin() ? '<button type="button" class="btn btn-sm danger-text" data-act="deleteMember" data-id="' + m.id + '">회원 삭제</button>' : '') + '</div></div>' +
    '<div class="passes">' + passCards + '</div>' +
    '<div class="grid2">' +
      '<section class="card"><h3 class="h3">수업일지</h3>' + (journals == null ? '<p class="muted small">불러오는 중…</p>' : journals.length ? journals.map((j) => '<div class="j-block"><div class="muted small">' + (j.session_at && j.session_at > new Date().toISOString() ? '<span class="pill pill-warn">미리 작성</span> ' : '') + md(localDate(j.session_at || j.created_at)) + ' ' + (j.session_at ? localTime(j.session_at) : '') + ' · ' + esc(staffName(j.trainer_id)) + '</div>' + journalMetaView(j) + journalItemsView(j.items) + journalTools(j) + '</div>').join('') : '<p class="muted small">아직 일지가 없어요.</p>') + '</section>' +
      '<div class="stack16">' +
        '<section class="card"><h3 class="h3">다가오는 예약</h3>' + (det == null ? '<p class="muted small">불러오는 중…</p>' : upcoming.length ? upcoming.map((x) => { const pre = det.journals.some((j) => j.session_id === x.id); return '<div class="list-row"><button type="button" class="link grow" style="color:inherit;font-weight:500" data-act="gotoSession" data-id="' + x.id + '" data-d="' + localDate(x.starts_at) + '">' + longDay(localDate(x.starts_at)) + ' ' + localTime(x.starts_at) + ' <span class="muted small">' + esc(staffName(x.trainer_id)) + '</span></button><button type="button" class="btn btn-sm' + (pre ? '' : ' btn-outline') + '" data-act="writeJournal" data-id="' + x.id + '" data-d="' + localDate(x.starts_at) + '">' + (pre ? '미리 쓴 일지 수정' : '일지 미리 쓰기') + '</button></div>'; }).join('') : '<p class="muted small">예약 없음</p>') + '</section>' +
        '<section class="card"><h3 class="h3">결제 내역</h3>' + (pays.length ? pays.map((p) => '<div class="list-row"><span class="grow">' + esc(p.item) + '<br><span class="muted small">' + p.paid_on + ' · ' + esc(p.method) + ' · ' + esc(staffName(p.trainer_id)) + '</span></span><b class="num">' + won(p.amount) + '</b></div>').join('') : '<p class="muted small">' + (canSeeAllPay ? '결제 내역이 없어요.' : '본인 매출로 잡힌 결제만 볼 수 있어요.') + '</p>') + '</section>' +
      '</div></div></div>';
}

// ---------- 수업일지 목록 ----------
function journalListView() {
  if (S.journals == null) return '<p class="muted">불러오는 중…</p>';
  // 회원별 일지 수·최근 날짜
  const stat = {};
  for (const j of S.journals) {
    const k = j.member_id;
    const d = j.session_at || j.created_at;
    if (!stat[k]) stat[k] = { n: 0, last: d };
    stat[k].n++;
    if (d > stat[k].last) stat[k].last = d;
  }
  const q = (S.jSearch || '').trim();
  const chips = [['all', '전체 강사']].concat(trainers().map((p) => [p.id, p.name])).map(([id, l]) =>
    '<button type="button" class="chip' + (S.jFilter === id ? ' on dark' : '') + '" data-act="jFilter" data-v="' + id + '" aria-pressed="' + (S.jFilter === id) + '">' + esc(l) + '</button>').join('');
  const list = S.members.filter((m) => (S.jFilter === 'all' || m.trainer_id === S.jFilter) && (!q || m.name.includes(q)))
    .sort((a, b) => { const x = stat[a.id], y = stat[b.id]; if (x && y) return x.last < y.last ? 1 : -1; if (x) return -1; if (y) return 1; return a.name.localeCompare(b.name, 'ko'); });
  const rows = list.length ? list.map((m) => {
    const st = stat[m.id];
    return '<button type="button" class="list-row tall' + (m.id === S.jMember ? ' sel' : '') + '" data-act="jMember" data-id="' + m.id + '"><span class="avatar">' + esc(m.name.slice(0, 1)) + '</span><span class="grow"><b>' + esc(m.name) + '</b><br><span class="muted small">' + esc(staffName(m.trainer_id)) + ' · ' + (st ? '일지 ' + st.n + '개 · 최근 ' + md(localDate(st.last)) : '일지 없음') + '</span></span></button>';
  }).join('') : '<p class="muted small">해당 회원이 없어요.</p>';
  return '<div class="split">' +
    '<section class="card list-pane"><h2 class="h3">회원</h2><label for="j-search" class="small b">검색</label><input id="j-search" type="search" data-model="jSearch" value="' + esc(S.jSearch || '') + '" placeholder="회원 이름">' +
    '<div class="row gap6 wrap mt8 mb8">' + chips + '</div>' + rows + '</section>' +
    '<section class="detail-pane">' + journalMemberView() + '</section></div>';
}

function journalMemberView() {
  const m = S.jMember ? memberById(S.jMember) : null;
  if (!m) return '<div class="card muted">왼쪽에서 회원을 누르면 날짜별 수업일지가 나와요.</div>';
  const det = S.jDetail && S.jDetail.memberId === m.id ? S.jDetail : null;
  const head = '<div class="card row-between wrap gap8"><div class="row gap16"><span class="avatar lg">' + esc(m.name.slice(0, 1)) + '</span><div><h2 class="h2">' + esc(m.name) + '</h2><div class="muted small">담당 ' + esc(staffName(m.trainer_id)) + (m.goal ? ' · 목표: ' + esc(m.goal) : '') + '</div></div></div>' +
    '<button type="button" class="btn btn-sm" data-act="openMember" data-id="' + m.id + '">회원 정보</button></div>';
  if (!det) return '<div class="stack16">' + head + '<div class="card muted">불러오는 중…</div></div>';
  const js = det.journals;
  if (!js.length) return '<div class="stack16">' + head + '<div class="card muted">아직 수업일지가 없어요. 예약·출석에서 출석 처리하면 일지를 쓸 수 있어요.</div></div>';
  const nowIso = new Date().toISOString();
  const sel = js.find((j) => j.id === S.jDate) || js[0];
  // 월별로 묶은 날짜 버튼
  const months = [];
  for (const j of js) {
    const d = localDate(j.session_at || j.created_at);
    const key = d.slice(0, 7);
    let g = months.find((x) => x.key === key);
    if (!g) { g = { key, items: [] }; months.push(g); }
    g.items.push({ j, d });
  }
  const dates = months.map((g) => '<div class="stack6"><div class="small b muted">' + g.key.slice(0, 4) + '년 ' + Number(g.key.slice(5)) + '월</div><div class="row gap6 wrap">' +
    g.items.map(({ j, d }) => { const future = j.session_at && j.session_at > nowIso; return '<button type="button" class="chip' + (j.id === sel.id ? ' on dark' : '') + '" data-act="jDate" data-id="' + j.id + '" aria-pressed="' + (j.id === sel.id) + '">' + md(d) + '(' + DOW[dowOf(d)] + ')' + (future ? ' · 미리' : '') + '</button>'; }).join('') + '</div></div>').join('');
  const sd = localDate(sel.session_at || sel.created_at);
  const future = sel.session_at && sel.session_at > nowIso;
  const card = '<article class="card"><div class="row-between wrap gap8"><h3 class="h2">' + longDay(sd) + (sel.session_at ? ' ' + localTime(sel.session_at) : '') + '</h3><span class="muted small">' + (future ? '<span class="pill pill-warn">미리 작성</span> ' : '') + esc(staffName(sel.trainer_id)) + '</span></div>' +
    journalMetaView(sel) + journalItemsView(sel.items) + journalTools(sel) + '</article>';
  return '<div class="stack16">' + head + '<section class="card stack"><div class="row-between"><h3 class="h3" style="margin:0">날짜 선택</h3><span class="muted small">일지 ' + js.length + '개</span></div>' + dates + '</section>' + card + '</div>';
}

// ---------- 강사 수업료 (프리랜서 3.3%) ----------
// 소득세 3% (10원 미만 버림) + 지방소득세 = 소득세의 10% (10원 미만 버림)
function freelancePay(count, rate, withTax) {
  const gross = count * rate;
  if (withTax === undefined ? !taxOn() : !withTax) return { gross, tax: 0, incomeTax: 0, localTax: 0, net: gross };
  const incomeTax = Math.floor(gross * 0.03 / 10) * 10;
  const localTax = Math.floor(incomeTax * 0.1 / 10) * 10;
  return { gross, tax: incomeTax + localTax, incomeTax, localTax, net: gross - incomeTax - localTax };
}
// 3.3% 공제 적용 여부 (선택사항, 이 기기에 기억. 기본은 적용)
function taxOn() { try { return localStorage.getItem('joeum.tax33') !== '0'; } catch (e) { return true; } }
const payRate = (p) => (p && Number(p.session_pay)) || 30000;

function payView() {
  if (S.monthDone == null) return '<section class="card"><h3 class="h3">수업료 (프리랜서)</h3><p class="muted small">불러오는 중…</p></section>';
  const rows = trainers().filter((p) => isAdmin() || p.id === S.me.id).map((p) => {
    const count = S.monthDone.filter((x) => x.trainer_id === p.id).length;
    return Object.assign({ p, count, rate: payRate(p) }, freelancePay(count, payRate(p)));
  }).filter((r) => r.count > 0 || r.p.role === 'trainer' || r.p.id === S.me.id);
  const sum = rows.reduce((a, r) => ({ gross: a.gross + r.gross, tax: a.tax + r.tax, net: a.net + r.net, count: a.count + r.count }), { gross: 0, tax: 0, net: 0, count: 0 });
  const tr = (r) => '<tr><td><b>' + esc(r.p.name) + '</b></td><td class="r num">' + r.count + '회</td><td class="r num">' + won(r.rate) + '</td><td class="r num">' + won(r.gross) + '</td><td class="r num">' + (taxOn() ? '-' + won(r.tax) + '</td><td class="r num">' : '') + '<b>' + won(r.net) + '</b></td></tr>';
  return '<section class="card"><div class="row-between"><h3 class="h3">' + (isAdmin() ? '강사 수업료 (프리랜서)' : '내 수업료 (프리랜서)') + '</h3><span class="muted small">출석 처리된 수업 기준</span></div>' +
    '<div class="row gap8 wrap mb8"><span class="small b">3.3% 세금 공제</span><div class="seg" role="group" aria-label="3.3% 세금 공제 적용 여부"><button type="button" class="' + (taxOn() ? 'on' : '') + '" data-act="taxToggle" data-v="1" aria-pressed="' + taxOn() + '">적용</button><button type="button" class="' + (!taxOn() ? 'on' : '') + '" data-act="taxToggle" data-v="0" aria-pressed="' + !taxOn() + '">미적용</button></div><span class="muted small">' + (taxOn() ? '수업료에서 3.3%를 빼고 정산해요.' : '세금을 빼지 않고 수업료 그대로 정산해요.') + '</span></div>' +
    '<div class="hscroll"><table class="tbl"><thead><tr><th>강사</th><th class="r">수업</th><th class="r">단가</th><th class="r">수업료</th>' + (taxOn() ? '<th class="r">3.3% 공제</th>' : '') + '<th class="r">' + (taxOn() ? '실지급액' : '정산액') + '</th></tr></thead><tbody>' +
    (rows.length ? rows.map(tr).join('') : '<tr><td colspan="' + (taxOn() ? 6 : 5) + '" class="muted">이 달 출석 처리된 수업이 없어요.</td></tr>') +
    (isAdmin() && rows.length > 1 ? '<tr><td><b>합계</b></td><td class="r num">' + sum.count + '회</td><td></td><td class="r num">' + won(sum.gross) + '</td><td class="r num">' + (taxOn() ? '-' + won(sum.tax) + '</td><td class="r num">' : '') + '<b>' + won(sum.net) + '</b></td></tr>' : '') +
    '</tbody></table></div>' + (() => { const n = S.unchecked.filter((s) => (isAdmin() || s.trainer_id === S.me.id) && s.starts_at.slice(0, 7) <= S.salesMonth).length; return n ? '<p class="form-err">출석 처리 안 된 지난 수업이 ' + n + '건 있어요. 대시보드에서 출석 처리하면 수업료에 들어가요.</p>' : ''; })() + '<p class="muted small">정산액 = 수업 횟수 × 단가' + (taxOn() ? ' − 3.3%(소득세 3% + 지방소득세 0.3%, 10원 미만 버림)' : '') + '. 노쇼·취소 수업은 빠져요.' + (isAdmin() ? ' 단가는 직원 관리에서 강사별로 바꿀 수 있어요.' : '') + ' 이 선택은 이 기기에 저장돼요.' + '</p></section>';
}

// ---------- 매출 ----------
function salesView() {
  const month = S.salesMonth;
  const pays = S.payments.filter((p) => p.paid_on.slice(0, 7) === month).sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1));
  const total = pays.reduce((a, p) => a + p.amount, 0);
  const by = trainers().filter((p) => isAdmin() || p.id === S.me.id).map((p) => ({ p, amt: pays.filter((x) => x.trainer_id === p.id).reduce((a, x) => a + x.amount, 0) }));
  const max = Math.max(1, ...by.map((b) => b.amt));
  const mLabel = month.slice(0, 4) + '년 ' + Number(month.slice(5)) + '월';
  return '<div class="stack16">' +
    '<div class="row gap8 wrap"><button type="button" class="btn icon" data-act="salesMove" data-v="-1" aria-label="이전 달">‹</button><h2 class="h2">' + mLabel + '</h2><button type="button" class="btn icon" data-act="salesMove" data-v="1" aria-label="다음 달">›</button><span class="grow"></span><button type="button" class="btn btn-primary" data-act="newPayment">+ 결제 등록</button></div>' +
    '<div class="kpis">' +
      '<div class="card kpi"><div class="muted small">' + (isAdmin() ? '매출' : '내 매출') + '</div><div class="kpi-v">' + won(total) + '</div></div>' +
      '<div class="card kpi"><div class="muted small">결제 건수</div><div class="kpi-v">' + pays.length + '건</div></div>' +
      '<div class="card kpi"><div class="muted small">객단가</div><div class="kpi-v">' + won(pays.length ? Math.round(total / pays.length) : 0) + '</div></div>' +
      (!isAdmin() && S.monthDone ? (() => { const c = S.monthDone.filter((x) => x.trainer_id === S.me.id).length; const f = freelancePay(c, payRate(S.me)); return '<div class="card kpi"><div class="muted small">' + (taxOn() ? '내 수업료 실지급액' : '내 수업료 정산액') + '</div><div class="kpi-v">' + won(f.net) + '</div><div class="muted small">' + c + '회 × ' + won(payRate(S.me)) + (taxOn() ? ' − 3.3%' : '') + '</div></div>'; })() : '') +
    '</div>' + payView() +
    '<div class="grid2">' +
      '<section class="card"><h3 class="h3">' + (isAdmin() ? '강사별 매출' : '내 매출') + '</h3>' + by.map((b) => '<div class="stack4 mb12"><div class="row-between"><span>' + esc(b.p.name) + '</span><b class="num">' + won(b.amt) + '</b></div><div class="bar"><div style="width:' + Math.round(b.amt / max * 100) + '%;background:' + esc(b.p.color) + '"></div></div></div>').join('') + (isAdmin() ? '' : '<p class="muted small">다른 강사의 매출은 볼 수 없어요.</p>') + '</section>' +
      '<section class="card"><h3 class="h3">결제 내역</h3><div class="hscroll"><table class="tbl"><thead><tr><th>날짜</th><th>회원</th><th>상품</th><th>강사</th><th>수단</th><th class="r">금액</th>' + (isAdmin() ? '<th></th>' : '') + '</tr></thead><tbody>' +
        (pays.length ? pays.map((p) => { const m = memberById(p.member_id); return '<tr><td>' + md(p.paid_on) + '</td><td><b>' + esc(m ? m.name : '?') + '</b></td><td>' + esc(p.item) + '</td><td>' + esc(staffName(p.trainer_id)) + '</td><td>' + esc(p.method) + '</td><td class="r num">' + won(p.amount) + '</td>' + (isAdmin() ? '<td><button type="button" class="link small" data-act="editPayment" data-id="' + p.id + '">수정</button></td>' : '') + '</tr>'; }).join('') : '<tr><td colspan="7" class="muted">이 달 결제가 없어요.</td></tr>') +
      '</tbody></table></div></section></div></div>';
}

// ---------- 게시판 ----------
function taskRow(t) {
  return '<div class="task' + (t.done ? ' done' : '') + '"><button type="button" class="check" data-act="toggleTask" data-id="' + t.id + '" aria-pressed="' + t.done + '" aria-label="' + esc(t.title) + ' 완료 표시">' + (t.done ? '✓' : '') + '</button><span class="grow">' + esc(t.title) + '</span><span class="muted small">' + esc(staffName(t.owner_id)) + (t.due_date ? ' · ' + md(t.due_date) : '') + '</span>' +
    ((isAdmin() || t.owner_id === S.me.id) ? '<button type="button" class="btn icon sm" data-act="deleteTask" data-id="' + t.id + '" aria-label="할 일 삭제">×</button>' : '') + '</div>';
}

function boardView() {
  const postList = (kind) => {
    const list = S.posts.filter((p) => p.kind === kind);
    return list.length ? list.map((p) => {
      const open = S.openPost === p.id;
      const canEdit = isAdmin();
      return '<div class="post"><button type="button" class="post-head" data-act="togglePost" data-id="' + p.id + '" aria-expanded="' + open + '"><b>' + esc(p.title) + '</b><span class="muted small">' + md(localDate(p.created_at)) + ' · ' + esc(staffName(p.author_id)) + '</span></button>' +
        (open ? '<div class="pre small post-body">' + esc(p.body) + '</div>' + (canEdit ? '<div class="row gap8 mb8"><button type="button" class="link small" data-act="editPost" data-id="' + p.id + '">수정</button><button type="button" class="link small danger-text" data-act="deletePost" data-id="' + p.id + '">삭제</button></div>' : '') : '') + '</div>';
    }).join('') : '<p class="muted small">아직 없어요.</p>';
  };
  const sorted = S.tasks.slice().sort((a, b) => (a.done === b.done ? ((a.due_date || '9') < (b.due_date || '9') ? -1 : 1) : a.done ? 1 : -1));
  const owners = trainers().map((p) => '<option value="' + p.id + '"' + (p.id === S.me.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  return '<div class="grid3">' +
    '<section class="card"><div class="row-between mb8"><h2 class="h3">센터 공지</h2>' + (isAdmin() ? '<button type="button" class="btn btn-sm" data-act="newPost" data-v="notice">+ 공지</button>' : '') + '</div>' + postList('notice') + '</section>' +
    '<section class="card"><div class="row-between mb8"><h2 class="h3">업무 매뉴얼</h2>' + (isAdmin() ? '<button type="button" class="btn btn-sm" data-act="newPost" data-v="manual">+ 매뉴얼</button>' : '') + '</div>' + postList('manual') + '</section>' +
    '<section class="card"><h2 class="h3">할 일</h2>' +
      '<form class="stack6 mb12" data-submit="addTask"><label for="task-title" class="small b">새 할 일</label><input id="task-title" name="title" required placeholder="예: 락커 정리"><div class="row gap6"><label class="sr" for="task-owner">담당</label><select id="task-owner" name="owner_id">' + owners + '</select><label class="sr" for="task-due">마감일</label><input id="task-due" name="due_date" type="date"><button class="btn btn-primary" type="submit">추가</button></div></form>' +
      sorted.map(taskRow).join('') + '</section></div>';
}

// ---------- 직원 관리 ----------
function staffView() {
  const rows = S.profiles.slice().sort((a, b) => (a.role === 'pending' ? -1 : 1) - (b.role === 'pending' ? -1 : 1)).map((p) =>
    '<form class="staff-row" data-submit="saveStaff" data-id="' + p.id + '">' +
    '<span class="dot lg" style="background:' + esc(p.color) + '"></span>' +
    '<div class="grow"><label class="sr" for="sn-' + p.id + '">이름</label><input id="sn-' + p.id + '" name="name" value="' + esc(p.name) + '"><div class="muted small">' + esc(p.email || '') + '</div></div>' +
    '<label class="sr" for="sr-' + p.id + '">권한</label><select id="sr-' + p.id + '" name="role"' + (p.id === S.me.id ? ' disabled' : '') + '>' +
      [['pending', '승인 대기'], ['trainer', '강사'], ['admin', '관리자']].map(([v, l]) => '<option value="' + v + '"' + (p.role === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<label class="small" for="sp-' + p.id + '">단가(회당)</label><input id="sp-' + p.id + '" name="session_pay" type="number" min="0" step="1000" value="' + payRate(p) + '" style="width:110px">' +
    '<label class="sr" for="sc-' + p.id + '">색</label><select id="sc-' + p.id + '" name="color">' + COLORS.map((c, i) => '<option value="' + c + '"' + (p.color === c ? ' selected' : '') + '>색 ' + (i + 1) + '</option>').join('') + '</select>' +
    '<button class="btn btn-sm btn-primary" type="submit">저장</button>' + (p.role === 'pending' ? '<span class="pill pill-warn">승인 필요</span>' : '') + '</form>').join('');
  return '<div class="stack16"><div class="card"><h2 class="h3">직원 ' + S.profiles.length + '명</h2><p class="muted small">새 직원은 로그인 화면의 <b>가입 신청</b>으로 계정을 만들고, 여기서 <b>강사</b>로 바꿔 주면 쓸 수 있어요. 관리자는 전체 매출을, 강사는 본인 매출만 봐요.</p>' + rows + '</div></div>';
}

function myInfoView() {
  return '<div class="grid2"><form class="card stack" data-submit="saveMe"><h2 class="h3">내 정보</h2>' +
    '<label for="me-name">이름</label><input id="me-name" name="name" value="' + esc(S.me.name) + '" required>' +
    '<label for="me-color">달력 색</label><select id="me-color" name="color">' + COLORS.map((c, i) => '<option value="' + c + '"' + (S.me.color === c ? ' selected' : '') + '>색 ' + (i + 1) + '</option>').join('') + '</select>' +
    '<div class="muted small">' + esc(S.me.email || (S.user && S.user.email) || '') + ' · ' + (isAdmin() ? '관리자' : '강사') + '</div>' +
    '<button class="btn btn-primary" type="submit">저장</button></form>' +
    '<form class="card stack" data-submit="changePw"><h2 class="h3">비밀번호 바꾸기</h2><label for="me-pw">새 비밀번호 (6자 이상)</label><input id="me-pw" name="password" type="password" minlength="6" required autocomplete="new-password"><button class="btn" type="submit">바꾸기</button></form></div>';
}

// =============================================================
// 모달 (입력 폼)
// =============================================================
function field(id, label, input) { return '<label for="' + id + '">' + label + '</label>' + input; }
function memberOptions(selected) {
  return S.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((m) => '<option value="' + m.id + '"' + (m.id === selected ? ' selected' : '') + '>' + esc(m.name) + ' (' + esc(staffName(m.trainer_id)) + ')</option>').join('');
}
function trainerOptions(selected, onlyMe) {
  return trainers().filter((p) => !onlyMe || p.id === S.me.id).map((p) => '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
}

function modalView() {
  const md_ = S.modal;
  if (!md_) return '';
  let title = '', body = '', submit = '', wide = false;
  const busy = S.busy ? ' disabled' : '';
  if (md_.type === 'session') {
    const s = md_.session;
    title = s ? '예약 변경' : '예약 추가';
    submit = 'saveSession';
    const memberId = s ? s.member_id : md_.memberId || '';
    const m = memberId ? memberById(memberId) : null;
    const trainerId = s ? s.trainer_id : (md_.trainerId || (m ? m.trainer_id : S.me.id));
    const date = s ? localDate(s.starts_at) : md_.date || S.calDate;
    const time = s ? localTime(s.starts_at) : md_.time || '10:00';
    const times = timeOptions(); if (!times.includes(time)) times.push(time);
    body = (S.members.length ? field('ss-member', '회원', '<select id="ss-member" name="member_id" required><option value="">회원 선택</option>' + memberOptions(memberId) + '</select>') : '<p class="form-err">먼저 회원·수강권 화면에서 회원을 등록해 주세요.</p>') +
      field('ss-trainer', '담당 강사', '<select id="ss-trainer" name="trainer_id">' + trainerOptions(trainerId) + '</select>') +
      '<div class="row gap8"><div class="grow stack4">' + field('ss-date', '날짜', '<input id="ss-date" name="date" type="date" required value="' + date + '">') + '</div><div class="grow stack4">' + field('ss-time', '시간', '<select id="ss-time" name="time">' + times.sort().map((t) => '<option' + (t === time ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>') + '</div></div>' +
      field('ss-dur', '수업 시간(분)', '<input id="ss-dur" name="duration_min" type="number" min="10" max="240" step="5" value="' + (s ? s.duration_min : md_.duration || 60) + '">') +
      (s ? '' : field('ss-rep', '매주 같은 시간 반복', '<select id="ss-rep" name="repeat">' + [1, 2, 4, 8, 12].map((n) => '<option value="' + n + '">' + (n === 1 ? '한 번만' : n + '주 동안') + '</option>').join('') + '</select>')) +
      '<p class="muted small">회원의 이용 중인 수강권에 자동으로 연결돼요. 출석 처리하면 1회 차감돼요.</p>';
  } else if (md_.type === 'member') {
    const m = md_.member || {};
    title = md_.member ? '회원 정보 수정' : '회원 추가';
    submit = 'saveMember';
    body = field('mm-name', '이름', '<input id="mm-name" name="name" required value="' + esc(m.name || '') + '">') +
      field('mm-phone', '전화번호', '<input id="mm-phone" name="phone" type="tel" value="' + esc(m.phone || '') + '" placeholder="010-0000-0000">') +
      field('mm-trainer', '담당 강사', '<select id="mm-trainer" name="trainer_id">' + trainerOptions(m.trainer_id || S.me.id) + '</select>') +
      field('mm-goal', '목표', '<input id="mm-goal" name="goal" value="' + esc(m.goal || '') + '" placeholder="예: 거북목 교정, 체지방 감량">') +
      field('mm-memo', '메모 (부상, 특이사항)', '<textarea id="mm-memo" name="memo" rows="3">' + esc(m.memo || '') + '</textarea>') +
      (md_.member ? '' : '<label class="check-line"><input type="checkbox" name="withPass" checked> 이어서 수강권 등록하기</label>');
  } else if (md_.type === 'pass') {
    const p = md_.pass;
    const m = memberById(p ? p.member_id : md_.memberId);
    title = (p ? '수강권 수정' : '수강권 등록') + ' · ' + (m ? m.name : '');
    submit = 'savePass';
    wide = !p;
    const start = p ? p.start_date : todayStr();
    body = (p ? '' : '<div class="row gap6 wrap">' + [['PT 10회', 10, 2], ['PT 20회', 20, 3], ['PT 30회', 30, 4], ['PT 50회', 50, 6]].map(([n, c, mo]) => '<button type="button" class="chip" data-act="passPreset" data-name="' + n + '" data-count="' + c + '" data-months="' + mo + '">' + n + '</button>').join('') + '</div>') +
      field('pp-name', '수강권 이름', '<input id="pp-name" name="name" required value="' + esc(p ? p.name : 'PT 10회') + '">') +
      '<div class="row gap8"><div class="grow stack4">' + field('pp-total', '총 횟수', '<input id="pp-total" name="total_count" type="number" min="1" required value="' + (p ? p.total_count : 10) + '">') + '</div><div class="grow stack4">' + field('pp-before', '이미 쓴 횟수', '<input id="pp-before" name="used_before" type="number" min="0" value="' + (p ? p.used_before : 0) + '">') + '</div></div>' +
      '<p class="muted small">다른 프로그램에서 쓰던 회원이면 지금까지 쓴 횟수를 넣어 주세요.</p>' +
      '<div class="row gap8"><div class="grow stack4">' + field('pp-start', '시작일', '<input id="pp-start" name="start_date" type="date" required value="' + start + '">') + '</div><div class="grow stack4">' + field('pp-end', '만료일', '<input id="pp-end" name="end_date" type="date" required value="' + (p ? p.end_date : passEnd(start, 3)) + '">') + '</div></div>' +
      (p ? '' : '<fieldset class="fs"><legend>결제 (선택)</legend>' +
        '<div class="row gap8"><div class="grow stack4">' + field('pp-amount', '금액 (원)', '<input id="pp-amount" name="amount" type="number" min="0" step="1000" placeholder="0이면 결제 기록 안 함">') + '</div><div class="grow stack4">' + field('pp-method', '결제 수단', '<select id="pp-method" name="method"><option>카드</option><option>계좌이체</option><option>현금</option><option>기타</option></select>') + '</div></div>' +
        field('pp-ptrainer', '매출 잡히는 강사', '<select id="pp-ptrainer" name="pay_trainer_id">' + trainerOptions(isAdmin() ? (m ? m.trainer_id : S.me.id) : S.me.id, !isAdmin()) + '</select>') + '</fieldset>');
  } else if (md_.type === 'payment') {
    const p = md_.payment;
    title = p ? '결제 수정' : '결제 등록';
    submit = 'savePayment';
    body = field('py-member', '회원', '<select id="py-member" name="member_id" required><option value="">회원 선택</option>' + memberOptions(p ? p.member_id : '') + '</select>') +
      field('py-item', '상품', '<input id="py-item" name="item" required value="' + esc(p ? p.item : '') + '" placeholder="예: PT 10회">') +
      '<div class="row gap8"><div class="grow stack4">' + field('py-amount', '금액 (원)', '<input id="py-amount" name="amount" type="number" min="0" step="1000" required value="' + (p ? p.amount : '') + '">') + '</div><div class="grow stack4">' + field('py-method', '결제 수단', '<select id="py-method" name="method">' + ['카드', '계좌이체', '현금', '기타'].map((x) => '<option' + (p && p.method === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>') + '</div></div>' +
      '<div class="row gap8"><div class="grow stack4">' + field('py-date', '결제일', '<input id="py-date" name="paid_on" type="date" required value="' + (p ? p.paid_on : todayStr()) + '">') + '</div><div class="grow stack4">' + field('py-trainer', '매출 잡히는 강사', '<select id="py-trainer" name="trainer_id">' + trainerOptions(p ? p.trainer_id : S.me.id, !isAdmin()) + '</select>') + '</div></div>' +
      (p && isAdmin() ? '<button type="button" class="link small danger-text left" data-act="deletePayment" data-id="' + p.id + '">이 결제 삭제</button>' : '');
  } else if (md_.type === 'post') {
    const p = md_.post;
    const kind = p ? p.kind : md_.kind;
    title = (p ? '수정 · ' : '새 ') + (kind === 'manual' ? '매뉴얼' : '공지');
    submit = 'savePost';
    body = '<input type="hidden" name="kind" value="' + kind + '">' + field('po-title', '제목', '<input id="po-title" name="title" required value="' + esc(p ? p.title : '') + '">') + field('po-body', '내용', '<textarea id="po-body" name="body" rows="8">' + esc(p ? p.body : '') + '</textarea>');
  } else if (md_.type === 'block') {
    const b = md_.block;
    title = b ? '고정 스케줄 수정' : '고정 스케줄 추가';
    submit = 'saveBlock';
    const pre = md_.preset || {};
    const days = b ? b.days : pre.days || [1, 2, 3, 4, 5];
    const times = timeOptions().concat([pad(CAL_END) + ':00']);
    const st = b ? hm(b.start_time) : pre.start || '09:00', en = b ? hm(b.end_time) : pre.end || '18:00';
    if (!times.includes(st)) times.push(st); if (!times.includes(en)) times.push(en); times.sort();
    body = (isAdmin() ? field('bl-owner', '누구 일정', '<select id="bl-owner" name="owner_id">' + trainerOptions(b ? b.owner_id : S.blockOwner || S.me.id) + '</select>') : '') +
      field('bl-title', '내용', '<input id="bl-title" name="title" required value="' + esc(b ? b.title : '') + '" placeholder="예: 병원 근무, 점심, 개인 운동">') +
      '<fieldset class="fs"><legend>요일</legend><div class="row gap6 wrap">' + DAY_ORDER.map((w) => '<label class="day-check"><input type="checkbox" name="day" value="' + w + '"' + (days.includes(w) ? ' checked' : '') + '><span>' + DOW[w] + '</span></label>').join('') + '</div>' +
      '<div class="row gap6 wrap"><button type="button" class="chip" data-act="blockDays" data-v="1,2,3,4,5">평일</button><button type="button" class="chip" data-act="blockDays" data-v="6,0">주말</button><button type="button" class="chip" data-act="blockDays" data-v="1,2,3,4,5,6,0">매일</button></div></fieldset>' +
      '<div class="row gap8"><div class="grow stack4">' + field('bl-start', '시작', '<select id="bl-start" name="start_time">' + times.map((t) => '<option' + (t === st ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>') + '</div><div class="grow stack4">' + field('bl-end', '끝', '<select id="bl-end" name="end_time">' + times.map((t) => '<option' + (t === en ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>') + '</div></div>';
    if (b) body += '<button type="button" class="link small left danger-text" data-act="deleteBlock" data-id="' + b.id + '">이 고정 스케줄 삭제</button>';
  } else if (md_.type === 'share') {
    title = '회원에게 일지 보내기';
    body = '<p class="small">' + esc(md_.memberName) + ' 회원님 전용 링크예요. 로그인 없이 운동 내용과 영상을 볼 수 있어요.</p>' +
      '<label for="share-url">링크</label><input id="share-url" readonly value="' + esc(md_.url) + '">' +
      '<label for="share-text">보낼 글 (고쳐도 돼요)</label><textarea id="share-text" rows="8">' + esc(md_.text) + '</textarea>' +
      '<div class="row gap8 wrap">' + (navigator.share ? '<button type="button" class="btn btn-primary grow" data-act="shareNow">카톡 등으로 보내기</button>' : '') +
      '<button type="button" class="btn grow" data-act="copyShare">글+링크 복사</button></div>' +
      '<button type="button" class="link small left" data-act="openShareLink">회원이 보는 화면 미리보기</button>' +
      '<button type="button" class="link small left danger-text" data-act="unshareJournal" data-id="' + md_.journalId + '">링크 끄기 (보낸 링크로 더는 못 봐요)</button>';
  } else if (md_.type === 'video') {
    title = '운동 영상';
    body = md_.url ? '<video src="' + esc(md_.url) + '" controls playsinline autoplay style="width:100%;max-height:70vh;background:#000;border-radius:8px"></video>' : '<p class="muted">영상을 불러오는 중…</p>';
  } else if (md_.type === 'confirm') {
    title = md_.title;
    body = '<p>' + esc(md_.text) + '</p>';
    submit = 'confirmYes';
  }
  return '<div class="modal-back" data-act="closeModalBack"><div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<form class="stack" data-submit="' + submit + '"><div class="row-between"><h2 class="h2">' + esc(title) + '</h2><button type="button" class="btn icon sm" data-act="closeModal" aria-label="닫기">×</button></div>' + body +
    (submit ? '<div class="row gap8 end mt8"><button type="button" class="btn" data-act="closeModal">취소</button><button type="submit" class="btn ' + (md_.type === 'confirm' ? 'btn-danger' : 'btn-primary') + '"' + busy + '>' + (S.busy ? '저장 중…' : md_.type === 'confirm' ? (md_.yes || '삭제') : '저장') + '</button></div>' : '') +
    '</form></div></div>';
}

// =============================================================
// 데이터 불러오기
// =============================================================
async function loadMe() {
  S.user = await api.currentUser();
  if (!S.user) { S.me = null; return; }
  const rows = await api.select('profiles', { filters: [['id', 'eq', S.user.id]] });
  S.me = rows[0] || null;
  if (!S.me) {
    // 트리거가 늦을 수 있음 → 잠깐 뒤 다시
    await new Promise((r) => setTimeout(r, 800));
    const again = await api.select('profiles', { filters: [['id', 'eq', S.user.id]] });
    S.me = again[0] || { id: S.user.id, name: S.user.email, role: 'pending' };
  }
}

async function loadCore() {
  const [profiles, members, passes, usage, payments, posts, tasks, blocks] = await Promise.all([
    api.select('profiles', { order: 'created_at.asc' }),
    api.select('members', { order: 'name.asc' }),
    api.select('passes', { order: 'end_date.desc' }),
    api.select('pass_usage'),
    api.select('payments', { order: 'paid_on.desc' }),
    api.select('posts', { order: 'created_at.desc' }),
    api.select('tasks', { order: 'created_at.desc' }),
    api.select('blocks', { order: 'start_time.asc' }).catch(() => []),
  ]);
  Object.assign(S, { profiles, members, passes, payments, posts, tasks, blocks });
  S.usage = {};
  for (const u of usage) S.usage[u.pass_id] = u.used;
  const me = profiles.find((p) => p.id === S.me.id);
  if (me) S.me = me;
}

async function loadUsage() {
  const usage = await api.select('pass_usage');
  S.usage = {};
  for (const u of usage) S.usage[u.pass_id] = u.used;
}

function calRange() {
  if (S.calView === 'week') { const ws = weekStart(S.calDate); return [ws, addDays(ws, 7)]; }
  const gs = weekStart(S.calDate.slice(0, 8) + '01');
  return [gs, addDays(gs, 42)];
}

async function loadSessions(force) {
  const [from, to] = calRange();
  const key = from + '|' + to;
  if (!force && key === S.sessionsRange) return;
  const rows = await api.select('sessions', {
    select: '*,journals(id,items,trainer_id,updated_at,share_token,condition,intensity)',
    filters: [['starts_at', 'gte', new Date(from + 'T00:00:00').toISOString()], ['starts_at', 'lt', new Date(to + 'T00:00:00').toISOString()]],
    order: 'starts_at.asc',
  });
  S.sessions = rows;
  S.sessionsRange = key;
}

async function loadUnchecked() {
  S.unchecked = await api.select('sessions', {
    select: 'id,member_id,trainer_id,starts_at,status',
    filters: [['status', 'eq', 'reserved'], ['starts_at', 'lt', new Date().toISOString()], ['starts_at', 'gte', new Date(addDays(todayStr(), -30) + 'T00:00:00').toISOString()]],
    order: 'starts_at.desc',
  });
}

async function loadToday() {
  await loadUnchecked();
  const t = todayStr();
  S.todaySessions = await api.select('sessions', {
    select: '*,journals(id,items,trainer_id,updated_at,share_token,condition,intensity)',
    filters: [['starts_at', 'gte', new Date(t + 'T00:00:00').toISOString()], ['starts_at', 'lt', new Date(addDays(t, 1) + 'T00:00:00').toISOString()]],
    order: 'starts_at.asc',
  });
}

async function loadMemberDetail(memberId) {
  const [journals, sessions] = await Promise.all([
    api.select('journals', { filters: [['member_id', 'eq', memberId]], order: 'created_at.desc', limit: 50 }),
    api.select('sessions', { filters: [['member_id', 'eq', memberId]], order: 'starts_at.asc' }),
  ]);
  const at = {};
  for (const s of sessions) at[s.id] = s.starts_at;
  for (const j of journals) j.session_at = at[j.session_id] || null;
  journals.sort((a, b) => ((b.session_at || b.created_at) > (a.session_at || a.created_at) ? 1 : -1));
  S.memberDetail = { memberId, journals, sessions };
}

async function loadJournals() {
  // 회원별 개수·최근 날짜용 가벼운 목록
  const idx = await api.select('journals', { select: 'id,member_id,session_id,trainer_id,created_at', order: 'created_at.desc', limit: 5000 });
  const ids = idx.map((j) => j.session_id).filter(Boolean);
  const at = {};
  for (let i = 0; i < ids.length; i += 80) {
    const ss = await api.select('sessions', { select: 'id,starts_at', filters: [['id', 'in', ids.slice(i, i + 80)]] });
    for (const s of ss) at[s.id] = s.starts_at;
  }
  for (const j of idx) j.session_at = at[j.session_id] || null;
  S.journals = idx;
  if (S.jMember) await loadJDetail(S.jMember);
}

async function loadJDetail(memberId) {
  const [journals, sessions] = await Promise.all([
    api.select('journals', { filters: [['member_id', 'eq', memberId]], order: 'created_at.desc', limit: 500 }),
    api.select('sessions', { select: 'id,starts_at', filters: [['member_id', 'eq', memberId]] }),
  ]);
  const at = {};
  for (const s of sessions) at[s.id] = s.starts_at;
  for (const j of journals) j.session_at = at[j.session_id] || null;
  journals.sort((a, b) => ((b.session_at || b.created_at) > (a.session_at || a.created_at) ? 1 : -1));
  S.jDetail = { memberId, journals };
}

async function loadMonthDone() {
  const m = S.salesMonth;
  const from = new Date(m + '-01T00:00:00').toISOString();
  const to = new Date(addMonths(m + '-01', 1) + 'T00:00:00').toISOString();
  S.monthDone = await api.select('sessions', { select: 'id,trainer_id,starts_at', filters: [['status', 'eq', 'done'], ['starts_at', 'gte', from], ['starts_at', 'lt', to]] });
}

async function refreshAfterSessionChange() {
  await Promise.all([loadSessions(true), loadToday(), loadUsage()]);
  if (S.memberDetail) await loadMemberDetail(S.memberDetail.memberId);
}

async function enterApp() {
  await loadMe();
  if (S.me && S.me.role !== 'pending') {
    await loadCore();
    await Promise.all([loadToday(), loadSessions(true)]);
  }
}

async function goScreen(screen) {
  S.screen = screen;
  S.modal = null;
  render();
  if (screen === 'journal') { S.journals = null; render(); await loadJournals(); }
  if (screen === 'sales') { S.monthDone = null; render(); await loadMonthDone(); }
  if (screen === 'schedule') await loadSessions();
  if (screen === 'members' && S.memberId) await loadMemberDetail(S.memberId);
  render();
}

// =============================================================
// 동작
// =============================================================
function composerSession() {
  const c = S.composer;
  if (!c) return null;
  return S.sessions.find((x) => x.id === c.sessionId) || S.todaySessions.find((x) => x.id === c.sessionId) || c.session || null;
}
const emptyRow = () => ({ exercise: '', sets: '', reps: '', min: '', sec: '', check: '', video: '' });
const itemToRow = (it) => ({ exercise: it.exercise || '', sets: it.sets || '', reps: it.reps || '', min: it.min || '', sec: it.sec || '', check: it.check || '', video: it.video || '' });
const formVals = (form) => Object.fromEntries(new FormData(form).entries());

function syncComposer() {
  if (!S.composer) return;
  document.querySelectorAll('[data-row][data-field]').forEach((el) => {
    const r = S.composer.rows[Number(el.dataset.row)];
    if (r) r[el.dataset.field] = el.value;
  });
}

function confirmBox(title, text, yes, fn) {
  S.modal = { type: 'confirm', title, text, yes, fn };
  render();
}

const actions = {
  authView: (d) => { S.authView = d.v; S.authErr = ''; S.authMsg = ''; render(); },
  enterDemo: () => { localStorage.setItem('joeum_demo', '1'); location.reload(); },
  leaveDemo: () => { localStorage.removeItem('joeum_demo'); const u = new URL(location.href); u.searchParams.delete('demo'); location.href = u.toString(); },
  demoReset: () => { api.reset(); toast('체험 데이터를 처음 상태로 돌렸어요.'); },
  logout: () => run(async () => { await api.signOut(); location.reload(); }),
  reloadMe: () => run(async () => { await enterApp(); if (S.me && S.me.role === 'pending') toast('아직 승인 전이에요.'); }),
  refresh: () => run(async () => { await loadCore(); await Promise.all([loadToday(), loadSessions(true)]); if (S.screen === 'journal') await loadJournals(); if (S.screen === 'sales') await loadMonthDone(); if (S.memberDetail) await loadMemberDetail(S.memberDetail.memberId); }, '최신 내용으로 불러왔어요.'),
  go: (d) => goScreen(d.v),

  // 달력
  calView: (d) => run(async () => { S.calView = d.v; await loadSessions(); }),
  calMove: (d) => run(async () => { S.calDate = S.calView === 'week' ? addDays(S.calDate, 7 * Number(d.v)) : addMonths(S.calDate, Number(d.v)); S.selSessionId = null; S.composer = null; await loadSessions(); }),
  calToday: () => run(async () => { S.calDate = todayStr(); await loadSessions(); }),
  tFilter: (d) => { S.tFilter = d.v; render(); },
  pickDay: (d) => { S.calDate = d.v; render(); },
  slot: (d) => { S.modal = { type: 'session', date: d.d, time: d.t }; render(); },
  blockBook: (d) => run(async () => {
    const b = S.blocks.find((x) => x.id === d.id); if (!b) return;
    const date = d.d || S.calDate, time = hm(b.start_time);
    const dur = Math.min(240, Math.max(10, timeMin(b.end_time) - timeMin(b.start_time)));
    // 고정 스케줄 이름에 회원 이름이 들어 있으면 그 회원 예약으로 바로 넣기
    const hits = S.members.filter((m) => m.name && b.title.includes(m.name));
    if (hits.length === 1) {
      const m = hits[0];
      const startsAt = toIso(date, time);
      if (S.sessions.some((x) => x.member_id === m.id && x.trainer_id === b.owner_id && x.status !== 'canceled' && x.starts_at === startsAt)) { toast('이미 예약돼 있어요.'); return; }
      const pass = activePass(m.id);
      await api.insert('sessions', [{ member_id: m.id, trainer_id: b.owner_id, pass_id: pass ? pass.id : null, starts_at: startsAt, duration_min: dur, status: 'reserved' }]);
      S.calDate = date; S.screen = 'schedule';
      await refreshAfterSessionChange();
      toast(m.name + ' 회원 ' + longDay(date) + ' ' + time + ' 예약을 넣었어요.');
      return;
    }
    S.modal = { type: 'session', date, time, trainerId: b.owner_id, duration: dur };
  }),
  taxToggle: (d) => { try { localStorage.setItem('joeum.tax33', d.v === '1' ? '1' : '0'); } catch (e) { /* 저장 불가 시 무시 */ } render(); },
  newSession: () => { S.modal = { type: 'session', date: S.calDate, time: '10:00' }; render(); },
  newSessionFor: (d) => { S.modal = { type: 'session', memberId: d.id, date: todayStr(), time: '10:00' }; render(); },
  editSession: (d) => { const s = S.sessions.find((x) => x.id === d.id) || S.todaySessions.find((x) => x.id === d.id); S.modal = { type: 'session', session: s }; render(); },
  openSession: (d) => run(async () => {
    const s = S.sessions.find((x) => x.id === d.id) || S.todaySessions.find((x) => x.id === d.id);
    if (!s) return;
    S.selSessionId = s.id; S.composer = null;
    S.calDate = localDate(s.starts_at);
    if (S.screen !== 'schedule') { S.screen = 'schedule'; }
    await loadSessions();
  }),
  gotoSession: (d) => run(async () => { S.screen = 'schedule'; S.calDate = d.d; S.selSessionId = d.id; S.composer = null; await loadSessions(); }),
  closeSession: () => { S.selSessionId = null; render(); },
  deleteSession: (d) => {
    const s = S.sessions.find((x) => x.id === d.id) || S.todaySessions.find((x) => x.id === d.id);
    if (!s) return;
    const m = memberById(s.member_id);
    const when = longDay(localDate(s.starts_at)) + ' ' + localTime(s.starts_at);
    const extra = s.status === 'done' ? ' 출석 처리된 수업이라 수강권 횟수가 1회 돌아오고, 수업료에서도 빠지고, 수업일지도 같이 지워져요.' : journalOf(s) ? ' 수업일지도 같이 지워져요.' : '';
    confirmBox('일정 삭제', (m ? m.name : '') + ' ' + when + ' 일정을 지울까요?' + extra + ' 되돌릴 수 없어요.', '삭제', async () => {
      await api.remove('sessions', s.id);
      S.selSessionId = null; S.composer = null;
      await refreshAfterSessionChange();
      if (S.screen === 'sales') await loadMonthDone();
    });
  },
  setStatus: (d) => run(async () => {
    await api.update('sessions', d.id, { status: d.v });
    await refreshAfterSessionChange();
    if (S.screen === 'sales') await loadMonthDone();
    const s = S.sessions.find((x) => x.id === d.id) || S.todaySessions.find((x) => x.id === d.id);
    if (d.v === 'done' && s && !journalOf(s) && S.screen === 'schedule') S.composer = { sessionId: s.id, journalId: null, condition: '', intensity: '', rows: [emptyRow()] };
    toast({ done: '출석 처리 · 수강권 1회 차감', noshow: '노쇼 처리 (차감 안 함)', canceled: '예약을 취소했어요', reserved: '예약 상태로 되돌렸어요' }[d.v]);
  }),

  // 일지
  writeJournal: (d) => run(async () => {
    S.screen = 'schedule';
    let s = S.sessions.find((x) => x.id === d.id) || S.todaySessions.find((x) => x.id === d.id);
    if (s) S.calDate = localDate(s.starts_at);
    else if (d.d) S.calDate = d.d;
    await loadSessions();
    s = S.sessions.find((x) => x.id === d.id) || s;
    const j = s ? journalOf(s) : null;
    S.selSessionId = d.id;
    S.composer = { sessionId: d.id, journalId: j ? j.id : null, condition: (j && j.condition) || '', intensity: (j && j.intensity) || '', rows: j && j.items.length ? j.items.map(itemToRow) : [emptyRow()] };
  }),
  closeComposer: () => { S.composer = null; render(); },
  setCondition: (d) => { syncComposer(); S.composer.condition = S.composer.condition === d.v ? '' : d.v; render(); },
  setIntensity: (d) => { syncComposer(); S.composer.intensity = S.composer.intensity === d.v ? '' : d.v; render(); },
  newBlock: () => { S.modal = { type: 'block' }; render(); },
  blockOwner: (d) => { S.blockOwner = d.v; render(); },
  blockSlot: (d) => { const h = Number(d.t.slice(0, 2)); S.modal = { type: 'block', preset: { days: [Number(d.w)], start: d.t, end: pad(Math.min(CAL_END, h + 1)) + ':00' } }; render(); },
  editBlock: (d) => { S.modal = { type: 'block', block: S.blocks.find((b) => b.id === d.id) }; render(); },
  deleteBlock: (d) => { const b = S.blocks.find((x) => x.id === d.id); confirmBox('고정 스케줄 삭제', b.title + ' (' + daysLabel(b.days) + ' ' + hm(b.start_time) + '–' + hm(b.end_time) + ') 을 지울까요?', '삭제', async () => { await api.remove('blocks', d.id); await loadCore(); }); },
  blockDays: (d) => { const on = d.v.split(','); document.querySelectorAll('input[name=day]').forEach((el) => { el.checked = on.includes(el.value); }); },
  shareJournal: (d) => run(async () => {
    const rows = await api.select('journals', { filters: [['id', 'eq', d.id]] });
    let j = rows[0];
    if (!j) throw new Error('일지를 찾을 수 없어요.');
    if (!j.share_token) j = await api.update('journals', j.id, { share_token: (uid() + uid()).replace(/-/g, '') });
    let startsAt = null;
    if (j.session_id) { const ss = await api.select('sessions', { select: 'id,starts_at', filters: [['id', 'eq', j.session_id]] }); startsAt = ss[0] ? ss[0].starts_at : null; }
    const m = memberById(j.member_id);
    const url = shareUrl(j.share_token);
    S.modal = { type: 'share', journalId: j.id, memberName: m ? m.name : '', url, text: shareText(m ? m.name : '', startsAt, j.items, url, j.condition, j.intensity) };
    await Promise.all([loadSessions(true), loadToday()]);
    if (S.screen === 'journal') await loadJournals();
  }),
  shareNow: () => {
    const text = document.getElementById('share-text').value;
    navigator.share({ title: CENTER_NAME + ' 수업일지', text }).catch(() => {});
  },
  copyShare: () => {
    const text = document.getElementById('share-text').value;
    const done = () => toast('복사했어요. 카톡 대화창에 붙여 넣으세요.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => { document.getElementById('share-text').select(); document.execCommand('copy'); done(); });
    else { document.getElementById('share-text').select(); document.execCommand('copy'); done(); }
  },
  openShareLink: () => { window.open(S.modal.url, '_blank'); },
  unshareJournal: (d) => run(async () => {
    await api.update('journals', d.id, { share_token: null });
    S.modal = null;
    await Promise.all([loadSessions(true), loadToday()]);
    if (S.screen === 'journal') await loadJournals();
  }, '링크를 껐어요. 보낸 링크로는 더 이상 볼 수 없어요.'),
  editJournalHere: (d) => run(async () => {
    const rows = await api.select('sessions', { select: '*,journals(id,items,trainer_id,updated_at,share_token,condition,intensity)', filters: [['id', 'eq', d.id]] });
    const s = rows[0];
    if (!s) throw new Error('연결된 일정을 찾을 수 없어요.');
    const j = journalOf(s);
    S.composer = { sessionId: s.id, session: s, journalId: j ? j.id : null, condition: (j && j.condition) || '', intensity: (j && j.intensity) || '', rows: j && j.items.length ? j.items.map(itemToRow) : [emptyRow()] };
  }),
  deleteJournal: (d) => confirmBox('수업일지 삭제', '이 수업일지를 지울까요? 수업(출석 기록)은 그대로 남아요. 되돌릴 수 없어요.', '삭제', async () => {
    await api.remove('journals', d.id);
    await Promise.all([loadSessions(true), loadToday()]);
    if (S.screen === 'journal') await loadJournals();
    if (S.memberDetail) await loadMemberDetail(S.memberDetail.memberId);
  }),
  loadLastJournal: () => {
    syncComposer();
    const c = S.composer;
    const s = composerSession();
    if (!s) return;
    run(async () => {
      const list = await api.select('journals', { filters: [['member_id', 'eq', s.member_id]], order: 'updated_at.desc', limit: 10 });
      const last = list.find((j) => j.session_id !== s.id && (j.items || []).length);
      if (!last) { toast('이 회원의 지난 일지가 없어요.'); return; }
      const keep = c.rows.filter((r) => r.exercise.trim());
      c.rows = keep.concat(last.items.map((it) => Object.assign(itemToRow(it), { video: '' })));
      toast('지난 일지의 운동 ' + last.items.length + '개를 불러왔어요. 영상은 빼고 가져와요.');
    });
  },
  addRow: () => { syncComposer(); S.composer.rows.push(emptyRow()); render(); },
  moveRow: (d) => {
    syncComposer();
    const rows = S.composer.rows, i = Number(d.i), j = i + Number(d.v);
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    render();
  },
  removeRow: (d) => { syncComposer(); S.composer.rows.splice(Number(d.i), 1); render(); },
  clearVideo: (d) => { syncComposer(); const r = S.composer.rows[Number(d.i)]; r.file = null; r.fileName = ''; r.video = ''; render(); },
  saveJournal: () => {
    syncComposer();
    const c = S.composer;
    const rows = c.rows.filter((r) => r.exercise.trim());
    if (!rows.length) { toast('운동 이름을 하나 이상 입력해 주세요.'); return; }
    const s = composerSession();
    if (!s) { toast('일정을 찾을 수 없어요. 새로고침 후 다시 해 주세요.'); return; }
    run(async () => {
      const items = [];
      for (const r of rows) {
        let video = r.video || '';
        if (r.file) {
          const ext = (r.fileName.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
          video = s.member_id + '/' + localDate(s.starts_at) + '_' + uid() + '.' + ext;
          toast('영상 올리는 중… (' + r.fileName + ')');
          await api.upload(video, r.file);
        }
        items.push({ exercise: r.exercise.trim(), sets: Number(r.sets) || null, reps: Number(r.reps) || null, min: Number(r.min) || null, sec: Number(r.sec) || null, check: (r.check || '').trim(), video });
      }
      const meta = { condition: c.condition || null, intensity: c.intensity || null };
      if (c.journalId) await api.update('journals', c.journalId, Object.assign({ items, updated_at: new Date().toISOString() }, meta));
      else await api.insert('journals', [Object.assign({ session_id: s.id, member_id: s.member_id, trainer_id: s.trainer_id || S.me.id, items }, meta)]);
      S.composer = null;
      await Promise.all([loadSessions(true), loadToday()]);
      if (S.memberDetail && S.memberDetail.memberId === s.member_id) await loadMemberDetail(s.member_id);
      if (S.screen === 'journal') await loadJournals();
    }, '수업일지를 저장했어요.');
  },
  playVideo: (d) => {
    S.modal = { type: 'video', url: null };
    render();
    api.videoUrl(d.path).then((url) => { if (S.modal && S.modal.type === 'video') { S.modal.url = url; render(); } }).catch((e) => { S.modal = null; toast(e.message); });
  },
  jFilter: (d) => { S.jFilter = d.v; render(); },
  jMember: (d) => run(async () => { S.jMember = d.id; S.jDate = null; S.jDetail = null; render(); await loadJDetail(d.id); }),
  jDate: (d) => { S.jDate = d.id; render(); },

  // 회원
  memberFilter: (d) => { S.memberFilter = d.v; render(); },
  openMember: (d) => run(async () => { S.screen = 'members'; S.memberId = d.id; S.memberDetail = null; S.modal = null; render(); await loadMemberDetail(d.id); }),
  newMember: () => { S.modal = { type: 'member' }; render(); },
  editMember: (d) => { S.modal = { type: 'member', member: memberById(d.id) }; render(); },
  deleteMember: (d) => { const m = memberById(d.id); confirmBox('회원 삭제', m.name + ' 회원과 수강권·예약·일지·결제 기록이 모두 지워져요. 되돌릴 수 없어요.', '삭제', async () => { await api.remove('members', d.id); S.memberId = null; S.memberDetail = null; await loadCore(); await refreshAfterSessionChange(); }); },
  newPass: (d) => { S.modal = { type: 'pass', memberId: d.id }; render(); },
  editPass: (d) => { S.modal = { type: 'pass', pass: S.passes.find((p) => p.id === d.id) }; render(); },
  deletePass: (d) => { const p = S.passes.find((x) => x.id === d.id); confirmBox('수강권 삭제', p.name + ' 수강권을 지울까요? 연결된 예약은 남지만 횟수 계산에서 빠져요.', '삭제', async () => { await api.remove('passes', d.id); await loadCore(); }); },
  passPreset: (d) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('pp-name', d.name); set('pp-total', d.count);
    const st = document.getElementById('pp-start');
    const start = st && st.value ? st.value : todayStr();
    set('pp-end', passEnd(start, Number(d.months)));
  },

  // 매출
  salesMove: (d) => run(async () => { S.salesMonth = addMonths(S.salesMonth + '-01', Number(d.v)).slice(0, 7); S.monthDone = null; render(); await loadMonthDone(); }),
  newPayment: () => { S.modal = { type: 'payment' }; render(); },
  editPayment: (d) => { S.modal = { type: 'payment', payment: S.payments.find((p) => p.id === d.id) }; render(); },
  deletePayment: (d) => confirmBox('결제 삭제', '이 결제 기록을 지울까요? 되돌릴 수 없어요.', '삭제', async () => { await api.remove('payments', d.id); await loadCore(); }),

  // 게시판
  togglePost: (d) => { S.openPost = S.openPost === d.id ? null : d.id; render(); },
  openPost: (d) => { S.screen = 'board'; S.openPost = d.id; render(); },
  newPost: (d) => { S.modal = { type: 'post', kind: d.v }; render(); },
  editPost: (d) => { S.modal = { type: 'post', post: S.posts.find((p) => p.id === d.id) }; render(); },
  deletePost: (d) => confirmBox('삭제', '이 글을 지울까요?', '삭제', async () => { await api.remove('posts', d.id); await loadCore(); }),
  toggleTask: (d) => run(async () => { const t = S.tasks.find((x) => x.id === d.id); await api.update('tasks', d.id, { done: !t.done }); t.done = !t.done; }),
  deleteTask: (d) => run(async () => { await api.remove('tasks', d.id); S.tasks = S.tasks.filter((t) => t.id !== d.id); }),

  // 모달
  closeModal: () => { S.modal = null; render(); },
  closeModalBack: (d, el, ev) => { if (ev.target === el) { S.modal = null; render(); } },
};

const submits = {
  login: (v) => run(async () => {
    S.authErr = '';
    try { await api.signIn(v.email.trim(), v.password); } catch (e) { S.authErr = e.message; return; }
    await enterApp();
  }),
  signup: (v) => run(async () => {
    S.authErr = ''; S.authMsg = '';
    let r;
    try { r = await api.signUp(v.email.trim(), v.password, v.name.trim()); } catch (e) { S.authErr = e.message; return; }
    if (r.needsConfirm) { S.authView = 'sent'; S.authMsg = v.email + ' 으로 인증 메일을 보냈어요. 메일의 링크를 누르면 로그인돼요. (메일이 안 보이면 스팸함도 확인해 주세요)'; return; }
    await enterApp();
  }),
  forgot: (v) => run(async () => {
    S.authErr = '';
    try { await api.resetPassword(v.email.trim()); } catch (e) { S.authErr = e.message; return; }
    S.authView = 'sent'; S.authMsg = '비밀번호 재설정 메일을 보냈어요. 메일의 링크를 누르면 새 비밀번호를 정할 수 있어요.';
  }),
  newpw: (v) => run(async () => {
    S.authErr = '';
    try { await api.updatePassword(v.password); } catch (e) { S.authErr = e.message; return; }
    S.authView = 'login';
    await enterApp();
  }, '비밀번호를 바꿨어요.'),

  saveSession: (v) => run(async () => {
    if (!v.member_id) throw new Error('회원을 골라 주세요.');
    const s = S.modal.session;
    const pass = activePass(v.member_id);
    if (s) {
      await api.update('sessions', s.id, { member_id: v.member_id, trainer_id: v.trainer_id, starts_at: toIso(v.date, v.time), duration_min: Number(v.duration_min) || 60, pass_id: s.member_id === v.member_id ? s.pass_id : pass ? pass.id : null });
    } else {
      const n = Number(v.repeat) || 1;
      const rows = [];
      for (let i = 0; i < n; i++) rows.push({ member_id: v.member_id, trainer_id: v.trainer_id, pass_id: pass ? pass.id : null, starts_at: toIso(addDays(v.date, 7 * i), v.time), duration_min: Number(v.duration_min) || 60, status: 'reserved' });
      await api.insert('sessions', rows);
    }
    const clash = blockConflicts(v.trainer_id, v.date, v.time, v.duration_min);
    S.modal = null;
    S.calDate = v.date;
    if (clash.length) setTimeout(() => toast('저장했어요. 단, ' + staffName(v.trainer_id) + ' 강사의 고정 스케줄(' + clash[0].title + ' ' + hm(clash[0].start_time) + '–' + hm(clash[0].end_time) + ')과 겹쳐요.'), 50);
    if (S.screen !== 'members') S.screen = 'schedule';
    await refreshAfterSessionChange();
  }, '예약을 저장했어요.'),

  saveBlock: (v, form) => run(async () => {
    const days = [...form.querySelectorAll('input[name=day]:checked')].map((el) => Number(el.value));
    if (!days.length) throw new Error('요일을 하나 이상 골라 주세요.');
    if (v.end_time <= v.start_time) throw new Error('끝나는 시간이 시작 시간보다 늦어야 해요.');
    const row = { owner_id: isAdmin() && v.owner_id ? v.owner_id : S.me.id, title: v.title.trim(), days, start_time: v.start_time, end_time: v.end_time };
    const b = S.modal.block;
    if (b) await api.update('blocks', b.id, row);
    else await api.insert('blocks', [row]);
    S.modal = null;
    await loadCore();
  }, '고정 스케줄을 저장했어요.'),

  saveMember: (v) => run(async () => {
    const m = S.modal.member;
    const row = { name: v.name.trim(), phone: v.phone.trim() || null, trainer_id: v.trainer_id || null, goal: v.goal.trim() || null, memo: v.memo.trim() || null };
    let saved;
    if (m) saved = await api.update('members', m.id, row);
    else saved = (await api.insert('members', [row]))[0];
    await loadCore();
    S.screen = 'members';
    S.memberId = saved.id;
    S.modal = !m && v.withPass ? { type: 'pass', memberId: saved.id } : null;
    await loadMemberDetail(saved.id);
  }, '회원 정보를 저장했어요.'),

  savePass: (v) => run(async () => {
    const p = S.modal.pass;
    const row = { name: v.name.trim(), total_count: Number(v.total_count), used_before: Number(v.used_before) || 0, start_date: v.start_date, end_date: v.end_date };
    if (row.end_date < row.start_date) throw new Error('만료일이 시작일보다 빨라요.');
    if (p) {
      await api.update('passes', p.id, row);
    } else {
      const memberId = S.modal.memberId;
      const saved = (await api.insert('passes', [Object.assign({ member_id: memberId }, row)]))[0];
      const amount = Number(v.amount) || 0;
      if (amount > 0) await api.insert('payments', [{ member_id: memberId, pass_id: saved.id, trainer_id: isAdmin() ? v.pay_trainer_id : S.me.id, item: row.name, amount, method: v.method, paid_on: row.start_date <= todayStr() ? todayStr() : row.start_date }]);
    }
    S.modal = null;
    await loadCore();
  }, '수강권을 저장했어요.'),

  savePayment: (v) => run(async () => {
    const p = S.modal.payment;
    const row = { member_id: v.member_id, item: v.item.trim(), amount: Number(v.amount) || 0, method: v.method, paid_on: v.paid_on, trainer_id: isAdmin() ? v.trainer_id : S.me.id };
    if (p) await api.update('payments', p.id, row);
    else await api.insert('payments', [row]);
    S.modal = null;
    S.salesMonth = v.paid_on.slice(0, 7);
    await loadMonthDone();
    await loadCore();
  }, '결제를 저장했어요.'),

  savePost: (v) => run(async () => {
    const p = S.modal.post;
    const row = { kind: v.kind, title: v.title.trim(), body: v.body };
    if (p) await api.update('posts', p.id, row);
    else await api.insert('posts', [Object.assign({ author_id: S.me.id }, row)]);
    S.modal = null;
    await loadCore();
  }, '저장했어요.'),

  addTask: (v, form) => run(async () => {
    const saved = await api.insert('tasks', [{ title: v.title.trim(), owner_id: v.owner_id || S.me.id, due_date: v.due_date || null }]);
    S.tasks = saved.concat(S.tasks);
    form.reset();
  }),

  saveStaff: (v, form) => run(async () => {
    const id = form.dataset.id;
    const patch = { name: v.name.trim(), color: v.color, session_pay: Number(v.session_pay) || 30000 };
    if (v.role) patch.role = v.role;
    await api.update('profiles', id, patch);
    await loadCore();
  }, '직원 정보를 저장했어요.'),

  saveMe: (v) => run(async () => { await api.rpc('update_my_profile', { p_name: v.name, p_color: v.color }); await loadCore(); }, '저장했어요.'),
  changePw: (v, form) => run(async () => { await api.updatePassword(v.password); form.reset(); }, '비밀번호를 바꿨어요.'),

  confirmYes: () => { const fn = S.modal.fn; run(async () => { await fn(); S.modal = null; }, '삭제했어요.'); },
};

// ---------- 이벤트 연결 ----------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.dataset.act === 'closeModalBack' && ev.target !== el) return;
  ev.preventDefault();
  fn(el.dataset, el, ev);
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-submit]');
  if (!form) return;
  ev.preventDefault();
  const fn = submits[form.dataset.submit];
  if (fn) fn(formVals(form), form);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.model) { S[el.dataset.model] = el.value; render(); }
  if (el.dataset.row != null && el.dataset.field && S.composer) {
    const r = S.composer.rows[Number(el.dataset.row)];
    if (r) r[el.dataset.field] = el.value;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.videoRow != null && S.composer) {
    syncComposer();
    const f = el.files && el.files[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast('영상이 ' + Math.round(f.size / 1048576) + 'MB예요. 50MB 이하로 줄여서 올려 주세요.'); el.value = ''; return; }
    const r = S.composer.rows[Number(el.dataset.videoRow)];
    r.file = f; r.fileName = f.name;
    render();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.modal) { S.modal = null; render(); }
});

// =============================================================
// 시작
// =============================================================
(async function boot() {
  const shareToken = params.get('j');
  if (shareToken) { await loadShared(shareToken); return; }
  try {
    if (api.redirectError) S.authErr = api.redirectError;
    if (api.redirectType === 'recovery') S.authView = 'newpw';
    await enterApp();
  } catch (e) {
    console.error(e);
    S.authErr = e.message || '불러오기에 실패했어요.';
  }
  S.booting = false;
  renderNow();
})();

// 테스트용
window.__joeum = { S, api, render: renderNow };
