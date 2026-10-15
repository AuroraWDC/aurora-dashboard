/* Workbench interface (manage.html): edit the work, review and override the PM agent, upload transcripts.
   Edits are queued in this tab, shown immediately, then saved as one file in the private repo's ops/ folder.
   That push runs the pipeline, which republishes the dashboard for everyone (usually 1-3 minutes). */
'use strict';
(() => {
const { $, $$, esc } = A;
const ss = (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } };
let D, Q = ss('aurora.queue', []), PUB = ss('aurora.pub', []), sel = null, wview = 'list', showArch = false, pollT = null, dirty = false;
let cf = { p: '', k: '' }, files = [];
const ROUTES = [['work', 'Work'], ['metrics', 'Metrics'], ['control', 'Control center'], ['upload', 'Upload'], ['activity', 'Activity'], ['settings', 'Settings']];
const rid = () => 'h' + [...crypto.getRandomValues(new Uint8Array(5))].map(b => b.toString(16).padStart(2, '0')).join('');
const persist = () => { sessionStorage.setItem('aurora.queue', JSON.stringify(Q)); sessionStorage.setItem('aurora.pub', JSON.stringify(PUB)); };
const who = () => A.me?.name || localStorage.getItem('aurora.who') || '';   // personal logins name you automatically
const token = () => sessionStorage.getItem('aurora.tk') || '';
const isTyping = () => { const a = document.activeElement; return a && $('#app').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName); };

A.boot(d => {
  D = d; reconcile();
  $('#app').addEventListener('change', onChange); $('#app').addEventListener('click', onClick);
  $('#app').addEventListener('submit', onSubmit);
  window.addEventListener('hashchange', draw);
  window.addEventListener('beforeunload', e => { if (Q.length) { e.preventDefault(); e.returnValue = ''; } });
  draw(); if (PUB.length) startPoll();
});

/* ---------- local queue: apply edits immediately, publish later ---------- */
function reconcile() {
  PUB = PUB.filter(x => !D.ops_applied.includes(x.id)); persist();
  [...PUB.flatMap(x => x.ops), ...Q].forEach(o => { try { applyLocal(o); } catch (e) { console.warn('local apply', o, e); } });
  A.derive(D);
}
function queue(ops, redraw = true) {
  ops = [].concat(ops); ops.forEach(o => { Q.push(o); applyLocal(o); }); persist(); A.derive(D);
  if (redraw) draw(); else saveBar();
}
function find(kind, id) {
  if (kind === 'project') return D.projects.find(p => p.id === id);
  if (kind === 'metric') return D.metrics.find(m => m.id === id);
  for (const p of D.projects) { const x = (kind === 'task' ? p.tasks : p.milestones).find(x => x.id === id); if (x) return x; }
}
const ownerOf = (kind, id) => D.projects.find(p => (kind === 'task' ? p.tasks : p.milestones).some(x => x.id === id));
function mark(e, f) { e._src ||= {}; e._lock ||= []; e._pre ||= {};
  if (!e._lock.includes(f)) { e._pre[f] = [structuredClone(e[f] ?? null), e._src[f] || null]; e._lock.push(f); } e._src[f] = 'human:pending'; }
const KF = { set_project_status: ['project', 'status'], set_project_owner: ['project', 'owner'], set_task_owner: ['task', 'assignee'], set_task_due: ['task', 'due'], set_task_status: ['task', 'status'], set_workstream: ['task', 'workstream'], set_priority: ['either', 'priority'] };
function applyLocal(o) {
  const t0 = A.today(), base = { _src: {}, _lock: [], _pre: {} };
  if (o.op === 'settings') { const f = o.fields || {}; for (const [k, v] of Object.entries(f)) (k === 'features' || k === 'autonomy') ? Object.assign(D.settings[k], v) : (D.settings[k] = v); return; }
  if (o.op === 'run_agent') return;
  if (o.op === 'decision') { const d = D.decisions.find(x => x.id === o.id); if (!d) return; d.state = { approve: 'approved', reject: 'rejected', revert: 'reverted' }[o.action];
    if (o.action === 'approve' && KF[d.kind]) { const e = d.task ? find('task', d.task) : find('project', d.project); if (e) { e[KF[d.kind][1]] = d.kind === 'set_priority' ? +d.value : d.value; e._src[KF[d.kind][1]] = 'agent:' + d.id; } }
    return; }
  if (o.op === 'merge') { const a = find('project', o.from), b = find('project', o.into); if (!a || !b || a === b) return;
    b.tasks.push(...a.tasks); b.milestones.push(...a.milestones); const have = new Set(b.team.map(t => t.name.toLowerCase()));
    b.team.push(...a.team.filter(t => !have.has(t.name.toLowerCase()))); D.projects.splice(D.projects.indexOf(a), 1); (D.alias ||= {})[a.id] = b.id; return; }
  const f = o.fields || {};
  if (o.op === 'create') {
    if (find(o.entity, o.id)) return applyLocal({ ...o, op: 'set' });
    if (o.entity === 'project') D.projects.push({ ...structuredClone(base), id: o.id, name: 'Untitled project', status: 'not_started', owner: null, description: '', team: [], tasks: [], milestones: [], metrics: [], depends_on: [], risks: [], assumptions: [], dependencies: [], metrics_mentioned: [], meetings: [], archived: false, priority: null, health: null, updated: t0, first_seen: t0, ...f });
    else if (o.entity === 'task') find('project', o.project)?.tasks.push({ ...structuredClone(base), id: o.id, text: 'Untitled task', status: 'open', assignee: null, due: null, depends_on: [], workstream: null, first_seen: t0, seen: t0, ...f });
    else if (o.entity === 'milestone') find('project', o.project)?.milestones.push({ ...structuredClone(base), id: o.id, title: 'Milestone', date: null, done: false, ...f });
    else if (o.entity === 'metric') D.metrics.push({ ...structuredClone(base), id: o.id, name: 'Metric', unit: '', target: null, current: null, baseline: null, direction: 'up', owner: null, description: '', period: '', ...f });
    return;
  }
  if (o.op === 'restore') { D.deleted = D.deleted.filter(x => x.id !== o.id); return; }   // reappears after the next publish
  const e = find(o.entity, o.id); if (!e) return;
  if (o.op === 'set') for (const [k, v] of Object.entries(f)) { mark(e, k); e[k] = v; }
  if (o.op === 'unset') for (const k of o.fields || []) { if (e._pre?.[k]) { const [v, s] = e._pre[k]; e[k] = v; e._src[k] = s; delete e._pre[k]; e._lock = e._lock.filter(x => x !== k); } }
  if (o.op === 'delete') {
    if (o.entity === 'project' && o.hard) { D.projects.splice(D.projects.indexOf(e), 1); D.deleted.push({ id: e.id, name: e.name, at: A.today(), pending: true });
      const ids = new Set(e.tasks.map(t => t.id)); D.projects.forEach(q => { q.depends_on = q.depends_on.filter(x => x !== e.id); q.tasks.forEach(t => t.depends_on = t.depends_on.filter(x => !ids.has(x))); }); }
    else if (o.entity === 'project') { mark(e, 'archived'); e.archived = true; }
    else if (o.entity === 'metric') { D.metrics.splice(D.metrics.indexOf(e), 1); D.projects.forEach(p => p.metrics = p.metrics.filter(l => l.metric !== e.id)); }
    else { const p = ownerOf(o.entity, o.id), L = o.entity === 'task' ? p.tasks : p.milestones; L.splice(L.indexOf(e), 1);
      if (o.entity === 'task') D.projects.forEach(q => q.tasks.forEach(t => t.depends_on = t.depends_on.filter(x => x !== e.id))); }
  }
}

/* ---------- saving ---------- */
function saveBar() {
  let b = $('#savebar'); if (!b) { b = document.createElement('div'); b.id = 'savebar'; b.setAttribute('role', 'status'); document.body.append(b); }
  if (Q.length) b.innerHTML = `<span>${Q.length} unsaved change${Q.length === 1 ? '' : 's'}</span><button class="quiet" id="discard">Discard</button><button class="go" id="save">Save and publish</button>`;
  else if (PUB.length) b.innerHTML = `<span>Publishing ${PUB.reduce((n, x) => n + x.ops.length, 0)} change(s). The dashboard updates for everyone in 1 to 3 minutes.</span>`;
  else if (dirty) b.innerHTML = `<span>Published.</span><button class="go" id="reload">Show latest</button>`;
  else { b.remove(); return; }
  $('#save', b) && ($('#save', b).onclick = save); $('#discard', b) && ($('#discard', b).onclick = discard);
  $('#reload', b) && ($('#reload', b).onclick = () => { dirty = false; draw(); });
}
async function discard() { if (!confirm(`Discard ${Q.length} unsaved change(s)?`)) return; Q = []; persist(); try { D = await A.refresh(); } catch {} reconcile(); draw(); }
const utf8b64 = s => { let b = ''; new TextEncoder().encode(s).forEach(c => b += String.fromCharCode(c)); return btoa(b); };
async function save() {
  if (!token()) { location.hash = 'settings'; draw(); $('#tkmsg').textContent = 'Add a GitHub token to save changes.'; $('#tk')?.focus(); return; }
  if (!who()) { location.hash = 'settings'; draw(); $('#whomsg').textContent = 'Add your name so the activity log shows who made each change.'; $('#who')?.focus(); return; }
  const btn = $('#save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + rid().slice(1, 7), ops = Q.slice();
  try {
    const r = await fetch(`https://api.github.com/repos/${A.DATA_REPO}/contents/ops/${id}.json`, { method: 'PUT',
      headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ message: `Workbench edit by ${who()} (${ops.length} change${ops.length === 1 ? '' : 's'})`, content: utf8b64(JSON.stringify({ by: who(), email: A.me?.name ? A.me.email : undefined, at: new Date().toISOString(), ops }, null, 1)) }) });
    if (!r.ok) throw new Error([401, 403, 404].includes(r.status) ? 'GitHub rejected the token, or it cannot write to the data repo. Check it in Settings.' : `GitHub returned an error (${r.status}). Try again.`);
    Q = Q.slice(ops.length); PUB.push({ id, ops }); persist(); startPoll();
  } catch (e) { alert(e.message || 'Network error. Check your connection and try again.'); }
  saveBar();
}
function startPoll() {
  clearInterval(pollT); let n = 0;
  pollT = setInterval(async () => {
    if (++n > 45) { clearInterval(pollT); return; }
    let nd; try { nd = await A.refresh(); } catch { clearInterval(pollT); alert('The dashboard password changed. Sign in again.'); A.signOut(); return; }
    if (nd.generated === D.generated) return;
    D = nd; reconcile(); dirty = true;
    if (!PUB.length) clearInterval(pollT);
    if (!isTyping()) { dirty = false; draw(); } else saveBar();
  }, 20000);
}

/* ---------- shell ---------- */
function draw() {
  const [r, id] = (location.hash.slice(1) || 'work').split('/');
  $('#nav').innerHTML = ROUTES.map(([k, v]) => `<a href="#${k}"${r === k ? ' aria-current="page"' : ''}>${v}${k === 'control' && D.proposed.length ? ` <span class="chip">${D.proposed.length}</span>` : ''}</a>`).join('') +
    `<a class="switch" href="index.html">Leadership view</a><button id="so">Sign out</button>`;
  $('#so').onclick = () => { if (!Q.length || confirm('You have unsaved changes. Sign out anyway?')) { Q = []; persist(); A.signOut(); } };
  if (r === 'work' && id) sel = id;
  const y = window.scrollY;
  $('#app').innerHTML = ({ work, metrics, control, upload, activity, settings }[r] || work)();
  if (r === 'upload') bindUpload(); if (r === 'work' && wview === 'board') bindBoard();
  window.scrollTo(0, y); saveBar();
}
const dl = () => `<datalist id="ppl">${[...new Set([...D.peopleNames, ...D.users.map(u => u.name)])].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${esc(k)}"${String(v ?? '') === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
const PRI = { '': '–', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
const unsetBtn = (kind, e, f, p) => e._lock?.includes(f) && e._pre?.[f] ? `<button type="button" class="quiet small" data-act="unset" data-e="${kind}" data-id="${esc(e.id)}" data-f="${f}"${p ? ` data-p="${esc(p)}"` : ''} title="Undo the manual edit and go back to the meeting or agent value">Revert</button>` : '';
const inp = (kind, e, f, type, attrs = '', p = '') => `<input data-e="${kind}" data-id="${esc(e.id)}" data-f="${f}" data-t="${type}"${p ? ` data-p="${esc(p)}"` : ''} ${type === 'date' ? 'type="date"' : type === 'num' || type === 'int' ? 'type="number" step="any"' : ''} value="${esc(e[f] ?? '')}" ${attrs}>`;
const sel_ = (kind, e, f, o, p = '', attrs = '') => `<select data-e="${kind}" data-id="${esc(e.id)}" data-f="${f}" data-t="${f === 'priority' ? 'int' : 'text'}"${p ? ` data-p="${esc(p)}"` : ''} ${attrs}>${opt(o, e[f])}</select>`;
const field = (label, kind, e, f, control, wide) => `<label${wide ? ' class="wide"' : ''}><span>${label}${A.srcMark(e, f)}${unsetBtn(kind, e, f)}</span>${control}</label>`;

/* ---------- Work ---------- */
function work() {
  const ps = D.projects.filter(p => showArch || !p.archived).sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name));
  if (!sel || !D.P.get(sel)) sel = D.P.get(D.alias?.[sel])?.id || ps[0]?.id;
  const p = D.P.get(sel);
  return `${dl()}<div class="wb"><aside><form id="np" class="bar" style="margin-bottom:8px"><input name="n" placeholder="New project name" aria-label="New project name" required style="flex:1;min-width:0"><button>Add</button></form>
  <nav class="plist" aria-label="Projects">${ps.map(x => `<a href="#work/${esc(x.id)}"${x.id === sel ? ' aria-current="true"' : ''}><span>${esc(x.name)}${x.archived ? ' <span class="mute small">(archived)</span>' : ''}</span>${A.pill(x.healthNow)}</a>`).join('') || '<p class="empty" style="padding:12px">No projects yet.</p>'}</nav>
  <label class="small mute" style="display:block;margin-top:8px"><input type="checkbox" data-act="arch"${showArch ? ' checked' : ''}> Show archived</label>
  ${D.deleted.length ? `<details style="margin-top:10px"><summary class="small mute">Deleted projects (${D.deleted.length})</summary><ul class="plain small">${D.deleted.map(x => `<li>${esc(x.name)} ${x.pending ? '<span class="mute">(deleting)</span>' : `<button type="button" class="quiet small" data-act="restore" data-id="${esc(x.id)}">Restore</button>`}</li>`).join('')}</ul></details>` : ''}</aside>
  <section>${p ? editor(p) : '<p class="empty">Add a project, or upload a transcript to have one extracted.</p>'}</section></div>`;
}
function editor(p) {
  const F = D.settings.features, others = D.projects.filter(x => x.id !== p.id && !x.archived);
  const views = [['list', 'List'], ['sequence', 'Sequence'], ...(F.agile ? [['board', 'Board']] : []), ...(F.waterfall ? [['timeline', 'Timeline']] : [])];
  if (!views.some(v => v[0] === wview)) wview = 'list';
  return `<h2 class="page">${esc(p.name)}</h2><p>${A.pill(p.healthNow)} ${A.status(p.status)} <a class="small" href="index.html#p/${esc(p.id)}">Open in leadership view</a></p>
  ${p.reasons.length ? `<div class="notice">Health is ${esc(A.HEALTH[p.autoHealth].toLowerCase())} because: ${esc(p.reasons.join('; '))}.</div>` : ''}
  <div class="panel"><div class="form">
   ${field('Name', 'project', p, 'name', inp('project', p, 'name', 'req'), true)}
   ${field('Status', 'project', p, 'status', sel_('project', p, 'status', A.ST))}
   ${field('Owner', 'project', p, 'owner', inp('project', p, 'owner', 'text', 'list="ppl"'))}
   ${field('Priority', 'project', p, 'priority', sel_('project', p, 'priority', PRI))}
   ${field('Health', 'project', p, 'health', sel_('project', p, 'health', { '': `Automatic (${A.HEALTH[p.autoHealth]})`, green: 'On track', amber: 'At risk', red: 'Off track' }))}
   ${field('Sponsor', 'project', p, 'sponsor', inp('project', p, 'sponsor', 'text', 'list="ppl"'))}
   ${field('Start', 'project', p, 'start', inp('project', p, 'start', 'date'))}
   ${field('Target date', 'project', p, 'target', inp('project', p, 'target', 'date'))}
   ${F.waterfall ? field('Phase', 'project', p, 'phase', inp('project', p, 'phase', 'text', 'list="phases"') + '<datalist id="phases"><option value="Initiate"><option value="Plan"><option value="Execute"><option value="Close"></datalist>') : ''}
   ${field('Description', 'project', p, 'description', `<textarea data-e="project" data-id="${esc(p.id)}" data-f="description" data-t="text">${esc(p.description)}</textarea>`, true)}
  </div>
  <p class="small"><label><input type="checkbox" data-e="project" data-id="${esc(p.id)}" data-f="archived" data-t="bool"${p.archived ? ' checked' : ''}> Archived (hidden from leadership views)</label>
   <button type="button" class="quiet danger" data-act="delproj" data-id="${esc(p.id)}" style="margin-left:12px">Delete project</button>
   ${others.length ? `<span style="margin-left:18px">Merge into <select id="mergeTo" aria-label="Merge into project"><option value="">Choose a project</option>${others.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select> <button type="button" data-act="merge" data-id="${esc(p.id)}">Merge</button></span>` : ''}</p></div>

  <h3 class="sec">People and roles ${A.srcMark(p, 'team')}${unsetBtn('project', p, 'team')}</h3>
  <div class="panel"><table class="t edit" id="team"><tr><th>Name</th><th>Role on this project</th><th></th></tr>
   ${p.team.map((t, i) => `<tr><td><input data-team="name" value="${esc(t.name)}" list="ppl" aria-label="Name"></td><td><input data-team="role" value="${esc(t.role)}" aria-label="Role" placeholder="e.g. design lead, approver"></td><td><button type="button" class="quiet danger" data-act="team-del" data-i="${i}" aria-label="Remove ${esc(t.name)}">Remove</button></td></tr>`).join('')}
   <tr><td><input data-team="name" list="ppl" placeholder="Add a person" aria-label="New person"></td><td><input data-team="role" placeholder="Role" aria-label="New person's role"></td><td></td></tr></table></div>

  <h3 class="sec">Company metrics it moves ${A.srcMark(p, 'metrics')}</h3>
  <div class="panel">${D.metrics.length ? `<table class="t edit"><tr><th>Metric</th><th>How this project moves it</th></tr>${D.metrics.map(m => { const l = p.metrics.find(x => x.metric === m.id);
    return `<tr><td><label><input type="checkbox" data-ml="${esc(m.id)}"${l ? ' checked' : ''}> ${esc(m.name)}</label></td><td><input data-mlhow="${esc(m.id)}" value="${esc(l?.how || '')}" placeholder="e.g. cuts onboarding time by automating setup" aria-label="How ${esc(p.name)} moves ${esc(m.name)}"></td></tr>`; }).join('')}</table>` : '<p class="empty">No metrics defined. Add them on the Metrics tab.</p>'}
   ${p.metrics_mentioned.length ? `<p class="small mute">Mentioned in meetings: ${esc(p.metrics_mentioned.join(', '))}</p>` : ''}</div>

  <h3 class="sec">Work breakdown <span class="mute">${p.open.length} open, ${p.done} done</span></h3>
  <div class="tabs" role="group" aria-label="Work view">${views.map(([k, v]) => `<button type="button" data-act="wview" data-v="${k}" aria-pressed="${wview === k}">${v}</button>`).join('')}</div>
  ${({ list: taskList, sequence: seqView, board: boardView, timeline: timelineView }[wview])(p)}

  <h3 class="sec">Milestones</h3><div class="panel"><table class="t edit"><tr><th>Milestone</th><th>Date</th><th>Done</th><th></th></tr>
   ${p.milestones.map(m => `<tr><td>${inp('milestone', m, 'title', 'req', 'aria-label="Milestone"')}</td><td>${inp('milestone', m, 'date', 'date', 'aria-label="Date"')}</td><td><input type="checkbox" data-e="milestone" data-id="${esc(m.id)}" data-f="done" data-t="bool"${m.done ? ' checked' : ''} aria-label="Done"></td><td><button type="button" class="quiet danger" data-act="del" data-e="milestone" data-id="${esc(m.id)}">Remove</button></td></tr>`).join('')}
   </table><form class="bar" data-form="ms" data-p="${esc(p.id)}" style="margin:8px 0 0"><input name="t" placeholder="New milestone" required aria-label="New milestone"><input name="d" type="date" aria-label="Date"><button>Add milestone</button></form></div>

  <h3 class="sec">Dependencies</h3><div class="panel"><div class="form">
   <label class="wide"><span>Waits on these projects ${A.srcMark(p, 'depends_on')}</span><span class="chips">${others.map(x => `<label class="chip"><input type="checkbox" data-pd="${esc(x.id)}"${p.depends_on.includes(x.id) ? ' checked' : ''}> ${esc(x.name)}</label>`).join('') || '<span class="mute">No other projects</span>'}</span></label>
   ${field('Risks, one per line', 'project', p, 'risks', `<textarea data-e="project" data-id="${esc(p.id)}" data-f="risks" data-t="lines">${esc(p.risks.join('\n'))}</textarea>`, true)}
   ${field('Assumptions, one per line', 'project', p, 'assumptions', `<textarea data-e="project" data-id="${esc(p.id)}" data-f="assumptions" data-t="lines">${esc(p.assumptions.join('\n'))}</textarea>`, true)}
   ${field('Outside dependencies, one per line', 'project', p, 'dependencies', `<textarea data-e="project" data-id="${esc(p.id)}" data-f="dependencies" data-t="lines">${esc(p.dependencies.join('\n'))}</textarea>`, true)}
  </div></div>`;
}
function taskList(p) {
  const F = D.settings.features, groups = new Map();
  [...p.tasks].sort((a, b) => (a.workstream || '~').localeCompare(b.workstream || '~') || (a.priority || 5) - (b.priority || 5) || a.n - b.n)
    .forEach(t => { const k = t.workstream || 'No workstream'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  const ws = [...new Set(D.projects.flatMap(x => x.tasks.map(t => t.workstream)).filter(Boolean))];
  const cols = 8 + (F.waterfall ? 2 : 0) + (F.agile ? 2 : 0);
  return `<datalist id="wsl">${ws.map(w => `<option value="${esc(w)}">`).join('')}</datalist><div class="panel scroll"><table class="t edit" style="min-width:${F.agile || F.waterfall ? 1100 : 860}px">
  <tr><th>#</th><th>Status</th><th style="width:32%">Task</th><th>Workstream</th><th>Owner</th><th>Due</th><th title="Task numbers this one waits on, e.g. 2, 5">Waits on #</th><th>Priority</th>${F.waterfall ? '<th>Start</th><th>Days</th>' : ''}${F.agile ? '<th>Points</th><th>Sprint</th>' : ''}<th></th></tr>
  ${[...groups.entries()].map(([g, ts]) => `<tr class="ws-row"><td colspan="${cols + 1}">${esc(g)}</td></tr>${ts.map(t => `<tr${t.status === 'done' ? ' class="mute"' : ''}>
   <td class="n">${t.n}${t.crit && F.waterfall ? ' <abbr title="On the critical path" class="late">●</abbr>' : ''}</td>
   <td>${sel_('task', t, 'status', A.TS, p.id, 'aria-label="Status"')}</td>
   <td>${inp('task', t, 'text', 'req', 'aria-label="Task"', p.id)}${t.overdue ? '<span class="small late">overdue</span>' : ''}${t.blockers.length ? `<span class="small mute">waits on ${t.blockers.map(b => '#' + b.n).join(', ')}</span>` : ''}</td>
   <td>${inp('task', t, 'workstream', 'text', 'list="wsl" aria-label="Workstream"', p.id)}</td>
   <td>${inp('task', t, 'assignee', 'text', 'list="ppl" aria-label="Owner"', p.id)}</td>
   <td>${inp('task', t, 'due', 'date', 'aria-label="Due"', p.id)}</td>
   <td><input data-e="task" data-id="${esc(t.id)}" data-p="${esc(p.id)}" data-f="depends_on" data-t="deps" value="${esc(t.depends_on.map(id => D.T.get(id)).filter(x => x && x._p === p.id).map(x => x.n).join(', '))}" aria-label="Waits on task numbers" style="width:70px"></td>
   <td>${sel_('task', t, 'priority', PRI, p.id, 'aria-label="Priority"')}</td>
   ${F.waterfall ? `<td>${inp('task', t, 'start', 'date', 'aria-label="Start"', p.id)}</td><td>${inp('task', t, 'estimate', 'num', 'aria-label="Estimate in days" style="width:60px"', p.id)}</td>` : ''}
   ${F.agile ? `<td>${inp('task', t, 'points', 'num', 'aria-label="Story points" style="width:60px"', p.id)}</td><td>${inp('task', t, 'sprint', 'text', 'aria-label="Sprint" style="width:90px"', p.id)}</td>` : ''}
   <td style="white-space:nowrap">${A.srcMark(t, 'text')}${['status', 'assignee', 'due'].some(f => t._lock?.includes(f)) ? ` <button type="button" class="quiet small" data-act="unset" data-e="task" data-id="${esc(t.id)}" data-f="${['status', 'assignee', 'due'].filter(f => t._lock.includes(f) && t._pre?.[f]).join(',')}" title="Undo your edits to status, owner and due date">Revert</button>` : ''}<button type="button" class="quiet danger" data-act="del" data-e="task" data-id="${esc(t.id)}" aria-label="Delete task ${t.n}">Delete</button></td></tr>`).join('')}`).join('')}
  </table>${p.tasks.length ? '' : '<p class="empty">No tasks yet. Add the first one below.</p>'}
  <form class="bar" data-form="task" data-p="${esc(p.id)}" style="margin:10px 0 0"><input name="t" placeholder="New task" required style="flex:2" aria-label="New task"><input name="w" list="wsl" placeholder="Workstream" aria-label="Workstream"><input name="a" list="ppl" placeholder="Owner" aria-label="Owner"><input name="d" type="date" aria-label="Due"><button>Add task</button></form></div>`;
}
function seqView(p) {
  const order = [...p.open].sort((a, b) => a.level - b.level || (a.due || '9').localeCompare(b.due || '9'));
  return `<div class="panel">${A.seqGraph(p.tasks)}<h4>Suggested order</h4><ol>${order.map(t => `<li>#${t.n} ${esc(t.text)} <span class="small mute">${esc(t.assignee || 'Unassigned')}${t.due ? ', ' + esc(A.fmtDate(t.due)) : ''}${t.blockers.length ? ', after ' + t.blockers.map(b => '#' + b.n).join(', ') : ''}</span>${t.cycle ? ' <span class="small late">circular dependency</span>' : ''}</li>`).join('')}</ol>
  <p class="small mute">Set "Waits on #" in the List view to sequence tasks. Tasks with nothing to wait on can start now.</p></div>`;
}
let sprintF = '';
function boardView(p) {
  const sprints = [...new Set(p.tasks.map(t => t.sprint).filter(Boolean))];
  const ts = p.tasks.filter(t => !sprintF || t.sprint === sprintF);
  return `<p class="bar"><label class="small mute">Sprint <select data-act="sprintF"><option value="">All</option>${sprints.map(s => `<option${s === sprintF ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
  <span class="small mute">${ts.filter(t => t.status !== 'done').reduce((n, t) => n + (+t.points || 0), 0)} points open. Drag cards between columns.</span></p>
  <div class="board">${Object.entries(A.TS).map(([k, v]) => `<div class="col" data-col="${k}" data-p="${esc(p.id)}"><h5>${v} (${ts.filter(t => t.status === k).length})</h5>${ts.filter(t => t.status === k).map(t => `<div class="tcard" draggable="true" data-tid="${esc(t.id)}">#${t.n} ${esc(t.text)}<div class="small mute">${esc(t.assignee || 'Unassigned')}${t.points ? ', ' + esc(t.points) + ' pts' : ''}${t.sprint ? ', ' + esc(t.sprint) : ''}</div></div>`).join('')}</div>`).join('')}</div>`;
}
function bindBoard() {
  $$('.tcard').forEach(c => c.ondragstart = e => e.dataTransfer.setData('text/plain', c.dataset.tid));
  $$('.board .col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('over'); }; col.ondragleave = () => col.classList.remove('over');
    col.ondrop = e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'), t = D.T.get(id); if (t && t.status !== col.dataset.col) queue({ op: 'set', entity: 'task', id, project: col.dataset.p, fields: { status: col.dataset.col } }); };
  });
}
function timelineView(p) {
  const rows = p.tasks.filter(t => t.due || t.start).map(t => ({ label: `#${t.n} ${t.text}`, sub: t.assignee || '', start: t.start || (t.estimate && t.due ? A.addDays(t.due, -Math.ceil(t.estimate)) : t.due), end: t.due || (t.start && t.estimate ? A.addDays(t.start, Math.ceil(t.estimate)) : t.start), cls: (t.crit ? 'crit ' : '') + (t.status === 'done' ? 'done' : '') }));
  if (p.milestones.some(m => m.date)) rows.push({ label: 'Milestones', ms: p.milestones });
  const crit = p.tasks.filter(t => t.crit);
  return `<div class="panel">${A.gantt(rows, { label: 'Task timeline' })}<p class="small">${crit.length ? `Critical path (${crit.reduce((n, t) => n + (+t.estimate || 1), 0)} days of work): ${crit.sort((a, b) => a.level - b.level).map(t => '#' + t.n).join(' → ')}. Red bars are on it; a delay there delays the project.` : 'Add "Waits on #" links and day estimates to see the critical path.'}</p></div>`;
}

/* ---------- Metrics ---------- */
function metrics() {
  return `${dl()}<h2 class="page">Company metrics</h2><p class="lede">Define the metrics leadership tracks, then tie projects to them on each project's page. Update "Current" as numbers come in; the leadership view charts the trend.</p>
  <div class="panel scroll"><table class="t edit" style="min-width:980px"><tr><th>Metric</th><th>Unit</th><th>Baseline</th><th>Current</th><th>Target</th><th>Better when</th><th>Owner</th><th>Target by</th><th>Projects</th><th></th></tr>
  ${D.metrics.map(m => `<tr><td>${inp('metric', m, 'name', 'req', 'aria-label="Metric name"')}${A.srcMark(m, 'current')}</td><td>${inp('metric', m, 'unit', 'text', 'style="width:70px" aria-label="Unit" placeholder="%, $, days"')}</td>
   <td>${inp('metric', m, 'baseline', 'num', 'style="width:90px" aria-label="Baseline"')}</td><td>${inp('metric', m, 'current', 'num', 'style="width:90px" aria-label="Current"')}</td><td>${inp('metric', m, 'target', 'num', 'style="width:90px" aria-label="Target"')}</td>
   <td>${sel_('metric', m, 'direction', { up: 'Higher', down: 'Lower' })}</td><td>${inp('metric', m, 'owner', 'text', 'list="ppl" aria-label="Owner"')}</td><td>${inp('metric', m, 'period', 'text', 'style="width:90px" aria-label="Target by" placeholder="Q4 2026"')}</td>
   <td class="num">${D.metricLinks.get(m.id)?.length || 0}</td><td><button type="button" class="quiet danger" data-act="del" data-e="metric" data-id="${esc(m.id)}">Delete</button></td></tr>
   <tr><td colspan="10"><input data-e="metric" data-id="${esc(m.id)}" data-f="description" data-t="text" value="${esc(m.description)}" placeholder="What this measures and why it matters" aria-label="Description"></td></tr>`).join('')}</table>
  ${D.metrics.length ? '' : '<p class="empty">No metrics yet. Add the first one below, such as on-time delivery rate or monthly recurring revenue.</p>'}
  <form class="bar" data-form="metric" style="margin-top:10px"><input name="n" placeholder="Metric name" required style="flex:2" aria-label="Metric name"><input name="u" placeholder="Unit" aria-label="Unit"><input name="c" type="number" step="any" placeholder="Current" aria-label="Current"><input name="t" type="number" step="any" placeholder="Target" aria-label="Target"><button>Add metric</button></form></div>
  <h3 class="sec">Map</h3>${A.metricMap(D)}`;
}

/* ---------- Control center ---------- */
const PRESETS = {
  manual: { label: 'Manual', note: 'Agent off. People do all planning.', s: { agent_enabled: false } },
  assist: { label: 'Assist', note: 'Agent proposes; every change waits for approval.', s: { agent_enabled: true, autonomy: Object.fromEntries(Object.keys(A.KINDS).map(k => [k, 'suggest'])) } },
  autopilot: { label: 'Autopilot', note: 'Routine changes apply on their own; status changes, new tasks and merges still wait for approval.', s: { agent_enabled: true, autonomy: Object.fromEntries(Object.keys(A.KINDS).map(k => [k, ['set_project_status', 'set_project_owner', 'set_task_status', 'add_task', 'merge_projects', 'merge_tasks'].includes(k) ? 'suggest' : 'auto'])) } }
};
const preset = () => { const s = D.settings; if (!s.agent_enabled) return 'manual'; const a = Object.keys(A.KINDS).map(k => s.autonomy[k] || 'suggest');
  return a.every(x => x === 'suggest') ? 'assist' : JSON.stringify(a) === JSON.stringify(Object.keys(A.KINDS).map(k => PRESETS.autopilot.s.autonomy[k])) ? 'autopilot' : 'custom'; };
const pname = id => D.P.get(id)?.name || D.P.get(D.alias?.[id])?.name || '(merged or removed project)';
const tname = id => { const t = D.T.get(id); return t ? `#${t.n} ${t.text}` : '(removed task)'; };
function shown(d) {
  const k = d.kind, v = d.value;
  if (k === 'set_project_status') return A.ST[v] || v; if (k === 'set_task_status') return A.TS[v] || v;
  if (k === 'set_task_due') return A.fmtDate(v); if (k === 'set_priority') return 'P' + v;
  if (k === 'add_task_dependency') return `waits on ${tname(v)}`; if (k === 'add_project_dependency') return `depends on ${pname(v)}`;
  if (k === 'link_metric') return D.K.get(v)?.name || '(removed metric)'; if (k === 'merge_projects') return `merge into ${pname(v)}`;
  if (k === 'merge_tasks') return `merge into ${tname(v)}`; return v;
}
const beforeTxt = d => d.before == null || d.before === '' ? 'empty' : d.kind.endsWith('status') ? (A.ST[d.before] || A.TS[d.before] || d.before) : d.kind === 'set_task_due' ? A.fmtDate(d.before) : d.kind === 'set_priority' ? 'P' + d.before : String(d.before);
function decCard(d) {
  const t = d.task ? D.T.get(d.task) : null, ent = t || D.P.get(d.project), f = KF[d.kind]?.[1], open = d.state === 'proposed', live = d.state === 'applied' || d.state === 'approved';
  const nowSrc = ent && f ? ent._src?.[f] : null;
  return `<article class="dec" id="dec-${esc(d.id)}"><header><h4>${esc(A.KINDS[d.kind] || d.kind)}</h4><span class="small mute">${esc(d.state === 'applied' ? 'Applied automatically' : d.state === 'approved' ? 'Approved' : d.state === 'proposed' ? 'Waiting for review' : d.state === 'stale' ? 'No longer applies' : d.state[0].toUpperCase() + d.state.slice(1))} · ${esc(A.fmtDate(d.created.slice(0, 10)))}</span></header>
  <div class="small"><a href="#work/${esc(d.project)}">${esc(pname(d.project))}</a>${d.task ? ' › ' + esc(tname(d.task)) : ''}</div>
  <p class="change">${f ? `<del>${esc(beforeTxt(d))}</del> → ` : ''}<ins>${esc(shown(d))}</ins>${d.workstream ? ` <span class="small mute">in ${esc(d.workstream)}</span>` : ''}</p>
  <p class="small" style="margin:4px 0">${esc(d.rationale)}</p>
  <details><summary class="small">Why and where from</summary>${d.evidence ? `<blockquote>${esc(d.evidence)}</blockquote>` : ''}
   <dl class="kv small"><dt>Confidence</dt><dd><span class="conf"><span style="width:${d.confidence * 100}%"></span></span> ${Math.round(d.confidence * 100)}%</dd>
   <dt>Policy at the time</dt><dd>${d.mode === 'auto' ? 'Apply automatically' : 'Ask for review'}</dd><dt>Agent run</dt><dd>${esc(d.run || '')} ${esc((D.agent_runs.find(r => r.id === d.run) || {}).model || '')}</dd>
   ${f && ent ? `<dt>Value now</dt><dd>${esc(ent[f] ?? 'empty')} <span class="mute">(${esc(A.srcLabel(nowSrc) || 'unknown source')})</span></dd>` : ''}</dl></details>
  <div class="acts">${open ? `<button class="go" data-act="dec" data-a="approve" data-id="${esc(d.id)}">Approve</button><button data-act="dec" data-a="reject" data-id="${esc(d.id)}">Reject</button>` : ''}
   ${live ? `<button data-act="dec" data-a="revert" data-id="${esc(d.id)}">Revert</button>` : ''}
   ${(open || live) && f ? `<button data-act="ovr" data-id="${esc(d.id)}">Override</button><span class="ovr" id="ovr-${esc(d.id)}" hidden>${ovrInput(d)} <button class="go" data-act="ovr-go" data-id="${esc(d.id)}">Apply override</button></span>` : ''}
   ${(open || live) && !f ? `<a class="small" href="#work/${esc(d.project)}">Edit in Work instead</a>` : ''}</div></article>`;
}
function ovrInput(d) {
  const k = d.kind, a = `id="ovv-${esc(d.id)}" aria-label="Your value"`;
  if (k === 'set_project_status') return `<select ${a}>${opt(A.ST, d.value)}</select>`; if (k === 'set_task_status') return `<select ${a}>${opt(A.TS, d.value)}</select>`;
  if (k === 'set_task_due') return `<input type="date" ${a} value="${esc(d.value)}">`; if (k === 'set_priority') return `<select ${a}>${opt(PRI, d.value)}</select>`;
  return `<input ${a} value="${esc(d.value)}"${k.includes('owner') ? ' list="ppl"' : ''}>`;
}
function control() {
  const S = D.settings, pr = preset(), filt = d => (!cf.p || d.project === cf.p) && (!cf.k || d.kind === cf.k);
  const prop = D.proposed.filter(filt), live = D.decisions.filter(d => (d.state === 'applied' || d.state === 'approved') && filt(d)).reverse().slice(0, 40);
  const closed = D.decisions.filter(d => ['rejected', 'reverted', 'stale'].includes(d.state) && filt(d)).reverse().slice(0, 60);
  const last = D.agent_runs[D.agent_runs.length - 1], pending = [...PUB.flatMap(x => x.ops), ...Q].some(o => o.op === 'run_agent');
  return `${dl()}<h2 class="page">Control center</h2><p class="lede">The project-management agent reads the portfolio and recent meetings, then proposes or makes changes. Everything it does is listed here with its reasons, and anything can be approved, rejected, overridden or reverted.</p>
  <div class="panel"><div class="bar" style="justify-content:space-between"><div><b>Agent mode</b><div class="seg" role="group" aria-label="Agent mode" style="margin-left:10px">${Object.entries(PRESETS).map(([k, v]) => `<button data-act="preset" data-v="${k}" aria-pressed="${pr === k}">${v.label}</button>`).join('')}${pr === 'custom' ? '<button aria-pressed="true" disabled>Custom</button>' : ''}</div></div>
   <button data-act="run"${S.agent_enabled && !pending ? '' : ' disabled'}>${pending ? 'Agent run requested' : 'Run the agent now'}</button></div>
   <p class="small mute" style="margin:0">${esc(PRESETS[pr]?.note || 'Custom permissions, set below.')} ${S.agent_enabled ? 'It runs on weekday mornings and after new transcripts.' : ''}
   ${last ? `Last run ${esc(A.fmtDate(last.at.slice(0, 10)))}: ${last.error ? 'failed: ' + esc(last.error) : last.note ? esc(last.note) : `${last.proposed} decision(s), ${last.auto || 0} applied automatically`}.` : 'It has not run yet.'}</p></div>
  <div class="bar" style="margin-top:16px"><select data-act="cfp" aria-label="Filter by project"><option value="">All projects</option>${D.active.map(p => `<option value="${esc(p.id)}"${cf.p === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
   <select data-act="cfk" aria-label="Filter by kind"><option value="">All kinds of change</option>${opt(A.KINDS, cf.k)}</select></div>
  <h3 class="sec">Waiting for review <span class="mute">${prop.length}</span>${prop.some(d => d.confidence >= .9) ? `<button class="small" data-act="bulk">Approve all 90% or more confident</button>` : ''}</h3>
  ${prop.map(decCard).join('') || '<p class="empty">Nothing is waiting. New proposals appear after the agent runs.</p>'}
  ${D.conflicts.length ? `<h3 class="sec">Overrides a newer meeting disagrees with <span class="mute">${D.conflicts.length}</span></h3>${D.conflicts.map(c => { const e = c.entity === 'task' ? D.T.get(c.id) : D.P.get(c.id);
    return `<div class="dec"><div class="small"><a href="#work/${esc(c.project)}">${esc(pname(c.project))}</a>${c.entity === 'task' && e ? ' › ' + esc(e.text) : ''}</div><p class="change">${esc(c.field)}: a person set <ins>${esc(c.override ?? 'empty')}</ins>; the ${esc(A.fmtDate(c.meeting_date))} meeting says <b>${esc(c.meeting_value)}</b></p>
    <div class="acts"><button data-act="unset" data-e="${c.entity}" data-id="${esc(c.id)}" data-f="${c.field}">Use the meeting's value</button><span class="small mute">Or leave it: the override stays until someone reverts it.</span></div></div>`; }).join('')}` : ''}
  <h3 class="sec">Changes the agent made <span class="mute">${live.length}</span></h3>${live.map(decCard).join('') || '<p class="empty">The agent has not changed anything yet.</p>'}
  <h3 class="sec">Alerts <span class="mute">${D.alerts.length}, checked by rules on every publish</span></h3>
  ${D.alerts.length ? `<div class="scroll"><table class="t"><tr><th>Type</th><th>Project</th><th>Detail</th></tr>${D.alerts.filter(a => !cf.p || a.p.id === cf.p).slice(0, 80).map(a => `<tr><td>${esc(a.type)}</td><td><a href="#work/${esc(a.p.id)}">${esc(a.p.name)}</a></td><td>${esc(a.text)}</td></tr>`).join('')}</table></div>` : '<p class="empty">No alerts.</p>'}
  <h3 class="sec">What the agent may do</h3><div class="panel scroll"><table class="t"><tr><th>Kind of change</th><th>Permission</th></tr>
   ${Object.entries(A.KINDS).map(([k, v]) => `<tr><td>${esc(v)}</td><td><div class="seg" role="group" aria-label="${esc(v)}">${[['off', 'Never'], ['suggest', 'Ask first'], ['auto', 'Do it']].map(([m, l]) => `<button data-act="auto" data-k="${k}" data-v="${m}" aria-pressed="${(S.autonomy[k] || 'suggest') === m}">${l}</button>`).join('')}</div></td></tr>`).join('')}</table>
   <p class="small"><label>"Do it" only applies when the agent is at least <input type="number" min="0" max="100" step="5" value="${Math.round(S.auto_min_confidence * 100)}" data-act="minconf" style="width:70px" aria-label="Minimum confidence percent">% confident; below that it asks first.</label></p></div>
  <h3 class="sec">Agent runs</h3>${D.agent_runs.length ? `<div class="scroll"><table class="t"><tr><th>When</th><th>Model</th><th>Decisions</th><th>Applied automatically</th><th>Dropped by checks</th><th>Notes</th></tr>${[...D.agent_runs].reverse().map(r => `<tr><td>${esc(r.at.replace('T', ' ').slice(0, 16))}</td><td class="small">${esc(r.model || '')}</td><td>${r.proposed ?? ''}</td><td>${r.auto ?? ''}</td><td>${r.rejected_by_checks ?? ''}</td><td class="small">${esc(r.error || r.note || '')}</td></tr>`).join('')}</table></div>` : '<p class="empty">No runs yet.</p>'}
  ${closed.length ? `<details style="margin-top:20px"><summary>Rejected, reverted and outdated decisions (${closed.length})</summary>${closed.map(decCard).join('')}</details>` : ''}`;
}

/* ---------- Upload ---------- */
function upload() {
  return `<h2 class="page">Upload transcripts</h2><p class="lede">Add Teams meeting transcripts (.vtt or .txt). They are saved to the private data repo, and the dashboard updates a few minutes later. Uses the GitHub token from Settings.</p>
  <div class="panel" style="max-width:720px">${token() ? '' : '<p class="notice">Add a GitHub token in <a href="#settings">Settings</a> first.</p>'}
  <p><input id="fp" type="file" accept=".vtt,.txt" multiple aria-label="Transcript files"></p><div id="rows"></div>
  <p><button class="go" id="up" disabled>Upload</button> <span id="us" class="mute" role="status"></span></p>
  <p class="small mute">The date sets "last discussed" and resolves phrases like "next Friday". It is taken from the file name when it contains one.</p></div>`;
}
function bindUpload() {
  const fp = $('#fp'), rows = $('#rows'), up = $('#up');
  fp.onchange = () => { files = [...fp.files].map(f => { const m = f.name.match(/(20\d\d)-?(\d\d)-?(\d\d)/); return { f, d: m ? `${m[1]}-${m[2]}-${m[3]}` : new Date(f.lastModified).toISOString().slice(0, 10) }; });
    rows.innerHTML = files.map((x, i) => `<div class="bar"><span style="flex:1;overflow-wrap:anywhere">${esc(x.f.name)}</span><input type="date" data-i="${i}" value="${x.d}" aria-label="Meeting date for ${esc(x.f.name)}"><span class="mute" id="s${i}"></span></div>`).join('');
    rows.querySelectorAll('input[type=date]').forEach(i => i.onchange = e => files[e.target.dataset.i].d = e.target.value); up.disabled = !files.length; };
  up.onclick = async () => {
    if (!token()) { $('#us').textContent = 'Add a GitHub token in Settings first.'; return; }
    up.disabled = true;
    for (const [i, x] of files.entries()) { const el = $('#s' + i); el.textContent = 'Uploading…';
      try { const c = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(x.f); });
        const n = x.d + '-' + x.f.name.replace(/^\d{4}-?\d{2}-?\d{2}[-_ ]*/, '').replace(/[^\w.-]+/g, '_');
        const r = await fetch(`https://api.github.com/repos/${A.DATA_REPO}/contents/transcripts/${encodeURIComponent(n)}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify({ message: 'Add transcript ' + n, content: c }) });
        el.textContent = r.ok ? 'Uploaded' : r.status === 422 ? 'Already uploaded' : [401, 403, 404].includes(r.status) ? 'Token rejected or lacks access to the data repo' : 'Failed (' + r.status + ')';
      } catch { el.textContent = 'Network error'; } }
    $('#us').textContent = 'Done. The dashboard updates after the pipeline finishes, usually within a few minutes per transcript.';
  };
}

/* ---------- Activity ---------- */
function describe(o) {
  const nm = (k, id) => k === 'project' ? pname(id) : k === 'task' ? (D.T.get(id)?.text || 'a task') : k === 'metric' ? (D.K.get(id)?.name || 'a metric') : 'a milestone';
  if (o.op === 'set') return `Edited ${o.entity} "${nm(o.entity, o.id)}": ${Object.keys(o.fields || {}).join(', ')}`;
  if (o.op === 'create') return `Added ${o.entity} "${(o.fields || {}).name || (o.fields || {}).text || (o.fields || {}).title || ''}"`;
  if (o.op === 'delete') return `${o.entity === 'project' ? (o.hard ? 'Deleted' : 'Archived') : 'Deleted'} ${o.entity} "${o.name || nm(o.entity, o.id)}"`;
  if (o.op === 'restore') return `Restored project "${o.name || o.id}"`;
  if (o.op === 'unset') return `Reverted ${(o.fields || []).join(', ')} on ${o.entity} "${nm(o.entity, o.id)}"`;
  if (o.op === 'merge') return `Merged project ${o.from} into "${pname(o.into)}"`;
  if (o.op === 'decision') return `${{ approve: 'Approved', reject: 'Rejected', revert: 'Reverted' }[o.action] || o.action} an agent decision`;
  if (o.op === 'settings') return `Changed settings: ${Object.keys(o.fields || {}).join(', ')}`;
  if (o.op === 'run_agent') return 'Asked the agent to run';
  return o.op;
}
function activity() {
  const errs = [...D.op_errors.map(e => `${e.file}: ${e.error}`), ...D.op_failures.map(e => `${e.op_file}: ${e.op} ${e.id || ''} ${e.error || 'did not apply (target missing or value invalid)'}`)];
  return `<h2 class="page">Activity</h2><p class="lede">Every saved batch of edits, newest first. Each is also a commit in the data repo's ops folder.</p>
  ${Q.length ? `<div class="notice">${Q.length} unsaved change(s) in this tab: ${Q.map(describe).map(esc).join('; ')}</div>` : ''}
  ${errs.length ? `<div class="notice late">Some edits could not be applied: ${errs.slice(-10).map(esc).join('<br>')}</div>` : ''}
  ${D.ops_log.length ? `<ul class="plain">${[...D.ops_log].reverse().map(f => `<li><b>${esc(f.by)}</b> <span class="small mute">${esc((f.at || '').replace('T', ' ').slice(0, 16))} UTC</span><div class="small">${f.ops.map(describe).map(esc).join('<br>')}</div></li>`).join('')}</ul>` : '<p class="empty">No edits saved yet.</p>'}`;
}

/* ---------- Settings ---------- */
function settings() {
  const F = D.settings.features;
  return `<h2 class="page">Settings</h2>
  <div class="cols"><div class="panel"><h3 class="sec" style="margin-top:0">You</h3><div class="form">
   ${A.me?.name ? `<p class="wide">Signed in as <b>${esc(A.me.name)}</b> (${esc(A.me.email)}). Your edits are recorded under this name.</p>` : `<label class="wide">Your name (shown in the activity log)<input id="who" value="${esc(who())}" autocomplete="name"></label>`}<p id="whomsg" class="err small"></p>
   <label class="wide">GitHub token<input id="tk" type="password" autocomplete="off" value="${esc(token())}"></label><p id="tkmsg" class="err small"></p></div>
   <p class="small mute">A fine-grained token that can only access ${esc(A.DATA_REPO)}, with Contents read and write. It stays in this browser tab and is cleared when you sign out or close the tab. Anyone holding it can read the raw transcripts, so give tokens only to trusted people.</p>
   <button class="go" data-act="me">Save</button> <span id="mesaved" class="small mute" role="status"></span></div>
  <div class="panel"><h3 class="sec" style="margin-top:0">Planning features <span class="mute">shared with everyone</span></h3>
   <p class="small">Keep these off for a simple list of tasks with owners, due dates and dependencies.</p>
   <label style="display:block;margin:8px 0"><input type="checkbox" data-act="feat" data-k="agile"${F.agile ? ' checked' : ''}> <b>Agile</b>: story points, sprints and a drag-and-drop board</label>
   <label style="display:block;margin:8px 0"><input type="checkbox" data-act="feat" data-k="waterfall"${F.waterfall ? ' checked' : ''}> <b>Waterfall</b>: phases, start dates, day estimates, a Gantt timeline and the critical path</label>
   <h3 class="sec">Dates from meetings and the agent</h3>
   <label class="small">Add <input type="number" min="0" max="30" step="1" data-act="buffer" value="${esc(D.settings.date_buffer_days ?? 3)}" style="width:64px" aria-label="Extra days"> extra days to each new due date and milestone date that comes from a meeting or the agent. Dates that land on a weekend move to Monday. Dates you type yourself are never changed, and existing dates stay as they are.</label>
   <label style="display:block;margin-top:14px" class="small mute">Organisation name<input data-act="org" value="${esc(D.settings.org)}" style="display:block;width:100%"></label>
   <p class="small mute">Feature and agent settings are saved like any other edit, with Save and publish.</p></div></div>`;
}

/* ---------- event handling ---------- */
function parse(el) {
  const v = el.type === 'checkbox' ? el.checked : el.value, t = el.dataset.t;
  if (t === 'bool') return v;
  if (t === 'date') return v || null;
  if (t === 'num' || t === 'int') return v === '' ? null : t === 'int' ? parseInt(v, 10) : +v;
  if (t === 'lines') return v.split('\n').map(s => s.trim()).filter(Boolean);
  if (t === 'deps') { const p = D.P.get(el.dataset.p), self = D.T.get(el.dataset.id), nums = v.split(/[^\d]+/).filter(Boolean).map(Number);
    const ids = nums.map(n => p.tasks.find(t => t.n === n)).filter(t => t && t !== self).map(t => t.id);
    return [...new Set([...self.depends_on.filter(id => D.T.get(id)?._p !== p.id), ...ids])]; }
  if (t === 'req') return v.trim() || undefined;
  if (el.dataset.f === 'health') return v || null;
  return v.trim() || null;
}
function onChange(e) {
  const el = e.target, ds = el.dataset;
  if (ds.f && ds.e) { const v = parse(el); if (v === undefined) { el.value = find(ds.e, ds.id)?.[ds.f] ?? ''; return; }
    const o = { op: 'set', entity: ds.e, id: ds.id, fields: { [ds.f]: v } }; if (ds.p) o.project = ds.p;
    const structural = ['depends_on', 'archived', 'status', 'workstream', 'priority', 'health'].includes(ds.f) || ds.e === 'metric' && ds.f === 'name';
    return queue(o, structural); }
  if (el.dataset.team !== undefined) { const p = D.P.get(sel), team = $$('#team tr').slice(1).map(r => ({ name: r.querySelector('[data-team=name]').value.trim(), role: r.querySelector('[data-team=role]').value.trim() })).filter(t => t.name);
    return queue({ op: 'set', entity: 'project', id: p.id, fields: { team } }, el.dataset.team === 'name'); }
  if (ds.ml !== undefined || ds.mlhow !== undefined) { const p = D.P.get(sel), metrics = D.metrics.filter(m => $(`[data-ml="${CSS.escape(m.id)}"]`).checked || (ds.mlhow === m.id && el.value.trim())).map(m => ({ metric: m.id, how: $(`[data-mlhow="${CSS.escape(m.id)}"]`).value.trim() }));
    return queue({ op: 'set', entity: 'project', id: p.id, fields: { metrics } }, ds.ml !== undefined); }
  if (ds.pd !== undefined) { const p = D.P.get(sel); return queue({ op: 'set', entity: 'project', id: p.id, fields: { depends_on: $$('[data-pd]').filter(x => x.checked).map(x => x.dataset.pd) } }); }
  const act = ds.act;
  if (act === 'arch') { showArch = el.checked; draw(); }
  if (act === 'sprintF') { sprintF = el.value; draw(); }
  if (act === 'cfp') { cf.p = el.value; draw(); } if (act === 'cfk') { cf.k = el.value; draw(); }
  if (act === 'minconf') queue({ op: 'settings', fields: { auto_min_confidence: Math.min(100, Math.max(0, +el.value || 0)) / 100 } }, false);
  if (act === 'feat') queue({ op: 'settings', fields: { features: { [ds.k]: el.checked } } });
  if (act === 'buffer' && el.value !== '') queue({ op: 'settings', fields: { date_buffer_days: Math.min(30, Math.max(0, parseInt(el.value, 10) || 0)) } }, false);
  if (act === 'org' && el.value.trim()) queue({ op: 'settings', fields: { org: el.value.trim() } }, false);
}
function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return; const ds = b.dataset;
  switch (ds.act) {
    case 'wview': wview = ds.v; draw(); break;
    case 'delproj': { const p = D.P.get(ds.id);
      if (confirm(`Delete "${p.name}" for everyone?\n\nIts tasks, milestones and links are removed from the dashboard, and later meetings that mention it will not bring it back. You can restore it from "Deleted projects" in the sidebar. To hide it but keep it, use Archived instead.`)) {
        queue({ op: 'delete', entity: 'project', id: p.id, hard: true, name: p.name }); sel = null; location.hash = 'work'; } break; }
    case 'restore': { const x = D.deleted.find(d => d.id === ds.id); queue({ op: 'restore', entity: 'project', id: ds.id, name: x?.name }); break; }
    case 'del': if (confirm(`Delete this ${ds.e}?`)) queue({ op: 'delete', entity: ds.e, id: ds.id }); break;
    case 'unset': queue({ op: 'unset', entity: ds.e, id: ds.id, fields: ds.f.split(',').filter(Boolean) }); break;
    case 'team-del': { const p = D.P.get(sel); queue({ op: 'set', entity: 'project', id: p.id, fields: { team: p.team.filter((_, i) => i !== +ds.i) } }); break; }
    case 'merge': { const to = $('#mergeTo').value; if (!to) return; if (confirm(`Merge "${pname(ds.id)}" into "${pname(to)}"? Its tasks, people and milestones move across, and future meetings that mention it update the merged project.`)) { queue({ op: 'merge', entity: 'project', from: ds.id, into: to }); sel = to; location.hash = 'work/' + to; } break; }
    case 'dec': queue({ op: 'decision', id: ds.id, action: ds.a }); break;
    case 'bulk': queue(D.proposed.filter(d => d.confidence >= .9 && (!cf.p || d.project === cf.p) && (!cf.k || d.kind === cf.k)).map(d => ({ op: 'decision', id: d.id, action: 'approve' }))); break;
    case 'ovr': $('#ovr-' + CSS.escape(ds.id)).hidden = false; $('#ovv-' + CSS.escape(ds.id)).focus(); break;
    case 'ovr-go': { const d = D.decisions.find(x => x.id === ds.id), [k, f] = KF[d.kind], raw = $('#ovv-' + CSS.escape(d.id)).value;
      const v = f === 'priority' ? (raw ? +raw : null) : f === 'due' ? (raw || null) : (raw.trim() || null);
      const o = d.task ? { op: 'set', entity: 'task', id: d.task, project: d.project, fields: { [f]: v } } : { op: 'set', entity: 'project', id: d.project, fields: { [f]: v } };
      queue([{ op: 'decision', id: d.id, action: d.state === 'proposed' ? 'reject' : 'revert', note: 'overridden' }, o]); break; }
    case 'preset': queue({ op: 'settings', fields: PRESETS[ds.v].s }); break;
    case 'auto': queue({ op: 'settings', fields: { autonomy: { [ds.k]: ds.v } } }); break;
    case 'run': queue({ op: 'run_agent' }); save(); break;
    case 'me': if ($('#who')) localStorage.setItem('aurora.who', $('#who').value.trim()); sessionStorage.setItem('aurora.tk', $('#tk').value.trim()); $('#mesaved').textContent = 'Saved.'; $('#tkmsg').textContent = ''; $('#whomsg').textContent = ''; break;
  }
}
function onSubmit(e) {
  e.preventDefault(); const f = e.target, v = n => f.elements[n]?.value.trim();
  if (f.id === 'np') { const id = rid(); queue({ op: 'create', entity: 'project', id, fields: { name: v('n') } }); sel = id; location.hash = 'work/' + id; return; }
  const kind = f.dataset.form;
  if (kind === 'task') queue({ op: 'create', entity: 'task', id: rid(), project: f.dataset.p, fields: { text: v('t'), workstream: v('w') || null, assignee: v('a') || null, due: v('d') || null } });
  if (kind === 'ms') queue({ op: 'create', entity: 'milestone', id: rid(), project: f.dataset.p, fields: { title: v('t'), date: v('d') || null } });
  if (kind === 'metric') queue({ op: 'create', entity: 'metric', id: rid(), fields: { name: v('n'), unit: v('u') || '', current: v('c') === '' ? null : +v('c'), target: v('t') === '' ? null : +v('t') } });
  setTimeout(() => $(`form[data-form="${kind}"] input`)?.focus(), 0);
}
})();
