/* Aurora dashboard core: shared by index.html (Leadership) and manage.html (Workbench).
   Sign-in derives the AES key from email+password (same derivation as aurora.py), decrypts data.enc.json,
   and derive() adds the computed views: health, progress, sequencing, critical path, people, staffing, alerts.
   V2.3: transcripts can be opened in the browser (t/<meeting id>.json, decrypted with the transcript key from the
   payload), provenance badges open the meeting they came from, and "Ask" (chat.js) gets its context from here. */
'use strict';
const A = window.A = {};
const DATA_REPO = A.DATA_REPO = 'AuroraWDC/aurora-dashboard-data'; // private repo with transcripts and edits
const $ = A.$ = (s, r = document) => r.querySelector(s);
const $$ = A.$$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = A.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64e = u => { let s = ''; new Uint8Array(u).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
A.today = () => new Date().toISOString().slice(0, 10);
A.addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
A.days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
A.fmtDate = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.slice(0, 4) === A.today().slice(0, 4) ? undefined : 'numeric' }) : '';
A.ST = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', on_hold: 'On hold', completed: 'Completed', unknown: 'Unknown' };
A.TS = { open: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
A.HEALTH = { green: 'On track', amber: 'At risk', red: 'Off track', done: 'Delivered', paused: 'Paused' };
A.KIND = { ops: 'Operational', innovation: 'Innovation' };   // work type: sustaining operations vs. new bets
A.KINDS = {
  set_project_status: 'Change project status', set_project_owner: 'Assign project owner', set_priority: 'Set priority',
  set_task_owner: 'Assign a task', set_task_due: 'Set a due date', set_task_status: 'Change task status',
  set_workstream: 'Group a task into a workstream', add_task: 'Add a task to the breakdown', add_task_dependency: 'Sequence two tasks',
  add_project_dependency: 'Link dependent projects', link_metric: 'Tie project to a metric', merge_projects: 'Merge duplicate projects',
  merge_tasks: 'Merge duplicate tasks', flag_risk: 'Flag a risk'
};

/* ---------- sign-in and data ---------- */
/* Two formats are understood:
   v3 (per-person logins): the data is locked with a random key, and the file holds one copy of that key for each person,
      locked with a key derived from their own email+password. Cached in this tab: the person's key and lookup id.
   v2 (old shared login): the data is locked directly with a key from username+password. */
let AUTH = null;
const enc = s => new TextEncoder().encode(s);
async function fetchEnc() { const r = await fetch('data.enc.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('nodata'); return r.json(); }
async function decryptWith(key, p) { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(p.iv) }, key, b64d(p.ct)))); }
async function pbkdf2(user, pw, salt, iter) {
  const km = await crypto.subtle.importKey('raw', enc(user.trim().toLowerCase() + ':' + pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}
async function lookupOf(email) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc('aurora-login:' + email)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function openWith(auth, p) {
  if ((p.v || 0) < 3) { if (auth.kind !== 'v2') throw new Error('format'); return decryptWith(auth.key, p); }
  if (auth.kind !== 'v3') throw new Error('format');
  const u = p.users?.[auth.lk]; if (!u) throw new Error('no user');
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(u.iv), additionalData: enc(auth.lk) }, auth.key, b64d(u.k));
  return decryptWith(await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']), p);
}
async function signIn(email, pw, p) {
  if ((p.v || 0) >= 3) {
    const lk = await lookupOf(email), u = p.users?.[lk];
    if (!u) throw new Error('no user');
    return { kind: 'v3', lk, key: await pbkdf2(email, pw, b64d(u.salt), p.iter) };
  }
  return { kind: 'v2', key: await pbkdf2(email, pw, b64d(p.salt), p.iter) };
}
const nameOf = email => email.includes('@') ? email.split('@')[0].split(/[._\-+]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : null;
A.boot = async onReady => {
  const lock = $('#lock'), err = $('#err');
  let p;
  try { p = await fetchEnc(); } catch { lock.hidden = false; $('#f').hidden = true; err.textContent = 'No dashboard data has been published yet. Add a transcript or save an edit to create it.'; return; }
  const cached = sessionStorage.getItem('aurora.auth');
  if (cached) {
    try { const c = JSON.parse(cached); const auth = { kind: c.kind, lk: c.lk, key: await crypto.subtle.importKey('raw', b64d(c.key), 'AES-GCM', true, ['decrypt']) };
      const d = await openWith(auth, p); AUTH = auth; setMe(c.email); return start(d, onReady); }
    catch { sessionStorage.removeItem('aurora.auth'); AUTH = null; }
  }
  lock.hidden = false; $('#u').focus();
  $('#f').onsubmit = async e => {
    e.preventDefault(); err.textContent = ''; const btn = $('#f button'); btn.disabled = true; btn.textContent = 'Signing in…';
    const email = $('#u').value.trim().toLowerCase();
    try {
      const auth = await signIn(email, $('#pw').value, p), d = await openWith(auth, p);
      AUTH = auth; setMe(email);
      sessionStorage.setItem('aurora.auth', JSON.stringify({ kind: auth.kind, lk: auth.lk, email, key: b64e(await crypto.subtle.exportKey('raw', auth.key)) }));
      $('#pw').value = ''; start(d, onReady);
    } catch { err.textContent = 'Incorrect email or password.'; }
    btn.disabled = false; btn.textContent = 'Sign in';
  };
};
function setMe(email) { A.me = { email, name: nameOf(email) }; }   // name is null for the old shared login
function start(d, onReady) {
  $('#lock').hidden = true; $('#app').hidden = false; $('#nav').hidden = false;
  const D = A._D = A.derive(A.normalize(d)); A.FB = d.feedback?.token ? d.feedback : null; A.CHAT = d.chat?.key ? d.chat : null; A.TKEY = d.tkey || null;
  onReady(D); document.dispatchEvent(new CustomEvent('aurora:ready'));
}
A.refresh = async () => { const d = await openWith(AUTH, await fetchEnc()); A.FB = d.feedback?.token ? d.feedback : A.FB; A.CHAT = d.chat?.key ? d.chat : A.CHAT; A.TKEY = d.tkey || A.TKEY; return (A._D = A.derive(A.normalize(d))); };
A.currentProjectName = id => A._D?.P.get(id)?.name || A._D?.P.get(A._D.alias?.[id])?.name || null;
A.signOut = () => { sessionStorage.clear(); location.href = location.pathname; };

/* Accept v1 payloads (from the old ingest.py) so nothing breaks before the first new run. */
A.normalize = D => {
  D.settings = Object.assign({ org: 'Aurora WDC', features: {}, autonomy: {}, agent_enabled: false, auto_min_confidence: .75 }, D.settings || {});
  D.settings.features = Object.assign({ agile: false, waterfall: false }, D.settings.features);
  D.settings.capacity = Object.assign({}, D.settings.capacity || {}); if (D.settings.ops_target == null) D.settings.ops_target = null;
  for (const k of ['metrics', 'decisions', 'conflicts', 'history', 'ops_applied', 'ops_log', 'agent_runs', 'op_errors', 'op_failures', 'meetings', 'deleted', 'users']) D[k] ||= [];
  D.projects.forEach((p, i) => {
    p.id ||= 'v1p' + i; p.tasks ||= []; p.milestones ||= []; p.metrics ||= []; p.depends_on ||= []; p._src ||= {}; p._lock ||= []; p._pre ||= {};
    p.team = (p.team || []).map(t => typeof t === 'string' ? { name: t, role: '', alloc: null } : Object.assign({ alloc: null }, t));
    if (!Object.hasOwn(p, 'kind')) p.kind = null; if (!Object.hasOwn(p, 'priority')) p.priority = null;
    for (const f of ['risks', 'assumptions', 'dependencies', 'metrics_mentioned', 'meetings']) p[f] ||= [];
    p.tasks.forEach((t, j) => { t.id ||= p.id + 't' + j; t.depends_on ||= []; t._src ||= {}; t._lock ||= []; t._pre ||= {}; t.first_seen ||= t.seen || ''; });
    p.milestones.forEach((m, j) => { m.id ||= p.id + 'm' + j; m._src ||= {}; m._lock ||= []; m._pre ||= {}; });
  });
  D.metrics.forEach(m => { m._src ||= {}; m._lock ||= []; m._pre ||= {}; });
  return D;
};

/* ---------- derived views ---------- */
const pkey = A.pkey = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
const ORDER_H = { red: 0, amber: 1, green: 2, paused: 3, done: 4 };
A.derive = D => {
  const t0 = A.today(), stale = A.addDays(t0, -30);
  D.P = new Map(); D.T = new Map(); D.K = new Map(D.metrics.map(m => [m.id, m])); D.MT = new Map(D.meetings.map(m => [m.id, m]));
  D.projects.forEach(p => { D.P.set(p.id, p); p.tasks.forEach(t => { t._p = p.id; D.T.set(t.id, t); }); });
  D.active = D.projects.filter(p => !p.archived);
  // sequencing: level = longest chain of unfinished prerequisites; cycles are reported, not followed
  const level = new Map(), cyc = new Set();
  const lv = (t, stack = new Set()) => {
    if (level.has(t.id)) return level.get(t.id);
    if (stack.has(t.id)) { cyc.add(t.id); return 0; }
    stack.add(t.id);
    let L = 0; for (const id of t.depends_on) { const d = D.T.get(id); if (d) L = Math.max(L, lv(d, stack) + 1); }
    stack.delete(t.id); level.set(t.id, L); return L;
  };
  D.T.forEach(t => { t.level = lv(t); t.cycle = false; });
  cyc.forEach(id => D.T.get(id) && (D.T.get(id).cycle = true));
  D.projects.forEach(p => {
    p.tasks.sort((a, b) => (a.first_seen || '').localeCompare(b.first_seen || '') || a.id.localeCompare(b.id));
    p.tasks.forEach((t, i) => {
      t.n = i + 1;
      t.blockers = t.depends_on.map(id => D.T.get(id)).filter(x => x && x.status !== 'done');
      t.overdue = t.status !== 'done' && !!t.due && t.due < t0;
    });
    const open = p.tasks.filter(t => t.status !== 'done');
    p.done = p.tasks.length - open.length; p.open = open;
    p.progress = p.tasks.length ? p.done / p.tasks.length : (p.status === 'completed' ? 1 : 0);
    p.overdue = open.filter(t => t.overdue).length;
    p.blockedTasks = open.filter(t => t.status === 'blocked' || t.blockers.length).length;
    const ms = p.milestones.filter(m => !m.done && m.date).sort((a, b) => a.date.localeCompare(b.date));
    p.nextMilestone = ms.find(m => m.date >= t0); p.lateMilestones = ms.filter(m => m.date < t0);
    p.stale = !!p.updated && p.updated < stale && !['completed', 'on_hold'].includes(p.status);
    p.autoHealth = p.status === 'completed' ? 'done' : p.status === 'on_hold' ? 'paused'
      : (p.status === 'blocked' || p.lateMilestones.length || p.overdue >= 3) ? 'red'
      : (p.overdue || p.blockedTasks || p.stale) ? 'amber' : 'green';
    p.healthNow = p.health || p.autoHealth;
    p.reasons = [p.status === 'blocked' && 'project is blocked', p.lateMilestones.length && `${p.lateMilestones.length} milestone(s) past date`,
      p.overdue && `${p.overdue} overdue task(s)`, p.blockedTasks && `${p.blockedTasks} task(s) blocked or waiting`, p.stale && `not discussed since ${A.fmtDate(p.updated)}`].filter(Boolean);
    // critical path across unfinished tasks (duration = estimate in days, default 1)
    const fin = new Map(), prev = new Map();
    const ef = t => { if (fin.has(t.id)) return fin.get(t.id); fin.set(t.id, 0); let best = 0, from = null;
      for (const d of t.blockers) if (d._p === p.id) { const v = ef(d); if (v > best) { best = v; from = d.id; } }
      const v = best + (+t.estimate || 1); fin.set(t.id, v); prev.set(t.id, from); return v; };
    open.forEach(ef); p.tasks.forEach(t => t.crit = false);
    let end = null, mx = 0; open.forEach(t => { if (fin.get(t.id) > mx) { mx = fin.get(t.id); end = t.id; } });
    p.critLen = 0; if (end && open.some(t => t.blockers.length)) { let c = end; while (c) { D.T.get(c).crit = true; p.critLen++; c = prev.get(c); } }
    // span for roadmaps
    const dates = [p.start, p.target, ...p.milestones.map(m => m.date), ...p.tasks.map(t => t.due), ...p.tasks.map(t => t.start)].filter(Boolean).sort();
    p.spanStart = p.start || p.first_seen || dates[0] || t0;
    p.spanEnd = p.target || dates[dates.length - 1] || A.addDays(p.spanStart, 30);
    if (p.spanEnd < p.spanStart) p.spanEnd = p.spanStart;
  });
  // people: who is involved, how, and with what load
  const ppl = new Map(), g = n => { const k = pkey(n); if (!ppl.has(k)) ppl.set(k, { name: String(n).trim(), roles: new Map(), owns: [], tasks: [] }); return ppl.get(k); };
  D.active.forEach(p => {
    if (p.owner) { g(p.owner).owns.push(p); g(p.owner).roles.set(p.id, 'Owner'); }
    if (p.sponsor) g(p.sponsor).roles.set(p.id, 'Sponsor');
    p.team.forEach(t => { const r = g(t.name).roles; if (!r.has(p.id) || !r.get(p.id)) r.set(p.id, t.role || r.get(p.id) || 'Team'); });
    p.open.forEach(t => { if (t.assignee) { const x = g(t.assignee); x.tasks.push(t); if (!x.roles.has(p.id)) x.roles.set(p.id, 'Assigned tasks'); } });
  });
  D.people = [...ppl.values()].sort((a, b) => a.name.localeCompare(b.name));
  D.peopleNames = D.people.map(x => x.name);
  // staffing: each team entry can carry alloc (% of that person's time); settings.capacity holds what each person can give (default 100).
  // Projects are funded in priority order (P1 first); whatever falls past a person's capacity is "below the line" for them.
  const capOf = n => { const k = pkey(n), hit = Object.keys(D.settings.capacity).find(c => pkey(c) === k); return hit != null ? D.settings.capacity[hit] : 100; };
  const prank = p => (p.priority || 5) * 10 + ORDER_H[p.healthNow];
  D.people.forEach(x => {
    x.capacity = capOf(x.name);
    const rows = D.active.filter(p => p.status !== 'completed').flatMap(p => p.team.filter(t => pkey(t.name) === pkey(x.name) && t.alloc != null).map(t => ({ p, alloc: +t.alloc })));
    rows.sort((a, b) => prank(a.p) - prank(b.p) || a.p.name.localeCompare(b.p.name));
    let cum = 0; rows.forEach(r => { cum += r.alloc; r.cum = cum; r.below = cum > x.capacity; });
    x.plan = rows; x.alloc = cum; x.over = cum > x.capacity; x.unknownLoad = x.roles.size - rows.length;   // projects with no % recorded
  });
  const byName = new Map(D.people.map(x => [pkey(x.name), x]));
  D.projects.forEach(p => {
    p.staff = p.team.filter(t => t.alloc != null).map(t => { const x = byName.get(pkey(t.name)), r = x?.plan.find(r => r.p === p); return { name: t.name, role: t.role, alloc: +t.alloc, total: x?.alloc || 0, capacity: x?.capacity ?? 100, below: !!r?.below }; });
    p.starvedBy = p.staff.filter(s => s.below).map(s => s.name);
    p.staffNote = p.starvedBy.length ? `${p.starvedBy.join(', ')} ${p.starvedBy.length === 1 ? 'is' : 'are'} over capacity and this project is below their line` : '';
  });
  // work type split (operational vs. innovation) by project count and by staffed effort
  D.split = { ops: { n: 0, alloc: 0 }, innovation: { n: 0, alloc: 0 }, none: { n: 0, alloc: 0 } };
  D.active.filter(p => p.status !== 'completed').forEach(p => { const k = p.kind || 'none'; D.split[k].n++; D.split[k].alloc += p.staff.reduce((n, s) => n + s.alloc, 0); });
  D.split.total = D.split.ops.alloc + D.split.innovation.alloc + D.split.none.alloc;
  // metrics: which projects move which metric
  D.metricLinks = new Map(D.metrics.map(m => [m.id, []]));
  D.active.forEach(p => p.metrics.forEach(l => D.metricLinks.get(l.metric)?.push({ p, how: l.how })));
  // alerts for the Control center and leadership attention list
  D.alerts = [];
  D.active.forEach(p => {
    if (['completed'].includes(p.status)) return;
    if (!p.owner) D.alerts.push({ p, type: 'No owner', text: 'Project has no owner' });
    if (p.starvedBy.length) D.alerts.push({ p, type: 'Capacity', text: p.staffNote });
    if (p.stale) D.alerts.push({ p, type: 'Stale', text: `Not discussed since ${A.fmtDate(p.updated)}` });
    p.lateMilestones.forEach(m => D.alerts.push({ p, type: 'Late milestone', text: `${m.title} (${A.fmtDate(m.date)})` }));
    p.open.forEach(t => {
      if (t.overdue) D.alerts.push({ p, t, type: 'Overdue', text: `${t.text}, due ${A.fmtDate(t.due)}` });
      if (t.cycle) D.alerts.push({ p, t, type: 'Circular dependency', text: t.text });
      if (t.blockers.length && t.due && t.blockers.some(b => b.due && b.due > t.due)) D.alerts.push({ p, t, type: 'Sequencing', text: `${t.text} is due before a task it waits on` });
    });
  });
  D.proposed = D.decisions.filter(d => d.state === 'proposed' && (D.P.has(d.project) || D.P.has(D.alias?.[d.project])));
  return D;
};

/* ---------- small render helpers ---------- */
A.pill = h => `<span class="pill h-${h}"><i></i>${esc(A.HEALTH[h] || h)}</span>`;
A.status = s => `<span class="st">${esc(A.ST[s] || s)}</span>`;
A.progress = (v, label) => `<span class="prog" role="img" aria-label="${Math.round(v * 100)}% complete"><span style="width:${Math.round(v * 100)}%"></span></span>${label ? `<span class="num">${Math.round(v * 100)}%</span>` : ''}`;
A.who = n => n ? esc(n) : '<span class="mute">Unassigned</span>';
A.srcLabel = s => !s ? '' : s.startsWith('human') ? 'Set by a person' : s.startsWith('agent') ? 'Set by the agent' : s.startsWith('meeting') ? 'From a meeting' : '';
A.srcMark = (e, f) => { const s = e._src?.[f]; if (!s) return ''; const k = s.startsWith('human') ? 'h' : s.startsWith('agent') ? 'a' : 'm';
  const lock = e._lock?.includes(f) ? ' (locked)' : '';
  if (k === 'm' && s.length > 8 && A._D?.MT.has(s.slice(8)))   // the meeting it came from can be opened
    return `<button type="button" class="src src-m" data-meet="${esc(s.slice(8))}" data-q="${esc(String(['text', 'name', 'title', 'description'].includes(f) ? e[f] : (e.text ?? e.name ?? e.title ?? '')).slice(0, 80))}" title="From a meeting${lock}. Open the transcript">M</button>`;
  return `<abbr class="src src-${k}" title="${esc(A.srcLabel(s))}${lock}">${{ h: 'P', a: 'A', m: 'M' }[k]}</abbr>`; };
A.kindChip = p => p.kind ? `<span class="chip kind-${p.kind}">${A.KIND[p.kind]}</span>` : '';
A.initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
A.metricPct = m => {
  const b = +m.baseline || 0, t = +m.target, c = +m.current;
  if (!isFinite(t) || !isFinite(c) || m.target == null || m.current == null || t === b) return null;
  return Math.max(0, Math.min(1, (c - b) / (t - b)));
};
A.fmtNum = (v, unit) => v == null || v === '' ? '–' : (+v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + (unit ? (unit === '%' ? '%' : ' ' + unit) : '');

/* ---------- transcripts in the browser ----------
   The pipeline publishes t/<meeting id>.json next to data.enc.json: the parsed transcript locked with the transcript
   key, which signed-in users receive inside the payload. Loaded on demand and cached for this page. */
const TX = new Map();
A.transcript = async id => {
  if (TX.has(id)) return TX.get(id);
  if (!A.TKEY) throw new Error('notkey');
  const r = await fetch(`t/${encodeURIComponent(id)}.json?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) throw new Error('nofile');
  const p = await r.json(), key = await crypto.subtle.importKey('raw', b64d(A.TKEY), 'AES-GCM', false, ['decrypt']);
  const t = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(p.iv), additionalData: enc(id) }, key, b64d(p.ct))));
  t.lines = []; for (const l of t.text.split('\n')) { const m = l.match(/^([^:]{1,60}):\s(.*)$/);   // continuation lines (no speaker) join the line above
    if (m) t.lines.push({ who: m[1], text: m[2] }); else if (t.lines.length && l.trim()) t.lines[t.lines.length - 1].text += ' ' + l.trim(); else if (l.trim()) t.lines.push({ who: '', text: l }); }
  TX.set(id, t); return t;
};
const words = q => [...new Set(String(q || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [])].filter(w => !STOP.has(w));
const STOP = new Set('the and for are but not you all any can had her was one our out day get has him his how its may new now old see two way who boy did man men put say she too use with this that from they have what when will more been were would there their about which them into than then also just like some could other over such only very what\'s its'.split(' '));
A.words = words;
/* Score transcript lines against a question; returns passages (groups of lines) best first. */
A.passages = (t, q, max = 6, span = 2) => {
  const ws = words(q); if (!ws.length) return [];
  const sc = t.lines.map(l => { const low = l.text.toLowerCase(); return ws.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0); });
  const picks = sc.map((v, i) => [v, i]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, max * 2);
  const out = [], used = new Set();
  for (const [, i] of picks) { if (used.has(i)) continue; const a = Math.max(0, i - span), b = Math.min(t.lines.length - 1, i + span);
    for (let j = a; j <= b; j++) used.add(j); out.push({ at: i, lines: t.lines.slice(a, b + 1) }); if (out.length >= max) break; }
  return out;
};
const mark = (text, ws) => { let h = esc(text); if (!ws.length) return h; const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi'); return h.replace(re, '<mark>$1</mark>'); };
A.showMeeting = async (id, q = '') => {
  const m = A._D?.MT.get(id); let box = $('#tmodal');
  if (!box) { box = document.createElement('div'); box.id = 'tmodal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Meeting transcript'); document.body.append(box);
    box.addEventListener('click', e => { if (e.target === box || e.target.closest('[data-tclose]')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); }); }
  const close = () => { box.hidden = true; };
  const render = (t, err) => {
    const ws = words(q), voice = /voice-note/i.test(m?.file || '');
    const hits = t ? t.lines.map((l, i) => ws.length && ws.some(w => l.text.toLowerCase().includes(w)) ? i : -1).filter(i => i >= 0) : [];
    box.innerHTML = `<div class="tbox"><header><div><b>${voice ? 'Voice note' : 'Meeting'} of ${esc(A.fmtDate(m?.date || t?.date || ''))}</b> <span class="small mute">${esc(m?.file || id)}</span></div>
      <span><button type="button" data-task class="small" ${A.CHAT ? '' : 'hidden'}>Ask about this meeting</button> <button type="button" data-tclose aria-label="Close">Close</button></span></header>
      ${m?.summary ? `<p class="small">${esc(m.summary)}</p>` : ''}${m?.decisions?.length ? `<details class="small"><summary>Decisions recorded (${m.decisions.length})</summary><ul>${m.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}
      <div class="bar" style="margin:8px 0 4px"><input type="search" id="tq" value="${esc(q)}" placeholder="Find in transcript" aria-label="Find in transcript"><span class="small mute" id="tn">${ws.length ? `${hits.length} matching line${hits.length === 1 ? '' : 's'}` : ''}</span></div>
      <div class="tbody" id="tbody">${err ? `<p class="empty">${esc(err)}</p>` : t.lines.map((l, i) => `<p id="tl${i}"${hits.includes(i) ? ' class="hit"' : ''}>${l.who ? `<b>${esc(l.who)}</b> ` : ''}${mark(l.text, ws)}</p>`).join('')}</div></div>`;
    box.hidden = false;
    $('#tq', box).oninput = e => { q = e.target.value; render(t, err); const n = $('#tq', box); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $('[data-task]', box).onclick = () => { close(); document.dispatchEvent(new CustomEvent('aurora:ask', { detail: { kind: 'meeting', id } })); };
    if (hits.length) $('#tl' + hits[0], box)?.scrollIntoView({ block: 'center' });
  };
  box.innerHTML = '<div class="tbox"><p class="mute">Opening transcript…</p></div>'; box.hidden = false;
  try { render(await A.transcript(id)); }
  catch (e) { render({ lines: [] }, e.message === 'notkey' ? 'Transcripts become readable here after the next pipeline run.' : e.message === 'nofile' ? 'This transcript has not been published to the site yet. It appears after the next pipeline run.' : 'Could not open this transcript.'); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-meet]'); if (b) { e.preventDefault(); A.showMeeting(b.dataset.meet, b.dataset.q || ''); } });

/* Timeline (Gantt) as SVG. rows: {label, sub, start, end, cls, ms:[{date,title}], href} */
A.gantt = (rows, opt = {}) => {
  if (!rows.length) return '<p class="empty">Nothing with dates yet. Add start, due or target dates to see the timeline.</p>';
  const t0 = A.today(); let lo = opt.from, hi = opt.to;
  rows.forEach(r => { [r.start, r.end, ...(r.ms || []).map(m => m.date)].filter(Boolean).forEach(d => { if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; }); });
  if (t0 < lo) lo = t0; if (t0 > hi) hi = t0;
  lo = A.addDays(lo, -7); hi = A.addDays(hi, 14);
  const L = 230, W = 1000, RH = 34, H = rows.length * RH + 34, span = Math.max(1, A.days(lo, hi)), x = d => L + (A.days(lo, d) / span) * (W - L - 10);
  let ticks = ''; const s = new Date(lo + 'T00:00:00Z'); s.setUTCDate(1);
  const stepM = span > 500 ? 3 : 1;
  for (let d = new Date(s); d.toISOString().slice(0, 10) <= hi; d.setUTCMonth(d.getUTCMonth() + stepM)) {
    const ds = d.toISOString().slice(0, 10); if (ds < lo) continue;
    ticks += `<line x1="${x(ds)}" x2="${x(ds)}" y1="22" y2="${H}" class="g-grid"/><text x="${x(ds) + 3}" y="15" class="g-tick">${d.toLocaleDateString(undefined, { month: 'short', year: d.getUTCMonth() === 0 || ds === lo ? '2-digit' : undefined })}</text>`;
  }
  const body = rows.map((r, i) => {
    const y = 28 + i * RH, a = x(r.start || r.end), b = x(r.end || r.start), w = Math.max(4, b - a);
    const lab = `<text x="0" y="${y + 15}" class="g-lab">${esc(r.label.length > 34 ? r.label.slice(0, 33) + '…' : r.label)}</text>${r.sub ? `<text x="0" y="${y + 28}" class="g-sub">${esc(r.sub.slice(0, 40))}</text>` : ''}`;
    const bar = r.start || r.end ? `<rect x="${a}" y="${y + 5}" width="${w}" height="16" rx="3" class="g-bar ${r.cls || ''}"><title>${esc(r.label)}: ${esc(A.fmtDate(r.start))} to ${esc(A.fmtDate(r.end))}</title></rect>` : '';
    const ms = (r.ms || []).filter(m => m.date).map(m => `<path d="M${x(m.date)} ${y + 3}l7 10-7 10-7-10z" class="g-ms${m.done ? ' done' : ''}"><title>${esc(m.title)}: ${esc(A.fmtDate(m.date))}</title></path>`).join('');
    const link = r.href ? [`<a href="${esc(r.href)}">`, '</a>'] : ['', ''];
    return `<g>${link[0]}${lab}${link[1]}${bar}${ms}</g>`;
  }).join('');
  return `<div class="scroll"><svg class="gantt" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || 'Timeline')}">${ticks}<line x1="${x(t0)}" x2="${x(t0)}" y1="18" y2="${H}" class="g-today"/><text x="${x(t0) + 3}" y="${H - 4}" class="g-tick">Today</text>${body}</svg></div>`;
};

/* Task sequence as a layered graph: columns = order of work, arrows = "waits on". */
A.seqGraph = (tasks, opt = {}) => {
  const ts = tasks.filter(t => opt.all || t.status !== 'done').slice(0, 80);
  if (!ts.length) return '<p class="empty">No open tasks to sequence.</p>';
  const ids = new Set(ts.map(t => t.id)), lvl = t => Math.min(t.level, 12), cols = new Map();
  ts.forEach(t => { const l = lvl(t); if (!cols.has(l)) cols.set(l, []); cols.get(l).push(t); });
  const CW = 230, NH = 46, G = 12, pos = new Map(); let maxRows = 0;
  [...cols.keys()].sort((a, b) => a - b).forEach((l, ci) => { const c = cols.get(l).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')); maxRows = Math.max(maxRows, c.length);
    c.forEach((t, ri) => pos.set(t.id, { x: 10 + ci * CW, y: 30 + ri * (NH + G) })); });
  const W = 20 + cols.size * CW, H = 40 + maxRows * (NH + G);
  const heads = [...cols.keys()].sort((a, b) => a - b).map((l, ci) => `<text x="${10 + ci * CW}" y="16" class="g-tick">${ci === 0 ? 'Can start now' : 'Step ' + (ci + 1)}</text>`).join('');
  let edges = '';
  ts.forEach(t => t.depends_on.forEach(d => { if (!ids.has(d)) return; const a = pos.get(d), b = pos.get(t.id);
    const x1 = a.x + CW - 30, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
    edges += `<path d="M${x1} ${y1}C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2 - 4} ${y2}" class="s-edge${t.crit && D_crit(d, ts) ? ' crit' : ''}" marker-end="url(#ah)"/>`; }));
  const nodes = ts.map(t => { const p = pos.get(t.id);
    return `<g class="s-node st-${t.status}${t.crit ? ' crit' : ''}${t.overdue ? ' late' : ''}"><rect x="${p.x}" y="${p.y}" width="${CW - 34}" height="${NH}" rx="5"/><text x="${p.x + 8}" y="${p.y + 18}">#${t.n} ${esc(t.text.length > 26 ? t.text.slice(0, 25) + '…' : t.text)}</text><text x="${p.x + 8}" y="${p.y + 35}" class="s-sub">${esc(t.assignee || 'Unassigned')}${t.due ? ' · ' + esc(A.fmtDate(t.due)) : ''}</text><title>${esc(t.text)}</title></g>`; }).join('');
  return `<div class="scroll"><svg class="seq" viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 900)}px" role="img" aria-label="Task sequence"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="s-arrow"/></marker></defs>${heads}${edges}${nodes}</svg></div>`;
};
const D_crit = (id, ts) => ts.find(t => t.id === id)?.crit;

/* Metric map: company metrics on the left, the projects that move them on the right. */
A.metricMap = (D, onlyMetric) => {
  const ms = D.metrics.filter(m => !onlyMetric || m.id === onlyMetric);
  const ps = D.active.filter(p => p.metrics.some(l => ms.some(m => m.id === l.metric)));
  if (!ms.length) return '<p class="empty">No company metrics yet. Add them in the Workbench under Metrics, then tie projects to them.</p>';
  const RH = 54, H = Math.max(ms.length, ps.length) * RH + 10, W = 1000, LX = 10, RX = 640, BW = 330, PW = 350;
  const my = new Map(ms.map((m, i) => [m.id, 10 + i * RH + (H - 10 - ms.length * RH) / 2]));
  const py = new Map(ps.map((p, i) => [p.id, 10 + i * RH + (H - 10 - ps.length * RH) / 2]));
  const links = ps.flatMap(p => p.metrics.filter(l => my.has(l.metric)).map(l => { const y1 = my.get(l.metric) + 22, y2 = py.get(p.id) + 22;
    return `<path d="M${LX + BW} ${y1}C${LX + BW + 150} ${y1} ${RX - 150} ${y2} ${RX} ${y2}" class="mm-link h-${p.healthNow}"><title>${esc(p.name)}: ${esc(l.how || 'moves this metric')}</title></path>`; })).join('');
  const mbox = ms.map(m => { const y = my.get(m.id), pc = A.metricPct(m);
    return `<g class="mm-metric"><rect x="${LX}" y="${y}" width="${BW}" height="44" rx="6"/><text x="${LX + 12}" y="${y + 19}" class="mm-t">${esc(m.name.slice(0, 38))}</text><text x="${LX + 12}" y="${y + 36}" class="mm-s">${esc(A.fmtNum(m.current, m.unit))} of ${esc(A.fmtNum(m.target, m.unit))}</text>${pc == null ? '' : `<rect x="${LX + BW - 92}" y="${y + 28}" width="80" height="6" rx="3" class="mm-track"/><rect x="${LX + BW - 92}" y="${y + 28}" width="${80 * pc}" height="6" rx="3" class="mm-fill"/>`}</g>`; }).join('');
  const pbox = ps.map(p => { const y = py.get(p.id);
    return `<a href="index.html#p/${esc(p.id)}"><g class="mm-proj"><rect x="${RX}" y="${y}" width="${PW}" height="44" rx="6"/><circle cx="${RX + 16}" cy="${y + 22}" r="6" class="dot h-${p.healthNow}"/><text x="${RX + 30}" y="${y + 19}" class="mm-t">${esc(p.name.slice(0, 40))}</text><text x="${RX + 30}" y="${y + 36}" class="mm-s">${esc(A.HEALTH[p.healthNow])} · ${Math.round(p.progress * 100)}% done</text></g></a>`; }).join('');
  return `<div class="scroll"><svg class="mmap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Company metrics and the projects that move them">${links}${mbox}${pbox}</svg></div>`;
};
