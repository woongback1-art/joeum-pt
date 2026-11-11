// 데이터 연결 계층
//  - SupaApi: Supabase (REST/Auth/Storage)를 fetch 로 직접 호출. 외부 라이브러리 없음
//  - MockApi: 체험 모드. 브라우저(localStorage)에만 저장
// 두 클래스는 같은 메서드를 가진다.

const SESSION_KEY = 'joeum_session_v1';

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

// filters: [[col, op, value]]  op: eq | neq | gte | lte | gt | lt | in | is
function filterParams(filters = []) {
  const out = [];
  for (const [col, op, val] of filters) {
    let v = val;
    if (op === 'in') v = '(' + val.map((x) => '"' + String(x).replace(/"/g, '') + '"').join(',') + ')';
    out.push([col, op + '.' + v]);
  }
  return out;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function friendlyError(status, body) {
  const msg = (body && (body.msg || body.message || body.error_description || body.error)) || '';
  const code = (body && (body.code || body.error_code)) || '';
  if (code === 'invalid_credentials' || /Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (code === 'email_not_confirmed' || /Email not confirmed/i.test(msg)) return '이메일 인증이 아직 안 됐어요. 메일함에서 인증 링크를 눌러 주세요.';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (code === 'weak_password' || /Password should be/i.test(msg)) return '비밀번호는 6자 이상으로 해 주세요.';
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(msg)) return '잠시 후 다시 시도해 주세요. (메일 발송 횟수 제한)';
  if (code === '42501' || /row-level security/i.test(msg)) return '이 작업을 할 권한이 없어요.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg) || status === 413) return '영상 파일이 너무 커요. 50MB 이하로 올려 주세요.';
  if (status === 0) return '인터넷 연결을 확인해 주세요.';
  return msg || '오류가 났어요. (' + status + ')';
}

export class SupaApi {
  constructor(url, key) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.mode = 'supabase';
    this.session = null;
    try { this.session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { this.session = null; }
    this._consumeRedirect();
  }

  // 이메일 인증 링크로 돌아왔을 때 (#access_token=...)
  _consumeRedirect() {
    const h = location.hash || '';
    if (!h.includes('access_token=') && !h.includes('error_description=')) return;
    const p = new URLSearchParams(h.slice(1));
    if (p.get('error_description')) {
      this.redirectError = p.get('error_description').replace(/\+/g, ' ');
    } else if (p.get('access_token')) {
      this._saveSession({
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token'),
        expires_in: Number(p.get('expires_in') || 3600),
        user: null,
      });
      this.redirectType = p.get('type');
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  _saveSession(s) {
    if (!s) { this.session = null; localStorage.removeItem(SESSION_KEY); return; }
    const expires_at = s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600);
    this.session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at, user: s.user || (this.session && this.session.user) || null };
    localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
  }

  async _fetch(path, opts = {}, auth = true) {
    if (auth) await this._ensureFresh();
    const headers = Object.assign({ apikey: this.key }, opts.headers || {});
    const token = auth && this.session ? this.session.access_token : null;
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(this.url + path, Object.assign({}, opts, { headers }));
    } catch (e) {
      throw new ApiError(friendlyError(0, null), 0);
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) {
      if (res.status === 401 && auth && this.session) {
        // 토큰이 만료됐을 수 있음 → 한 번 갱신 후 재시도
        const ok = await this._refresh();
        if (ok && !opts._retried) return this._fetch(path, Object.assign({}, opts, { _retried: true }), auth);
      }
      throw new ApiError(friendlyError(res.status, body), res.status, body && body.code);
    }
    return body;
  }

  async _refresh() {
    if (!this.session || !this.session.refresh_token) return false;
    try {
      const res = await fetch(this.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.session.refresh_token }),
      });
      if (!res.ok) { this._saveSession(null); return false; }
      this._saveSession(await res.json());
      return true;
    } catch (e) {
      return false;
    }
  }

  async _ensureFresh() {
    if (!this.session) return;
    if (this.session.expires_at - 60 < Date.now() / 1000) await this._refresh();
  }

  // ---------- 인증 ----------
  async currentUser() {
    if (!this.session) return null;
    try {
      const u = await this._fetch('/auth/v1/user');
      this.session.user = u;
      localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      return u;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { this._saveSession(null); return null; }
      throw e;
    }
  }

  async signIn(email, password) {
    const s = await this._fetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, false);
    this._saveSession(s);
    return s.user;
  }

  async signUp(email, password, name) {
    const redirect = location.origin + location.pathname;
    const r = await this._fetch('/auth/v1/signup?' + qs({ redirect_to: redirect }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, data: { name } }),
    }, false);
    if (r && r.access_token) { this._saveSession(r); return { user: r.user, needsConfirm: false }; }
    return { user: r && (r.user || r), needsConfirm: true };
  }

  async resetPassword(email) {
    const redirect = location.origin + location.pathname;
    await this._fetch('/auth/v1/recover?' + qs({ redirect_to: redirect }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }, false);
  }

  async updatePassword(password) {
    await this._fetch('/auth/v1/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  }

  async signOut() {
    try { await this._fetch('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* 무시 */ }
    this._saveSession(null);
  }

  // ---------- 테이블 ----------
  async select(table, { select = '*', filters = [], order, limit } = {}) {
    const params = [['select', select], ...filterParams(filters)];
    if (order) params.push(['order', order]);
    if (limit) params.push(['limit', String(limit)]);
    const q = params.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    return (await this._fetch('/rest/v1/' + table + '?' + q)) || [];
  }

  async insert(table, rows) {
    const r = await this._fetch('/rest/v1/' + table, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    return r || [];
  }

  async update(table, id, patch) {
    const r = await this._fetch('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!r || !r.length) throw new ApiError('이 작업을 할 권한이 없어요.', 403);
    return r[0];
  }

  async remove(table, id) {
    const r = await this._fetch('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!r || !r.length) throw new ApiError('삭제할 권한이 없어요.', 403);
  }

  async rpc(fn, args) {
    return this._fetch('/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
  }

  // ---------- 영상 ----------
  async upload(path, file) {
    await this._fetch('/storage/v1/object/videos/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'video/mp4', 'x-upsert': 'false', 'cache-control': '3600' },
      body: file,
    });
    return path;
  }

  async videoUrl(path) {
    const r = await this._fetch('/storage/v1/object/sign/videos/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const signed = r.signedURL || r.signedUrl;
    return this.url + '/storage/v1' + signed;
  }
}

// =============================================================
// 체험 모드 (브라우저에만 저장)
// =============================================================
const MOCK_KEY = 'joeum_mock_db_v1';
const MOCK_USER_KEY = 'joeum_mock_user_v1';

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function seedMock() {
  const now = new Date();
  const today = ymd(now);
  const addDays = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return ymd(d); };
  const admin = { id: 'u-admin', name: '원장', email: 'admin@demo', role: 'admin', color: '#23634A', session_pay: 30000, created_at: now.toISOString() };
  const t1 = { id: 'u-t1', name: '장정웅', email: 'trainer@demo', role: 'trainer', color: '#2F6DB0', session_pay: 30000, created_at: now.toISOString() };
  const t2 = { id: 'u-t2', name: '이서연', email: 'trainer2@demo', role: 'trainer', color: '#B4561A', session_pay: 30000, created_at: now.toISOString() };
  const members = [
    { id: uuid(), name: '정하늘', phone: '010-1234-5678', trainer_id: t1.id, goal: '거북목·라운드숄더 교정', memo: '' },
    { id: uuid(), name: '최민지', phone: '010-2231-0000', trainer_id: t2.id, goal: '체지방 감량', memo: '' },
    { id: uuid(), name: '강태우', phone: '010-9014-0000', trainer_id: t1.id, goal: '스쿼트 자세', memo: '' },
  ].map((m) => Object.assign({ created_at: now.toISOString() }, m));
  const passes = [
    { id: uuid(), member_id: members[0].id, name: 'PT 30회', total_count: 30, used_before: 20, start_date: addDays(-90), end_date: addDays(60) },
    { id: uuid(), member_id: members[1].id, name: 'PT 20회', total_count: 20, used_before: 17, start_date: addDays(-60), end_date: addDays(10) },
    { id: uuid(), member_id: members[2].id, name: 'PT 10회', total_count: 10, used_before: 2, start_date: addDays(-14), end_date: addDays(80) },
  ].map((p) => Object.assign({ created_at: now.toISOString() }, p));
  const at = (day, hh) => new Date(day + 'T' + hh + ':00').toISOString();
  const sessions = [
    { member: 0, day: addDays(-1), hh: '10:00', status: 'done' },
    { member: 0, day: today, hh: '09:00', status: 'done' },
    { member: 1, day: today, hh: '11:00', status: 'reserved' },
    { member: 2, day: today, hh: '19:00', status: 'reserved' },
    { member: 0, day: addDays(2), hh: '09:00', status: 'reserved' },
    { member: 1, day: addDays(3), hh: '11:00', status: 'reserved' },
  ].map((s) => ({
    id: uuid(), member_id: members[s.member].id, trainer_id: members[s.member].trainer_id, pass_id: passes[s.member].id,
    starts_at: at(s.day, s.hh), duration_min: 50, status: s.status, created_at: now.toISOString(),
  }));
  const journals = [{
    id: uuid(), session_id: sessions[0].id, member_id: members[0].id, trainer_id: t1.id,
    items: [{ exercise: '시티드 로우', check: '25kg 3x12, 어깨 으쓱임 줄어듦', video: '' }, { exercise: '페이스풀', check: '15kg 3x15', video: '' }],
    created_at: sessions[0].starts_at, updated_at: sessions[0].starts_at,
  }];
  const payments = [
    { id: uuid(), member_id: members[0].id, trainer_id: t1.id, pass_id: passes[0].id, paid_on: addDays(-90), item: 'PT 30회', method: '카드', amount: 1800000 },
    { id: uuid(), member_id: members[1].id, trainer_id: t2.id, pass_id: passes[1].id, paid_on: addDays(-60), item: 'PT 20회', method: '카드', amount: 1300000 },
    { id: uuid(), member_id: members[2].id, trainer_id: t1.id, pass_id: passes[2].id, paid_on: addDays(-14), item: 'PT 10회', method: '계좌이체', amount: 700000 },
  ].map((p) => Object.assign({ created_at: now.toISOString() }, p));
  const posts = [
    { id: uuid(), kind: 'notice', title: '체험 모드입니다', body: '여기서 입력한 내용은 이 브라우저에만 저장돼요.\n실제 저장은 Supabase에 로그인해서 쓰면 돼요.', author_id: admin.id, created_at: now.toISOString() },
  ];
  const tasks = [{ id: uuid(), title: '최민지 회원 재등록 상담', owner_id: t2.id, due_date: addDays(2), done: false, created_at: now.toISOString() }];
  return { profiles: [admin, t1, t2], members, passes, sessions, journals, payments, posts, tasks, videos: {} };
}

export class MockApi {
  constructor() {
    this.mode = 'demo';
    try { this.db = JSON.parse(localStorage.getItem(MOCK_KEY) || 'null'); } catch (e) { this.db = null; }
    if (!this.db) { this.db = seedMock(); this._save(); }
    this.userId = localStorage.getItem(MOCK_USER_KEY);
  }
  _save() { localStorage.setItem(MOCK_KEY, JSON.stringify(this.db)); }
  reset() { this.db = seedMock(); this._save(); }
  _me() { return this.db.profiles.find((p) => p.id === this.userId) || null; }
  _staff() { const m = this._me(); return !!m && (m.role === 'admin' || m.role === 'trainer'); }
  _admin() { const m = this._me(); return !!m && m.role === 'admin'; }

  async currentUser() { const m = this._me(); return m ? { id: m.id, email: m.email } : null; }
  async signIn(email) {
    const p = this.db.profiles.find((x) => x.email === String(email).trim().toLowerCase());
    if (!p) throw new ApiError('체험 모드 계정: admin@demo (관리자), trainer@demo (강사)', 400);
    this.userId = p.id; localStorage.setItem(MOCK_USER_KEY, p.id);
    return { id: p.id, email: p.email };
  }
  async signUp(email, password, name) {
    const id = uuid();
    this.db.profiles.push({ id, name: name || email.split('@')[0], email, role: 'pending', color: '#23634A', created_at: new Date().toISOString() });
    this._save();
    this.userId = id; localStorage.setItem(MOCK_USER_KEY, id);
    return { user: { id, email }, needsConfirm: false };
  }
  async resetPassword() {}
  async updatePassword() {}
  async signOut() { this.userId = null; localStorage.removeItem(MOCK_USER_KEY); }

  _rows(table) {
    if (table === 'pass_usage') {
      const m = {};
      for (const s of this.db.sessions) if (s.status === 'done' && s.pass_id) m[s.pass_id] = (m[s.pass_id] || 0) + 1;
      return Object.entries(m).map(([pass_id, used]) => ({ pass_id, used }));
    }
    return this.db[table] || [];
  }

  _visible(table, rows) {
    const me = this._me();
    if (!me) return [];
    if (table === 'profiles') return this._staff() ? rows : rows.filter((r) => r.id === me.id);
    if (!this._staff()) return [];
    if (table === 'payments' && !this._admin()) return rows.filter((r) => r.trainer_id === me.id);
    return rows;
  }

  async select(table, { select = '*', filters = [], order, limit } = {}) {
    let rows = this._visible(table, this._rows(table)).slice();
    for (const [col, op, val] of filters) {
      rows = rows.filter((r) => {
        const v = r[col];
        if (op === 'eq') return String(v) === String(val);
        if (op === 'neq') return String(v) !== String(val);
        if (op === 'gte') return v >= val;
        if (op === 'lte') return v <= val;
        if (op === 'gt') return v > val;
        if (op === 'lt') return v < val;
        if (op === 'in') return val.map(String).includes(String(v));
        if (op === 'is') return val === 'null' ? v == null : v != null;
        return true;
      });
    }
    if (order) {
      const [col, dir] = order.split('.');
      rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (limit) rows = rows.slice(0, limit);
    rows = JSON.parse(JSON.stringify(rows));
    if (table === 'sessions' && select.includes('journals')) {
      for (const r of rows) r.journals = this.db.journals.find((j) => j.session_id === r.id) || null;
    }
    return rows;
  }

  async insert(table, rows) {
    if (!this._staff()) throw new ApiError('이 작업을 할 권한이 없어요.', 403);
    const me = this._me();
    const out = rows.map((r) => {
      if (table === 'payments' && !this._admin() && r.trainer_id !== me.id) throw new ApiError('이 작업을 할 권한이 없어요.', 403);
      return Object.assign({ id: uuid(), created_at: new Date().toISOString() }, r);
    });
    if (table === 'journals') {
      for (const r of out) if (r.session_id && this.db.journals.some((j) => j.session_id === r.session_id)) throw new ApiError('이미 일지가 있어요.', 409);
    }
    this.db[table].push(...out);
    this._save();
    return JSON.parse(JSON.stringify(out));
  }

  async update(table, id, patch) {
    if (!this._staff()) throw new ApiError('이 작업을 할 권한이 없어요.', 403);
    if ((table === 'profiles' || table === 'payments') && !this._admin()) throw new ApiError('이 작업을 할 권한이 없어요.', 403);
    const row = this.db[table].find((r) => r.id === id);
    if (!row) throw new ApiError('찾을 수 없어요.', 404);
    Object.assign(row, patch);
    this._save();
    return JSON.parse(JSON.stringify(row));
  }

  async remove(table, id) {
    const me = this._me();
    const row = (this.db[table] || []).find((r) => r.id === id);
    if (!row) return;
    const ownerOk = (table === 'tasks' && row.owner_id === me.id) || (table === 'posts' && row.author_id === me.id);
    if (!this._admin() && !(this._staff() && ownerOk)) throw new ApiError('삭제할 권한이 없어요.', 403);
    this.db[table] = this.db[table].filter((r) => r.id !== id);
    if (table === 'members') {
      for (const t of ['passes', 'sessions', 'journals', 'payments']) this.db[t] = this.db[t].filter((r) => r.member_id !== id);
    }
    this._save();
  }

  async rpc(fn, args) {
    if (fn === 'update_my_profile') {
      const me = this._me();
      if (args.p_name) me.name = args.p_name;
      if (args.p_color) me.color = args.p_color;
      this._save();
    }
    return null;
  }

  async upload(path, file) {
    // 체험 모드: 영상은 이 탭에서만 재생 (새로고침하면 사라짐)
    this._blobs = this._blobs || {};
    this._blobs[path] = URL.createObjectURL(file);
    return path;
  }
  async videoUrl(path) {
    if (this._blobs && this._blobs[path]) return this._blobs[path];
    throw new ApiError('체험 모드에서는 새로고침하면 영상이 사라져요.', 404);
  }
}
