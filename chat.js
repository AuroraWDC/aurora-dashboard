/* "Ask" panel (both pages): talk to the dashboard at company, project or meeting level.
   The browser calls Groq directly with the chat key the pipeline put in the encrypted payload (CHAT_GROQ_KEY secret);
   there is no server. Context is built here from the decrypted data plus passages of the relevant transcripts, kept
   under a character budget so one question fits the free tier's tokens-per-minute limit. The button only appears
   when the payload carries a chat key. */
'use strict';
(() => {
const { $, esc } = A;
const URL = 'https://api.groq.com/openai/v1/chat/completions';
const css = `
.ask-btn{position:fixed;right:16px;bottom:16px;z-index:40;display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:99px;border:1px solid var(--acc);background:var(--acc);color:var(--acc-ink);font:600 14px var(--font);box-shadow:0 4px 16px rgba(0,0,0,.14);cursor:pointer}
.ask-panel{position:fixed;right:16px;bottom:66px;z-index:41;width:min(460px,calc(100vw - 32px));height:min(620px,calc(100vh - 90px));display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);font-size:14px}
.ask-panel header{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)}
.ask-panel header select{flex:1;min-width:0;font-size:13px}
.ask-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.ask-msg{max-width:92%;padding:8px 11px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
.ask-msg.me{align-self:flex-end;background:var(--acc);color:var(--acc-ink)}
.ask-msg.ai{align-self:flex-start;background:var(--sunk)}
.ask-msg.err{align-self:stretch;background:transparent;border:1px solid var(--red);color:var(--red)}
.ask-msg .small{display:block;margin-top:6px;opacity:.8}
.ask-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}
.ask-form textarea{flex:1;min-height:40px;max-height:120px;resize:vertical}
.ask-hint{padding:0 12px 8px;font-size:12px;color:var(--mute)}
body:has(#deck) .ask-btn,body:has(#deck) .ask-panel{display:none}
@media print{.ask-btn,.ask-panel{display:none}}`;

let btn, panel, open = false, scope = null, log = [], busy = false;

function mount() {
  if (btn || !A.CHAT?.key) return;
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  btn = document.createElement('button'); btn.className = 'ask-btn'; btn.type = 'button'; btn.textContent = 'Ask'; btn.setAttribute('aria-expanded', 'false');
  btn.onclick = () => open ? hide() : show();
  panel = document.createElement('div'); panel.className = 'ask-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ask the dashboard');
  document.body.append(btn, panel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) hide(); });
}
document.addEventListener('aurora:ready', mount);
document.addEventListener('aurora:ask', e => { scope = e.detail; log = []; show(); });   // "Ask about this project / meeting" buttons
if (A.CHAT) mount();

/* where the person is looking decides the default scope */
function current() {
  const [route, id] = (location.hash.slice(1) || '').split('/');
  if ((route === 'p' || route === 'work') && id && A._D?.P.get(id)) return { kind: 'project', id };
  return { kind: 'company' };
}
const label = s => s.kind === 'company' ? `${A._D.settings.org} (every project)` : s.kind === 'project' ? A._D.P.get(s.id)?.name || 'Project' : `Meeting ${A.fmtDate(A._D.MT.get(s.id)?.date || '')}`;

function show() {
  if (!scope) scope = current();
  open = true; panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); draw(); $('#askq', panel)?.focus();
}
function hide() { open = false; panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
function draw() {
  const D = A._D, ps = D.active.filter(p => p.status !== 'completed').sort((a, b) => a.name.localeCompare(b.name));
  const opts = [`<option value="company"${scope.kind === 'company' ? ' selected' : ''}>${esc(D.settings.org)}: every project</option>`,
    `<optgroup label="Projects">${ps.map(p => `<option value="project:${esc(p.id)}"${scope.kind === 'project' && scope.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`,
    `<optgroup label="Meetings">${D.meetings.slice(0, 30).map(m => `<option value="meeting:${esc(m.id)}"${scope.kind === 'meeting' && scope.id === m.id ? ' selected' : ''}>${esc(A.fmtDate(m.date))} ${esc(m.file.slice(0, 40))}</option>`).join('')}</optgroup>`].join('');
  panel.innerHTML = `<header><label class="small mute" for="askscope">About</label><select id="askscope" aria-label="What to ask about">${opts}</select><button type="button" class="quiet small" data-clear title="Start over">Clear</button><button type="button" class="quiet" data-close aria-label="Close">✕</button></header>
  <div class="ask-log" id="asklog">${log.length ? log.map(m => `<div class="ask-msg ${m.role === 'user' ? 'me' : m.role === 'error' ? 'err' : 'ai'}">${m.html || esc(m.content)}</div>`).join('') :
    `<div class="ask-msg ai">Ask anything about <b>${esc(label(scope))}</b>: what was decided, who owns what, why something is at risk, what a meeting said. Answers come only from the transcripts and edits in the dashboard; if a meeting has not been uploaded yet, it will say so.</div>`}</div>
  <div class="ask-hint">${A._D.meetings.length} meeting${A._D.meetings.length === 1 ? '' : 's'} on file. ${A.CHAT.model}.</div>
  <form class="ask-form" id="askf"><textarea id="askq" rows="2" placeholder="Type a question" aria-label="Your question"></textarea><button class="go" ${busy ? 'disabled' : ''}>${busy ? '…' : 'Send'}</button></form>`;
  $('#askscope', panel).onchange = e => { const [k, id] = e.target.value.split(':'); scope = { kind: k, id }; log = []; draw(); };
  $('[data-close]', panel).onclick = hide; $('[data-clear]', panel).onclick = () => { log = []; draw(); };
  $('#askf', panel).onsubmit = e => { e.preventDefault(); const q = $('#askq', panel).value.trim(); if (q && !busy) ask(q); };
  $('#askq', panel).onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#askf', panel).requestSubmit(); } };
  const L = $('#asklog', panel); L.scrollTop = L.scrollHeight;
}

/* ---------- context ---------- */
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const pline = p => {
  const team = p.team.map(t => `${t.name}${t.role ? ' (' + t.role + (t.alloc != null ? ', ' + t.alloc + '%' : '') + ')' : t.alloc != null ? ' (' + t.alloc + '%)' : ''}`).join(', ');
  return `- ${p.name} [id ${p.id}] · ${A.HEALTH[p.healthNow]} · ${A.ST[p.status]}${p.priority ? ' · P' + p.priority : ''}${p.kind ? ' · ' + A.KIND[p.kind] : ''} · owner ${p.owner || 'none'}${team ? ' · team: ' + team : ''} · ${p.open.length} open task(s)${p.overdue ? ', ' + p.overdue + ' overdue' : ''}${p.nextMilestone ? ' · next: ' + p.nextMilestone.title + ' ' + p.nextMilestone.date : ''}${p.reasons.length ? ' · ' + p.reasons.join('; ') : ''}${p.staffNote ? ' · ' + p.staffNote : ''}${p.depends_on.length ? ' · depends on: ' + p.depends_on.map(id => A._D.P.get(id)?.name).filter(Boolean).join(', ') : ''}${p.risks.length ? ' · risks: ' + p.risks.slice(0, 2).map(r => trunc(r, 90)).join('; ') : ''}`;
};
function projectDetail(p) {
  const D = A._D, L = [`PROJECT: ${p.name} [id ${p.id}]`, `Status ${A.ST[p.status]}, health ${A.HEALTH[p.healthNow]}${p.reasons.length ? ' (' + p.reasons.join('; ') + ')' : ''}, priority ${p.priority ? 'P' + p.priority : 'not set'}, type ${p.kind ? A.KIND[p.kind] : 'not set'}, owner ${p.owner || 'none'}${p.sponsor ? ', sponsor ' + p.sponsor : ''}.`];
  if (p.description) L.push('Description: ' + trunc(p.description, 500));
  if (p.team.length) L.push('People: ' + p.team.map(t => `${t.name}${t.role ? ' (' + t.role + ')' : ''}${t.alloc != null ? ' ' + t.alloc + '% of their time' : ''}`).join('; '));
  if (p.staffNote) L.push('Staffing: ' + p.staffNote);
  if (p.start || p.target) L.push(`Dates: start ${p.start || '?'}, target ${p.target || '?'}; last discussed ${p.updated || 'never'}.`);
  const deps = p.depends_on.map(id => D.P.get(id)?.name).filter(Boolean), needed = D.active.filter(x => x.depends_on.includes(p.id)).map(x => x.name);
  if (deps.length) L.push('Depends on projects: ' + deps.join(', ')); if (needed.length) L.push('Needed by projects: ' + needed.join(', '));
  if (p.metrics.length) L.push('Moves metrics: ' + p.metrics.map(l => `${D.K.get(l.metric)?.name || l.metric}${l.how ? ' (' + l.how + ')' : ''}`).join('; '));
  const ts = [...p.tasks].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.priority || 5) - (b.priority || 5)).slice(0, 60);
  if (ts.length) L.push('Tasks:\n' + ts.map(t => `  #${t.n} [${A.TS[t.status]}] ${t.text}${t.assignee ? ' — ' + t.assignee : ''}${t.due ? ', due ' + t.due + (t.overdue ? ' (overdue)' : '') : ''}${t.workstream ? ' [' + t.workstream + ']' : ''}${t.blockers.length ? ' waits on ' + t.blockers.map(b => '#' + b.n).join(',') : ''}`).join('\n'));
  if (p.milestones.length) L.push('Milestones: ' + p.milestones.map(m => `${m.title} ${m.date || '(no date)'}${m.done ? ' done' : ''}`).join('; '));
  for (const [k, v] of [['Risks', p.risks], ['Assumptions', p.assumptions], ['Outside dependencies', p.dependencies]]) if (v.length) L.push(`${k}: ` + v.map(x => trunc(x, 160)).join(' | '));
  const ev = D.history.filter(e => e.p === p.id).slice(-10);
  if (ev.length) L.push('Recent changes: ' + ev.map(e => `${e.at} ${e.label}: ${e.type === 'changed' ? e.field + ' ' + (e.from ?? 'none') + '→' + (e.to ?? 'none') : e.type}`).join('; '));
  return L.join('\n');
}
async function passagesFor(ids, q, budget) {
  const out = []; let used = 0;
  for (const id of ids) {
    if (used >= budget) break;
    let t; try { t = await A.transcript(id); } catch { continue; }
    const m = A._D.MT.get(id), head = `--- ${/voice-note/i.test(m?.file || '') ? 'Voice note' : 'Meeting'} ${m?.date || t.date} (${m?.file || id}) ---`;
    let ps = A.passages(t, q, 5, 2);
    if (!ps.length && ids.length === 1) ps = [{ at: 0, lines: t.lines.slice(0, 40) }];   // a single meeting with no keyword hit: show its opening
    if (!ps.length) continue;
    const txt = ps.map(p => p.lines.map(l => (l.who ? l.who + ': ' : '') + l.text).join('\n')).join('\n…\n');
    const piece = head + '\n' + trunc(txt, Math.max(600, budget - used));
    out.push(piece); used += piece.length;
  }
  return out.join('\n');
}
async function context(q) {
  const D = A._D, B = A.CHAT.budget || 20000, L = [];
  const live = D.active.filter(p => p.status !== 'completed').sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.name.localeCompare(b.name));
  L.push(`TODAY: ${A.today()}. ORGANISATION: ${D.settings.org}. Dashboard last updated ${D.generated.slice(0, 10)}.`);
  L.push(`MEETINGS ON FILE (newest first; the only transcripts you have):\n` + D.meetings.slice(0, 40).map(m => `- ${m.date} ${m.file}: ${trunc(m.summary, scope.kind === 'company' ? 220 : 120)}`).join('\n'));
  let keywords = q;
  if (scope.kind === 'project') {
    const p = D.P.get(scope.id); keywords = q + ' ' + p.name;
    L.push(projectDetail(p));
    L.push('OTHER PROJECTS (one line each):\n' + live.filter(x => x !== p).map(x => trunc(pline(x), 260)).join('\n'));
  } else if (scope.kind === 'meeting') {
    const m = D.MT.get(scope.id);
    L.push(`MEETING IN FOCUS: ${m.date} ${m.file}\nSummary: ${m.summary}\nDecisions: ${(m.decisions || []).join(' | ') || 'none recorded'}`);
    L.push('PROJECTS (one line each):\n' + live.map(x => trunc(pline(x), 260)).join('\n'));
  } else {
    L.push('PROJECTS (priority order, one line each):\n' + live.map(pline).join('\n'));
    const over = D.people.filter(x => x.over); if (over.length) L.push('OVER CAPACITY: ' + over.map(x => `${x.name} ${x.alloc}% of ${x.capacity}%`).join('; '));
    if (D.metrics.length) L.push('METRICS: ' + D.metrics.map(m => `${m.name}: ${A.fmtNum(m.current, m.unit)} of ${A.fmtNum(m.target, m.unit)}`).join('; '));
    const dec = D.meetings.slice(0, 6).flatMap(m => (m.decisions || []).slice(0, 5).map(d => `${m.date}: ${trunc(d, 140)}`)); if (dec.length) L.push('RECENT DECISIONS FROM MEETINGS:\n' + dec.join('\n'));
  }
  let ctx = L.join('\n\n'); if (ctx.length > B * 0.6) ctx = ctx.slice(0, Math.floor(B * 0.6)) + '…';
  const ids = scope.kind === 'meeting' ? [scope.id] : scope.kind === 'project' ? [...D.P.get(scope.id).meetings].map(i => D.MT.get(i)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(m => m.id) : D.meetings.slice(0, 6).map(m => m.id);
  const tx = await passagesFor(ids, keywords, B - ctx.length - 500);
  return ctx + (tx ? '\n\nTRANSCRIPT PASSAGES (matched to the question; speaker: text):\n' + tx : '\n\n(No transcript passage matched the question.)');
}
const SYSTEM = `You are the assistant inside the %ORG% project dashboard, answering for leadership. Answer only from the CONTEXT: projects, people, dates, decisions and transcript passages. Be specific: name the meeting date when you quote or rely on a transcript. If the context does not cover the question, say so plainly; if someone asks about a meeting, call or chat that is not in MEETINGS ON FILE, say you do not have that transcript and that it can be added with the Workbench Upload tab or by speaking a voice note with the Give feedback button. Never invent people, dates, numbers or decisions. Keep answers short (a few sentences or a short list) unless asked for detail. Do not use markdown headings; plain sentences and simple dashes are fine.`;

/* ---------- the call ---------- */
async function ask(q) {
  busy = true; log.push({ role: 'user', content: q }); draw();
  const thinking = document.createElement('div'); thinking.className = 'ask-msg ai'; thinking.textContent = 'Reading the dashboard and transcripts…'; $('#asklog', panel).append(thinking);
  try {
    const ctx = await context(q), prior = log.filter(m => m.role !== 'error').slice(-7, -1).map(m => ({ role: m.role, content: m.content }));
    const messages = [{ role: 'system', content: SYSTEM.replace('%ORG%', A._D.settings.org) }, { role: 'user', content: 'CONTEXT:\n' + ctx }, { role: 'assistant', content: 'Understood. I will answer from this context only.' }, ...prior, { role: 'user', content: q }];
    thinking.textContent = 'Thinking…';
    const text = await groq(messages);
    log.push({ role: 'assistant', content: text, html: render(text) });
  } catch (e) { log.push({ role: 'error', content: e.message }); }
  busy = false; draw();
}
async function groq(messages, tries = 0) {
  const body = { model: A.CHAT.model, messages, temperature: 0.2, max_tokens: 700 };
  if (/gpt-oss/.test(A.CHAT.model)) body.reasoning_effort = 'low';
  let r;
  try { r = await fetch(URL, { method: 'POST', headers: { Authorization: 'Bearer ' + A.CHAT.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('The browser could not reach Groq. If you are online, Groq may be refusing calls from web pages (CORS); the dashboard admin can switch Ask to a relay. Transcripts still open with the M badges.'); }
  if (r.status === 429 && tries < 2) { const wait = Math.min(60, +r.headers.get('retry-after') || 15); await sleep(wait * 1000); return groq(messages, tries + 1); }
  if (r.status === 413 || r.status === 400 && tries < 1 && A.CHAT.budget > 6000) { A.CHAT.budget = Math.floor(A.CHAT.budget / 2); throw new Error('That question needed more context than one call allows. Ask again; the next try uses a smaller slice of the transcripts.'); }
  if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error(r.status === 401 ? 'The chat key was rejected. Tell the dashboard admin.' : r.status === 429 ? 'Groq is at its limit for the moment. Wait a minute and try again.' : `Groq returned an error (${r.status}). ${d.slice(0, 160)}`); }
  const d = await r.json(); return (d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || 'No answer came back.';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* light formatting: bold, dashes as bullets; dates that match a meeting become links to its transcript */
function render(text) {
  let h = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#+\s*/gm, '');
  const byDate = new Map(A._D.meetings.map(m => [m.date, m.id]));
  h = h.replace(/\b(20\d\d-\d\d-\d\d)\b/g, (d) => byDate.has(d) ? `<a href="#" data-meet="${esc(byDate.get(d))}">${d}</a>` : d);
  return h;
}
})();
