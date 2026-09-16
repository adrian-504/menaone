// Phone skeleton — four screens against the real API contract.
//
// Deliberately plain: no framework, no build step, so what is here is the
// interface and nothing else. When this becomes a real iOS app it is wrapped
// (Tauri or a native shell) and the same screens keep working; when the API
// moves to Azure only API_BASE changes.

const API = '';                       // same origin as the server that serves this page
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const screenEl = document.getElementById('screen');
const titleEl = document.getElementById('top-title');
const subEl = document.getElementById('top-sub');
const offlineEl = document.getElementById('offline');
const backEl = document.getElementById('back');

/** Last good response per endpoint. The owner chose "read offline, don't let
 *  me type", so reading falls back to this and capture simply refuses. */
const cache = new Map();

async function get(path) {
  try {
    const r = await fetch(API + path, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    cache.set(path, data);
    offlineEl.hidden = true;
    return data;
  } catch (e) {
    if (cache.has(path)) { offlineEl.hidden = false; return cache.get(path); }
    throw e;
  }
}

const time = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
const day = (iso) => iso ? new Date(iso + (iso.length === 10 ? 'T00:00' : '')).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
const card = (inner) => `<div class="card">${inner}</div>`;
/** Outlook locations arrive as a full postal address plus a joining link. On a
 *  phone only the first part is worth the space. */
const place = (loc) => {
  if (!loc) return '';
  if (/teams\.microsoft|meet\.google|zoom\./i.test(loc)) return 'Online';
  return loc.split(/[,;]/)[0].trim().slice(0, 40);
};
const empty = (text) => `<div class="card"><div class="empty">${esc(text)}</div></div>`;

// ── Today ───────────────────────────────────────────────────────────────────
async function today() {
  titleEl.textContent = 'Today';
  const d = await get('/api/today');
  subEl.textContent = new Date(d.date + 'T00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  const meetings = d.meetings.length
    ? card(d.meetings.map((m) => `<div class="row">
        <div class="row-flex"><span class="row-title">${esc(m.title)}</span><span class="when">${esc(time(m.startAt))}</span></div>
        <div class="row-sub">${[m.company, place(m.location)].filter(Boolean).map(esc).join(' · ') || 'No client linked'}</div>
      </div>`).join(''))
    : empty('Nothing in the calendar today');

  const attention = d.attention.length
    ? card(d.attention.map((a) => {
        const overdue = a.days < 0;
        const notice = a.noticeDueInDays != null && a.noticeDueInDays <= 14
          ? ` · notice ${a.noticeDueInDays <= 0 ? 'due now' : `in ${a.noticeDueInDays} days`}` : '';
        return `<div class="row">
          <div class="row-flex"><span class="row-title">${esc(a.company)}</span>
            <span class="pill ${a.tone}">${overdue ? `ended ${-a.days}d ago` : `${a.days}d`}</span></div>
          <div class="row-sub">${esc(a.ref || 'Agreement')} ends ${esc(day(a.endDate))}${esc(notice)}</div>
        </div>`;
      }).join(''))
    : '';

  const tasks = d.tasks.slice(0, 6);
  screenEl.innerHTML = `
    <div class="section-hd">Meetings</div>${meetings}
    ${attention ? `<div class="section-hd">Needs attention</div>${attention}` : ''}
    <div class="section-hd">Tasks</div>
    ${tasks.length ? card(tasks.map((t) => `<div class="row">
        <div class="row-flex"><span class="row-title">${esc(t.title)}</span>
          <span class="when">${t.dueDate ? esc(day(t.dueDate)) : ''}</span></div>
        ${t.company ? `<div class="row-sub">${esc(t.company)}</div>` : ''}
      </div>`).join('')) : empty('Nothing due')}
    <p class="skeleton-note">Skeleton — reading your real data, nothing can be changed from here yet.</p>`;
}

// ── Clients ─────────────────────────────────────────────────────────────────
async function clients() {
  titleEl.textContent = 'Clients';
  const list = await get('/api/clients');
  subEl.textContent = `${list.length} companies`;
  const draw = (q = '') => {
    const shown = q ? list.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : list;
    document.getElementById('client-list').innerHTML = shown.length
      ? card(shown.slice(0, 60).map((c) => `<button class="row" data-client="${c.id}">
          <div class="row-flex"><span class="row-title">${esc(c.name)}</span>
            ${c.agreements ? `<span class="pill green">client</span>` : ''}</div>
          <div class="row-sub">${[c.city, c.contacts ? `${c.contacts} contact${c.contacts === 1 ? '' : 's'}` : ''].filter(Boolean).map(esc).join(' · ') || 'No details yet'}</div>
        </button>`).join(''))
      : empty('No company by that name');
  };
  screenEl.innerHTML = `<input class="search" id="q" type="search" placeholder="Search clients" autocomplete="off"><div id="client-list"></div>`;
  draw();
  document.getElementById('q').addEventListener('input', (e) => draw(e.target.value));
}

async function clientPage(id) {
  const c = await get(`/api/clients/${id}`);
  titleEl.textContent = 'Client';
  subEl.textContent = '';
  backEl.hidden = false;
  const phone = c.contacts.find((x) => x.phone)?.phone || '';
  const wa = (c.contacts.find((x) => x.whatsapp)?.whatsapp || phone).replace(/[^0-9]/g, '');
  const mail = c.contacts.find((x) => x.email)?.email || '';
  const live = c.agreements.filter((a) => a.endDate);

  screenEl.innerHTML = `
    ${card(`<div class="client-hd">
      <div class="client-name">${esc(c.name)}</div>
      <div class="client-meta">${[c.city, c.status].filter(Boolean).map(esc).join(' · ') || 'No details yet'}</div>
    </div>
    <div class="actions">
      ${phone ? `<a class="act" href="tel:${esc(phone)}">Call</a>` : ''}
      ${wa ? `<a class="act" href="https://wa.me/${esc(wa)}">WhatsApp</a>` : ''}
      ${mail ? `<a class="act" href="mailto:${esc(mail)}">Email</a>` : ''}
    </div>`)}

    ${c.notes.length ? `<div class="section-hd">Latest notes</div>${card(c.notes.map((n) => `<div class="note">
        <div class="note-when">${esc(day((n.at || '').slice(0, 10)))}</div>${esc(n.body)}</div>`).join(''))}` : ''}

    ${live.length ? `<div class="section-hd">Agreements</div>${card(live.map((a) => `<div class="row">
        <div class="row-flex"><span class="row-title">${esc(a.ref)}</span><span class="when">${esc(day(a.endDate))}</span></div>
        <div class="row-sub">${[a.type, a.status].filter(Boolean).map(esc).join(' · ')}</div></div>`).join(''))}` : ''}

    ${c.contacts.length ? `<div class="section-hd">Contacts</div>${card(c.contacts.map((p) => `<div class="row">
        <div class="row-title">${esc(p.name)}</div>
        <div class="row-sub">${[p.role, p.email].filter(Boolean).map(esc).join(' · ')}</div></div>`).join(''))}` : ''}

    ${c.proposals.length ? `<div class="section-hd">Proposals</div>${card(c.proposals.map((p) => `<div class="row">
        <div class="row-flex"><span class="row-title">SL# ${p.id}</span><span class="when">${esc(p.sent ? day(p.sent) : '')}</span></div>
        <div class="row-sub">${[p.type, p.status].filter(Boolean).map(esc).join(' · ')}</div></div>`).join(''))}` : ''}

    ${c.tasks.length ? `<div class="section-hd">Open tasks</div>${card(c.tasks.map((t) => `<div class="row">
        <div class="row-flex"><span class="row-title">${esc(t.title)}</span><span class="when">${esc(t.dueDate ? day(t.dueDate) : '')}</span></div>
      </div>`).join(''))}` : ''}`;
}

// ── Tasks ───────────────────────────────────────────────────────────────────
async function tasks() {
  titleEl.textContent = 'Tasks';
  const d = await get('/api/today');
  subEl.textContent = `${d.tasks.length} open`;
  screenEl.innerHTML = d.tasks.length
    ? card(d.tasks.map((t) => `<div class="row">
        <div class="row-flex"><span class="row-title">${esc(t.title)}</span>
          <span class="when">${t.dueDate ? esc(day(t.dueDate)) : ''}</span></div>
        <div class="row-sub">${[t.company, t.priority].filter(Boolean).map(esc).join(' · ')}</div>
      </div>`).join('')) + `<p class="skeleton-note">Ticking a task off needs the backend — it is the next thing to build, not a missing screen.</p>`
    : empty('Nothing open');
}

// ── Capture ─────────────────────────────────────────────────────────────────
function capture() {
  titleEl.textContent = 'Capture';
  subEl.textContent = 'Needs a connection, by design';
  let kind = 'task';
  screenEl.innerHTML = `
    <div class="seg">
      <button data-kind="task" class="on">Task</button>
      <button data-kind="note">Note</button>
    </div>
    <textarea class="capture" id="cap" placeholder="Call the CFO about the renewal…"></textarea>
    <button class="btn-primary" id="send" disabled>Save</button>
    <p class="hint" id="cap-hint">Dictation works — hold the microphone on the keyboard.</p>`;

  const ta = document.getElementById('cap');
  const send = document.getElementById('send');
  const hint = document.getElementById('cap-hint');
  ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); });
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kind;
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      const r = await fetch(API + '/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, text: ta.value }) });
      if (!r.ok) throw new Error(await r.text());
      ta.value = '';
      hint.textContent = 'Accepted by the API — the skeleton holds it rather than writing it.';
    } catch {
      hint.textContent = 'No connection, so nothing was saved. Capture needs a connection — that was the deliberate choice.';
      send.disabled = false;
    }
  });
}

// ── router ──────────────────────────────────────────────────────────────────
const screens = { today, clients, tasks, capture };
async function show(name) {
  backEl.hidden = true;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  screenEl.innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
  try { await screens[name](); }
  catch { screenEl.innerHTML = empty('Could not reach the Mac. Same wifi?'); }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.screen)));
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-client]');
  if (row) clientPage(row.dataset.client);
});
backEl.addEventListener('click', () => show('clients'));
show('today');
