/* Voice feedback: one button on every page. Records from the microphone, then saves the audio plus a small
   context file (page, view, person, session) to the private aurora-feedback repo. A GitHub Action there
   transcribes it with Groq Whisper and keeps FEEDBACK.md up to date, grouped by person and session.
   The upload token arrives inside the encrypted dashboard data, so only signed-in users can send feedback. */
'use strict';
(() => {
const MAX_MS = 5 * 60 * 1000, MIN_MS = 1500;
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const get = (store, k, make) => { let v = store.getItem(k); if (!v) { v = make(); store.setItem(k, v); } return v; };
const device = get(localStorage, 'aurora.fb.person', () => hex(4));
// signed in with a personal login: group by that person's email; old shared login: group by browser
const person = () => window.A?.me?.name ? window.A.me.email.replace(/[^a-z0-9._-]+/gi, '_') : device;
const myName = () => window.A?.me?.name || localStorage.getItem('aurora.who') || '';
const session = get(sessionStorage, 'aurora.fb.session', () => hex(3));             // one tab visit = one session
const sessionStart = get(sessionStorage, 'aurora.fb.started', () => new Date().toISOString());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const css = `
.fb-btn{position:fixed;left:16px;bottom:16px;z-index:40;display:inline-flex;align-items:center;gap:8px;padding:9px 14px 9px 11px;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 14px var(--font);box-shadow:0 4px 16px rgba(0,0,0,.14);cursor:pointer}
.fb-btn svg{width:18px;height:18px;fill:var(--acc)}
.fb-btn[aria-pressed=true]{background:var(--red);border-color:var(--red);color:#fff}.fb-btn[aria-pressed=true] svg{fill:#fff}
.fb-panel{position:fixed;left:16px;bottom:66px;z-index:41;width:min(340px,calc(100vw - 32px));background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;box-shadow:0 8px 28px rgba(0,0,0,.2);font-size:14px}
.fb-panel h4{margin:0 0 4px;font:600 15px var(--display)}
.fb-panel p{margin:4px 0 10px;color:var(--mute)}
.fb-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fb-time{font-variant-numeric:tabular-nums;font-weight:600}
.fb-meter{flex:1;height:8px;border-radius:4px;background:var(--sunk);overflow:hidden}.fb-meter span{display:block;height:100%;width:0;background:var(--acc);transition:width .08s linear}
.fb-dot{width:10px;height:10px;border-radius:50%;background:var(--red)}
@media (prefers-reduced-motion:no-preference){.fb-dot{animation:fbp 1.2s ease-in-out infinite}@keyframes fbp{50%{opacity:.3}}}
body:has(#deck) .fb-btn,body:has(#deck) .fb-panel{display:none}
@media print{.fb-btn,.fb-panel{display:none}}`;
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

let btn, panel, rec, stream, chunks = [], t0 = 0, tick, raf, audioCtx, last = null;

function mount() {
  if (btn || !window.A?.FB?.token) return;
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  btn = document.createElement('button'); btn.className = 'fb-btn'; btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = MIC + '<span>Give feedback</span>'; btn.onclick = () => rec?.state === 'recording' ? stop() : start();
  panel = document.createElement('div'); panel.className = 'fb-panel'; panel.hidden = true; panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
  document.body.append(btn, panel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && rec?.state === 'recording') cancel(); });
}
document.addEventListener('aurora:ready', mount);
if (window.A?.FB) mount();

const show = html => { panel.innerHTML = html; panel.hidden = false; };
const hide = () => { panel.hidden = true; };
const mmss = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function pickType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'])
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return '';
}
const extFor = t => t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : 'webm';

async function start() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    show('<h4>Recording is not available</h4><p>This browser cannot record audio. Try a current version of Chrome, Edge, Safari or Firefox.</p><button type="button" data-x>Close</button>');
    panel.querySelector('[data-x]').onclick = hide; return;
  }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch {
    show('<h4>Microphone blocked</h4><p>Allow microphone access for this site in your browser\'s address bar, then press Give feedback again.</p><button type="button" data-x>Close</button>');
    panel.querySelector('[data-x]').onclick = hide; return;
  }
  const type = pickType(); chunks = [];
  rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.start(1000); t0 = Date.now();
  btn.setAttribute('aria-pressed', 'true'); btn.querySelector('span').textContent = 'Stop and send';
  show(`<div class="fb-row"><span class="fb-dot"></span><b>Recording</b><span class="fb-time" id="fbt">0:00</span><span class="fb-meter"><span id="fbm"></span></span></div>
    <p>Say what could be better on this page, or anywhere in the dashboard. Press Stop and send when you are done.</p>
    <div class="fb-row"><button type="button" class="go" data-s>Stop and send</button><button type="button" class="quiet" data-c>Cancel</button></div>`);
  panel.querySelector('[data-s]').onclick = stop; panel.querySelector('[data-c]').onclick = cancel;
  tick = setInterval(() => { const ms = Date.now() - t0; const el = document.getElementById('fbt'); if (el) el.textContent = mmss(ms); if (ms >= MAX_MS) stop(); }, 250);
  meter();
}
function meter() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const an = audioCtx.createAnalyser(); an.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(an); const buf = new Uint8Array(an.fftSize);
    const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
      const el = document.getElementById('fbm'); if (el) el.style.width = Math.min(100, m / 64 * 100) + '%'; raf = requestAnimationFrame(loop); };
    loop();
  } catch { /* level meter is optional */ }
}
function teardown() {
  clearInterval(tick); cancelAnimationFrame(raf); audioCtx?.close().catch(() => {}); audioCtx = null;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  btn.setAttribute('aria-pressed', 'false'); btn.querySelector('span').textContent = 'Give feedback';
}
function cancel() { if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } teardown(); hide(); }
function stop() {
  const ms = Date.now() - t0;
  rec.onstop = () => {
    teardown();
    if (ms < MIN_MS) { show('<h4>That was too short</h4><p>Nothing was saved. Press Give feedback and speak for a few seconds.</p><button type="button" data-x>Close</button>'); panel.querySelector('[data-x]').onclick = hide; return; }
    const type = rec.mimeType || chunks[0]?.type || 'audio/webm';
    last = { blob: new Blob(chunks, { type }), ext: extFor(type), ms, ctx: context(), at: new Date() };
    send();
  };
  rec.stop();
}
function context() {
  const h = location.hash.slice(1), [route, id] = h.split('/');
  const proj = (route === 'p' || route === 'work') && id ? window.A?.currentProjectName?.(id) : null;
  return { page: /manage\.html$/.test(location.pathname) ? 'Workbench' : 'Leadership view', view: route === 'p' ? 'project' : route || (/manage\.html$/.test(location.pathname) ? 'work' : 'overview'),
    heading: document.querySelector('#app h2.page')?.textContent.trim().slice(0, 120) || document.title, project: proj || null, url: location.pathname.split('/').pop() + location.hash };
}
const b64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64txt = s => { let b = ''; new TextEncoder().encode(s).forEach(c => b += String.fromCharCode(c)); return btoa(b); };
async function put(path, content, message) {
  const { repo, token } = window.A.FB;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message, content }) });
  if (!r.ok && r.status !== 422) throw new Error(r.status);
}
async function send() {
  show('<h4>Sending…</h4><p>Saving your recording.</p>');
  const L = last, stamp = L.at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), base = `recordings/${person()}/${stamp}-${session}`;
  const meta = { person: person(), email: window.A?.me?.name ? window.A.me.email : null, session, session_started: sessionStart, name: myName() || null, at: L.at.toISOString(),
    duration_ms: L.ms, audio: `${stamp}-${session}.${L.ext}`, mime: L.blob.type, ...L.ctx, browser: navigator.userAgent.slice(0, 160) };
  try {
    await put(base + '.json', b64txt(JSON.stringify(meta, null, 1)), `Feedback context (${meta.page}, ${meta.view})`);
    await put(`${base}.${L.ext}`, await b64(L.blob), `Feedback recording (${meta.page}, ${meta.view}, ${mmss(L.ms)})`);
    last = null;
    const name = myName();
    show(`<h4>Thank you, your feedback was saved</h4><p>It will be transcribed in a few minutes.${name ? '' : ' If you like, add your name so your recordings are grouped under it.'}</p>
      ${name ? '' : '<div class="fb-row"><input id="fbn" placeholder="Your name (optional)" aria-label="Your name (optional)" autocomplete="name" style="flex:1;min-width:0"><button type="button" data-n>Save name</button></div>'}
      <div class="fb-row" style="margin-top:8px"><button type="button" class="quiet" data-x>Close</button></div>`);
    panel.querySelector('[data-x]').onclick = hide;
    const n = panel.querySelector('[data-n]');
    if (n) n.onclick = async () => { const v = panel.querySelector('#fbn').value.trim(); if (!v) return; localStorage.setItem('aurora.who', v);
      try { await put(`recordings/${person()}/name-${new Date().toISOString().replace(/[-:.]/g, '')}.json`, b64txt(JSON.stringify({ name: v, at: new Date().toISOString() })), 'Feedback name'); } catch {}
      show('<h4>Thanks, ' + esc(v) + '</h4><p>Your recordings are grouped under your name.</p><button type="button" class="quiet" data-x>Close</button>'); panel.querySelector('[data-x]').onclick = hide; };
  } catch (e) {
    const url = URL.createObjectURL(L.blob);
    show(`<h4>Could not save your recording</h4><p>${String(e.message).match(/^(401|403|404)$/) ? 'The feedback connection was refused. Tell the dashboard admin.' : 'Check your connection and try again.'}</p>
      <div class="fb-row"><button type="button" class="go" data-r>Try again</button><a href="${url}" download="feedback.${L.ext}">Download recording</a><button type="button" class="quiet" data-x>Discard</button></div>`);
    panel.querySelector('[data-r]').onclick = send; panel.querySelector('[data-x]').onclick = () => { last = null; hide(); };
  }
}
})();
