/* Leadership interface (index.html): read-only views built to run the all-hands.
   V2.3: the Overview has four layouts to try (Frames, Priority stack, Briefing, Outcome map), chosen with the switch at the
   top and remembered in this browser; project pages lead with the work and the "needed by" links; meetings and M badges
   open the transcript; People shows capacity. */
'use strict';
(() => {
const { $, $$, esc } = A;
let D, q = '', hf = '', kf = '', sort = 'health';
let layout = localStorage.getItem('aurora.layout') || 'frames';
const LAYOUTS = [['frames', 'Frames', 'One frame per project, bordered by health, people and next date inside.'], ['stack', 'Priority stack', 'Every project ranked top to bottom with staffing, risk and next date in one dense table.'],
  ['brief', 'Briefing', 'Reads like a one-page brief: priorities, staffing, risks, open concerns, what is next.'], ['outcomes', 'Outcome map', 'Projects grouped under the metric they move (or by work type), so bets sit next to outcomes.']];
const ORDER = { red: 0, amber: 1, green: 2, paused: 3, done: 4 };
const ROUTES = [['overview', 'Overview'], ['projects', 'Projects'], ['metrics', 'Metrics'], ['people', 'People'], ['roadmap', 'Roadmap']];

A.boot(d => { D = d; window.addEventListener('hashchange', draw); draw(); });

function nav(cur) {
  $('#nav').innerHTML = ROUTES.map(([k, v]) => `<a href="#${k}"${cur === k ? ' aria-current="page"' : ''}>${v}</a>`).join('') +
    `<button id="present">Present</button><a class="switch" href="manage.html">Workbench</a><button id="so">Sign out</button>`;
  $('#so').onclick = A.signOut; $('#present').onclick = present;
}
function draw() {
  const h = location.hash.slice(1) || 'overview', [r, id] = h.split('/');
  nav(r === 'p' ? 'projects' : r);
  const app = $('#app');
  app.innerHTML = r === 'p' ? project(id) : ({ overview, projects, metrics, people, roadmap }[r] || overview)();
  if (r === 'projects') bindProjects();
  if (r === 'overview' || r === 'metrics') $$('[data-m]').forEach(b => b.onclick = () => { location.hash = 'metrics'; });
  $$('[data-layout]').forEach(b => b.onclick = () => { layout = b.dataset.layout; localStorage.setItem('aurora.layout', layout); draw(); });
  $$('[data-ask]').forEach(b => b.onclick = () => { const [kind, id] = b.dataset.ask.split(':'); document.dispatchEvent(new CustomEvent('aurora:ask', { detail: { kind, id } })); });
  window.scrollTo(0, 0);
}
const live = () => D.active.filter(p => p.status !== 'completed');
const byHealth = ps => [...ps].sort((a, b) => ORDER[a.healthNow] - ORDER[b.healthNow] || a.name.localeCompare(b.name));
const counts = ps => ps.reduce((c, p) => (c[p.healthNow] = (c[p.healthNow] || 0) + 1, c), {});
const plink = id => { const p = D.P.get(id) || D.P.get(D.alias?.[id]); return p ? `<a href="#p/${esc(p.id)}">${esc(p.name)}</a>` : ''; };

/* ---------- events ---------- */
const FIELD = { status: 'status', owner: 'owner', assignee: 'owner', due: 'due date', date: 'date', done: 'done', current: 'value', target: 'target', archived: 'archived' };
const val = (f, v) => v == null || v === '' ? 'none' : f === 'status' ? (A.ST[v] || A.TS[v] || v) : (f === 'due' || f === 'date') ? A.fmtDate(v) : f === 'done' ? (v ? 'done' : 'not done') : String(v);
function evText(e) {
  const kind = { p: 'Project', t: 'Task', m: 'Milestone', k: 'Metric' }[e.key[0]];
  if (e.type === 'added') return `${kind} added: ${esc(e.label)}`;
  if (e.type === 'removed') return `${kind} removed: ${esc(e.label)}`;
  return `${esc(e.label)}: ${esc(FIELD[e.field] || e.field)} ${esc(val(e.field, e.from))} → <b>${esc(val(e.field, e.to))}</b>`;
}
const isWin = e => e.type === 'changed' && ((e.field === 'status' && (e.to === 'done' || e.to === 'completed')) || (e.field === 'done' && e.to === true));
function winsSince(since) {
  const ev = D.history.filter(e => e.at >= since && isWin(e)), keys = new Set(ev.map(e => e.key));
  D.projects.forEach(p => p.tasks.forEach(t => { if (t.status === 'done' && (t.seen || '') >= since && !keys.has('t:' + t.id)) ev.push({ at: t.seen, key: 't:' + t.id, p: p.id, label: t.text, type: 'changed', field: 'status', to: 'done' }); }));
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}
function upcoming(days) {
  const t0 = A.today(), end = A.addDays(t0, days), r = [];
  D.active.forEach(p => {
    p.milestones.filter(m => !m.done && m.date && m.date >= t0 && m.date <= end).forEach(m => r.push({ d: m.date, k: 'Milestone', x: m.title, p, w: p.owner }));
    p.open.filter(t => t.due && t.due >= t0 && t.due <= end).forEach(t => r.push({ d: t.due, k: 'Task', x: t.text, p, w: t.assignee }));
  });
  return r.sort((a, b) => a.d.localeCompare(b.d) || (a.k === 'Milestone' ? -1 : 1));
}

/* ---------- overview: four layouts to compare ---------- */
const PRI = p => p.priority ? `<span class="pri p${p.priority}">P${p.priority}</span>` : '';
const prank = p => (p.priority || 5) * 10 + ORDER[p.healthNow];
const byPriority = ps => [...ps].sort((a, b) => prank(a) - prank(b) || a.name.localeCompare(b.name));
const concern = p => p.reasons[0] || p.staffNote || (p.risks[0] ? 'Risk: ' + p.risks[0] : '') || '';
const teamLine = p => { const t = p.team.slice(0, 6); return t.length ? `<span class="who">${t.map(x => `<i title="${esc(x.name)}${x.role ? ', ' + esc(x.role) : ''}${x.alloc != null ? ', ' + x.alloc + '%' : ''}" class="${p.starvedBy.includes(x.name) ? 'over' : ''}">${esc(A.initials(x.name))}</i>`).join('')}${p.team.length > 6 ? `<i>+${p.team.length - 6}</i>` : ''}</span>` : '<span class="mute small">No team recorded</span>'; };
function splitLine() {
  const S = D.split, pct = k => S.total ? Math.round(S[k].alloc / S.total * 100) : null, tgt = D.settings.ops_target;
  if (!S.ops.n && !S.innovation.n) return '';
  const effort = S.total ? ` · staffed effort ${pct('ops')}% operational, ${pct('innovation')}% innovation${S.none.alloc ? `, ${pct('none')}% unclassified` : ''}${tgt != null ? ` (target ${tgt}/${100 - tgt})` : ''}` : '';
  return `<p class="small mute">Work type: ${S.ops.n} operational, ${S.innovation.n} innovation${S.none.n ? `, ${S.none.n} unclassified` : ''}${effort}.</p>`;
}
function overview() {
  const ps = byHealth(live()), c = counts(ps);
  const head = ps.length ? `${ps.length} active project${ps.length === 1 ? '' : 's'}: ${c.green || 0} on track, ${c.amber || 0} at risk, ${c.red || 0} off track.` : 'No active projects yet.';
  const agentN = D.decisions.filter(d => d.state === 'applied' || d.state === 'approved').length, cur = LAYOUTS.find(l => l[0] === layout) || LAYOUTS[0];
  return `<div class="ovhead"><div><h2 class="page">${esc(D.settings.org)} portfolio</h2><p class="lede" style="margin:0">Updated ${esc(A.fmtDate(D.generated.slice(0, 10)))} from ${D.meetings.length} meeting${D.meetings.length === 1 ? '' : 's'}, ${D.ops_applied.length} saved edit${D.ops_applied.length === 1 ? '' : 's'} and ${agentN} agent change${agentN === 1 ? '' : 's'}.</p></div>
   <div class="layouts" role="group" aria-label="Overview layout">${LAYOUTS.map(([k, v, t]) => `<button type="button" data-layout="${k}" aria-pressed="${layout === k}" title="${esc(t)}">${v}</button>`).join('')}</div></div>
  <p class="small mute" style="margin:-8px 0 14px">Four layouts to try. ${esc(cur[2])} Use <b>Give feedback</b> (bottom left) to say what works and what does not.</p>
  <p class="headline">${esc(head)}</p>
  ${({ frames: ovFrames, stack: ovStack, brief: ovBrief, outcomes: ovOutcomes }[layout] || ovFrames)(ps, c)}`;
}
const legend = c => `<div class="legend">${['red', 'amber', 'green', 'paused'].filter(h => c[h]).map(h => `<span class="pill h-${h}"><i></i>${A.HEALTH[h]}<b class="num">&nbsp;${c[h]}</b></span>`).join('')}<span class="small mute">P1 to P4 is priority. Initials are the people on it; red initials mean that person is over capacity and this project is below their line.</span></div>`;

/* A: Frames. A grid of project frames bordered by health. */
function ovFrames(ps, c) {
  const L = byPriority(ps);
  return `${legend(c)}${splitLine()}
  <div class="frames">${L.map(p => `<a class="frame h-${p.healthNow}" href="#p/${esc(p.id)}"><header>${PRI(p)}<h4>${esc(p.name)}</h4>${A.kindChip(p)}</header>
    <div class="row">${A.pill(p.healthNow)} <span class="small mute">${esc(A.ST[p.status])}</span></div>
    <div class="row small"><b>${esc(p.owner || 'No owner')}</b> ${teamLine(p)}</div>
    <div class="row small">${A.progress(p.progress)}${p.done}/${p.tasks.length}${p.overdue ? ` <span class="late">${p.overdue} overdue</span>` : ''}${p.nextMilestone ? ` · next ${esc(p.nextMilestone.title)} ${esc(A.fmtDate(p.nextMilestone.date))}` : ''}</div>
    ${concern(p) ? `<div class="row small concern">${esc(concern(p))}</div>` : ''}</a>`).join('') || '<p class="empty">No active projects.</p>'}</div>
  <div class="cols" style="margin-top:22px"><section><h3 class="sec">Company metrics</h3>${metricCards(D.metrics.slice(0, 4))}</section><section><h3 class="sec">Next 30 days</h3>${upcomingList(10)}</section></div>`;
}
/* B: Priority stack. One dense ranked table. */
function ovStack(ps, c) {
  const L = byPriority(ps);
  return `${legend(c)}${splitLine()}
  <div class="scroll"><table class="t stack"><tr><th>#</th><th>Project</th><th>Health</th><th>Type</th><th>Owner</th><th>People</th><th>Work</th><th>Next date</th><th>Top concern</th></tr>
  ${L.map((p, i) => { const nx = [p.nextMilestone && { d: p.nextMilestone.date, x: p.nextMilestone.title }, ...p.open.filter(t => t.due && t.due >= A.today()).map(t => ({ d: t.due, x: t.text }))].filter(Boolean).sort((a, b) => a.d.localeCompare(b.d))[0];
    return `<tr class="h-${p.healthNow}"><td class="num mute">${i + 1} ${PRI(p)}</td><td><a href="#p/${esc(p.id)}"><b>${esc(p.name)}</b></a></td><td>${A.pill(p.healthNow)}</td><td>${A.kindChip(p) || '<span class="mute">–</span>'}</td><td>${A.who(p.owner)}</td><td>${teamLine(p)}</td><td class="small">${p.open.length} open${p.overdue ? `, <span class="late">${p.overdue} late</span>` : ''}${p.blockedTasks ? `, ${p.blockedTasks} waiting` : ''}</td><td class="small">${nx ? `${esc(A.fmtDate(nx.d))} <span class="mute">${esc(nx.x.slice(0, 40))}</span>` : '<span class="mute">–</span>'}</td><td class="small">${esc(concern(p))}</td></tr>`; }).join('')}</table></div>
  <p class="small mute">Ranked by priority, then health. Projects with no priority sink to the bottom; set priorities in the Workbench.</p>
  <div class="cols"><section><h3 class="sec">Over capacity</h3>${capacityList()}</section><section><h3 class="sec">Next 30 days</h3>${upcomingList(10)}</section></div>`;
}
/* C: Briefing. Prose-first, the way a chief of staff would brief. */
function ovBrief(ps, c) {
  const top = byPriority(ps).filter(p => p.priority && p.priority <= 2), noPri = ps.filter(p => !p.priority);
  const risks = ps.flatMap(p => p.risks.slice(0, 2).map(r => ({ p, r }))).slice(0, 10), late = D.alerts.filter(a => ['Late milestone', 'Overdue'].includes(a.type)).slice(0, 10);
  const stale = ps.filter(p => p.stale), unowned = ps.filter(p => !p.owner), decisions = D.meetings.slice(0, 4).flatMap(m => (m.decisions || []).slice(0, 4).map(d => ({ m, d })));
  return `${legend(c)}${splitLine()}<div class="brief">
  <section><h3 class="sec">Priorities</h3>${top.length ? `<ol>${top.map(p => `<li>${PRI(p)} <a href="#p/${esc(p.id)}">${esc(p.name)}</a> ${A.pill(p.healthNow)} <span class="small mute">${esc(p.owner || 'no owner')}${concern(p) ? ' · ' + esc(concern(p)) : ''}</span></li>`).join('')}</ol>` : '<p class="empty">No project is marked P1 or P2 yet. Set priorities in the Workbench so the brief can lead with them.</p>'}${noPri.length ? `<p class="small mute">${noPri.length} project${noPri.length === 1 ? ' has' : 's have'} no priority: ${noPri.slice(0, 8).map(p => plink(p.id)).join(', ')}${noPri.length > 8 ? '…' : ''}.</p>` : ''}</section>
  <section><h3 class="sec">Staffing</h3>${capacityList()}${unowned.length ? `<p class="small">No owner: ${unowned.map(p => plink(p.id)).join(', ')}.</p>` : ''}</section>
  <section><h3 class="sec">Risks and late work</h3>${late.length || risks.length ? `<ul class="plain">${late.map(a => `<li><span class="late">${esc(a.type)}</span> ${esc(a.text)} <span class="small mute">${plink(a.p.id)}</span></li>`).join('')}${risks.map(({ p, r }) => `<li>${esc(r)} <span class="small mute">${plink(p.id)}</span></li>`).join('')}</ul>` : '<p class="empty">No risks or late work recorded.</p>'}</section>
  <section><h3 class="sec">Open concerns from discussions</h3>${stale.length ? `<p class="small">Not discussed for 30 days: ${stale.map(p => plink(p.id)).join(', ')}.</p>` : ''}${decisions.length ? `<ul class="plain">${decisions.map(({ m, d }) => `<li>${esc(d)} <span class="small mute"><a href="#" data-meet="${esc(m.id)}" data-q="${esc(d.slice(0, 60))}">${esc(A.fmtDate(m.date))}</a></span></li>`).join('')}</ul>` : '<p class="empty">Decisions recorded in meetings appear here.</p>'}</section>
  <section><h3 class="sec">Next 30 days</h3>${upcomingList(12)}</section>
  <section><h3 class="sec">Delivered in the last 30 days</h3>${winsList()}</section></div>`;
}
/* D: Outcome map. Projects under the metric they move; without metrics, under their work type. */
function ovOutcomes(ps, c) {
  const mini = p => `<a class="mini h-${p.healthNow}" href="#p/${esc(p.id)}">${PRI(p)}<b>${esc(p.name)}</b><span class="small">${A.pill(p.healthNow)} ${esc(p.owner || 'no owner')}</span>${concern(p) ? `<span class="small concern">${esc(concern(p).slice(0, 70))}</span>` : ''}</a>`;
  let lanes;
  if (D.metrics.length) {
    lanes = D.metrics.map(m => ({ title: m.name, sub: `${A.fmtNum(m.current, m.unit)} of ${A.fmtNum(m.target, m.unit)}`, cls: 'metric', ps: byPriority(ps.filter(p => p.metrics.some(l => l.metric === m.id))) }));
    lanes.push({ title: 'Not tied to a metric', sub: 'bets without a stated outcome', ps: byPriority(ps.filter(p => !p.metrics.some(l => D.K.has(l.metric)))) });
  } else {
    lanes = [{ title: 'Operational', sub: 'sustains the business and paying clients', ps: byPriority(ps.filter(p => p.kind === 'ops')) }, { title: 'Innovation', sub: 'bets on a future result', ps: byPriority(ps.filter(p => p.kind === 'innovation')) }, { title: 'Unclassified', sub: 'set the work type in the Workbench', ps: byPriority(ps.filter(p => !p.kind)) }];
  }
  return `${legend(c)}${splitLine()}<p class="small mute">${D.metrics.length ? 'Each column is a company metric; the projects under it are the bets that move it, best priority first.' : 'No company metrics are loaded yet, so columns are work type. Once metrics exist, each column becomes a metric with its bets under it.'}</p>
  <div class="lanes">${lanes.map(l => `<section class="lane ${l.cls || ''}"><h4>${esc(l.title)} <span class="small mute">${l.ps.length}</span></h4><p class="small mute">${esc(l.sub)}</p>${l.ps.map(mini).join('') || '<p class="empty small">Nothing here.</p>'}</section>`).join('')}</div>`;
}
const upcomingList = n => { const up = upcoming(30); return up.length ? `<ul class="plain">${up.slice(0, n).map(x => `<li><span class="num">${esc(A.fmtDate(x.d))}</span> · ${x.k === 'Milestone' ? '<b>' + esc(x.x) + '</b>' : esc(x.x)}<div class="small mute">${plink(x.p.id)}${x.w ? ' · ' + esc(x.w) : ''}</div></li>`).join('')}</ul>` : '<p class="empty">No dated milestones or tasks in the next 30 days.</p>'; };
const winsList = () => { const wins = winsSince(A.addDays(A.today(), -30)).slice(0, 10); return wins.length ? `<ul class="plain">${wins.map(e => `<li>${esc(e.label)}<div class="small mute">${plink(e.p)} · ${esc(A.fmtDate(e.at))}</div></li>`).join('')}</ul>` : '<p class="empty">No completed work recorded yet.</p>'; };
function capacityList() {
  const over = D.people.filter(x => x.over), known = D.people.filter(x => x.plan.length);
  if (!known.length) return '<p class="empty">No staffing percentages yet. In the Workbench, give each person on a project a share of their time, and set people\'s capacity in Settings.</p>';
  return over.length ? `<ul class="plain">${over.map(x => `<li><b>${esc(x.name)}</b> is at <span class="late">${x.alloc}%</span> of ${x.capacity}%<div class="small mute">Below their line: ${x.plan.filter(r => r.below).map(r => plink(r.p.id)).join(', ')}</div></li>`).join('')}</ul>` : `<p class="small">Nobody is over capacity. <a href="#people">See everyone's load.</a></p>`;
}
function metricCards(ms) {
  if (!D.metrics.length) return '<p class="empty">No company metrics yet. Add them in the Workbench under Metrics, then tie each project to the metrics it moves.</p>';
  return `<div class="cards">${ms.map(m => { const pc = A.metricPct(m), n = D.metricLinks.get(m.id).length, tr = trend(m);
    return `<div class="mcard"><h4>${esc(m.name)}</h4><div class="big num">${esc(A.fmtNum(m.current, m.unit))}</div>
    <div class="small mute">Target ${esc(A.fmtNum(m.target, m.unit))}${m.period ? ' by ' + esc(m.period) : ''}${m.owner ? ' · ' + esc(m.owner) : ''}</div>
    ${pc == null ? '' : `<div class="gauge" role="img" aria-label="${Math.round(pc * 100)}% of the way to target"><span style="width:${pc * 100}%"></span></div>`}
    ${tr}<div class="small"><a href="#metrics">${n} project${n === 1 ? '' : 's'}</a> move this metric</div></div>`; }).join('')}</div>`;
}
function trend(m) {
  const pts = D.history.filter(e => e.key === 'k:' + m.id && e.field === 'current' && e.to != null).map(e => +e.to);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts), w = 120, h = 26, x = i => i / (pts.length - 1) * w, y = v => h - 2 - (hi === lo ? .5 : (v - lo) / (hi - lo)) * (h - 4);
  return `<svg width="${w}" height="${h}" role="img" aria-label="Recent values"><polyline fill="none" stroke="var(--metric)" stroke-width="2" points="${pts.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/></svg>`;
}

/* ---------- projects ---------- */
function projects() {
  const L = D.active.filter(p => (!hf || p.healthNow === hf) && (!kf || (kf === 'none' ? !p.kind : p.kind === kf)) && (!q || JSON.stringify([p.name, p.owner, p.description, p.team, p.tasks.map(t => [t.text, t.assignee])]).toLowerCase().includes(q.toLowerCase())));
  const S = { health: (a, b) => ORDER[a.healthNow] - ORDER[b.healthNow], name: (a, b) => a.name.localeCompare(b.name), progress: (a, b) => b.progress - a.progress, next: (a, b) => (a.nextMilestone?.date || '9').localeCompare(b.nextMilestone?.date || '9') };
  L.sort((a, b) => S[sort](a, b) || a.name.localeCompare(b.name));
  return `<h2 class="page">Projects</h2><p class="lede">Every active project, its health, owner and progress. Select one for people, work breakdown, backlog and timeline.</p>
  <div class="bar"><input type="search" id="q" placeholder="Search projects, people or tasks" value="${esc(q)}" aria-label="Search">
  <select id="hf" aria-label="Health"><option value="">All health</option>${Object.entries(A.HEALTH).map(([k, v]) => `<option value="${k}"${hf === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
  <select id="kf" aria-label="Work type"><option value="">All work types</option>${[['ops', 'Operational'], ['innovation', 'Innovation'], ['none', 'Unclassified']].map(([k, v]) => `<option value="${k}"${kf === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
  <select id="sort" aria-label="Sort">${[['health', 'Worst health first'], ['next', 'Next milestone'], ['progress', 'Most complete'], ['name', 'Name']].map(([k, v]) => `<option value="${k}"${sort === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="cards">${L.map(card).join('') || '<p class="empty">No projects match. Clear the search or filter.</p>'}</div>`;
}
const card = p => `<a class="card h-${p.healthNow}" href="#p/${esc(p.id)}"><h4>${PRI(p)} ${esc(p.name)}</h4>${A.pill(p.healthNow)} ${A.status(p.status)} ${A.kindChip(p)}
  <div class="meta"><span>Owner ${A.who(p.owner)}</span><span>${A.progress(p.progress)}${p.done}/${p.tasks.length} tasks</span>${p.nextMilestone ? `<span>Next: ${esc(p.nextMilestone.title)}, ${esc(A.fmtDate(p.nextMilestone.date))}</span>` : ''}</div>
  ${p.metrics.length ? `<div class="chips" style="margin-top:8px">${p.metrics.map(l => D.K.get(l.metric)).filter(Boolean).map(m => `<span class="chip metric">${esc(m.name)}</span>`).join('')}</div>` : ''}</a>`;
function bindProjects() {
  const i = $('#q'); i.oninput = e => { q = e.target.value; const pos = e.target.selectionStart; draw(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#hf').onchange = e => { hf = e.target.value; draw(); }; $('#kf').onchange = e => { kf = e.target.value; draw(); }; $('#sort').onchange = e => { sort = e.target.value; draw(); };
}

function project(id) {
  const p = D.P.get(id) || D.P.get(D.alias?.[id]);
  if (!p) return '<p class="empty">This project no longer exists. It may have been merged or archived. <a href="#projects">Back to projects</a></p>';
  const F = D.settings.features, ws = groupWS(p.tasks), backlog = [...p.open].sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.level - b.level || (a.due || '9').localeCompare(b.due || '9'));
  const roles = (D.people.filter(x => x.roles.has(p.id)));
  const meetings = p.meetings.map(m => D.MT.get(m)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  const ev = D.history.filter(e => e.p === p.id).slice(-12).reverse();
  const deps = p.depends_on.map(plink).filter(Boolean), dependents = D.active.filter(x => x.depends_on.includes(p.id));
  const tline = t => `${esc(t.text)} <span class="small mute">${esc(t.assignee || 'Unassigned')}${t.due ? ', ' : ''}</span>${t.due ? `<span class="small ${t.overdue ? 'late' : 'mute'}">${esc(A.fmtDate(t.due))}</span>` : ''}${t.status === 'blocked' ? ' <span class="small late">blocked</span>' : ''}${F.agile && t.points ? ` <span class="chip">${esc(t.points)} pts</span>` : ''} ${A.srcMark(t, 'text')}`;
  return `<p class="small"><a href="#projects">Projects</a></p>
  <div class="ovhead"><div><h2 class="page">${PRI(p)} ${esc(p.name)}</h2>
  <p>${A.pill(p.healthNow)} ${A.status(p.status)} ${A.kindChip(p)} <span class="small mute">Owner</span> <b>${A.who(p.owner)}</b> ${p.health ? '<span class="small mute">· health set by a person</span>' : ''}</p></div>
  <div class="acts">${A.CHAT ? `<button type="button" data-ask="project:${esc(p.id)}">Ask about this project</button>` : ''}<a class="btn" href="manage.html#upload/${esc(p.id)}">Add a transcript</a><a class="btn" href="manage.html#work/${esc(p.id)}">Edit</a></div></div>
  ${p.reasons.length || p.staffNote ? `<div class="notice">${esc([...p.reasons, p.staffNote].filter(Boolean).join('; '))}.</div>` : ''}
  <div class="cols">
   <div class="panel"><dl class="kv">${dependents.length ? `<dt>Needed by</dt><dd><b>${dependents.map(x => plink(x.id)).join(', ')}</b> <span class="small mute">wait on this project</span></dd>` : '<dt>Needed by</dt><dd><span class="mute">No other project waits on this one</span></dd>'}
   ${deps.length ? `<dt>Depends on</dt><dd>${deps.join(', ')}</dd>` : ''}
   <dt>Progress</dt><dd>${A.progress(p.progress, true)} <span class="small mute">${p.done} of ${p.tasks.length} tasks${p.overdue ? `, <span class="late">${p.overdue} overdue</span>` : ''}</span></dd>
   <dt>Next milestone</dt><dd>${p.nextMilestone ? esc(p.nextMilestone.title) + ', ' + esc(A.fmtDate(p.nextMilestone.date)) : '<span class="mute">None scheduled</span>'}</dd>
   ${F.waterfall && p.phase ? `<dt>Phase</dt><dd>${esc(p.phase)}</dd>` : ''}${p.target ? `<dt>Target date</dt><dd>${esc(A.fmtDate(p.target))}</dd>` : ''}
   <dt>Last discussed</dt><dd>${esc(A.fmtDate(p.updated)) || '<span class="mute">Not in a meeting yet</span>'}</dd>${p.sponsor ? `<dt>Sponsor</dt><dd>${esc(p.sponsor)}</dd>` : ''}</dl></div>
   <div class="panel"><h4 style="margin:0 0 8px">Staffing <span class="mute small">who is on it and how much of their time</span></h4>
   ${p.team.length ? `<table class="t"><tr><th>Person</th><th>Role</th><th>Share of their time</th><th>Their total load</th></tr>${p.team.map(t => { const st = p.staff.find(s => s.name === t.name); return `<tr><td>${esc(t.name)}${p.owner && A.pkey(p.owner) === A.pkey(t.name) ? ' <span class="small mute">(owner)</span>' : ''}</td><td>${esc(t.role || '')}</td><td>${t.alloc != null ? t.alloc + '%' : '<span class="mute">not set</span>'}</td><td class="small">${st ? `<span class="${st.total > st.capacity ? 'late' : ''}">${st.total}% of ${st.capacity}%</span>${st.below ? ' · <b class="late">this project is below their line</b>' : ''}` : '<span class="mute">–</span>'}</td></tr>`; }).join('')}</table>` : '<p class="empty">No team recorded. Add people and their share of time in the Workbench.</p>'}
   ${p.staffNote ? `<p class="small late" style="margin:8px 0 0">${esc(p.staffNote)}: expect work here to slip unless priorities change.</p>` : ''}</div></div>
  <h3 class="sec">Work breakdown <span class="mute">${ws.length} workstream${ws.length === 1 ? '' : 's'}, ${p.tasks.length} tasks · M badges open the meeting a line came from</span></h3>
  ${p.tasks.length ? ws.map(([w, ts]) => `<details class="ws" open><summary>${esc(w)} <span class="mute small">${ts.filter(t => t.status === 'done').length}/${ts.length} done</span></summary><ul>${ts.map(t => `<li class="${t.status === 'done' ? 'done-t' : ''}">${tline(t)}</li>`).join('')}</ul></details>`).join('') : '<p class="empty">No tasks recorded yet.</p>'}
  <h3 class="sec">Backlog <span class="mute">open work in priority and sequence order</span></h3>
  ${backlog.length ? `<div class="scroll"><table class="t"><tr><th>#</th><th>Task</th><th>Owner</th><th>Due</th><th>Waits on</th>${F.agile ? '<th>Sprint</th><th>Points</th>' : ''}</tr>${backlog.map(t => `<tr><td class="mute">${t.priority ? 'P' + t.priority : ''}</td><td>${esc(t.text)}${t.status === 'blocked' ? ' <span class="small late">blocked</span>' : ''}</td><td>${A.who(t.assignee)}</td><td class="${t.overdue ? 'late' : ''}">${esc(A.fmtDate(t.due))}</td><td class="small">${t.blockers.map(b => esc(b.text)).join('<br>')}</td>${F.agile ? `<td>${esc(t.sprint || '')}</td><td>${esc(t.points ?? '')}</td>` : ''}</tr>`).join('')}</table></div>` : '<p class="empty">No open tasks.</p>'}
  <h3 class="sec">Sequence <span class="mute">what can start now and what waits on what</span></h3>${A.seqGraph(p.tasks)}
  <h3 class="sec">Timeline</h3>${A.gantt(p.tasks.filter(t => t.due || t.start).map(t => ({ label: t.text, sub: t.assignee || '', start: t.start || (t.estimate && t.due ? A.addDays(t.due, -Math.ceil(t.estimate)) : t.due), end: t.due || t.start, cls: (t.crit && F.waterfall ? 'crit ' : '') + (t.status === 'done' ? 'done' : '') })).concat(p.milestones.filter(m => m.date).length ? [{ label: 'Milestones', ms: p.milestones }] : []), { label: 'Project timeline' })}
  <div class="cols">
   <section><h3 class="sec">Risks ${A.srcMark(p, 'risks')}</h3>${list(p.risks)}</section>
   <section><h3 class="sec">Assumptions</h3>${list(p.assumptions)}</section>
   <section><h3 class="sec">Dependencies mentioned</h3>${list(p.dependencies)}</section>
  </div>
  <div class="cols"><div class="panel"><h4 style="margin:0 0 8px">How it moves company metrics</h4>${p.metrics.length ? `<ul class="plain">${p.metrics.map(l => { const m = D.K.get(l.metric); return m ? `<li><span class="chip metric">${esc(m.name)}</span> <span class="small">${esc(A.fmtNum(m.current, m.unit))} of ${esc(A.fmtNum(m.target, m.unit))}</span><div class="small mute">${esc(l.how || 'No explanation recorded')}</div></li>` : ''; }).join('')}</ul>` : `<p class="empty">Not tied to a company metric yet.${p.metrics_mentioned.length ? ' Meetings mentioned: ' + esc(p.metrics_mentioned.join(', ')) + '.' : ''}</p>`}</div>
   <div class="panel"><h4 style="margin:0 0 8px">About ${A.srcMark(p, 'description')}</h4><p class="small">${esc(p.description) || '<span class="mute">No description yet.</span>'}</p>${roles.length ? `<p class="small mute">Also involved through tasks: ${roles.filter(x => !p.team.some(t => A.pkey(t.name) === A.pkey(x.name))).map(x => esc(x.name)).join(', ') || 'nobody else'}.</p>` : ''}</div></div>
  <h3 class="sec">Where this came from <span class="mute">meetings, voice notes and edits behind this page</span></h3>
  <div class="cols"><section><h4 style="margin:0 0 6px">Meetings <span class="small mute">select one to read the transcript</span></h4>${meetings.length ? `<ul class="plain">${meetings.map(m => `<li><a href="#" data-meet="${esc(m.id)}" data-q="${esc(p.name)}"><b>${esc(A.fmtDate(m.date))}</b></a> <span class="small mute">${esc(m.file)}${/voice-note/i.test(m.file) ? ' · voice note' : ''}</span><div class="small">${esc(m.summary)}</div></li>`).join('')}</ul>` : '<p class="empty">Not discussed in an ingested meeting.</p>'}</section>
  <section><h4 style="margin:0 0 6px">Recent changes</h4>${ev.length ? `<ul class="plain">${ev.map(e => `<li>${evText(e)}<div class="small mute">${esc(A.fmtDate(e.at))}${e.src ? ' · ' + esc(A.srcLabel(e.src).toLowerCase()) : ''}${e.src?.startsWith('meeting:') && D.MT.has(e.src.slice(8)) ? ` · <a href="#" data-meet="${esc(e.src.slice(8))}" data-q="${esc(e.label.slice(0, 60))}">open</a>` : ''}</div></li>`).join('')}</ul>` : '<p class="empty">No changes recorded yet.</p>'}</section></div>
  <p class="small mute">Something wrong or missing here? Press <b>Give feedback</b> and say what should change; it is transcribed and applied as an update. <a href="manage.html#work/${esc(p.id)}">Edit this project in the Workbench</a>.</p>`;
}
const list = a => a.length ? `<ul class="plain">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="empty">None recorded.</p>';
function groupWS(ts) { const m = new Map(); ts.forEach(t => { const k = t.workstream || 'General'; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
  return [...m.entries()].sort((a, b) => (a[0] === 'General') - (b[0] === 'General') || a[0].localeCompare(b[0])); }

/* ---------- metrics: each metric, then the bets pointed at it in priority order ---------- */
function metrics() {
  const untied = live().filter(p => !p.metrics.some(l => D.K.has(l.metric)));
  return `<h2 class="page">Company metrics</h2><p class="lede">Each metric, and under it the work pointed at it in priority order. When a metric is not moving, this is where to pick the next bet or drop one.</p>
  ${A.metricMap(D)}
  ${D.metrics.map(m => { const ls = byPriority(D.metricLinks.get(m.id).map(l => l.p)).map(p => ({ p, how: p.metrics.find(l => l.metric === m.id)?.how })), pc = A.metricPct(m);
    return `<h3 class="sec">${esc(m.name)} <span class="mute">${esc(A.fmtNum(m.current, m.unit))} of ${esc(A.fmtNum(m.target, m.unit))}${m.period ? ' by ' + esc(m.period) : ''}${m.owner ? ', owned by ' + esc(m.owner) : ''}</span>${pc == null ? '' : `<span class="gauge" style="width:120px;margin:0"><span style="width:${pc * 100}%"></span></span>`}</h3>
    ${m.description ? `<p class="lede">${esc(m.description)}</p>` : ''}${ls.length ? `<div class="scroll"><table class="t"><tr><th>#</th><th>Bet</th><th>Health</th><th>Owner</th><th>How it moves this metric</th><th>Work</th><th>Top concern</th></tr>${ls.map(({ p, how }, i) => `<tr><td class="num mute">${i + 1} ${PRI(p)}</td><td>${plink(p.id)} ${A.kindChip(p)}</td><td>${A.pill(p.healthNow)}</td><td>${A.who(p.owner)}</td><td class="small">${esc(how || '')}</td><td class="small">${p.open.length} open${p.overdue ? `, <span class="late">${p.overdue} late</span>` : ''} · ${Math.round(p.progress * 100)}%</td><td class="small">${esc(concern(p))}</td></tr>`).join('')}</table></div>` : '<p class="empty">No project is tied to this metric yet. Tie projects to it in the Workbench, on each project\'s page.</p>'}`; }).join('')}
  ${untied.length ? `<h3 class="sec">Not tied to a metric <span class="mute">${untied.length} active project${untied.length === 1 ? '' : 's'} · the question for each: which outcome is it for?</span></h3><div class="chips">${byPriority(untied).map(p => `<a class="chip" href="#p/${esc(p.id)}">${p.priority ? 'P' + p.priority + ' ' : ''}${esc(p.name)}</a>`).join('')}</div>` : ''}`;
}

/* ---------- people: load, capacity and what falls below the line ---------- */
function people() {
  const ps = byHealth(live()), people = D.people.filter(x => x.roles.size), max = Math.max(1, ...people.map(x => x.tasks.length));
  if (!people.length) return '<h2 class="page">People</h2><p class="empty">No people recorded yet.</p>';
  const staffed = people.filter(x => x.plan.length).sort((a, b) => b.alloc / b.capacity - a.alloc / a.capacity);
  return `<h2 class="page">People</h2><p class="lede">Who is on what, how much of their time it takes, and what falls below the line when someone is over capacity. Projects are funded in priority order, so the lowest-priority work is what slips.</p>
  <h3 class="sec">Capacity <span class="mute">allocated share of time against what each person can give</span></h3>
  ${staffed.length ? `<div class="capgrid">${staffed.map(x => `<div class="panel cap ${x.over ? 'over' : ''}"><div class="row"><b>${esc(x.name)}</b><span class="num ${x.over ? 'late' : ''}">${x.alloc}% of ${x.capacity}%</span></div>
    <div class="capbar"><span class="fill" style="width:${Math.min(100, x.alloc / Math.max(1, x.capacity) * 100)}%"></span>${x.over ? `<span class="spill" style="width:${Math.min(100, (x.alloc - x.capacity) / Math.max(1, x.capacity) * 100)}%"></span>` : ''}</div>
    <ol class="plain small">${x.plan.map(r => `<li class="${r.below ? 'below' : ''}">${r.p.priority ? 'P' + r.p.priority + ' ' : ''}${plink(r.p.id)} <span class="num">${r.alloc}%</span>${r.below ? ' <span class="late">below the line</span>' : ''}</li>`).join('')}</ol>${x.unknownLoad > 0 ? `<p class="small mute">Plus ${x.unknownLoad} project${x.unknownLoad === 1 ? '' : 's'} with no share recorded.</p>` : ''}</div>`).join('')}</div>` : '<p class="empty">No staffing percentages yet. In the Workbench, give each person on a project a share of their time; set each person\'s capacity under Settings if it is not 100%.</p>'}
  <h3 class="sec">Who is on what</h3><p class="small mute">Filled cells mark project owners; the bar shows open tasks.</p>
  <div class="scroll"><table class="t matrix"><tr><th>Person</th><th>Open tasks</th>${ps.map(p => `<th class="rot"><div><a href="#p/${esc(p.id)}">${esc(p.name.slice(0, 28))}</a></div></th>`).join('')}</tr>
  ${people.map(x => `<tr><td>${esc(x.name)}</td><td class="num"><span class="load" style="width:${Math.round(x.tasks.length / max * 60)}px"></span>${x.tasks.length}${x.tasks.some(t => t.overdue) ? ` <span class="small late">${x.tasks.filter(t => t.overdue).length} late</span>` : ''}</td>${ps.map(p => { const r = x.roles.get(p.id), al = p.team.find(t => A.pkey(t.name) === A.pkey(x.name))?.alloc; return `<td class="cell">${r ? `<span class="${r === 'Owner' ? 'own' : ''}" title="${esc(x.name)}: ${esc(r)} on ${esc(p.name)}${al != null ? ', ' + al + '% of their time' : ''}">${esc(r)}${al != null ? ' ' + al + '%' : ''}</span>` : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
}

/* ---------- roadmap ---------- */
function roadmap() {
  const ps = byHealth(live());
  return `<h2 class="page">Roadmap</h2><p class="lede">Each bar runs from a project's start (or first mention) to its target date (or latest dated work). Diamonds are milestones; the dashed line is today.</p>
  ${A.gantt(ps.map(p => ({ label: p.name, sub: (A.HEALTH[p.healthNow] + (p.owner ? ', ' + p.owner : '')), start: p.spanStart, end: p.spanEnd, cls: 'h-' + p.healthNow, ms: p.milestones, href: '#p/' + p.id })), { label: 'Portfolio roadmap' })}`;
}

/* ---------- present mode: drives the all-hands ---------- */
function present() {
  const since = localStorage.getItem('aurora.since') || A.addDays(A.today(), -7);
  const slides = buildSlides(since);
  let i = 0;
  const deck = document.createElement('div'); deck.id = 'deck'; deck.setAttribute('role', 'dialog'); deck.setAttribute('aria-label', 'All-hands presentation');
  document.body.append(deck);
  const show = () => {
    deck.innerHTML = `<div class="slide">${slides[i]}</div><div class="ctrl"><span><button id="dx">Exit</button> <label class="small mute">Changes since <input type="date" id="since" value="${esc(since)}"></label></span>
    <span class="num mute">${i + 1} / ${slides.length}</span><span><button id="dp" ${i ? '' : 'disabled'}>Previous</button> <button class="go" id="dn" ${i < slides.length - 1 ? '' : 'disabled'}>Next</button> <button id="fs">Full screen</button></span></div>`;
    $('#dx').onclick = close; $('#dp').onclick = () => go(-1); $('#dn').onclick = () => go(1);
    $('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : deck.requestFullscreen?.();
    $('#since').onchange = e => { localStorage.setItem('aurora.since', e.target.value); close(); present(); };
  };
  const go = d => { i = Math.max(0, Math.min(slides.length - 1, i + d)); show(); };
  const key = e => { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', key); if (document.fullscreenElement) document.exitFullscreen(); deck.remove(); };
  document.addEventListener('keydown', key); show(); $('#dn')?.focus();
}
function buildSlides(since) {
  const ps = byHealth(live()), c = counts(ps), wins = winsSince(since), t0 = A.today();
  const moved = D.history.filter(e => e.at >= since && e.key[0] === 'p' && e.field === 'status');
  const newP = D.history.filter(e => e.at >= since && e.key[0] === 'p' && e.type === 'added');
  const attention = ps.filter(p => p.healthNow === 'red' || p.healthNow === 'amber');
  const up = upcoming(30);
  const S = [];
  S.push(`<div class="kicker">${esc(D.settings.org)} all-hands, ${esc(A.fmtDate(t0))}</div><h2>Where our projects stand</h2>
   <div class="big3"><div class="h-green"><b class="num">${c.green || 0}</b>on track</div><div class="h-amber"><b class="num">${c.amber || 0}</b>at risk</div><div class="h-red"><b class="num">${c.red || 0}</b>off track</div><div><b class="num">${wins.length}</b>items delivered since ${esc(A.fmtDate(since))}</div></div>`);
  if (D.metrics.length) S.push(`<div class="kicker">Company metrics</div><h2>What the work is moving</h2>${metricCards(D.metrics)}`);
  if (D.metrics.length && D.active.some(p => p.metrics.length)) S.push(`<div class="kicker">Company metrics</div><h2>Which projects move which metric</h2>${A.metricMap(D)}`);
  S.push(`<div class="kicker">Portfolio</div><h2>Every active project</h2><div class="strip" style="height:56px">${ps.map(p => `<a class="h-${p.healthNow}" style="flex:1" title="${esc(p.name)}"></a>`).join('')}</div>
   <div class="cols" style="margin-top:3vh">${['red', 'amber', 'green', 'paused'].filter(h => c[h]).map(h => `<div>${A.pill(h)}<ul class="plain">${ps.filter(p => p.healthNow === h).map(p => `<li>${esc(p.name)} <span class="small mute">${esc(p.owner || 'No owner')}, ${Math.round(p.progress * 100)}%</span></li>`).join('')}</ul></div>`).join('')}</div>`);
  S.push(`<div class="kicker">Since ${esc(A.fmtDate(since))}</div><h2>Delivered</h2>${wins.length ? `<ul class="plain">${wins.slice(0, 12).map(e => `<li>${esc(e.label)} <span class="small mute">${esc(D.P.get(e.p)?.name || '')}</span></li>`).join('')}</ul>${wins.length > 12 ? `<p class="mute">and ${wins.length - 12} more</p>` : ''}` : '<p class="mute">Nothing marked done in this period.</p>'}
   ${moved.length || newP.length ? `<h3 class="sec">Status changes</h3><ul class="plain">${newP.map(e => `<li>New project: <b>${esc(e.label)}</b></li>`).join('')}${moved.map(e => `<li>${esc(e.label)}: ${esc(A.ST[e.from] || e.from || 'none')} → <b>${esc(A.ST[e.to] || e.to)}</b></li>`).join('')}</ul>` : ''}`);
  S.push(`<div class="kicker">Decisions and help needed</div><h2>Needs attention</h2>${attention.length ? `<ul class="plain">${attention.map(p => `<li>${A.pill(p.healthNow)} <b>${esc(p.name)}</b> <span class="mute">${esc(p.owner || 'No owner')}</span><div class="small">${esc(p.reasons.join('; ') || 'Marked at risk')}${p.risks.length ? '. Top risk: ' + esc(p.risks[0]) : ''}</div></li>`).join('')}</ul>` : '<p class="mute">Nothing is off track or at risk.</p>'}`);
  S.push(`<div class="kicker">Next 30 days</div><h2>Coming up</h2>${up.length ? `<ul class="plain">${up.slice(0, 12).map(x => `<li><span class="num">${esc(A.fmtDate(x.d))}</span>: ${x.k === 'Milestone' ? '<b>' + esc(x.x) + '</b>' : esc(x.x)} <span class="small mute">${esc(x.p.name)}${x.w ? ', ' + esc(x.w) : ''}</span></li>`).join('')}</ul>` : '<p class="mute">No dated milestones or tasks in the next 30 days.</p>'}`);
  ps.filter(p => p.healthNow !== 'paused').forEach(p => S.push(`<div class="kicker">${A.pill(p.healthNow)} ${esc(A.ST[p.status])}</div><h2>${esc(p.name)}</h2>
   <div class="cols"><div><p>${esc(p.description || '')}</p><dl class="kv"><dt>Owner</dt><dd>${A.who(p.owner)}</dd><dt>Team</dt><dd>${p.team.map(t => esc(t.name) + (t.role ? ` <span class="mute small">(${esc(t.role)})</span>` : '')).join(', ') || '<span class="mute">None recorded</span>'}</dd>
   <dt>Progress</dt><dd>${A.progress(p.progress, true)}</dd><dt>Next milestone</dt><dd>${p.nextMilestone ? esc(p.nextMilestone.title) + ', ' + esc(A.fmtDate(p.nextMilestone.date)) : '<span class="mute">None scheduled</span>'}</dd>
   ${p.metrics.length ? `<dt>Moves</dt><dd>${p.metrics.map(l => D.K.get(l.metric)?.name).filter(Boolean).map(esc).join(', ')}</dd>` : ''}</dl></div>
   <div>${p.reasons.length || p.staffNote ? `<p class="late">${esc([...p.reasons, p.staffNote].filter(Boolean).join('; '))}</p>` : ''}<h3 class="sec">Up next</h3><ul class="plain">${[...p.open].sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 5).map(t => `<li>${esc(t.text)} <span class="small mute">${esc(t.assignee || 'Unassigned')}${t.due ? ', ' + esc(A.fmtDate(t.due)) : ''}</span></li>`).join('') || '<li class="mute">No open tasks</li>'}</ul>
   ${p.risks.length ? `<h3 class="sec">Risks</h3><ul class="plain">${p.risks.slice(0, 3).map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</div></div>`));
  return S;
}
})();
