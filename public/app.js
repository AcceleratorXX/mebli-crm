'use strict';

// ---------- довідники

const STATUSES = [
  { key: 'quote',     label: 'Прорахунок',    color: '#a16207', quote: true },
  { key: 'measure',   label: 'Замір',         color: '#0891b2' },
  { key: 'design',    label: 'Конструювання', color: '#7c3aed' },
  { key: 'approval',  label: 'Погодження',    color: '#d97706' },
  { key: 'work',      label: 'В роботі',      color: '#2563eb' },
  { key: 'install',   label: 'Монтаж',        color: '#0d9488' },
  { key: 'pause',     label: 'На паузі',      color: '#e11d48' },
  { key: 'closed',    label: 'Закритий',      color: '#16a34a', archived: true },
  { key: 'cancelled', label: 'Скасований',    color: '#94a3b8', archived: true },
];
const STATUS = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const isArchived = p => !!STATUS[p.status]?.archived;
// Прорахунок — ще не замовлення: окремий список «Прорахунки», не серед «Проєктів».
const isQuote = p => !!STATUS[p.status]?.quote;
// Спершу — прорахунок (і колишній статус «Новий» теж); коли клієнт погодився — «Замір» і далі.
const START_STATUS = 'quote';
const FIRST_STATUS = 'measure';
const statusOf = p => STATUS[p.status] || STATUS[START_STATUS];
// Розділ меню, до якого належить проєкт.
const navOf = p => isArchived(p) ? 'archive' : isQuote(p) ? 'quotes' : '';

const FILE_CATEGORIES = ['Вхідні від клієнта', 'Заміри', 'Креслення / проєкт', 'Фото', 'Фото до', 'Фото після', 'Рахунки', 'Документи', 'Інше'];
const FURNITURE_TYPES = ['Кухня', 'Шафа-купе', 'Гардероб', 'Передпокій', 'Ванна кімната', 'Дитяча', 'Спальня', 'Вітальня', 'Офісні меблі', 'Інше'];
// Порізку, кромкування й присадку робить ВіЯр — для нас це один етап «Запущено в роботу».
// Матеріали замовляє ВіЯр разом із порізкою — окремого етапу «Замовлення матеріалів» немає.
const DEFAULT_STAGES = ['Замір', 'Конструювання / креслення', 'Погодження з клієнтом', 'Аванс отримано',
  'Запущено в роботу', 'Збірка', 'Доставка', 'Монтаж', 'Здача клієнту'];
const DROPPED_STAGES = ['Замовлення матеріалів'];
const VIYAR_STAGES = ['Порізка та кромкування', 'Присадка / свердління'];

// Старі стандартні етапи порізки й присадки → один «Запущено в роботу» (виконаний, якщо виконано хоч один).
function mergeViyarStages(p) {
  const old = p.stages.filter(s => VIYAR_STAGES.includes(s.label.trim()));
  if (!old.length || p.stages.some(s => s.label.trim() === 'Запущено в роботу')) return;
  const done = old.filter(s => s.done);
  Object.assign(old[0], {
    label: 'Запущено в роботу',
    done: done.length > 0,
    doneAt: done.map(s => s.doneAt).filter(Boolean).sort()[0] || '',
    plan: old.map(s => s.plan).filter(Boolean).sort()[0] || '',
  });
  p.stages = p.stages.filter(s => !old.slice(1).includes(s));
}
const TABS = [
  { key: 'overview',  label: 'Огляд' },
  { key: 'questions', label: 'Питання' },
  { key: 'stages',    label: 'Етапи' },
  { key: 'reminders', label: 'Нагадування' },
  { key: 'offer',     label: 'КП' },
  { key: 'contract',  label: 'Договір' },
  { key: 'files',     label: 'Файли' },
  { key: 'invoices',  label: 'Рахунки' },
  { key: 'handover',  label: 'Здача' },
  { key: 'log',       label: 'Журнал' },
];

const state = {
  projects: [], template: [], contacts: [], settings: {}, dataDir: '',
  filter: 'all', search: '', qOnlyOpen: false, matFilter: 'all',
  contactsTab: 'client', contactsSearch: '',
  current: null, tab: 'overview', page: null,
  uploadCategory: FILE_CATEGORIES[0],
  draft: null, draftDirty: false,
};

const app = document.getElementById('app');
const $ = sel => document.querySelector(sel);

// ---------- утиліти

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d = new Date()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1 + (Number(n) || 0), d));
}
const num = v => Number(v) || 0;

function fmtDate(v) {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return new Date(v).toLocaleDateString('uk-UA');
}
const fmtDateTime = v => new Date(v).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtNum = n => num(n).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
const money = n => fmtNum(n) + ' грн';
function fmtSize(b) {
  if (b < 1024) return b + ' Б';
  if (b < 1024 ** 2) return (b / 1024).toFixed(0) + ' КБ';
  return (b / 1024 ** 2).toFixed(1) + ' МБ';
}
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isError ? 5000 : 2500);
}

async function request(method, url, body, raw = false) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function copyText(text, okMsg) {
  navigator.clipboard.writeText(text)
    .then(() => toast(okMsg))
    .catch(() => toast('Не вдалося скопіювати', true));
}

// ---------- модель проєкту

function ensureProject(p) {
  p.questions ||= [];
  p.files ||= [];
  p.invoices ||= [];
  p.log ||= [];
  p.reminders ||= [];
  p.stages ||= DEFAULT_STAGES.map(label => ({ id: uid(), label, plan: '', done: false, doneAt: '' }));
  mergeViyarStages(p);
  p.stages = p.stages.filter(s => !DROPPED_STAGES.includes(s.label.trim()));
  p.materials ||= [];
  p.approvals ||= [];
  p.handover ||= { date: '', warrantyMonths: 24, note: '' };
  p.offer ||= { date: '', items: [] };
  p.contract ||= { number: '', date: '', clientDoc: '', pay1: '', pay2: '', days: '' };
  if (!STATUS[p.status]) p.status = START_STATUS;
  p.offer.items.forEach(ensureKpItem);
  return p;
}

const qState = q => (q.na ? 'na' : (q.answer || '').trim() ? 'done' : 'open');
function qStats(p) {
  const s = { done: 0, open: 0, na: 0 };
  for (const q of p.questions) s[qState(q)]++;
  s.total = s.done + s.open;
  s.pct = s.total ? Math.round((s.done / s.total) * 100) : 100;
  return s;
}

function stageStats(p) {
  const total = p.stages.length, done = p.stages.filter(s => s.done).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, next: p.stages.find(s => !s.done) };
}

// Рахунки — лише від постачальників (рахунків клієнту більше не ведемо; старі просто не показуємо).
const supplierInvoices = p => p.invoices.filter(i => i.kind !== 'client');
function finance(p) {
  const list = supplierInvoices(p);
  const costs = list.reduce((a, i) => a + num(i.amount), 0), paid = list.reduce((a, i) => a + num(i.paid), 0);
  return { count: list.length, costs, paid, due: costs - paid };
}

function invStatus(i) {
  const a = num(i.amount), pd = num(i.paid);
  if (a > 0 && pd >= a) return { label: 'Оплачено', cls: 'ok' };
  if (pd > 0) return { label: 'Частково', cls: 'warn' };
  return { label: 'Не оплачено', cls: 'bad' };
}

const remDue = r => `${r.date}T${r.time || '09:00'}`;
function remKind(r) {
  if (r.done) return 'done';
  if (remDue(r) <= localDateTime()) return 'overdue';
  if (r.date === localDate()) return 'today';
  return 'later';
}
const openReminders = p => p.reminders.filter(r => !r.done);
const dueReminders = p => openReminders(p).filter(r => r.date <= localDate());

const warrantyEnd = p => (p.handover.date ? addMonths(p.handover.date, p.handover.warrantyMonths) : '');

function groupOrder(questions) {
  const order = [];
  for (const q of [...state.template, ...questions]) if (!order.includes(q.group)) order.push(q.group);
  return order.filter(g => questions.some(q => q.group === g));
}

// ---------- збереження

let saveTimer = null;
function saveSoon(delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, delay);
}
async function saveNow(p = state.current) {
  if (p === state.current) { clearTimeout(saveTimer); saveTimer = null; }
  if (!p) return;
  try {
    const r = await request('PUT', `/api/projects/${p.id}`, p);
    p.updatedAt = r.updatedAt;
  } catch (e) {
    toast('Не вдалося зберегти: ' + e.message, true);
  }
}
window.addEventListener('pagehide', () => {
  if (saveTimer && state.current) {
    fetch(`/api/projects/${state.current.id}`, {
      method: 'PUT', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.current),
    });
  }
});

let settingsTimer = null;
function saveSettingsSoon() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => request('PUT', '/api/settings', state.settings).catch(e => toast(e.message, true)), 500);
}

async function saveContacts() {
  state.contacts = await request('PUT', '/api/contacts', state.contacts);
  refreshDatalists();
}

// Додати контакт у довідник, якщо такого ще немає
async function rememberContact(type, name, extra = {}) {
  name = String(name || '').trim();
  if (!name || state.contacts.some(c => c.type === type && sameName(c.name, name))) return;
  state.contacts.push({ id: uid(), type, name, phone: '', email: '', address: '', note: '', ...extra });
  try { await saveContacts(); } catch (e) { toast(e.message, true); }
}

function refreshDatalists() {
  const opts = type => state.contacts.filter(c => c.type === type).map(c => `<option value="${esc(c.name)}">`).join('');
  $('#clients-list').innerHTML = opts('client');
  $('#suppliers-list').innerHTML = opts('supplier');
}

function addLog(p, text, auto = false) {
  p.log.push({ id: uid(), at: new Date().toISOString(), text, auto });
}

// ---------- діалог і друк

function openDialog({ title, body, submitLabel = 'Зберегти', onSubmit }) {
  const dlg = $('#dlg');
  dlg.innerHTML = `
    <form class="dlg-form">
      <h2>${title}</h2>
      <div class="dlg-body">${body}</div>
      <div class="dlg-foot">
        <button type="button" class="btn" data-close>Скасувати</button>
        <button type="submit" class="btn primary">${submitLabel}</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  form.querySelector('[data-close]').onclick = () => dlg.close();
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if ((await onSubmit(form)) !== false) dlg.close();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };
  dlg.showModal();
  form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return form;
}

function printDoc(title, html) {
  const el = $('#print');
  el.innerHTML = `<div class="doc">${html}</div>`;
  const prevTitle = document.title;
  document.title = title;
  const imgs = [...el.querySelectorAll('img')];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))).then(() => {
    window.print();
    document.title = prevTitle;
  });
}

function partiesHtml(p) {
  const s = state.settings;
  return `
    <div class="doc-parties">
      <div><div class="doc-label">Виконавець</div>
        <b>${esc(s.companyName || '—')}</b><br>${[s.phone, s.email, s.address].filter(Boolean).map(esc).join('<br>')}
        ${s.details ? `<div class="doc-small">${nl2br(s.details)}</div>` : ''}</div>
      <div><div class="doc-label">Замовник</div>
        <b>${esc(p.client || '—')}</b><br>${[p.phone, p.address].filter(Boolean).map(esc).join('<br>')}</div>
    </div>`;
}

// ---------- маршрутизація

function updateNav(nav) {
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
}

async function route() {
  if (saveTimer) await saveNow();
  const [, page = '', id, tab] = location.hash.split('/');
  const pageKey = page === 'project' ? 'project:' + id : page;
  const pageChanged = pageKey !== state.page;
  state.page = pageKey;

  let nav = page;
  if (page === 'project') {
    const p = state.projects.find(x => x.id === id);
    if (!p) {
      app.innerHTML = `<div class="empty">Проєкт не знайдено. <a href="#/">До списку</a></div>`;
      return;
    }
    state.current = p;
    state.tab = TABS.some(t => t.key === tab) ? tab : 'overview';
    nav = navOf(p);
    viewProject();
  } else {
    state.current = null;
    if (page === 'settings') viewSettings();
    else if (page === 'board') viewBoard();
    else if (page === 'calendar') viewCalendar(id);
    else if (page === 'contacts') viewContacts();
    else viewList(page === 'archive' || page === 'quotes' ? page : '');
  }
  updateNav(nav);
  if (pageChanged) window.scrollTo(0, 0);
}

// ---------- список проєктів

function badge(s) {
  return `<span class="badge" style="--c:${s.color}"><i></i>${s.label}</span>`;
}
function progress(done, total, pct) {
  return `<div class="progress"><div style="width:${pct}%"></div></div><div class="muted small">${done}/${total}</div>`;
}

// Список проєктів розділу меню: '' — «Проєкти» (замовлення в роботі), 'quotes' — «Прорахунки», 'archive' — «Архів».
function viewList(kind) {
  state.listKind = kind;
  const archived = kind === 'archive', quotes = kind === 'quotes', active = kind === '';
  const pool = state.projects.filter(p => navOf(p) === kind);
  const chips = !active ? '' : `
    <div class="chips">
      <button class="chip ${state.filter === 'all' ? 'on' : ''}" data-action="filter" data-v="all">Усі <b>${pool.length}</b></button>
      ${STATUSES.filter(s => !s.archived && !s.quote).map(s => {
        const n = pool.filter(p => p.status === s.key).length;
        return `<button class="chip ${state.filter === s.key ? 'on' : ''}" data-action="filter" data-v="${s.key}" style="--c:${s.color}"><i></i>${s.label} <b>${n}</b></button>`;
      }).join('')}
    </div>`;

  app.innerHTML = `
    <div class="page-head">
      <h1>${archived ? 'Архів' : quotes ? 'Прорахунки' : 'Проєкти'}</h1>
      <div class="spacer"></div>
      <input type="search" class="search" placeholder="Пошук: назва, клієнт, телефон…" value="${esc(state.search)}" data-action="search">
      ${archived ? '' : quotes ? '<button class="btn primary" data-action="new-quote">+ Новий прорахунок</button>' : '<button class="btn primary" data-action="new-quote">+ Новий прорахунок</button>'}
    </div>
    ${active ? '<div id="rem-panel"></div>' : ''}
    ${quotes ? '<p class="muted" style="margin-top:0">Прорахунки — ще не замовлення: КП для клієнта. Коли клієнт погодиться — кнопка «✓ Клієнт погодився» в прорахунку перенесе його в «Проєкти».</p>' : ''}
    ${chips}
    <div id="list-body"></div>`;
  if (active) renderReminderPanel();
  renderListBody();
}

const kpSum = p => p.offer.items.reduce((a, it) => a + kpTotal(it), 0);

function quotesTable(list) {
  return `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>№</th><th>Прорахунок</th><th>Клієнт</th><th class="r">Сума КП</th><th>Виробів</th><th>Створено</th><th>Оновлено</th></tr></thead>
      <tbody>${list.map(p => `
        <tr data-go="#/project/${p.id}/offer">
          <td class="num">${p.number}</td>
          <td><div class="strong">${esc(p.name)}</div><div class="muted small">${esc(p.furnitureType || '')}</div></td>
          <td>${esc(p.client || '—')}<div class="muted small">${esc(p.phone || '')}</div></td>
          <td class="r nowrap">${p.offer.items.length ? money(kpSum(p)) : '<span class="muted">—</span>'}</td>
          <td>${p.offer.items.length || '<span class="muted">—</span>'}</td>
          <td class="muted small">${fmtDate(p.createdAt)}</td>
          <td class="muted small">${fmtDate(p.updatedAt)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function renderReminderPanel() {
  const el = $('#rem-panel');
  if (!el) return;
  const horizon = addDays(7);
  const items = state.projects
    .filter(p => !isArchived(p))
    .flatMap(p => openReminders(p).filter(r => r.date <= horizon).map(r => ({ r, p })))
    .sort((a, b) => remDue(a.r).localeCompare(remDue(b.r)));

  const notifBtn = 'Notification' in window && Notification.permission === 'default'
    ? '<button class="btn small" data-action="notif-enable">🔔 Увімкнути сповіщення</button>' : '';

  if (!items.length) {
    el.innerHTML = `<div class="rem-panel empty-panel"><span class="muted">Нагадувань на найближчий тиждень немає</span>${notifBtn}</div>`;
    return;
  }
  el.innerHTML = `
    <div class="rem-panel">
      <div class="rem-panel-head"><h3>Нагадування на тиждень</h3><div class="spacer"></div>${notifBtn}</div>
      ${items.map(({ r, p }) => remRow(r, p, true)).join('')}
    </div>`;
}

function remRow(r, p, withProject = false) {
  const kind = remKind(r);
  const when = `${r.date === localDate() ? 'Сьогодні' : fmtDate(r.date)}${r.time ? ', ' + r.time : ''}`;
  return `
    <div class="rem-row ${kind}" data-pid="${p.id}" data-rid="${r.id}">
      <input type="checkbox" data-action="rem-done" ${r.done ? 'checked' : ''} title="Виконано">
      <div class="rem-main">
        <div class="rem-text">${esc(r.text)}</div>
        <div class="small muted">
          <span class="rem-when">${kind === 'overdue' ? '⚠ ' : ''}${when}</span>
          ${withProject ? ` · <a href="#/project/${p.id}/reminders">№${p.number} ${esc(p.name)}</a>` : ''}
        </div>
      </div>
      ${withProject ? '' : `
        <button class="icon-btn" data-action="rem-edit" title="Редагувати">✎</button>
        <button class="icon-btn" data-action="rem-del" title="Видалити">✕</button>`}
    </div>`;
}

function renderListBody() {
  const kind = state.listKind ?? '';
  const archived = kind === 'archive', quotes = kind === 'quotes';
  const q = state.search.trim().toLowerCase();
  let list = state.projects.filter(p => navOf(p) === kind);
  const pool = list.length;
  if (kind === '' && state.filter !== 'all') list = list.filter(p => p.status === state.filter);
  if (q) list = list.filter(p => [p.number, p.name, p.client, p.phone, p.address, p.furnitureType].join(' ').toLowerCase().includes(q));

  if (archived) list.sort((a, b) => (b.closedAt || b.updatedAt).localeCompare(a.closedAt || a.updatedAt));
  else if (quotes) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else list.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || b.updatedAt.localeCompare(a.updatedAt));

  const body = $('#list-body');
  if (!list.length) {
    body.innerHTML = `<div class="empty">${
      pool && q ? 'Нічого не знайдено.'
        : archived ? 'Архів порожній. Сюди потрапляють проєкти зі статусом «Закритий» або «Скасований».'
          : quotes ? 'Прорахунків немає. Натисніть «+ Новий прорахунок», щоб зробити КП для клієнта.'
            : pool ? 'Нічого не знайдено.' : 'Проєктів у роботі ще немає. Кожен проєкт починається з прорахунку («+ Новий прорахунок»); коли клієнт погодиться — він з\'явиться тут.'
    }</div>`;
    return;
  }
  if (quotes) { body.innerHTML = quotesTable(list); return; }
  const today = localDate();
  body.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>№</th><th>Проєкт</th><th>Клієнт</th><th>Статус</th><th>${archived ? 'Гарантія до' : 'Етап'}</th><th>Дедлайн</th><th>Питання</th><th>${archived ? 'Закрито' : 'Оновлено'}</th>
      </tr></thead>
      <tbody>${list.map(p => {
        const s = statusOf(p);
        const overdue = !archived && p.deadline && p.deadline < today;
        const due = archived ? 0 : dueReminders(p).length;
        const qs = qStats(p), st = stageStats(p);
        const we = warrantyEnd(p);
        return `<tr data-go="#/project/${p.id}">
          <td class="num">${p.number}</td>
          <td><div class="strong">${esc(p.name)}${due ? ` <span class="bell" title="Нагадування на сьогодні / прострочені">🔔${due}</span>` : ''}</div>
              <div class="muted small">${esc(p.furnitureType || '')}</div></td>
          <td>${esc(p.client || '—')}<div class="muted small">${esc(p.phone || '')}</div></td>
          <td>${badge(s)}</td>
          <td>${archived
            ? (we ? `<span class="${we >= today ? 'ok-text' : 'muted'}">${fmtDate(we)}</span>` : '—')
            : `<div class="small">${st.next ? esc(st.next.label) : '✓ Усі етапи'}</div><div class="muted small">${st.done}/${st.total}</div>`}</td>
          <td class="${overdue ? 'overdue' : ''}">${fmtDate(p.deadline)}</td>
          <td class="prog-cell">${progress(qs.done, qs.total, qs.pct)}</td>
          <td class="muted small">${fmtDate(archived ? p.closedAt || p.updatedAt : p.updatedAt)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function newProjectDialog(quote = false) {
  const form = openDialog({
    title: quote ? 'Новий прорахунок' : 'Новий проєкт',
    submitLabel: 'Створити',
    body: `
      <label class="field"><span>Назва *</span><input name="name" required placeholder="Напр.: Кухня, вул. Шевченка 10"></label>
      <label class="field"><span>Тип меблів</span><input name="furnitureType" list="furniture-types"></label>
      <div class="row2">
        <label class="field"><span>Клієнт</span><input name="client" list="clients-list" autocomplete="off"></label>
        <label class="field"><span>Телефон</span><input name="phone" type="tel"></label>
      </div>
      <label class="field"><span>Адреса</span><input name="address"></label>
      <label class="field"><span>Дедлайн</span><input name="deadline" type="date"></label>
      <p class="muted small">Питання для проєкту буде скопійовано з шаблону. Новий клієнт автоматично потрапить у «Контакти».</p>`,
    onSubmit: async form => {
      const data = Object.fromEntries(new FormData(form));
      const p = ensureProject(await request('POST', '/api/projects', quote ? { ...data, status: 'quote' } : data));
      state.projects.push(p);
      await rememberContact('client', data.client, { phone: data.phone, address: data.address });
      location.hash = `#/project/${p.id}/${quote ? 'offer' : 'questions'}`;
    },
  });
  form.elements.client.addEventListener('change', () => {
    const c = state.contacts.find(x => x.type === 'client' && sameName(x.name, form.elements.client.value));
    if (!c) return;
    if (!form.elements.phone.value) form.elements.phone.value = c.phone || '';
    if (!form.elements.address.value) form.elements.address.value = c.address || '';
  });
}

// ---------- дошка (канбан)

function viewBoard() {
  const active = state.projects.filter(p => !isArchived(p));
  const today = localDate();
  const card = p => {
    const st = stageStats(p), due = dueReminders(p).length;
    const overdue = p.deadline && p.deadline < today;
    return `
      <div class="kcard" draggable="true" data-pid="${p.id}" data-go="#/project/${p.id}">
        <div class="kcard-top"><span class="muted">№${p.number}</span>${due ? `<span class="bell">🔔${due}</span>` : ''}</div>
        <div class="strong">${esc(p.name)}</div>
        <div class="muted small">${esc([p.furnitureType, p.client].filter(Boolean).join(' · '))}</div>
        <div class="progress"><div style="width:${st.pct}%"></div></div>
        <div class="kcard-foot small">
          <span class="muted">${st.next ? esc(st.next.label) : '✓ Усі етапи'}</span>
          ${p.deadline ? `<span class="${overdue ? 'overdue' : 'muted'}">⏰ ${fmtDate(p.deadline)}</span>` : ''}
        </div>
      </div>`;
  };
  app.innerHTML = `
    <div class="page-head">
      <h1>Дошка</h1>
      <span class="muted small">Перетягуйте картки між колонками, щоб змінити статус</span>
      <div class="spacer"></div>
      <button class="btn primary" data-action="new-quote">+ Новий прорахунок</button>
    </div>
    <div class="board">
      ${STATUSES.filter(s => !s.archived).map(s => {
        const items = active.filter(p => p.status === s.key);
        return `
          <div class="col" data-col="${s.key}" style="--c:${s.color}">
            <div class="col-head"><i></i>${s.label}<b>${items.length}</b></div>
            <div class="col-body">${items.map(card).join('') || '<div class="col-empty">—</div>'}</div>
          </div>`;
      }).join('')}
      <div class="col col-close" data-col="closed" style="--c:${STATUS.closed.color}">
        <div class="col-head"><i></i>Закрити<b></b></div>
        <div class="col-body"><div class="col-empty">Перетягніть сюди,<br>щоб закрити проєкт<br>і перенести в архів</div></div>
      </div>
    </div>`;
}

// ---------- календар

function calendarEvents() {
  const ev = [];
  for (const p of state.projects) {
    if (isArchived(p)) continue;
    const proj = `№${p.number} ${p.name}`;
    if (p.deadline) ev.push({ date: p.deadline, kind: 'deadline', text: 'Дедлайн', proj, href: `#/project/${p.id}/overview` });
    for (const r of p.reminders) {
      if (!r.done) ev.push({ date: r.date, time: r.time, kind: remKind(r) === 'overdue' ? 'overdue' : 'rem', text: r.text, proj, href: `#/project/${p.id}/reminders` });
    }
    for (const s of p.stages) {
      if (s.plan && !s.done) ev.push({ date: s.plan, kind: 'stage', text: s.label, proj, href: `#/project/${p.id}/stages` });
    }
  }
  return ev.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

const EVENT_ICON = { deadline: '⏰', rem: '🔔', overdue: '⚠', stage: '▸' };

function viewCalendar(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = localDate().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const title = first.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }).replace(/\s*р\.?$/, '');
  const today = localDate();

  const events = calendarEvents();
  const byDate = {};
  for (const e of events) (byDate[e.date] ||= []).push(e);

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(y, m - 1, 1 - offset + i);
    const key = localDate(d);
    const list = byDate[key] || [];
    cells.push(`
      <div class="cal-day ${d.getMonth() !== m - 1 ? 'other' : ''} ${key === today ? 'today' : ''}">
        <div class="cal-num">${d.getDate()}</div>
        ${list.map(e => `<a class="cal-ev ${e.kind}" href="${e.href}" title="${esc(e.proj + ': ' + e.text)}">${EVENT_ICON[e.kind]} ${e.time ? e.time + ' ' : ''}${esc(e.text)} <span>${esc(e.proj)}</span></a>`).join('')}
      </div>`);
  }

  const monthEvents = events.filter(e => e.date.startsWith(ym));
  app.innerHTML = `
    <div class="page-head">
      <h1 class="cal-title">${esc(title)}</h1>
      <div class="spacer"></div>
      <a class="btn" href="#/calendar/${prev}">←</a>
      <a class="btn" href="#/calendar/${today.slice(0, 7)}">Сьогодні</a>
      <a class="btn" href="#/calendar/${next}">→</a>
    </div>
    <div class="cal-legend small muted">
      <span><i class="dot rem"></i>Нагадування</span><span><i class="dot overdue"></i>Прострочене</span>
      <span><i class="dot stage"></i>Запланований етап</span><span><i class="dot deadline"></i>Дедлайн</span>
    </div>
    <div class="cal">
      ${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map(d => `<div class="cal-wd">${d}</div>`).join('')}
      ${cells.join('')}
    </div>
    <div class="cal-list">
      <h3>Події місяця</h3>
      ${monthEvents.length ? monthEvents.map(e => `
        <a class="cal-list-row" href="${e.href}">
          <span class="cal-list-date ${e.date === today ? 'today' : ''}">${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}</span>
          <span class="cal-ev ${e.kind}">${EVENT_ICON[e.kind]} ${esc(e.text)}</span>
          <span class="muted small">${esc(e.proj)}</span>
        </a>`).join('') : '<div class="muted">Подій немає</div>'}
    </div>
    <p class="muted small">Щоб етап з'явився в календарі, вкажіть йому планову дату на вкладці «Етапи» проєкту.</p>`;
}

// ---------- контакти

function viewContacts() {
  const type = state.contactsTab;
  app.innerHTML = `
    <div class="page-head">
      <h1>Контакти</h1>
      <div class="seg">
        <button class="${type === 'client' ? 'on' : ''}" data-action="ct-tab" data-v="client">Клієнти (${state.contacts.filter(c => c.type === 'client').length})</button>
        <button class="${type === 'supplier' ? 'on' : ''}" data-action="ct-tab" data-v="supplier">Постачальники (${state.contacts.filter(c => c.type === 'supplier').length})</button>
      </div>
      <div class="spacer"></div>
      <input type="search" class="search" placeholder="Пошук…" value="${esc(state.contactsSearch)}" data-action="ct-search">
      <button class="btn primary" data-action="ct-add">+ ${type === 'client' ? 'Клієнт' : 'Постачальник'}</button>
    </div>
    <div id="contacts-body"></div>`;
  renderContactsBody();
}

function contactProjects(c) {
  return state.projects.filter(p => sameName(p.client, c.name) || (c.phone && p.phone && p.phone.replace(/\D/g, '') === c.phone.replace(/\D/g, '')));
}
function supplierStats(c) {
  let invoices = 0, sum = 0;
  const projects = new Set();
  for (const p of state.projects) {
    for (const i of p.invoices) if (i.kind === 'supplier' && sameName(i.counterparty, c.name)) { invoices++; sum += num(i.amount); projects.add(p); }
  }
  return { invoices, sum, projects: [...projects] };
}

function renderContactsBody() {
  const type = state.contactsTab;
  const q = state.contactsSearch.trim().toLowerCase();
  const list = state.contacts
    .filter(c => c.type === type)
    .filter(c => !q || [c.name, c.phone, c.email, c.address, c.note].join(' ').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const body = $('#contacts-body');
  if (!list.length) {
    body.innerHTML = `<div class="empty">${q ? 'Нічого не знайдено.' : type === 'client'
      ? 'Клієнтів ще немає. Вони додаються автоматично при створенні проєкту або вручну.'
      : 'Постачальників ще немає. Вони додаються автоматично з рахунків і матеріалів або вручну.'}</div>`;
    return;
  }
  const projLinks = ps => ps.map(p => `<a href="#/project/${p.id}">№${p.number} ${esc(p.name)}</a>`).join('<br>') || '<span class="muted">—</span>';
  body.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${type === 'client' ? "Ім'я" : 'Назва'}</th><th>Телефон</th><th>Email</th><th>${type === 'client' ? 'Адреса' : 'Що постачає / примітка'}</th><th>${type === 'client' ? 'Проєкти' : 'Рахунки / проєкти'}</th><th></th></tr></thead>
      <tbody>${list.map(c => {
        let extra;
        if (type === 'client') extra = projLinks(contactProjects(c));
        else { const s = supplierStats(c); extra = `${s.invoices ? `<div class="small">${s.invoices} рах. на ${money(s.sum)}</div>` : ''}${projLinks(s.projects)}`; }
        return `<tr data-cid="${c.id}">
          <td class="strong">${esc(c.name)}</td>
          <td class="nowrap">${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</td>
          <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
          <td class="small">${type === 'client' ? esc(c.address || '') : ''}${c.note ? `<div class="muted">${nl2br(c.note)}</div>` : ''}</td>
          <td class="small">${extra}</td>
          <td class="nowrap"><button class="icon-btn" data-action="ct-edit">✎</button><button class="icon-btn" data-action="ct-del">✕</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function contactDialog(type, c) {
  const x = c || { type, name: '', phone: '', email: '', address: '', note: '' };
  openDialog({
    title: c ? 'Редагувати контакт' : type === 'client' ? 'Новий клієнт' : 'Новий постачальник',
    body: `
      <label class="field"><span>${type === 'client' ? "Ім'я *" : 'Назва *'}</span><input name="name" required value="${esc(x.name)}"></label>
      <div class="row2">
        <label class="field"><span>Телефон</span><input name="phone" type="tel" value="${esc(x.phone)}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(x.email)}"></label>
      </div>
      <label class="field"><span>Адреса</span><input name="address" value="${esc(x.address)}"></label>
      <label class="field"><span>${type === 'client' ? 'Примітка' : 'Що постачає / менеджер / примітка'}</span><textarea name="note" rows="3">${esc(x.note)}</textarea></label>`,
    onSubmit: async form => {
      const d = Object.fromEntries(new FormData(form));
      const data = { name: d.name.trim(), phone: d.phone.trim(), email: d.email.trim(), address: d.address.trim(), note: d.note.trim() };
      if (c) Object.assign(c, data);
      else state.contacts.push({ id: uid(), type, ...data });
      await saveContacts();
      viewContacts();
    },
  });
}

// ---------- сторінка проєкту

function viewProject() {
  app.innerHTML = `<div id="proj-head" class="proj-head"></div><nav class="tabs" id="tabs"></nav><section id="tab-body"></section>`;
  renderHead();
  renderTabs();
  renderTab();
}

function renderHead() {
  const p = state.current;
  const s = statusOf(p);
  const back = { archive: ['#/archive', 'Архів'], quotes: ['#/quotes', 'Прорахунки'], '': ['#/', 'Проєкти'] }[navOf(p)];
  $('#proj-head').innerHTML = `
    <a class="back" href="${back[0]}">← ${back[1]}</a>
    <div class="title-row">
      <span class="num-big">№${p.number}</span>
      <h1>${esc(p.name)}</h1>
      <div class="spacer"></div>
      ${isQuote(p) ? '<button class="btn primary" data-action="quote-accept" title="Перенести в «Проєкти» зі статусом «Замір»">✓ Клієнт погодився → у проєкти</button>' : ''}
      <label class="status-pick" style="--c:${s.color}" title="Статус проєкту"><i></i>
        <select data-action="status">${STATUSES.map(x => `<option value="${x.key}" ${x.key === p.status ? 'selected' : ''}>${x.label}</option>`).join('')}</select>
      </label>
    </div>
    <div class="sub muted">${[p.furnitureType, p.client, p.phone, p.address].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>`;
}

function renderTabs() {
  const p = state.current;
  const st = stageStats(p);
  const counts = {
    questions: qStats(p).open,
    stages: st.total ? `${st.done}/${st.total}` : 0,
    reminders: openReminders(p).length,
    offer: p.offer.items.length,
    files: p.files.length,
    invoices: p.invoices.length,
    log: p.log.length,
  };
  const alert = dueReminders(p).length > 0;
  $('#tabs').innerHTML = TABS.map(t => {
    const c = counts[t.key];
    const cls = t.key === 'reminders' && alert ? 'cnt alert' : 'cnt';
    return `<a href="#/project/${p.id}/${t.key}" class="${t.key === state.tab ? 'on' : ''}">${t.label}${c ? ` <span class="${cls}">${c}</span>` : ''}</a>`;
  }).join('');
}

const TAB_VIEWS = {};
function renderTab() {
  $('#tab-body').innerHTML = TAB_VIEWS[state.tab](state.current);
  if (state.tab === 'invoices') backfillInvoices(state.current);
}
function refreshTab() {
  renderTab();
  renderTabs();
}

function changeStatus(p, key) {
  const was = p.status;
  if (was === key) return;
  const wasArchived = isArchived(p);
  p.status = key;
  addLog(p, `Статус: ${STATUS[was]?.label || was} → ${STATUS[key].label}`, true);
  if (isArchived(p) && !wasArchived) {
    p.closedAt = new Date().toISOString();
    if (key === 'closed' && !p.handover.date) p.handover.date = localDate();
    toast(`«${p.name}» перенесено в архів`);
  } else if (!isArchived(p) && wasArchived) {
    p.closedAt = null;
    toast(`«${p.name}» повернуто в активні`);
  }
  saveNow(p);
  if (p === state.current) {
    renderHead();
    renderTabs();
    if (['log', 'overview', 'handover'].includes(state.tab)) renderTab();
    updateNav(navOf(p));
  }
}

// --- Огляд

TAB_VIEWS.overview = p => {
  const F = (field, label, type = 'text', cls = '', attrs = '') =>
    `<label class="field ${cls}"><span>${label}</span><input type="${type}" data-field="${field}" value="${esc(p[field] ?? '')}" ${attrs}></label>`;
  const qs = qStats(p), f = finance(p), st = stageStats(p), offer = kpSum(p);
  const nextRem = openReminders(p).sort((a, b) => remDue(a).localeCompare(remDue(b)))[0];
  const fileCounts = [...new Set(p.files.map(x => x.category))].map(c => [c, p.files.filter(x => x.category === c).length]);
  const we = warrantyEnd(p);

  return `
    <div class="grid-side">
      <div class="card">
        <h3>Дані проєкту</h3>
        <div class="form-grid">
          ${F('name', 'Назва проєкту')}
          ${F('furnitureType', 'Тип меблів', 'text', '', 'list="furniture-types"')}
          ${F('client', 'Клієнт', 'text', '', 'list="clients-list" autocomplete="off"')}
          ${F('phone', 'Телефон', 'tel')}
          ${F('address', 'Адреса', 'text', 'full')}
          ${F('deadline', 'Дедлайн', 'date')}
          ${F('budget', 'Бюджет, грн', 'number')}
          <label class="field full"><span>Нотатки</span><textarea data-field="notes" rows="6" placeholder="Загальні нотатки по проєкту…">${esc(p.notes || '')}</textarea></label>
        </div>
      </div>
      <div class="side">
        <a class="card link-card" href="#/project/${p.id}/stages">
          <h3>Етапи</h3>
          <div class="progress big"><div style="width:${st.pct}%"></div></div>
          <div>${st.done} з ${st.total} · ${st.next ? `зараз: <b>${esc(st.next.label)}</b>${st.next.plan ? ` (план ${fmtDate(st.next.plan)})` : ''}` : 'усі виконано ✓'}</div>
        </a>
        <a class="card link-card" href="#/project/${p.id}/questions">
          <h3>Питання</h3>
          <div class="progress big"><div style="width:${qs.pct}%"></div></div>
          <div>${qs.done} з ${qs.total} мають відповідь${qs.open ? ` · <b class="warn-text">${qs.open} відкритих</b>` : ' ✓'}</div>
        </a>
        <a class="card link-card" href="#/project/${p.id}/reminders">
          <h3>Найближче нагадування</h3>
          ${nextRem ? `<div class="rem-mini ${remKind(nextRem)}"><b>${fmtDate(nextRem.date)}${nextRem.time ? ' ' + nextRem.time : ''}</b> — ${esc(nextRem.text)}</div>` : '<div class="muted">Немає</div>'}
        </a>
        <a class="card link-card" href="#/project/${p.id}/invoices">
          <h3>Фінанси</h3>
          ${offer ? `<div class="kv"><span>За КП</span><b>${money(offer)}</b></div>` : ''}
          <div class="kv"><span>Рахунки постачальників (${f.count})</span><b>${money(f.costs)}</b></div>
          <div class="kv"><span>Оплачено</span><b>${money(f.paid)}</b></div>
          <div class="kv"><span>Не оплачено</span><b class="${f.due > 0 ? 'warn-text' : ''}">${money(f.due)}</b></div>
        </a>
        <a class="card link-card" href="#/project/${p.id}/files">
          <h3>Файли</h3>
          ${fileCounts.length ? fileCounts.map(([c, n]) => `<div class="kv"><span>${esc(c)}</span><b>${n}</b></div>`).join('') : '<div class="muted">Ще немає файлів</div>'}
        </a>
        <div class="card muted small">
          Створено: ${fmtDateTime(p.createdAt)}<br>Оновлено: ${fmtDateTime(p.updatedAt)}
          ${p.closedAt ? `<br>Закрито: ${fmtDateTime(p.closedAt)}` : ''}
          ${we ? `<br>Гарантія до: <b class="${we >= localDate() ? 'ok-text' : ''}">${fmtDate(we)}</b>` : ''}
          <div class="danger-zone"><button class="btn danger small" data-action="project-del">Видалити проєкт</button></div>
        </div>
      </div>
    </div>`;
};

// --- Питання

TAB_VIEWS.questions = p => {
  const qs = qStats(p);
  const existing = new Set(p.questions.map(q => q.id));
  const missing = state.template.filter(t => !existing.has(t.id)).length;

  const groups = groupOrder(p.questions).map(g => {
    const items = p.questions.filter(q => q.group === g);
    const visible = state.qOnlyOpen ? items.filter(q => qState(q) === 'open') : items;
    if (!visible.length) return '';
    const done = items.filter(q => qState(q) !== 'open').length;
    return `
      <div class="q-group">
        <div class="q-group-head"><h3>${esc(g)}</h3><span class="muted g-count">${done}/${items.length}</span></div>
        ${visible.map(qRow).join('')}
      </div>`;
  }).join('');

  return `
    <div class="toolbar">
      <div class="seg">
        <button class="${state.qOnlyOpen ? '' : 'on'}" data-action="q-filter" data-v="all">Усі</button>
        <button class="${state.qOnlyOpen ? 'on' : ''}" data-action="q-filter" data-v="open">Без відповіді (${qs.open})</button>
      </div>
      <div class="progress grow"><div style="width:${qs.pct}%"></div></div>
      <span class="muted small">${qs.pct}%</span>
      <div class="spacer"></div>
      ${missing ? `<button class="btn" data-action="q-sync" title="Додати питання, що з'явилися в шаблоні">+ З шаблону (${missing})</button>` : ''}
      <button class="btn" data-action="q-add">+ Питання</button>
      <button class="btn" data-action="q-print" title="Надрукувати анкету: з відповідями та порожніми рядками для відкритих питань">🖨 Анкета</button>
      <button class="btn primary" data-action="q-copy" title="Скопіювати список питань без відповіді, щоб надіслати клієнту">📋 Скопіювати відкриті</button>
    </div>
    ${groups || `<div class="empty">${state.qOnlyOpen ? 'Усі питання мають відповіді 🎉' : 'Питань немає.'}</div>`}`;
};

function qRow(q) {
  return `
    <div class="q-row ${qState(q)}" data-qid="${q.id}">
      <div class="q-text">
        <div class="q-title">${esc(q.text)}</div>
        ${q.hint ? `<div class="q-hint">${esc(q.hint)}</div>` : ''}
      </div>
      <textarea class="q-answer" data-action="q-answer" rows="1" placeholder="${q.na ? 'Не стосується' : 'Відповідь…'}">${esc(q.answer || '')}</textarea>
      <div class="q-actions">
        <button class="icon-btn ${q.na ? 'on' : ''}" data-action="q-na" title="Не стосується цього проєкту">н/с</button>
        <button class="icon-btn" data-action="q-del" title="Видалити питання з проєкту">✕</button>
      </div>
    </div>`;
}

function updateQRow(row, q) {
  row.className = 'q-row ' + qState(q);
  const items = state.current.questions.filter(x => x.group === q.group);
  row.closest('.q-group').querySelector('.g-count').textContent = `${items.filter(x => qState(x) !== 'open').length}/${items.length}`;
  const qs = qStats(state.current);
  const bar = $('#tab-body .toolbar .progress div');
  if (bar) bar.style.width = qs.pct + '%';
  const seg = $('#tab-body [data-v="open"]');
  if (seg) seg.textContent = `Без відповіді (${qs.open})`;
  renderTabs();
}

function addQuestionDialog() {
  const p = state.current;
  const groups = groupOrder(p.questions);
  openDialog({
    title: 'Нове питання',
    submitLabel: 'Додати',
    body: `
      <label class="field"><span>Питання *</span><input name="text" required></label>
      <label class="field"><span>Підказка (варіанти)</span><input name="hint" placeholder="необов'язково"></label>
      <label class="field"><span>Розділ</span><input name="group" list="q-groups" value="${esc(groups[0] || 'Загальне')}"></label>
      <datalist id="q-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <label class="check"><input type="checkbox" name="toTemplate"> Також додати в шаблон для нових проєктів</label>`,
    onSubmit: async form => {
      const d = Object.fromEntries(new FormData(form));
      const q = { id: 'c' + uid(), group: d.group.trim() || 'Інше', text: d.text.trim(), hint: d.hint.trim() };
      p.questions.push({ ...q, answer: '', na: false });
      await saveNow();
      if (d.toTemplate) {
        state.template = await request('PUT', '/api/template', [...state.template, q]);
        state.draft = null;
      }
      refreshTab();
    },
  });
}

function copyOpenQuestions() {
  const p = state.current;
  const open = p.questions.filter(q => qState(q) === 'open');
  if (!open.length) return toast('Відкритих питань немає');
  let n = 0;
  const text = [`Питання по проєкту «${p.name}»:`, ''];
  for (const g of groupOrder(open)) {
    text.push(g.toUpperCase());
    for (const q of open.filter(x => x.group === g)) text.push(`${++n}. ${q.text}${q.hint ? ` (${q.hint})` : ''}`);
    text.push('');
  }
  copyText(text.join('\n').trim(), `Скопійовано ${n} питань — можна вставити у Viber / Telegram`);
}

function printQuestionnaire(p) {
  const qs = p.questions.filter(q => !q.na);
  let n = 0;
  const groups = groupOrder(qs).map(g => `
    <h2>${esc(g)}</h2>
    ${qs.filter(q => q.group === g).map(q => `
      <div class="doc-q">
        <div><b>${++n}. ${esc(q.text)}</b>${q.hint ? ` <span class="doc-hint">(${esc(q.hint)})</span>` : ''}</div>
        ${(q.answer || '').trim() ? `<div class="doc-a">${nl2br(q.answer)}</div>` : '<div class="doc-line"></div><div class="doc-line"></div>'}
      </div>`).join('')}`).join('');
  printDoc(`Анкета — ${p.name}`, `
    <h1>Анкета перед конструюванням</h1>
    <div class="doc-meta">
      Проєкт: <b>№${p.number} ${esc(p.name)}</b>${p.furnitureType ? ` (${esc(p.furnitureType)})` : ''}<br>
      Клієнт: ${esc(p.client || '____________________')} · Тел.: ${esc(p.phone || '____________________')}<br>
      Адреса: ${esc(p.address || '________________________________________')}<br>
      Дата: ${fmtDate(localDate())}
    </div>
    ${groups}
    <h2>Додаткові нотатки</h2>
    <div class="doc-line"></div><div class="doc-line"></div><div class="doc-line"></div><div class="doc-line"></div>`);
}

// --- Етапи та погодження

TAB_VIEWS.stages = p => {
  const st = stageStats(p);
  const files = Object.fromEntries(p.files.map(f => [f.id, f]));
  return `
    <div class="toolbar">
      <div class="progress grow"><div style="width:${st.pct}%"></div></div>
      <span class="muted small">${st.done} з ${st.total} етапів</span>
      <div class="spacer"></div>
      <button class="btn" data-action="st-add">+ Етап</button>
    </div>
    <div class="card list-card">
      ${p.stages.map((s, i) => `
        <div class="st-row ${s.done ? 'done' : ''} ${!s.done && s.plan && s.plan < localDate() ? 'late' : ''}" data-sid="${s.id}">
          <input type="checkbox" data-action="st-done" ${s.done ? 'checked' : ''} title="Виконано">
          <span class="st-num muted">${i + 1}</span>
          <input class="st-label" data-action="st-label" value="${esc(s.label)}">
          <label class="st-date small muted">План <input type="date" data-action="st-plan" value="${s.plan || ''}"></label>
          <span class="st-doneat small">${s.done ? `<label title="Коли виконано — можна змінити">✓ <input type="date" data-action="st-doneat" value="${s.doneAt || ''}"></label>` : ''}</span>
          <span class="nowrap">
            <button class="icon-btn" data-action="st-up" title="Вище">↑</button>
            <button class="icon-btn" data-action="st-down" title="Нижче">↓</button>
            <button class="icon-btn" data-action="st-del" title="Видалити">✕</button>
          </span>
        </div>`).join('') || '<div class="muted">Етапів немає</div>'}
    </div>
    <p class="muted small">Етапи з плановою датою з'являються в «Календарі». Прострочені позначені червоним.</p>

    <div class="card">
      <div class="card-head">
        <h3>Погодження з клієнтом</h3>
        <div class="spacer"></div>
        <button class="btn small primary" data-action="ap-add">+ Зафіксувати погодження</button>
      </div>
      <p class="muted small" style="margin-top:0">Записуйте, що саме і коли клієнт погодив (проєкт, кольори, розміри) — з файлом або скріном переписки. Це захищає при суперечках.</p>
      ${p.approvals.length ? `<div class="table-wrap"><table class="table compact">
        <thead><tr><th>Дата</th><th>Що погоджено</th><th>Як</th><th>Файл</th><th></th></tr></thead>
        <tbody>${[...p.approvals].sort((a, b) => b.date.localeCompare(a.date)).map(a => {
          const f = a.fileId && files[a.fileId];
          return `<tr data-aid="${a.id}">
            <td class="nowrap">${fmtDate(a.date)}</td>
            <td><div class="strong">${esc(a.title)}</div>${a.note ? `<div class="small muted">${nl2br(a.note)}</div>` : ''}</td>
            <td class="small">${esc(a.how || '')}</td>
            <td>${f ? `<a href="${fileUrl(p, f)}" target="_blank" title="${esc(f.name)}">📎</a>` : ''}</td>
            <td><button class="icon-btn" data-action="ap-del">✕</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : ''}
    </div>`;
};

function approvalDialog() {
  const p = state.current;
  openDialog({
    title: 'Погодження з клієнтом',
    body: `
      <label class="field"><span>Що погоджено *</span><input name="title" required placeholder="Проєкт v2, колір фасадів, розміри, КП…"></label>
      <div class="row2">
        <label class="field"><span>Дата</span><input type="date" name="date" value="${localDate()}" required></label>
        <label class="field"><span>Як погоджено</span><input name="how" placeholder="Viber, підпис, email, усно"></label>
      </div>
      <label class="field"><span>Примітка</span><textarea name="note" rows="2"></textarea></label>
      <label class="field"><span>Файл (креслення, скрін, підписаний документ)</span><input type="file" name="file"></label>`,
    onSubmit: async form => {
      const d = Object.fromEntries(new FormData(form));
      let fileId = null;
      if (d.file && d.file.size) fileId = (await uploadFiles([d.file], 'Документи')).id;
      p.approvals.push({ id: uid(), date: d.date, title: d.title.trim(), how: d.how.trim(), note: d.note.trim(), fileId });
      addLog(p, `Погоджено з клієнтом: ${d.title.trim()}`, true);
      await saveNow();
      refreshTab();
    },
  });
}

// --- Нагадування

TAB_VIEWS.reminders = p => {
  const open = p.reminders.filter(r => !r.done).sort((a, b) => remDue(a).localeCompare(remDue(b)));
  const done = p.reminders.filter(r => r.done).sort((a, b) => remDue(b).localeCompare(remDue(a)));
  const quick = [['Сьогодні', 0], ['Завтра', 1], ['+3 дні', 3], ['+тиждень', 7]];
  return `
    <div class="card rem-form">
      <input class="grow" data-ref="rem-text" placeholder="Про що нагадати? Напр.: подзвонити клієнту щодо кольору фасадів">
      <input type="date" data-ref="rem-date" value="${addDays(1)}">
      <input type="time" data-ref="rem-time" title="Час (необов'язково)">
      <button class="btn primary" data-action="rem-add">Додати</button>
      <div class="quick">${quick.map(([l, d]) => `<button class="link-btn" data-action="rem-quick" data-d="${d}">${l}</button>`).join('')}</div>
    </div>
    ${open.length ? `<div class="rem-list">${open.map(r => remRow(r, p)).join('')}</div>` : '<div class="empty">Активних нагадувань немає.</div>'}
    ${done.length ? `<details class="rem-done-list"><summary class="muted">Виконані (${done.length})</summary>${done.map(r => remRow(r, p)).join('')}</details>` : ''}`;
};

function findReminder(el) {
  const row = el.closest('[data-rid]');
  const p = state.projects.find(x => x.id === row.dataset.pid);
  return { p, r: p.reminders.find(x => x.id === row.dataset.rid) };
}

function rerenderReminders() {
  if (state.current) { renderTabs(); if (state.tab === 'reminders' || state.tab === 'overview') renderTab(); }
  else { renderReminderPanel(); if ($('#list-body')) renderListBody(); }
}

function editReminderDialog(p, r) {
  openDialog({
    title: 'Редагувати нагадування',
    body: `
      <label class="field"><span>Текст</span><input name="text" required value="${esc(r.text)}"></label>
      <div class="row2">
        <label class="field"><span>Дата</span><input type="date" name="date" required value="${r.date}"></label>
        <label class="field"><span>Час</span><input type="time" name="time" value="${r.time || ''}"></label>
      </div>`,
    onSubmit: async form => {
      const d = Object.fromEntries(new FormData(form));
      Object.assign(r, { text: d.text.trim(), date: d.date, time: d.time, notified: false });
      await saveNow(p);
      rerenderReminders();
    },
  });
}

function addReminderFromInput() {
  const text = $('[data-ref="rem-text"]').value.trim();
  const date = $('[data-ref="rem-date"]').value;
  const time = $('[data-ref="rem-time"]').value;
  if (!text) { $('[data-ref="rem-text"]').focus(); return toast('Напишіть текст нагадування'); }
  if (!date) return toast('Оберіть дату');
  state.current.reminders.push({ id: uid(), text, date, time, done: false, notified: false, createdAt: new Date().toISOString() });
  saveSoon(0);
  refreshTab();
  toast('Нагадування додано');
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

// Перевірка нагадувань щохвилини: сповіщення браузера + підказка на сторінці
function checkReminders() {
  const nowKey = localDateTime();
  for (const p of state.projects) {
    if (isArchived(p)) continue;
    let changed = false;
    for (const r of p.reminders) {
      if (r.done || r.notified || remDue(r) > nowKey) continue;
      r.notified = true;
      changed = true;
      toast(`🔔 №${p.number} ${p.name}: ${r.text}`);
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`Нагадування: ${p.name}`, { body: r.text, tag: r.id });
        n.onclick = () => { window.focus(); location.hash = `#/project/${p.id}/reminders`; };
      }
    }
    if (changed) saveNow(p);
  }
  if (!state.current && $('#rem-panel')) renderReminderPanel();
}

// --- КП (комерційна пропозиція: титульна сторінка + сторінка на кожен виріб)

const KP_MAX_IMAGES = 4;
const KP_IMAGE_CATEGORY = 'Креслення / проєкт';

function plural(n, one, few, many) {
  n = Math.abs(Math.trunc(num(n)));
  const t = n % 100, u = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (u === 1) return one;
  return u >= 2 && u <= 4 ? few : many;
}
// **жирний**, [[червоний]]
const kpLine = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\]\]/g, '<span class="kp-red">$1</span>');
const kpQty = it => num(it.qty) || 1;
// Підпис рядка ціни за 1 шт; число там — не підпис (раніше туди вписували суму).
const kpUnitLabel = it => { const s = String(it.unitLabel || '').trim(); return s && !/^[\d\s.,]+$/.test(s) ? s : 'Вартість одного виробу'; };
const kpTotal = it => kpQty(it) * num(it.price);
const kpSumText = it => kpQty(it) > 1 ? `${fmtNum(kpQty(it))} шт × ${money(it.price)} = ${money(kpTotal(it))}` : money(it.price);
const newKpItem = p => ({ id: uid(), title: p.offer.items.length ? '' : (p.furnitureType || ''), imageIds: [], list: [''], qty: 1, price: 0, unitLabel: '', days: 20, warranty: 24 });
// Рядки матеріалів раніше були одним текстом із нумерацією вручну — тепер список, номер ставиться сам.
function ensureKpItem(it) {
  if (!Array.isArray(it.list)) {
    it.list = String(it.lines || '').split('\n').map(l => l.trim().replace(/^\d+\s*[.)]\s*/, '')).filter(Boolean);
    delete it.lines;
  }
  if (!it.list.length) it.list.push('');
  return it;
}
// Новий рядок після `after` (або в кінці) — і курсор у нього.
function kpAddLine(it, after = it.list.length - 1) {
  it.list.splice(after + 1, 0, '');
  saveSoon(0);
  renderTab();
  app.querySelector(`[data-kid="${it.id}"] [data-li="${after + 1}"] input`)?.focus();
}
// Матеріали й фурнітура з рахунків постачальників — для списку в КП; послуги (порізка, крайкування…) — ні.
const SERVICE = /порізк|підрізк|крайкуван|свердлін|присадк|фрезерн|комплектуван|доставк|упаковк|пакуван|послуг/i;
const invoiceGoods = p => [...new Set(supplierInvoices(p).flatMap(i => i.items || []).map(it => it.name.trim()).filter(n => n && !SERVICE.test(n)))];
const findKpItem = (p, el) => p.offer.items.find(x => x.id === el.closest('[data-kid]').dataset.kid);

function kpItemHtml(p, it, i, imgs) {
  const n = p.offer.items.length;
  const I = (k, label, type = 'number') => `<label class="field"><span>${label}</span><input type="${type}" ${type === 'number' ? 'step="any"' : ''} data-action="kpi" data-k="${k}" value="${esc(it[k])}"></label>`;
  return `
    <div class="card kp-item" data-kid="${it.id}">
      <div class="card-head">
        <span class="muted">${i + 1}.</span>
        <input class="t-group-name" data-action="kpi" data-k="title" value="${esc(it.title)}" placeholder="Назва виробу: Стіл, Кухня, Інсталяція…">
        <div class="spacer"></div>
        ${n > 1 ? `<button class="icon-btn" data-action="kp-up" title="Вище">↑</button><button class="icon-btn" data-action="kp-down" title="Нижче">↓</button>` : ''}
        <button class="icon-btn" data-action="kp-del" title="Видалити виріб">✕</button>
      </div>
      <div class="kp-edit">
        <div>
          <div class="muted small">Зображення на сторінці (до ${KP_MAX_IMAGES}) — клікніть, щоб обрати. <b>Ctrl+V</b> — вставити знімок екрана з Базиса.</div>
          <div class="kp-thumbs">
            ${imgs.map(f => {
              const k = it.imageIds.indexOf(f.id);
              return `<button class="kp-thumb ${k >= 0 ? 'on' : ''}" data-action="kp-img" data-fid="${f.id}" title="${esc(f.name)}"><img src="${fileUrl(p, f)}" loading="lazy" alt="">${k >= 0 ? `<span class="kp-n">${k + 1}</span>` : ''}</button>`;
            }).join('')}
            <label class="kp-thumb kp-upload" title="Завантажити зображення">+<input type="file" accept="image/*" multiple hidden data-action="kp-upload"></label>
          </div>
        </div>
        <div>
          <div class="field"><span>Матеріали та фурнітура — у КП пронумеруються самі</span></div>
          <div class="kp-list">
            ${it.list.map((line, li) => `
              <div class="kp-li" data-li="${li}">
                <span class="muted">${li + 1}.</span>
                <input data-action="kpl" value="${esc(line)}" list="kp-mat-list" placeholder="${li ? '' : 'ДСП Kronospan 7045 SU Сатин 2800х2070х18мм'}">
                <button class="icon-btn" data-action="kpl-up" title="Вище" ${li ? '' : 'disabled'}>↑</button>
                <button class="icon-btn" data-action="kpl-down" title="Нижче" ${li < it.list.length - 1 ? '' : 'disabled'}>↓</button>
                <button class="icon-btn" data-action="kpl-del" title="Видалити">✕</button>
              </div>`).join('')}
          </div>
          <div class="muted small kp-hint">
            <span><button class="link-btn" data-action="kpl-add">+ рядок</button> (або Enter) · <code>**текст**</code> — жирний, <code>[[текст]]</code> — червоний</span>
            <button class="link-btn" data-action="kp-mats" title="Матеріали й фурнітура з рахунків постачальників (без послуг)">+ з рахунків</button>
          </div>
        </div>
      </div>
      <div class="kp-nums">
        ${I('qty', 'Кількість, шт')}
        ${I('price', 'Ціна за 1 шт, грн')}
        ${I('days', 'Термін, робочих днів')}
        ${I('warranty', 'Гарантія, місяців')}
        ${I('unitLabel', 'Текст рядка ціни за 1 шт, напр. «Вартість одного стола»', 'text')}
      </div>
      <div class="kp-sum">Вартість: <b>${kpSumText(it)}</b></div>
    </div>`;
}

TAB_VIEWS.offer = p => {
  const o = p.offer, s = state.settings;
  const imgs = p.files.filter(f => IMG_EXT.test(f.ext));
  const total = o.items.reduce((a, it) => a + kpTotal(it), 0);
  return `
    <div class="toolbar">
      <label class="field inline"><span>Дата КП</span><input type="date" data-action="kp" data-k="date" value="${esc(o.date || localDate())}"></label>
      <div class="spacer"></div>
      ${o.items.length > 1 ? `<span class="muted">Разом: <b id="kp-total">${money(total)}</b></span>` : ''}
      <button class="btn" data-action="kp-add">+ Виріб</button>
      <button class="btn primary" data-action="kp-print" ${o.items.length ? '' : 'disabled'}>🖨 КП (PDF)</button>
    </div>
    ${!s.logo && !s.brand ? '<div class="card muted small">Логотип, назву бренду, телефон, email, Instagram і адресу для титульної сторінки КП заповніть у <a href="#/settings">Налаштуваннях</a>.</div>' : ''}
    <datalist id="kp-mat-list">${invoiceGoods(p).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${o.items.map((it, i) => kpItemHtml(p, it, i, imgs)).join('') || '<div class="empty">Комерційна пропозиція: титульна сторінка з логотипом і контактами, далі по сторінці на кожен виріб — зображення, матеріали, вартість, термін і гарантія.<br><br><button class="btn primary" data-action="kp-add">+ Додати виріб</button></div>'}`;
};

async function kpAddImages(p, it, files) {
  files = [...files].filter(f => f.type.startsWith('image/'));
  if (!files.length) return toast('Потрібне зображення (JPG, PNG…)', true);
  for (const [i, f] of files.entries()) {
    toast(`Завантаження ${i + 1}/${files.length}`);
    const name = f.name && f.name !== 'image.png' ? f.name : `КП_${localDate()}_${uid().slice(0, 4)}.png`;
    const r = await request('POST', `/api/projects/${p.id}/files?name=${encodeURIComponent(name)}&category=${encodeURIComponent(KP_IMAGE_CATEGORY)}`, f, true);
    p.files = r.files;
    if (it.imageIds.length < KP_MAX_IMAGES) it.imageIds.push(r.file.id);
  }
  toast(files.length === 1 ? 'Зображення додано' : `Додано зображень: ${files.length}`);
  saveSoon(0);
  if (state.current === p && state.tab === 'offer') refreshTab();
}

function kpLogoHtml() {
  const s = state.settings;
  if (s.logo) return `<img class="kp-logo-img" src="${esc(s.logo)}" alt="">`;
  const b = [...String(s.brand || '').trim()];
  if (b.length === 4) return `<div class="kp-logo-grid">${b.map(c => `<span>${esc(c)}</span>`).join('')}</div>`;
  return b.length ? `<div class="kp-logo-text">${esc(b.join(''))}</div>` : '';
}

// Зображення ширші за висоту — одне під одним, вищі — поруч в один ряд. Широких 3–4 — сіткою 2×2.
function kpColumns(imgs, ratios) {
  const n = imgs.length;
  if (n < 2) return 1;
  const wide = imgs.reduce((s, f) => s + (ratios.get(f.id) ?? 1), 0) / n > 1;
  if (wide) return n > 2 ? 2 : 1;
  return n > 3 ? 2 : n;
}

// Співвідношення ширина / висота кожного зображення — щоб розкласти їх на сторінці.
function imageRatios(p, ids) {
  return Promise.all(ids.map(id => new Promise(resolve => {
    const f = p.files.find(x => x.id === id);
    if (!f) return resolve([id, 1]);
    const img = new Image();
    img.onload = () => resolve([id, img.naturalWidth / (img.naturalHeight || 1)]);
    img.onerror = () => resolve([id, 1]);
    img.src = fileUrl(p, f);
  }))).then(pairs => new Map(pairs));
}

function kpItemPage(p, it, ratios) {
  const imgs = it.imageIds.map(id => p.files.find(f => f.id === id)).filter(Boolean);
  const lines = it.list.map(l => l.trim()).filter(Boolean).map((l, i) => `${i + 1}. ${l}`);
  while (lines.length < 4) lines.push('');
  const q = kpQty(it);
  const rows = q > 1
    ? [[kpUnitLabel(it), money(it.price)], [`Загальна вартість (${fmtNum(q)} шт)`, money(kpTotal(it))]]
    : [['Вартість', money(it.price)]];
  if (num(it.days)) rows.push(['Термін виконання', `${fmtNum(it.days)} ${plural(it.days, 'робочий день', 'робочі дні', 'робочих днів')}`]);
  if (num(it.warranty)) rows.push(['Гарантія', `${fmtNum(it.warranty)} ${plural(it.warranty, 'місяць', 'місяці', 'місяців')}`]);
  return `
    <section class="kp-page"><div class="kp-sheet">
      <div class="kp-title">${esc(it.title || p.furnitureType || p.name)}</div>
      <div class="kp-images" style="grid-template-columns: repeat(${kpColumns(imgs, ratios)}, 1fr)">${imgs.map(f => `<img src="${fileUrl(p, f)}" alt="">`).join('')}</div>
      ${lines.map(l => `<div class="kp-row">${kpLine(l) || '&nbsp;'}</div>`).join('')}
      <div class="kp-prices">${rows.map(([k, v]) => `<div>${esc(k)}</div><div class="r"><b>${esc(v)}</b></div>`).join('')}</div>
    </div></section>`;
}

async function printKp(p) {
  const o = p.offer, s = state.settings;
  if (!o.items.length) return toast('Додайте хоча б один виріб', true);
  const ratios = await imageRatios(p, o.items.flatMap(it => it.imageIds));
  const date = fmtDate(o.date || localDate());
  const contacts = [
    s.tagline && esc(s.tagline), s.phone && esc(s.phone), s.email && `<u>${esc(s.email)}</u>`,
    s.instagram && `<u>${esc(s.instagram)}</u>`, s.address && esc(s.address),
  ].filter(Boolean);
  let summary = '';
  if (o.items.length > 1) {
    const total = o.items.reduce((a, it) => a + kpTotal(it), 0);
    summary = `
      <section class="kp-page"><div class="kp-sheet auto">
        <div class="kp-title">Загальна вартість</div>
        <div class="kp-prices">${o.items.map(it => `<div>${esc(it.title || p.name)}${kpQty(it) > 1 ? ` (${fmtNum(kpQty(it))} шт)` : ''}</div><div class="r">${money(kpTotal(it))}</div>`).join('')}
          <div><b>Разом</b></div><div class="r"><b>${money(total)}</b></div></div>
      </div></section>`;
  }
  // Ім'я PDF за замовчуванням: КП_INOM_06.10.2026 (бренд з «Налаштувань»).
  const fileName = ['КП', s.brand || s.companyName, date].map(x => String(x || '').trim()).filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, '-');
  printDoc(fileName, `
    <div class="kp">
      <section class="kp-page">
        <div class="kp-cover-top"><div>${kpLogoHtml()}</div><b>${date} р.</b></div>
        <div class="kp-contacts">${contacts.join('<br>')}</div>
      </section>
      ${o.items.map(it => kpItemPage(p, it, ratios)).join('')}
      ${summary}
    </div>`);
}

// --- Договір (за зразком «№148_19_09_2026_Договір_меблі»: текст дослівно; дані — з проєкту, КП, рахунків і «Налаштувань»)

const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

// «19» вересня 2026 року / 19 вересня 2026 року
function dateWords(iso, quoted = true) {
  const [y, m, d] = (iso || localDate()).split('-');
  return `${quoted ? `«${d}»` : Number(d)} ${MONTHS_GEN[Number(m) - 1]} ${y} року`;
}

// Сума прописом: «сто тисяч гривень, 00 копійок».
function moneyWords(amount) {
  const ONES_M = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
  const ONES_F = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
  const TEENS = ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять", 'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять"];
  const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
  const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];
  const triad = (n, fem) => {
    const out = [HUNDREDS[Math.floor(n / 100)]];
    const r = n % 100;
    if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
    else out.push(TENS[Math.floor(r / 10)], (fem ? ONES_F : ONES_M)[r % 10]);
    return out.filter(Boolean).join(' ');
  };
  const total = Math.round(num(amount) * 100);
  let uah = Math.floor(total / 100);
  const kop = total % 100;
  const parts = [];
  for (const [size, fem, names] of [[1e9, false, ['мільярд', 'мільярди', 'мільярдів']], [1e6, false, ['мільйон', 'мільйони', 'мільйонів']], [1e3, true, ['тисяча', 'тисячі', 'тисяч']]]) {
    const n = Math.floor(uah / size);
    if (n) parts.push(triad(n, fem), plural(n, ...names));
    uah %= size;
  }
  if (uah) parts.push(triad(uah, true));
  const whole = Math.floor(total / 100);
  return `${parts.join(' ') || 'нуль'} ${plural(whole, 'гривня', 'гривні', 'гривень')}, ${String(kop).padStart(2, '0')} ${plural(kop, 'копійка', 'копійки', 'копійок')}`;
}
// «100 000 (сто тисяч гривень, 00 копійок) гривень» — як у зразку.
const moneyFull = v => `${fmtNum(v)} (${moneyWords(v)}) ${plural(Math.floor(num(v)), 'гривня', 'гривні', 'гривень')}`;

// Номер нового договору — наступний за найбільшим уже виданим.
function nextContractNumber(p) {
  const used = state.projects.filter(x => x !== p).map(x => parseInt(x.contract?.number, 10)).filter(Number.isFinite);
  return used.length ? String(Math.max(...used) + 1) : String(p.number);
}

function contractTerms(p) {
  const c = p.contract;
  const its = p.offer.items;
  const maxOf = k => Math.max(0, ...its.map(it => num(it[k])));
  const total = kpSum(p);
  const pay1 = c.pay1 === '' || c.pay1 == null ? Math.round(total / 2 / 1000) * 1000 : num(c.pay1);
  const pay2 = num(c.pay2);
  return {
    number: c.number || nextContractNumber(p), date: c.date || localDate(),
    days: num(c.days) || maxOf('days') || 40, warranty: maxOf('warranty') || 24,
    total, pay1, pay2, rest: Math.round((total - pay1 - pay2) * 100) / 100,
  };
}

TAB_VIEWS.contract = p => {
  const c = p.contract, t = contractTerms(p), s = state.settings;
  const C = (k, label, attrs = '') => `<label class="field"><span>${label}</span><input data-action="dg" data-k="${k}" value="${esc(c[k] ?? '')}" ${attrs}></label>`;
  const F = (field, label, attrs = '') => `<label class="field"><span>${label}</span><input data-field="${field}" value="${esc(p[field] ?? '')}" ${attrs}></label>`;
  const warn = [
    !p.offer.items.length && `немає виробів у <a href="#/project/${p.id}/offer">КП</a> — специфікація, суми й візуалізація беруться звідти`,
    !s.companyName && 'не заповнено «Виконавець» у <a href="#/settings">Налаштуваннях</a>',
    !s.details && 'немає реквізитів виконавця у <a href="#/settings">Налаштуваннях</a>',
    !p.client && 'не вказано ПІБ замовника',
    t.rest < 0 && 'платежі більші за вартість — залишок від\'ємний',
  ].filter(Boolean);
  return `
    ${warn.length ? `<div class="card warn-card small">⚠ ${warn.join('; ')}.</div>` : ''}
    <div class="grid-side">
      <div>
        <div class="card">
          <h3>Договір</h3>
          <div class="form-grid">
            ${C('number', 'Номер договору', `placeholder="${esc(t.number)}"`)}
            <label class="field"><span>Дата договору</span><input type="date" data-action="dg" data-k="date" value="${esc(c.date || localDate())}"></label>
          </div>
        </div>
        <div class="card">
          <h3>Замовник</h3>
          <div class="form-grid">
            ${F('client', 'ПІБ замовника', 'list="clients-list" autocomplete="off"')}
            ${C('clientDoc', 'ІПН замовника')}
            ${F('address', 'Адреса')}
            ${F('phone', 'Телефон', 'type="tel"')}
          </div>
        </div>
        <div class="card">
          <h3>Оплата й строки (Додаток № 1)</h3>
          <div class="form-grid">
            ${C('pay1', 'Передплата, грн', `type="number" step="any" placeholder="${t.pay1}"`)}
            ${C('pay2', 'Другий платіж у день доставки, грн (0 — без нього)', 'type="number" step="any"')}
            ${C('days', 'Виготовити й доставити за, робочих днів', `type="number" placeholder="${t.days}"`)}
          </div>
          <p class="muted small" style="margin-bottom:0">Залишок — у день завершення монтажу — рахується сам. Гарантія в специфікації — з КП.</p>
        </div>
      </div>
      <div class="side">
        <div class="card" id="dg-sum">${contractSumHtml(p)}</div>
        <div class="card stack">
          <button class="btn primary" data-action="dg-print" ${p.offer.items.length ? '' : 'disabled'}>🖨 Договір (PDF)</button>
          <span class="muted small">Договір + Додаток № 1 (специфікація з КП), № 2 (візуалізація — картинки з КП), № 3 (матеріали й фурнітура з КП, артикули — з рахунків).</span>
        </div>
      </div>
    </div>`;
};

function contractSumHtml(p) {
  const t = contractTerms(p);
  return `
    <div class="kv"><span>Вартість (з КП)</span><b>${money(t.total)}</b></div>
    <div class="kv"><span>Передплата</span><b>${money(t.pay1)}</b></div>
    ${t.pay2 ? `<div class="kv"><span>У день доставки</span><b>${money(t.pay2)}</b></div>` : ''}
    <div class="kv"><span>Залишок (у день монтажу)</span><b class="${t.rest < 0 ? 'warn-text' : ''}">${money(t.rest)}</b></div>
    <div class="kv"><span>Строк</span><b>${fmtNum(t.days)} ${plural(t.days, 'робочий день', 'робочі дні', 'робочих днів')}</b></div>`;
}

// Абзаци договору: «Виконавець», «Замовник», «Меблі», «Монтажник» — жирним, як у зразку.
const dgBold = html => html.replace(/(^|[\s(«"„])((?:Виконав|Замовник|Меблі|Меблів|Меблям|Меблями|Монтажник)[а-яіїєґ']*)/g, '$1<b>$2</b>');
const dgP = (n, text) => `<div class="dg-p"><b>${n}</b><span>${dgBold(text)}</span></div>`;
const dgH = text => `<h2 class="dg-h">${text}</h2>`;

function printContract(p) {
  if (!p.offer.items.length) return toast('Спершу додайте вироби в «КП» — з них специфікація, суми й візуалізація', true);
  const c = p.contract, t = contractTerms(p), s = state.settings;
  const fop = String(s.companyName || '').replace(/^\s*ФОП\s+/i, '').trim() || '____________________';
  const client = p.client ? esc(p.client) : '____________________';
  const ipn = c.clientDoc ? `, ІПН ${esc(c.clientDoc)}` : '';
  const parties = (what) => `<b>ФІЗИЧНА ОСОБА ${client}</b>${ipn}, надалі іменується <b>Замовник, -</b> з однієї сторони, та <b>ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ ${esc(fop)}</b>, який діє на підставі Виписки про державну реєстрацію, надалі іменується <b>Виконавець</b>, з другої сторони, надалі кожна окремо «Сторона», а разом – «Сторони», ${what}`;
  const ref = `Договору на виготовлення меблів №${esc(t.number)} від ${dateWords(t.date, false)}`;
  const annex = (n, title) => `<div class="dg-break"></div><div class="dg-annex">Додаток № ${n} до<br>${ref}.</div>${title ? `<h1 class="dg-title">${title}</h1>` : ''}`;
  const requisites = `
    <table class="dg-req">
      <tr><th>Виконавець:</th><th>Замовник:</th></tr>
      <tr><td>${esc(s.companyName || '')}${s.details ? '<br>' + nl2br(s.details) : ''}</td>
        <td>${client}${c.clientDoc ? `<br>ІПН ${esc(c.clientDoc)}` : ''}${p.address ? `<br>Адреса: ${esc(p.address)}` : ''}${p.phone ? `<br>Тел (${esc(p.phone)})` : ''}</td></tr>
      <tr class="dg-req-sign"><td></td><td></td></tr>
    </table>`;
  const plain = l => l.replace(/\*\*|\[\[|\]\]/g, '').trim();

  // Додаток № 1 — меблі з КП
  const rows = p.offer.items.map((it, i) => `<tr><td>${i + 1}</td><td><b>${esc(it.title || p.name)}</b></td><td></td><td>шт</td><td>${fmtNum(kpQty(it))}</td><td>${fmtNum(it.price)}</td><td>${fmtNum(kpTotal(it))}</td><td>${fmtNum(num(it.warranty) || t.warranty)} ${plural(num(it.warranty) || t.warranty, 'місяць', 'місяці', 'місяців')}</td></tr>`).join('');
  const pays = [
    ['Сума передплати', t.pay1, 'Замовник здійснює передплату у повній сумі в точці продажу (офісі) Виконавця одночасно із укладанням цього Договору або на розрахунковий рахунок Виконавця.'],
    t.pay2 ? ['Другий платіж', t.pay2, 'Замовник оплачує в день доставки Меблів, шляхом передачі коштів представнику Виконавця, або на розрахунковий рахунок Виконавця.'] : null,
    t.rest > 0 ? ['Залишок за договором', t.rest, 'Замовник оплачує залишок за договором в день завершення монтажу Меблів, шляхом передачі коштів представнику Виконавця, або на розрахунковий рахунок Виконавця.'] : null,
  ].filter(Boolean);

  // Додаток № 2 — картинки з КП
  const visual = p.offer.items.map(it => {
    const imgs = it.imageIds.map(id => p.files.find(f => f.id === id)).filter(Boolean);
    // Назва виробу — разом із першою картинкою (не лишається сама внизу сторінки).
    const img = f => `<img src="${fileUrl(p, f)}" alt="">`;
    return imgs.length ? `<div class="dg-vis"><div class="dg-vis-head"><div class="dg-vis-title">${esc(it.title || p.name)}</div>${img(imgs[0])}</div>${imgs.slice(1).map(img).join('')}</div>` : '';
  }).join('');

  // Додаток № 3 — матеріали й фурнітура з КП; артикул — код товару з рахунків
  const codes = new Map(supplierInvoices(p).flatMap(i => i.items || []).filter(it => it.code).map(it => [it.name.trim().toLowerCase(), it.code]));
  const mats = [...new Set(p.offer.items.flatMap(it => it.list.map(plain)).filter(Boolean))];

  const fileName = ['№' + t.number, fmtDate(t.date).replace(/\./g, '_'), 'Договір_меблі'].join('_').replace(/[\\/:*?"<>|]+/g, '-');
  printDoc(fileName, `
    <table class="dg-page"><thead><tr><td></td></tr></thead>
    <tfoot><tr><td><div class="dg-foot"><span>Виконавець <i></i></span><span>Замовник <i></i></span></div></td></tr></tfoot>
    <tbody><tr><td class="dg-doc">
      <h1 class="dg-title">ДОГОВІР<br>№ ${esc(t.number)}</h1>
      <div class="dg-place"><b>м. ${esc(s.city || 'Київ')}</b><b>${dateWords(t.date)}</b></div>
      <p class="dg-intro">${parties('керуючись нормами чинного законодавства України уклали цей Договір, далі – «Договір», про наступне:')}</p>

      ${dgH('ВИЗНАЧЕННЯ ТЕРМІНІВ')}
      <p class="dg-def"><b>Збірка Меблів</b> – підготовка матеріалів та виготовлення модульних конструкцій безпосередньо на виробництві <b>Виконавця</b>.</p>
      <p class="dg-def"><b>Монтаж Меблів</b> – встановлення та закріплення модулів <b>Меблів</b>, врізка, монтування техніки.</p>
      <p class="dg-def"><b>Контрольний замір</b> – необхідні заміри приміщення, в якому буде проводитись монтаж <b>Меблів</b>, на підставі яких відбувається конструювання <b>Меблів</b>.</p>
      <p class="dg-def"><b>Монтажник</b> – уповноважений працівник <b>Виконавця</b>, що здійснює монтаж <b>Меблів</b>.</p>

      ${dgH('1. ПРЕДМЕТ ДОГОВОРУ')}
      ${dgP('1.1.', 'Виконавець зобов’язується надати за завданням Замовника послуги з виготовлення та монтажу меблів (далі – Меблі) і передати їх Замовнику, а Замовник відповідно до умов цього Договору зобов’язується прийняти та оплатити за такі Меблі.')}
      ${dgP('1.2.', 'Вид Меблів, кількість, комплексність, комплектація, матеріал, узгоджуються Сторонами в Дизайн-проекті Меблів замовника.')}

      ${dgH('2. ТЕРМІНИ ВИГОТОВЛЕННЯ, ПОРЯДОК ДОСТАВКИ, ВСТАНОВЛЕННЯ')}
      ${dgP('2.1.', 'Фактична дата виготовлення та доставка Меблів погоджується із Замовником в Додатку № 1.')}
      ${dgP('2.2.', 'Перед настанням терміну доставки і монтажу Меблів, Виконавець повідомляє Замовника про готовність і уточнює час і дату доставки. Замовник, у разі зміни часу доставки, не менше ніж за 24 години повинен повідомити про це Виконавця і узгодити з ним новий час.')}
      ${dgP('2.3.', 'У разі, якщо з незалежних від Виконавця причин (несвоєчасне постачання матеріалів постачальником та інші обставини, які не залежать від сили та волі Виконавця), останній не вкладається в установлений термін, він має право перенести строк виконання замовлення до 30 робочих днів за згодою Сторін.')}
      ${dgP('2.4.', 'Претензії щодо візуально-видимих недоліків Меблів, після підписання Замовником акту приймання-передачі виконаних робіт, не приймаються. У разі виявлення дефекту Меблів або його некомплектності, Замовник спільно з представником Виконавця здійснюють відповідний запис в акті прийому-передачі виконаних Меблів та погоджують порядок і терміни усунення виявлених недоліків.')}
      ${dgP('2.5.', 'По завершенню монтажу Меблів, Замовник (або його довірена особа), зобов’язаний перевірити та прийняти Меблі за якістю, комплектністю і кількістю та підписати Акт прийому-передачі виконаних робіт.')}
      ${dgP('2.6.', 'Якщо протягом 5 (п’яти) календарних днів після отримання Акту прийому-передачі виконаних робіт Замовник не висуває письмової претензії до наданих послуг, такий Акт прийому-передачі виконаних робіт вважається погоджений та підписаний між Сторонами.')}

      ${dgH('3. ВАРТІСТЬ ДОГОВОРУ І ПОРЯДОК РОЗРАХУНКІВ')}
      ${dgP('3.1.', 'Загальна сума Договору складається з сум усіх Актів приймання-передачі виконаних робіт за період дії цього Договору. Вартість послуг встановлюється в національній валюті України – гривня. Вартість Меблів та черговість оплати зазначаються у Додатку № 1 до даного Договору. Зазначена в Додатку № 1 ціна вважається чинною протягом 60 (шістдесяти) календарних днів з моменту його підписання, не є остаточною згідно технічного завдання і може бути змінена.')}
      ${dgP('3.2.', 'У разі порушення Замовником терміну оплати, Виконавець вправі зупинити подальше надання послуг з виготовлення меблів, до моменту повного погашення Замовником заборгованості згідно умов Додатку № 1.')}
      ${dgP('3.3.', 'Додаткові платежі, необхідність в яких може виникнути при виконанні цього Договору, підлягають відшкодуванню Замовником окремо, за умови якщо їх підтверджено документально. Документальним підтвердженням вважається наданий Виконавцем лист-розрахунок про додаткові платежі.')}
      ${dgP('3.4.', 'Вартість доставки та монтажу включено в ціну Меблів.')}
      ${dgP('3.5.', 'Доставка Меблів до квартири (підйом на поверх) оплачується окремо, в тому випадку, якщо відсутній ліфт, або деталі не вміщаються в ліфт.')}
      ${dgP('3.6.', 'Вартість послуг з підйому визначається в калькуляції і залежить від поверху і кількості підйомів та оплачується додатково, в день доставки Меблів .')}
      ${dgP('3.7.', 'Підйом меблів в квартиру без ліфта - 40 грн. за поверх – один підйом, однією людиною, перший поверх не враховується.')}
      ${dgP('3.8.', 'Підключення і гарантійне обслуговування вбудованої кухонної техніки здійснюються виробниками (дилерами виробників) або організаціями, що зазначені у гарантійних талонах (технічних паспортах, сервісних книжках) на цю техніку, які передаються Продавцем Покупцю разом з Товаром.')}
      ${dgP('3.9.', 'Підключення сантехнічних виробів та прокладення сантехнічних мереж (водопостачання, водовідведення) Виконавцем не здійснюється.')}
      ${dgP('3.10.', 'Техніка, що стоїть чи висить окремо (холодильник, витяжка, і т.д.) встановлюється силами Замовника, або за окрему плату Виконавцем, вартість якої залежить від складності установки.')}
      ${dgP('3.11.', 'Вартість вищезазначених додаткових послуг не є частиною цього договору, не входить в зобов’язання за цим Договором і оплачується Замовником окремо, за їх фактом виконання.')}

      ${dgH('4. ПРАВА ТА ОБОВ’ЯЗКИ СТОРІН')}
      <div class="dg-p"><b>4.1.</b><span><b>Права та обов’язки Виконавця:</b></span></div>
      ${dgP('4.1.1.', 'Виконавець зобов\'язаний передати Замовнику Меблі належної якості, які відповідають технічним кресленням, складеним на підставі контрольного заміру, погодженим з Замовником, та комплектації, описаній в Специфікації, у строк, зазначений у Додатку № 1.')}
      ${dgP('4.1.2.', 'Виконавець зобов\'язаний усунути визнані ним недоліки Меблів, виявлені в процесі приймання Меблів Замовником, у термін не більше 45 (сорока п’яти) календарних днів з дня винесення висновку щодо претензії Замовника.')}
      ${dgP('4.1.3.', 'Виконавець має право, встановлювати і вносити зміни в технічні особливості і конструктив Меблів, які не впливають істотно на його зовнішній вигляд і вартість, за згодою сторін (наприклад: фальш-панелі, відступи, технологічні розміри і т.д.).')}
      ${dgP('4.1.4.', 'Перевірка якості виконання ремонту приміщення Замовника не входить в зобов\'язання Виконавця в особі Монтажника або іншого представника Виконавця.')}
      ${dgP('4.1.5.', 'Виконавець має право здійснювати фото- та/або відео-зйомку вже змонтованих Меблів з подальшим використанням отриманих фото- та/або відеоматеріалів в рекламних цілях на власний розсуд. Авторські права на отримані в процесі зйомки матеріали належать Виконавцю.')}
      ${dgP('4.1.6.', 'Виконавець зобов’язується надати Замовнику конструкторське креслення Меблів (надалі за текстом – креслення), за вимогою Замовника виготовити та надати зразки Меблів на погодження Замовнику. Замовник зобов’язується погодити дане креслення та передані зразки Меблів протягом 4 (чотирьох) робочих днів від дати отримання. У разі збільшення строків погодження між Сторонами, термін виготовлення та доставки Меблів збільшується пропорційно кількість днів.')}
      <div class="dg-p"><b>4.2.</b><span><b>Права та обов’язки Замовника:</b></span></div>
      ${dgP('4.2.1.', 'Замовник зобов\'язаний забезпечити можливість доставки і установки Меблів у строк, що зазначений у Додатку № 2. При неготовності приміщення Замовника до монтажу Меблів в зазначений термін (<i>не здійснено вчасно ремонт приміщення тощо</i>), Замовник зобов\'язаний (до настання «фактичної готовності Меблів до доставки») оплатити 100% вартості Меблів (забезпечивши остаточну оплату залишку коштів у сумі, зазначену в Додатку № 2) і прийняти доставку Меблів за адресою установки, або за будь-якою іншою адресою, з подальшим транспортуванням Меблів власними силами, за власний рахунок і під особисту відповідальність Замовника. Монтаж Меблів, в такому випадку, буде здійснено за окрему додаткову плату та у додатково погоджені з Виконавцем строки.')}
      ${dgP('4.2.2.', 'Замовник зобов\'язаний надати Виконавцю схему прихованих комунікацій (прихованої проводки, труб опалення і т.д.). У випадку не надання даної схеми, вся відповідальність за пошкодження прихованих комунікацій і наслідки їх пошкодження повністю покладається на Замовника. У деяких випадках, Виконавець, в особі Монтажника, має право відмовитися від робіт, пов\'язаних з ризиком пошкодження схованих комунікацій або наявного ремонту приміщення (пошкодження плитки, підлоги, стелі та ін.).')}
      ${dgP('4.2.3.', 'У разі зміни конструювання приміщення після того, як Виконавцем було проведено контрольний замір, Замовник зобов’язується повідомити про це Виконавця. У разі неповідомлення про зміну конструювання приміщення, претензії, викликані наслідками недодержання даних вимог не приймаються. Переробка або підгонка Меблів, пов’язані з порушенням даних вимог, можуть бути здійснені лише за додаткову оплату.')}
      ${dgP('4.2.4.', 'Перед проведенням монтажу Меблів, Замовник, щоб уникнути псуванню і забрудненню Меблів, зобов\'язаний вкрити меблі, підлогу, побутові прилади, прибрати зайві предмети, провести демонтаж старих меблів, провести відключення сантехніки.')}
      ${dgP('4.2.5', 'Замовник зобов\'язаний виконати прийняття Меблів після його встановлення і підписати акт прийому-передачі виконаних робіт, згідно з порядком, встановленим цим Договором.')}
      ${dgP('4.2.6.', 'У разі неможливості здійснення Виконавцем монтажу Меблів у день доставки через обставини, що не залежать від Виконавця (немає електроенергії, аварійна ситуація на об’єкті, немає доступу до місця встановлення Меблів та/або ін.), Замовник зобов\'язується забезпечити цілісність фабричної упаковки переданих йому Меблів та елементів, і передати їх монтажній бригаді в тому вигляді, в якому він їх отримав.')}
      ${dgP('4.2.7.', 'У разі відмови Замовника від виконання Договору до передачі йому Меблів, Замовник зобов\'язаний сплатити Виконавцю частину встановленої цим Договором загальної вартості договору, пропорційно обсягу роботи, виконаної Виконавцем, з метою виконання цього Договору, включаючи прямі і непрямі витрати Виконавця.')}
      ${dgP('4.2.8.', 'Замовник зобов\'язаний здійснити своєчасну оплату Меблів, згідно з умовами, описаними у Додатку № 1. При порушенні порядку та/або термінів оплати, Виконавець має право стягнути з Замовника неустойку у розмірі подвійної облікової ставки НБУ від загальної суми залишку згідно з Додатком № 1 за кожен день прострочення.')}
      ${dgP('4.2.9.', 'У разі порушення Виконавцем строку виконання своїх зобов\'язань, передбачених пунктом 2 цього Договору з вини Виконавця, Замовник вправі стягнути з Виконавця неустойку, у розмірі 0,01% від загальної вартості недопоставлених Меблів за кожен день прострочки, але у будь-якому випадку не більше загальної вартості недопоставлених елементів Меблів.')}

      ${dgH('5. ЯКІСТЬ МЕБЛІВ ТА ГАРАНТІЙНІ ОБОВ’ЯЗКИ')}
      ${dgP('5.1.', 'Меблі, що доставляються в рамках цього Договору є корпусними. Окремі деталі Меблів мають гранично-допустимі відхилення в розмірах, які разом з вадами кривизни стін, можуть в результаті монтажу незначно змінити загальні габаритні розміри Меблів в більшу сторону. Враховуючи ці фактори, при проектуванні Меблів, затиснутих між двома стінами, робиться технічний відступ від другої стіни, розмір якого технолог вибирає самостійно, для безперешкодної установки Меблів в нішу. У випадку, якщо розмір цього відступу (щілини між стіною і крайнім корпусом Меблів) не перевищує 20 мм, щілина залишається незакритою. У разі якщо Замовник, при підписанні договору зафіксував у специфікації бажання виготовити Меблі від стіни до стіни, Виконавець проектує Меблі таким чином, щоб між стіною і крайнім ящиком Меблів залишився отвір не менше 50 мм. Цей отвір закривається фальш-фасадом, який підпилюється в розмір за місцем установки.')}
      <div class="dg-p"><b>5.2</b><span><b>Гарантія:</b></span></div>
      ${dgP('5.2.1.', 'Загальні умови:<br>– Гарантійний ремонт Меблів здійснюється тільки при наявності акту приймання-передачі Меблів за даним Договором та Чеку;<br>– Гарантія передбачає виконання ремонтних робіт Меблів та/або окремих їх частин та/або механізмів, якщо пошкодження виникли з вини Виконавця.')}
      ${dgP('5.2.2.', 'На виготовлені Меблі, а також на фурнітуру, Виконавець встановлює гарантійний термін в Додатку № 1. Термін обчислюється з моменту підписання Замовником акту приймання-передачі Меблів.')}
      ${dgP('5.3.', 'Гарантія не поширюється на Меблі у разі їх самостійної установки Замовником або установки із залученням третьої сторони.')}
      ${dgP('5.4.', 'Безкоштовному гарантійному обслуговуванню не підлягають: скло, дзеркала, ламкі деталі (маркуються етикетками «Обережно»). Кількість та цілісність вищевказаних елементів Замовник зобов’язаний перевірити спільно із Виконавцем (або з Монтажником).')}
      ${dgP('5.5.', 'Меблі знімаються з гарантії у випадку їх пошкодження або окремих їх частин та/або механізмів в результаті:')}
      <ul class="dg-dash">${['стороннього втручання або спроби самостійного ремонту;', 'несанкціонованих змін конструкції та/або схем виробу, не передбачених даним Договором;', 'механічних пошкоджень або впливу занадто великого навантаження;', 'механічних пошкоджень через використання окремих частин Меблів не за цільовим призначенням;', 'підвищеної вологість більше 80%;', 'підвищеної температури більше 40 градусів;', 'пониженої температури менше 0 градусів;', 'прямого впливу сонячного світла, дощу, снігу тощо;', 'багаторазових циклів заморозки, розморожування (більше 3-х);', 'прямого впливу пару та води;', 'прямого впливу хімічних речовин, кислот, лугу, розчинників та їх похідних;', 'якщо меблі піддавались механічному впливу.'].map(x => `<li>${dgBold(x)}</li>`).join('')}</ul>
      <p class="dg-indent">У разі зняття Меблів з гарантії будь-які ремонтні роботи та/або регулювання механізмів Меблів здійснюється за окрему плату. Замовник зобов’язаний внести 100% передплату за ремонтні роботи до моменту виїзду монтажників на об’єкт для здійснення негарантійного ремонту.</p>
      ${dgP('5.6.', 'Гарантійні зобов\'язання на побутову техніку або сантехнічне обладнання обмежуються строками, встановленими виробником даної техніки. У разі виникнення гарантійного випадку, пов\'язаного з побутовою технікою або сантехнічним обладнанням, що є частиною цього Договору Замовник зобов\'язується звертатися безпосередньо в офіційні сервіс–центри, адреси яких вказані на доданих до техніки гарантійних талонах. Будь які необхідні дії Замовника щодо гарантійного обслуговування побутової техніки та/або сантехнічного обладнання (перевезення до/від сервісного центру і т.п.) не є обов’язком Виконавця за цим договором та не можуть бути відшкодовані за рахунок Виконавця.')}

      ${dgH('6. ОБСТАВИНИ НЕПЕРЕБОРНОЇ СИЛИ')}
      ${dgP('6.1.', 'Сторона звільняється від відповідальності за повне або часткове невиконання/неналежне виконання умов цього Договору, якщо доведе, що таке порушення сталося внаслідок дії обставин непереборної сили та (або) випадку, за умови, що період їх дії був засвідчений у визначеному Договором порядку.')}
      ${dgP('6.2.', 'Під непереборною силою маються на увазі: стихійні лиха (пожежі, повені, зсуви, землетруси тощо), воєнні дії, злочинні дії третіх осіб, епідемії, страйки, ембарго, бойкот, рішення та дії органів державної влади.')}
      ${dgP('6.3.', 'Під «випадком» у Договорі маються на увазі: будь-які обставини, що не вважаються непереборною силою за Договором і які безпосередньо не обумовлені діяльністю Сторін та не пов’язані із ними причинним зв’язком, що виникають без вини Сторін, поза волею Сторін і які не можна за умови вжиття звичайних для цього заходів передбачити та відвернути (уникнути).')}
      ${dgP('6.4.', 'Факт виникнення і припинення обставин непереборної сили підтверджується відповідним документом, виданим уповноваженим органом.')}
      ${dgP('6.5.', 'Сторона, що постраждала від дії непереборної сили, повинна не пізніше 5 діб з моменту її виникнення, сповістити іншу Сторону про настання таких обставин.')}
      ${dgP('6.6.', 'Настання обставин непереборної сили та (або) випадку не звільняє Сторону, для якої вони настали, від виконання своїх зобов’язань по Договору, а лише подовжує строки їх виконання на період дії таких обставин та (або) випадку.')}
      ${dgP('6.7.', 'Якщо обставини непереборної сили та (або) випадок тривають більш як 60 (шістдесят) календарних днів, Сторона що не потрапила під дію таких обставин вправі розірвати Договір в односторонньому порядку, повідомивши про це іншу Сторону за десять днів до розірвання.')}
      ${dgP('6.8.', 'Виникнення обставин непереборної сили та (або) випадку в момент прострочення виконання Стороною своїх зобов’язань за Договором позбавляє таку Сторону права посилатись на такі обставини як на підставу звільнення від відповідальності за Договором.')}

      ${dgH('7. ЗАКЛЮЧНІ ПОЛОЖЕННЯ')}
      ${dgP('7.1.', 'Договір набуває чинності з моменту його підписання і діє до повного виконання Сторонами своїх зобов\'язань. У всьому іншому, що не врегульовано умовами цього Договору, Сторони будуть керуватися чинним законодавством.')}
      ${dgP('7.2.', 'Підписанням цього Договору Замовник підтверджує, що йому надана і зрозуміла повна інформація про споживчі властивості товару, особливості фасадів обраної моделі, технологічні особливості виготовлення, експлуатації та установки комплекту Меблів.')}
      ${dgP('7.3.', 'Відповідальність за збереження Меблів переходить до Замовника з моменту доставки Меблів або його елементів на адресу установки.')}
      ${dgP('7.4.', 'Право власності переходить Замовнику в момент повної оплати вартості Меблів (при оплаті залишку коштів у сумі, зазначеній у Додатку № 1).')}
      ${dgP('7.5.', 'У разі відмови Замовника від умов даного Договору, або внесення додаткових змін в проект замовлення <u>на будь-якому етапі його виконання</u>, Замовник зобов’язується сплатити Виконавцю грошове відшкодування коштів у розмірі вартості придбаних Виконавцем, на момент відмови, матеріалів, або внесення додаткових конструктивних змін в проект замовлення та оплачених на момент відмови робіт (технолог, замірщик, логістика, зразки Меблів і т.д.) для виконання даного Договору. Виконавець зобов\'язаний повернути Замовникові кошти за вирахуванням вказаних у пункті 7.5 цього Договору сум.')}
      ${dgP('7.6.', 'Усі суперечки та розбіжності, що не передбачені умовами даного договору та/або які можуть виникнути в ході виконання цього договору, вирішуються шляхом переговорів/усних домовленостей між Сторонами. У разі неможливості врегулювати спірне питання шляхом переговорів/усних домовленостей спір передається на розгляд суду в порядку, передбаченому чинним законодавством.')}
      ${dgP('7.7.', 'Копії документів, отримані електронною поштою та/або через будь-які месенджери або мобільні додатки (в тому числі, але не обмежуючись, через Telegram, Signal, Viber, WhatsApp) за номерами телефонів, вказаними у реквізитах Сторін цього Договору, мають юридичну силу до моменту обміну оригіналами, що має бути здійснений протягом 10 (десяти) робочих днів з моменту направлення копій документів.')}
      ${dgP('7.8.', 'Уся інша переписка, здійснена за допомогою будь-якого з вказаних у цьому пункті способів, та не оформлена у документарному вигляді, має юридичну силу та визнається Сторонами належною. Договір складений у двох примірниках, які мають однакову юридичну силу при умові підписання обома Сторонами, по одному екземпляру для кожної зі Сторін.')}
      <p class="dg-annexes"><b>До Договору додаються:</b></p>
      <ol class="dg-list"><li>Додаток № 1 – Специфікація;</li><li>Додаток №2- Візуалізація;</li>${mats.length ? '<li>Додаток № 3 – Специфікація використаних матеріалів і фурнітури.</li>' : ''}</ol>
      ${requisites}

      ${annex(1, 'СПЕЦИФІКАЦІЯ № 1')}
      <p class="dg-intro">${parties(`уклали цю Специфікацію до ${ref} (далі – Договір), про наступне:`)}</p>
      ${dgH('1. НАЙМЕНУВАННЯ, КІЛЬКІСТЬ ТА ВАРТІСТЬ МЕБЛІВ')}
      ${dgP('1.1.', 'Виконавець за даною Специфікацією до Договору передає у власність Замовника наступні Меблі:')}
      <table class="dg-spec">
        <thead><tr><th>№ п/п</th><th>Найменування Меблів (номенклатура)</th><th>Розміри Меблів</th><th>Одиниця виміру</th><th>Кількість</th><th>Ціна за одиницю без ПДВ, грн</th><th>Всього без ПДВ, грн</th><th>Гарантійний строк на Меблі</th></tr></thead>
        <tbody>${rows}<tr class="dg-spec-total"><td colspan="7">Всього сума без ПДВ грн.</td><td>${fmtNum(t.total)}</td></tr></tbody>
      </table>
      ${dgH('2. ПОРЯДОК РОЗРАХУНКІВ')}
      <div class="dg-p"><b>2.1.</b><span><b>Черговість та порядок оплати</b></span></div>
      ${pays.map(([label, sum, text], i) => `<div class="dg-p"><b>2.1.${i + 1}.</b><span><b>${label}: ${moneyFull(sum)}</b>.</span></div><p class="dg-plain">${text}</p>`).join('')}
      ${dgH('3. СТРОКИ ВИГОТОВЛЕННЯ МЕБЛІВ ТА ЇХ ДОСТАВКА')}
      ${dgP('3.1.', `Виконавець зобов’язується виготовити та доставити Меблі протягом ${fmtNum(t.days)} ${plural(t.days, 'робочого дня', 'робочих днів', 'робочих днів')} з моменту повної передоплати.`)}
      ${requisites}

      ${visual ? annex(2, '') + visual + requisites : ''}

      ${mats.length ? `${annex(3, 'СПЕЦИФІКАЦІЯ ВИКОРИСТАНИХ МАТЕРІАЛІВ І ФУРНІТУРИ')}
      <table class="dg-mats">
        <thead><tr><th>№</th><th>Найменування</th><th>Артикул</th><th>Опис</th></tr></thead>
        <tbody>${mats.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m)}</td><td>${esc(codes.get(m.toLowerCase()) || '')}</td><td></td></tr>`).join('')}</tbody>
      </table>
      ${requisites}` : ''}
    </td></tr></tbody></table>`);
}

function readLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 800 / Math.max(img.naturalWidth || 800, img.naturalHeight || 800));
      const c = document.createElement('canvas');
      c.width = Math.round((img.naturalWidth || 800) * k);
      c.height = Math.round((img.naturalHeight || 800) * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не вдалося прочитати зображення')); };
    img.src = url;
  });
}

// --- Файли

const fileUrl = (p, f) => `/api/projects/${p.id}/files/${f.id}`;
const IMG_EXT = /^\.(jpe?g|png|gif|webp|bmp|svg)$/;

function fileCard(p, f, cats) {
  const url = fileUrl(p, f);
  const ext = (f.ext || '').slice(1).toUpperCase() || 'ФАЙЛ';
  return `
    <div class="file-card">
      <a class="thumb" href="${url}" target="_blank">${IMG_EXT.test(f.ext) ? `<img src="${url}" loading="lazy" alt="">` : `<span class="ext">${esc(ext)}</span>`}</a>
      <div class="file-info">
        <a href="${url}" target="_blank" class="file-name" title="${esc(f.name)}">${esc(f.name)}</a>
        <div class="muted small">${fmtSize(f.size)} · ${fmtDate(f.uploadedAt)}</div>
        <div class="file-actions">
          <select data-action="file-cat" data-fid="${f.id}" title="Перемістити в категорію">${cats.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <a href="${url}?download=1" class="icon-btn" title="Завантажити">⬇</a>
          <button class="icon-btn" data-action="file-del" data-fid="${f.id}" title="Видалити">✕</button>
        </div>
      </div>
    </div>`;
}
const fileCats = p => [...new Set([...FILE_CATEGORIES, ...p.files.map(f => f.category)])];

TAB_VIEWS.files = p => {
  const cats = fileCats(p);
  const groups = cats.map(c => {
    const items = p.files.filter(f => f.category === c);
    if (!items.length) return '';
    return `
      <div class="file-group">
        <h3>${esc(c)} <span class="muted">${items.length}</span></h3>
        <div class="file-grid">${items.map(f => fileCard(p, f, cats)).join('')}</div>
      </div>`;
  }).join('');

  return `
    <div class="card upload">
      <label class="field inline"><span>Категорія для нових файлів:</span>
        <select data-action="upload-cat">${FILE_CATEGORIES.map(c => `<option ${c === state.uploadCategory ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <label class="drop" data-drop>
        <input type="file" multiple data-action="file-input" hidden>
        <div><b>Перетягніть файли сюди</b> або натисніть, щоб обрати</div>
        <div class="muted small">PDF, фото, креслення, DWG / DXF, Excel — будь-які файли</div>
      </label>
    </div>
    ${groups || '<div class="empty">Файлів ще немає.</div>'}`;
};

async function uploadFiles(fileList, category = state.uploadCategory) {
  const p = state.current;
  const files = [...fileList];
  let last = null;
  for (const [i, f] of files.entries()) {
    toast(`Завантаження ${i + 1}/${files.length}: ${f.name}`);
    const r = await request('POST', `/api/projects/${p.id}/files?name=${encodeURIComponent(f.name)}&category=${encodeURIComponent(category)}`, f, true);
    p.files = r.files;
    last = r.file;
  }
  if (files.length) toast(files.length === 1 ? 'Файл додано' : `Додано файлів: ${files.length}`);
  return last;
}

async function handleUpload(fileList, category) {
  if (!fileList.length || !state.current) return;
  try { await uploadFiles(fileList, category); } catch (e) { toast('Помилка завантаження: ' + e.message, true); }
  if (state.current && ['files', 'handover'].includes(state.tab)) refreshTab();
}

// --- Рахунки

TAB_VIEWS.invoices = p => {
  const f = finance(p);
  const stat = (label, value, cls = '') => `<div class="stat ${cls}"><div class="muted small">${label}</div><div class="stat-v">${value}</div></div>`;
  return `
    <div class="stats">
      ${stat('Рахунків', f.count)}
      ${stat('Сума рахунків', money(f.costs))}
      ${stat('Оплачено', money(f.paid), 'ok')}
      ${stat('Не оплачено', money(f.due), f.due > 0 ? 'warn' : '')}
    </div>
    <div class="card upload">
      <label class="drop" data-drop="invoices">
        <input type="file" accept=".pdf,application/pdf,image/*" multiple data-action="inv-files" hidden>
        <div><b>Перетягніть PDF рахунків постачальників сюди</b> або натисніть, щоб обрати — можна кілька одразу</div>
        <div class="muted small">Номер, дату, суму, постачальника й позиції програма прочитає з PDF сама. PDF зберігається при рахунку.</div>
      </label>
    </div>
    ${invTable(p)}`;
};

// Версія розбору PDF: коли її піднято, рахунки, яких не правили вручну, перечитуються.
const PARSE_V = 3; // 3 — код товару в позиціях (артикул у договорі)

// Що прочитано з PDF → у рахунок. Виправлений вручну (✎) не перезаписуємо; оплату — ніколи.
function applyParsed(i, r) {
  if (!i.manual) {
    Object.assign(i, {
      number: r.number || i.number || '', date: r.date || i.date || '', ready: r.ready || '',
      amount: r.amount || num(i.amount), counterparty: r.counterparty || i.counterparty || '',
      description: r.title || i.description || '', items: r.items?.length ? r.items : i.items || [],
    });
  }
  i.check = !num(i.amount) || !i.number || !i.counterparty;
  i.parsed = true;
  i.parseV = PARSE_V;
}

// PDF рахунків → файли в «Рахунки» й рядки таблиці; що прочитати не вдалося — позначено «перевірте».
async function uploadInvoices(fileList) {
  const p = state.current;
  const files = [...fileList];
  if (!p || !files.length) return;
  let added = 0, unsure = 0;
  try {
    for (const [n, f] of files.entries()) {
      toast(`Рахунок ${n + 1}/${files.length}: ${f.name}`);
      const up = await request('POST', `/api/projects/${p.id}/files?name=${encodeURIComponent(f.name)}&category=${encodeURIComponent('Рахунки')}`, f, true);
      p.files = up.files;
      const r = await request('GET', `/api/projects/${p.id}/files/${up.file.id}/invoice`);
      const i = { id: uid(), kind: 'supplier', number: '', date: '', counterparty: '', description: '', amount: 0, paid: 0, fileId: up.file.id, items: [] };
      applyParsed(i, r);
      if (!i.date) i.date = localDate();
      p.invoices.push(i);
      if (i.counterparty) await rememberContact('supplier', i.counterparty);
      added++;
      if (i.check) unsure++;
    }
  } catch (e) {
    toast('Помилка: ' + e.message, true);
  }
  await saveNow(p);
  if (state.current === p && state.tab === 'invoices') refreshTab();
  if (added) toast(`Додано рахунків: ${added}${unsure ? ` (перевірте: ${unsure})` : ''}`);
}

// Рахунки, завантажені раніше (без позицій із PDF), — дочитуємо один раз, коли відкрили вкладку.
async function backfillInvoices(p) {
  const todo = supplierInvoices(p).filter(i => i.fileId && !i.manual && (i.parseV || 0) < PARSE_V && p.files.some(f => f.id === i.fileId && f.ext === '.pdf'));
  if (!todo.length) return;
  for (const i of todo) {
    try { applyParsed(i, await request('GET', `/api/projects/${p.id}/files/${i.fileId}/invoice`)); } catch { i.parseV = PARSE_V; }
  }
  await saveNow(p);
  if (state.current === p && state.tab === 'invoices') refreshTab();
}

function invTable(p) {
  const items = supplierInvoices(p).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const files = Object.fromEntries(p.files.map(f => [f.id, f]));
  return `
    <div class="card">
      <div class="card-head"><h3>Рахунки від постачальників</h3><div class="spacer"></div><button class="btn small" data-action="inv-add">+ Вручну</button></div>
      ${items.length ? `<div class="table-wrap"><table class="table compact inv-table">
        <thead><tr><th>Дата</th><th>№ рахунку</th><th>Готовність</th><th>Назва</th><th class="r">Сума</th><th class="r">Оплачено</th><th>Статус</th><th>PDF</th><th></th></tr></thead>
        <tbody>${items.map(i => {
          const st = invStatus(i);
          const file = i.fileId && files[i.fileId];
          return `<tr data-iid="${i.id}" class="${i.check ? 'inv-check' : ''}">
            <td class="nowrap">${fmtDate(i.date)}</td>
            <td class="nowrap">${esc(i.number || '—')}</td>
            <td class="nowrap">${i.ready ? `<span class="${i.ready < localDate() ? 'muted' : 'strong'}" title="Дата готовності замовлення">${fmtDate(i.ready)}</span>` : '<span class="muted">—</span>'}</td>
            <td>
              <div class="strong">${esc(i.counterparty || 'Постачальник?')}</div>
              <div class="small">${esc(i.description || '')}</div>
              ${i.items?.length ? `<details class="inv-items"><summary class="small muted">Позиції (${i.items.length})</summary>
                <table class="table compact"><tbody>${i.items.map((it, k) => `<tr><td class="muted">${k + 1}</td><td>${esc(it.name)}</td><td class="r nowrap">${it.qty ? `${fmtNum(it.qty)} ${esc(it.unit || '')}` : ''}</td><td class="r nowrap">${money(it.sum)}</td></tr>`).join('')}</tbody></table>
              </details>` : ''}
              ${i.check ? '<div class="small warn-text">⚠ Не все прочиталося з PDF — перевірте (✎)</div>' : ''}</td>
            <td class="r nowrap">${money(i.amount)}</td>
            <td class="r nowrap">${money(i.paid)}</td>
            <td><span class="pill ${st.cls}">${st.label}</span>${st.cls !== 'ok' && num(i.amount) ? `<br><button class="link-btn small" data-action="inv-paid">✓ оплачено</button>` : ''}</td>
            <td>${file ? `<a class="btn small" href="${fileUrl(p, file)}" target="_blank" title="${esc(file.name)}">📄 Відкрити</a>` : '<span class="muted">—</span>'}</td>
            <td class="nowrap"><button class="icon-btn" data-action="inv-edit" title="Редагувати">✎</button><button class="icon-btn" data-action="inv-del" title="Видалити">✕</button></td>
          </tr>`;
        }).join('')}
          <tr class="total-row"><td colspan="4">Разом</td><td class="r nowrap">${money(items.reduce((a, i) => a + num(i.amount), 0))}</td><td class="r nowrap">${money(items.reduce((a, i) => a + num(i.paid), 0))}</td><td colspan="3"></td></tr>
        </tbody>
      </table></div>` : '<div class="muted">Поки немає — перетягніть PDF рахунків у поле вище.</div>'}
    </div>`;
}

function invoiceDialog(inv) {
  const p = state.current;
  const i = inv || { kind: 'supplier', number: '', date: localDate(), counterparty: '', description: '', amount: '', paid: '', fileId: null };
  const curFile = i.fileId && p.files.find(f => f.id === i.fileId);
  const form = openDialog({
    title: inv ? 'Редагувати рахунок' : 'Рахунок від постачальника',
    body: `
      <div class="row2">
        <label class="field"><span>Номер рахунку</span><input name="number" value="${esc(i.number)}"></label>
        <label class="field"><span>Дата</span><input type="date" name="date" value="${i.date || ''}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Постачальник</span><input name="counterparty" value="${esc(i.counterparty)}" list="suppliers-list" autocomplete="off"></label>
        <label class="field"><span>Дата готовності</span><input type="date" name="ready" value="${i.ready || ''}"></label>
      </div>
      <label class="field"><span>Назва (що в рахунку)</span><input name="description" value="${esc(i.description)}" placeholder="ДСП, кромка, порізка…"></label>
      <div class="row2">
        <label class="field"><span>Сума, грн</span><input type="number" step="0.01" name="amount" value="${esc(i.amount)}" required></label>
        <label class="field"><span>Оплачено, грн <button type="button" class="link-btn" data-fill-paid>= вся сума</button></span><input type="number" step="0.01" name="paid" value="${esc(i.paid)}"></label>
      </div>
      <label class="field"><span>PDF рахунку ${curFile ? `(зараз: ${esc(curFile.name)})` : ''}</span><input type="file" name="file" accept=".pdf,application/pdf,image/*"></label>`,
    onSubmit: async form => {
      const d = Object.fromEntries(new FormData(form));
      let fileId = i.fileId || null;
      if (d.file && d.file.size) fileId = (await uploadFiles([d.file], 'Рахунки')).id;
      const data = {
        kind: 'supplier', number: d.number.trim(), date: d.date, ready: d.ready, counterparty: d.counterparty.trim(),
        description: d.description.trim(), amount: num(d.amount), paid: num(d.paid), fileId, check: false, manual: true,
      };
      if (inv) Object.assign(inv, data);
      else p.invoices.push({ id: uid(), items: [], parsed: true, ...data });
      await saveNow();
      await rememberContact('supplier', data.counterparty);
      refreshTab();
    },
  });
  form.querySelector('[data-fill-paid]').onclick = () => (form.elements.paid.value = form.elements.amount.value);
}

// --- Здача проєкту

TAB_VIEWS.handover = p => {
  const h = p.handover;
  const we = warrantyEnd(p);
  const cats = fileCats(p);
  const photos = cat => {
    const items = p.files.filter(f => f.category === cat);
    return `
      <div class="card">
        <div class="card-head"><h3>${cat} <span class="muted">${items.length}</span></h3><div class="spacer"></div>
          <label class="btn small">+ Додати фото<input type="file" accept="image/*" multiple hidden data-action="file-input" data-cat="${cat}"></label></div>
        ${items.length ? `<div class="file-grid">${items.map(f => fileCard(p, f, cats)).join('')}</div>` : '<div class="muted small">Ще немає</div>'}
      </div>`;
  };
  return `
    <div class="grid-side">
      <div class="card">
        <h3>Здача клієнту та гарантія</h3>
        <div class="form-grid">
          <label class="field"><span>Дата здачі</span><input type="date" data-hand="date" value="${h.date || ''}"></label>
          <label class="field"><span>Гарантія, місяців</span><input type="number" min="0" data-hand="warrantyMonths" value="${esc(h.warrantyMonths)}"></label>
          <div class="field full"><span>Гарантія діє до</span><b id="warranty-end" class="${we && we >= localDate() ? 'ok-text' : ''}">${we ? fmtDate(we) : 'вкажіть дату здачі'}</b></div>
          <label class="field full"><span>Зауваження клієнта / що доробити</span><textarea data-hand="note" rows="4">${esc(h.note || '')}</textarea></label>
        </div>
      </div>
      <div class="side">
        <div class="card stack">
          <button class="btn primary" data-action="act-print">🖨 Акт виконаних робіт (PDF)</button>
          ${!isArchived(p) ? '<button class="btn" data-action="close-project">✓ Закрити проєкт і перенести в архів</button>' : `<span class="muted small">Проєкт в архіві (${STATUS[p.status].label})</span>`}
          <span class="muted small">Роботи в акті — вироби з «КП», а якщо КП немає — бюджет проєкту з «Огляду».</span>
        </div>
      </div>
    </div>
    <div class="photo-cols">${photos('Фото до')}${photos('Фото після')}</div>`;
};

function printAct(p) {
  const s = state.settings, h = p.handover;
  // Роботи — вироби з КП (кожен окремим рядком); КП немає — одним рядком на бюджет проєкту.
  const items = p.offer.items.filter(it => kpTotal(it));
  const total = items.length ? kpSum(p) : num(p.budget);
  const we = warrantyEnd(p);
  let n = 0;
  const rows = items.length
    ? items.map(it => [`Виготовлення: ${it.title || p.name}${kpQty(it) > 1 ? ` (${fmtNum(kpQty(it))} шт)` : ''}`, kpTotal(it)])
    : [[`Виготовлення меблів: ${[p.furnitureType, p.name].filter(Boolean).join(' — ')}`, total]];
  printDoc(`Акт — ${p.name}`, `
    <h1>Акт приймання-передачі виконаних робіт</h1>
    <div class="doc-meta">№${p.number} від ${fmtDate(h.date || localDate())}</div>
    ${partiesHtml(p)}
    ${p.address ? `<p>Адреса об'єкта: ${esc(p.address)}</p>` : ''}
    <p>Виконавець виконав, а Замовник прийняв такі роботи:</p>
    <table class="doc-table">
      <thead><tr><th>№</th><th>Найменування робіт</th><th class="r">Сума, грн</th></tr></thead>
      <tbody>
        ${rows.map(([name, sum]) => `<tr><td>${++n}</td><td>${esc(name)}</td><td class="r">${fmtNum(sum)}</td></tr>`).join('')}
        <tr class="doc-total"><td></td><td class="r">Разом</td><td class="r">${fmtNum(total)}</td></tr>
      </tbody>
    </table>
    <p>Загальна вартість робіт: <b>${money(total)}</b>.</p>
    <p>Роботи виконано в повному обсязі. Замовник претензій щодо обсягу, якості та строків виконання робіт не має.</p>
    ${num(h.warrantyMonths) ? `<p>Гарантійний строк: <b>${fmtNum(h.warrantyMonths)} міс</b>${we ? ` (до ${fmtDate(we)})` : ''}. Гарантія не поширюється на пошкодження внаслідок неналежної експлуатації.</p>` : ''}
    ${h.note ? `<p>Зауваження: ${nl2br(h.note)}</p>` : ''}
    <div class="doc-sign two">
      <div>Виконавець<br><br>____________________<br><span class="doc-small">${esc(s.companyName || '')}</span></div>
      <div>Замовник<br><br>____________________<br><span class="doc-small">${esc(p.client || '')}</span></div>
    </div>`);
}

// --- Журнал

TAB_VIEWS.log = p => {
  const items = [...p.log].reverse();
  return `
    <div class="card">
      <textarea data-ref="log-text" rows="3" placeholder="Що сталося: дзвінок, домовленість, зміна в проєкті… (Ctrl+Enter — додати)"></textarea>
      <div class="right"><button class="btn primary" data-action="log-add">Додати запис</button></div>
    </div>
    <div class="timeline">${items.map(e => `
      <div class="tl-item ${e.auto ? 'auto' : ''}" data-lid="${e.id}">
        <div class="tl-date">${fmtDateTime(e.at)}</div>
        <div class="tl-text">${esc(e.text)}</div>
        <button class="icon-btn" data-action="log-del" title="Видалити">✕</button>
      </div>`).join('')}
    </div>`;
};

function addLogFromInput() {
  const ta = $('[data-ref="log-text"]');
  const text = ta.value.trim();
  if (!text) return;
  addLog(state.current, text);
  saveNow();
  refreshTab();
}

// ---------- налаштування

function toGroups(template) {
  const groups = [];
  for (const q of template) {
    let g = groups.find(x => x.name === q.group);
    if (!g) groups.push((g = { name: q.group, items: [] }));
    g.items.push({ id: q.id, text: q.text, hint: q.hint || '' });
  }
  return groups;
}

function viewSettings() {
  if (!state.draft) { state.draft = toGroups(state.template); state.draftDirty = false; }
  const d = state.draft, s = state.settings;
  const S = (k, label, type = 'text') => `<label class="field"><span>${label}</span><input type="${type}" data-set="${k}" value="${esc(s[k] || '')}"></label>`;
  app.innerHTML = `
    <div class="page-head"><h1>Налаштування</h1></div>
    <div class="card">
      <h3>Мої дані для документів</h3>
      <p class="muted small" style="margin-top:0">Підставляються в комерційну пропозицію та акт виконаних робіт. Зберігаються автоматично.</p>
      <div class="form-grid">
        ${S('companyName', 'Виконавець (ПІБ / ФОП / назва)')}
        ${S('phone', 'Телефон', 'tel')}
        ${S('email', 'Email', 'email')}
        ${S('address', 'Адреса')}
        ${S('city', 'Місто (у договорі: «м. Київ»)')}
        <label class="field full"><span>Реквізити виконавця для договору — кожне з нового рядка: адреса, ІПН, телефон, р/р, банк</span><textarea data-set="details" rows="2">${esc(s.details || '')}</textarea></label>
        ${S('brand', 'Назва бренду для КП (напр. INOM)')}
        ${S('instagram', 'Instagram')}
        ${S('tagline', 'Підзаголовок на титулі КП')}
        <div class="field"><span>Логотип для КП</span>
          <div class="logo-row">
            ${s.logo ? `<img class="logo-prev" src="${esc(s.logo)}" alt="">` : '<span class="muted small">Немає — буде назва бренду (з 4 літер — квадрат 2×2, як INOM)</span>'}
            <label class="btn small">Обрати…<input type="file" accept="image/*" hidden data-action="logo-file"></label>
            ${s.logo ? '<button class="btn small" data-action="logo-del">Прибрати</button>' : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="page-head" style="margin-top:28px">
      <h2 style="margin:0">Шаблон питань</h2>
      <div class="spacer"></div>
      <span class="muted small" id="dirty">${state.draftDirty ? 'Є незбережені зміни' : ''}</span>
      <button class="btn" data-action="t-reset">Стандартний набір</button>
      <button class="btn" data-action="t-cancel">Скасувати зміни</button>
      <button class="btn primary" data-action="t-save">Зберегти шаблон</button>
    </div>
    <p class="muted">Шаблон копіюється в кожен <b>новий</b> проєкт. В існуючих проєктах нові питання можна підтягнути кнопкою «+ З шаблону» на вкладці «Питання».</p>
    ${d.map((g, gi) => `
      <div class="card t-group">
        <div class="card-head">
          <input class="t-group-name" data-action="t-group" data-g="${gi}" value="${esc(g.name)}" placeholder="Назва розділу">
          <div class="spacer"></div>
          <button class="icon-btn" data-action="t-gup" data-g="${gi}" title="Вище">↑</button>
          <button class="icon-btn" data-action="t-gdown" data-g="${gi}" title="Нижче">↓</button>
          <button class="icon-btn" data-action="t-gdel" data-g="${gi}" title="Видалити розділ">✕</button>
        </div>
        ${g.items.map((q, qi) => `
          <div class="t-row">
            <input data-action="t-text" data-g="${gi}" data-i="${qi}" value="${esc(q.text)}" placeholder="Питання">
            <input data-action="t-hint" data-g="${gi}" data-i="${qi}" value="${esc(q.hint)}" placeholder="Підказка / варіанти">
            <div class="nowrap">
              <button class="icon-btn" data-action="t-up" data-g="${gi}" data-i="${qi}" title="Вище">↑</button>
              <button class="icon-btn" data-action="t-down" data-g="${gi}" data-i="${qi}" title="Нижче">↓</button>
              <button class="icon-btn" data-action="t-del" data-g="${gi}" data-i="${qi}" title="Видалити">✕</button>
            </div>
          </div>`).join('')}
        <button class="link-btn" data-action="t-add" data-g="${gi}">+ питання</button>
      </div>`).join('')}
    <button class="btn" data-action="t-add-group">+ Новий розділ</button>
    <p class="muted small" style="margin-top:24px">Дані зберігаються в папці: <code>${esc(state.dataDir)}</code>. Для резервної копії достатньо скопіювати цю папку.</p>`;
}

function markDirty() {
  state.draftDirty = true;
  const el = $('#dirty');
  if (el) el.textContent = 'Є незбережені зміни';
}

const swap = (arr, i, j) => { if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]]; };

async function settingsAction(a, el) {
  const d = state.draft;
  const gi = Number(el.dataset.g), qi = Number(el.dataset.i);
  switch (a) {
    case 't-add': d[gi].items.push({ id: 't' + uid(), text: '', hint: '' }); break;
    case 't-del': d[gi].items.splice(qi, 1); break;
    case 't-up': swap(d[gi].items, qi, qi - 1); break;
    case 't-down': swap(d[gi].items, qi, qi + 1); break;
    case 't-gup': swap(d, gi, gi - 1); break;
    case 't-gdown': swap(d, gi, gi + 1); break;
    case 't-gdel':
      if (d[gi].items.length && !confirm(`Видалити розділ «${d[gi].name}» з усіма питаннями?`)) return;
      d.splice(gi, 1); break;
    case 't-add-group': d.push({ name: 'Новий розділ', items: [{ id: 't' + uid(), text: '', hint: '' }] }); break;
    case 't-reset':
      if (!confirm('Замінити шаблон стандартним набором питань? (Збережеться після «Зберегти шаблон»)')) return;
      state.draft = toGroups(await request('GET', '/api/template/default')); break;
    case 't-cancel': state.draft = null; viewSettings(); return;
    case 't-save': {
      const flat = d.flatMap(g => g.items.filter(q => q.text.trim()).map(q => ({ id: q.id, group: g.name.trim() || 'Інше', text: q.text.trim(), hint: q.hint.trim() })));
      state.template = await request('PUT', '/api/template', flat);
      state.draft = null;
      toast('Шаблон збережено');
      viewSettings();
      return;
    }
    default: return;
  }
  markDirty();
  viewSettings();
  if (a === 't-add' || a === 't-add-group') {
    const inputs = app.querySelectorAll('[data-action="t-text"]');
    const target = a === 't-add' ? app.querySelector(`[data-action="t-text"][data-g="${gi}"][data-i="${d[gi].items.length - 1}"]`) : inputs[inputs.length - 1];
    target?.focus();
  }
}

// ---------- обробники подій

app.addEventListener('click', async e => {
  const go = e.target.closest('[data-go]');
  if (go && !e.target.closest('a, button, select, input, label')) { location.hash = go.dataset.go; return; }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const p = state.current;

  try {
    if (a.startsWith('t-')) return await settingsAction(a, el);

    switch (a) {
      case 'filter': state.filter = el.dataset.v; return viewList('');
      case 'new-quote': return newProjectDialog(true);
      case 'quote-accept':
        changeStatus(p, FIRST_STATUS);
        return toast(`«${p.name}» перенесено в «Проєкти»`);
      case 'notif-enable':
        await Notification.requestPermission();
        return renderReminderPanel();

      case 'project-del':
        if (!confirm(`Видалити проєкт «${p.name}» разом з усіма файлами? Це не можна скасувати.`)) return;
        await request('DELETE', `/api/projects/${p.id}`);
        state.projects = state.projects.filter(x => x !== p);
        clearTimeout(saveTimer); saveTimer = null;
        state.current = null;
        toast('Проєкт видалено');
        location.hash = '#/';
        return;

      // контакти
      case 'ct-tab': state.contactsTab = el.dataset.v; return viewContacts();
      case 'ct-add': return contactDialog(state.contactsTab);
      case 'ct-edit': return contactDialog(state.contactsTab, state.contacts.find(c => c.id === el.closest('[data-cid]').dataset.cid));
      case 'ct-del': {
        const c = state.contacts.find(x => x.id === el.closest('[data-cid]').dataset.cid);
        if (!confirm(`Видалити «${c.name}» з контактів? Проєкти не зміняться.`)) return;
        state.contacts = state.contacts.filter(x => x !== c);
        await saveContacts();
        return viewContacts();
      }

      // питання
      case 'q-filter': state.qOnlyOpen = el.dataset.v === 'open'; return renderTab();
      case 'q-na': {
        const q = p.questions.find(x => x.id === el.closest('[data-qid]').dataset.qid);
        q.na = !q.na;
        saveSoon(0);
        return refreshTab();
      }
      case 'q-del': {
        const id = el.closest('[data-qid]').dataset.qid;
        const q = p.questions.find(x => x.id === id);
        if (!confirm(`Видалити питання «${q.text}» з цього проєкту?`)) return;
        p.questions = p.questions.filter(x => x.id !== id);
        saveSoon(0);
        return refreshTab();
      }
      case 'q-add': return addQuestionDialog();
      case 'q-copy': return copyOpenQuestions();
      case 'q-print': return printQuestionnaire(p);
      case 'q-sync': {
        const have = new Set(p.questions.map(q => q.id));
        const add = state.template.filter(t => !have.has(t.id));
        p.questions.push(...add.map(t => ({ ...t, answer: '', na: false })));
        saveSoon(0);
        toast(`Додано питань: ${add.length}`);
        return refreshTab();
      }

      // етапи
      case 'st-add': {
        p.stages.push({ id: uid(), label: '', plan: '', done: false, doneAt: '' });
        saveSoon(0);
        refreshTab();
        return [...app.querySelectorAll('.st-label')].pop()?.focus();
      }
      case 'st-up': case 'st-down': case 'st-del': {
        const i = p.stages.findIndex(s => s.id === el.closest('[data-sid]').dataset.sid);
        if (a === 'st-del') {
          if (!confirm(`Видалити етап «${p.stages[i].label}»?`)) return;
          p.stages.splice(i, 1);
        } else swap(p.stages, i, a === 'st-up' ? i - 1 : i + 1);
        saveSoon(0);
        return refreshTab();
      }
      case 'ap-add': return approvalDialog();
      case 'ap-del': {
        const id = el.closest('[data-aid]').dataset.aid;
        if (!confirm('Видалити запис про погодження? (Файл залишиться у «Файлах»)')) return;
        p.approvals = p.approvals.filter(x => x.id !== id);
        saveSoon(0);
        return refreshTab();
      }

      // нагадування
      case 'rem-quick': $('[data-ref="rem-date"]').value = addDays(Number(el.dataset.d)); $('[data-ref="rem-text"]').focus(); return;
      case 'rem-add': return addReminderFromInput();
      case 'rem-edit': { const { p: rp, r } = findReminder(el); return editReminderDialog(rp, r); }
      case 'rem-del': {
        const { p: rp, r } = findReminder(el);
        if (!confirm(`Видалити нагадування «${r.text}»?`)) return;
        rp.reminders = rp.reminders.filter(x => x !== r);
        await saveNow(rp);
        return rerenderReminders();
      }


      // КП
      case 'kp-add':
        p.offer.items.push(newKpItem(p));
        saveSoon(0);
        refreshTab();
        return [...app.querySelectorAll('.kp-item [data-k="title"]')].pop()?.focus();
      case 'kp-del': {
        const it = findKpItem(p, el);
        if (!confirm(`Видалити «${it.title || 'виріб'}» з КП? (Зображення залишаться у «Файлах»)`)) return;
        p.offer.items = p.offer.items.filter(x => x !== it);
        saveSoon(0);
        return refreshTab();
      }
      case 'kp-up': case 'kp-down': {
        const i = p.offer.items.indexOf(findKpItem(p, el));
        swap(p.offer.items, i, a === 'kp-up' ? i - 1 : i + 1);
        saveSoon(0);
        return renderTab();
      }
      case 'kp-img': {
        const it = findKpItem(p, el), id = el.dataset.fid;
        if (it.imageIds.includes(id)) it.imageIds = it.imageIds.filter(x => x !== id);
        else if (it.imageIds.length >= KP_MAX_IMAGES) return toast(`Не більше ${KP_MAX_IMAGES} зображень на сторінку`, true);
        else it.imageIds.push(id);
        saveSoon(0);
        renderTab();
        return app.querySelector(`[data-kid="${it.id}"] [data-fid="${id}"]`)?.focus();
      }
      case 'kp-mats': {
        const it = findKpItem(p, el);
        const have = new Set(it.list.map(l => l.trim().toLowerCase()));
        const add = invoiceGoods(p).filter(n => !have.has(n.toLowerCase()));
        if (!add.length) return toast(invoiceGoods(p).length ? 'Усі позиції з рахунків уже в списку' : 'У рахунках ще немає позицій — завантажте PDF на вкладці «Рахунки»');
        it.list = [...it.list.filter(l => l.trim()), ...add];
        saveSoon(0);
        return renderTab();
      }
      case 'kpl-add': return kpAddLine(findKpItem(p, el));
      case 'kpl-del': case 'kpl-up': case 'kpl-down': {
        const it = findKpItem(p, el), li = Number(el.closest('[data-li]').dataset.li);
        if (a === 'kpl-del') {
          it.list.splice(li, 1);
          if (!it.list.length) it.list.push('');
        } else swap(it.list, li, a === 'kpl-up' ? li - 1 : li + 1);
        saveSoon(0);
        return renderTab();
      }
      case 'kp-print': return await printKp(p);
      case 'dg-print': return printContract(p);

      case 'logo-del':
        delete state.settings.logo;
        saveSettingsSoon();
        return viewSettings();

      // здача
      case 'act-print': return printAct(p);
      case 'close-project':
        if (!confirm('Закрити проєкт і перенести його в архів?')) return;
        changeStatus(p, 'closed');
        return renderTab();

      // файли
      case 'file-del': {
        const f = p.files.find(x => x.id === el.dataset.fid);
        if (!confirm(`Видалити файл «${f.name}»?`)) return;
        const r = await request('DELETE', `/api/projects/${p.id}/files/${f.id}`);
        p.files = r.files; p.invoices = r.invoices; p.approvals = r.approvals;
        return refreshTab();
      }

      // рахунки
      case 'inv-add': return invoiceDialog();
      case 'inv-paid': {
        const i = p.invoices.find(x => x.id === el.closest('[data-iid]').dataset.iid);
        i.paid = num(i.amount);
        await saveNow();
        return refreshTab();
      }
      case 'inv-edit': return invoiceDialog(p.invoices.find(i => i.id === el.closest('[data-iid]').dataset.iid));
      case 'inv-del': {
        const id = el.closest('[data-iid]').dataset.iid;
        if (!confirm('Видалити рахунок? (Прикріплений файл залишиться у «Файлах»)')) return;
        p.invoices = p.invoices.filter(i => i.id !== id);
        await saveNow();
        return refreshTab();
      }

      // журнал
      case 'log-add': return addLogFromInput();
      case 'log-del': {
        const id = el.closest('[data-lid]').dataset.lid;
        if (!confirm('Видалити запис з журналу?')) return;
        p.log = p.log.filter(x => x.id !== id);
        saveSoon(0);
        return refreshTab();
      }
    }
  } catch (err) {
    toast(err.message, true);
  }
});

app.addEventListener('input', e => {
  const el = e.target;
  const a = el.dataset.action;
  const p = state.current;

  if (a === 'search') { state.search = el.value; return renderListBody(); }
  if (a === 'ct-search') { state.contactsSearch = el.value; return renderContactsBody(); }

  if (el.dataset.set) {
    state.settings[el.dataset.set] = el.value;
    return saveSettingsSoon();
  }
  if (!p) {
    if (state.draft && a?.startsWith('t-')) {
      const g = state.draft[Number(el.dataset.g)];
      if (a === 't-group') g.name = el.value;
      if (a === 't-text') g.items[Number(el.dataset.i)].text = el.value;
      if (a === 't-hint') g.items[Number(el.dataset.i)].hint = el.value;
      markDirty();
    }
    return;
  }

  if (el.dataset.field) {
    p[el.dataset.field] = el.value;
    return saveSoon();
  }
  if (el.dataset.hand) {
    const k = el.dataset.hand;
    p.handover[k] = k === 'warrantyMonths' ? num(el.value) : el.value;
    const we = warrantyEnd(p), out = $('#warranty-end');
    if (out) { out.textContent = we ? fmtDate(we) : 'вкажіть дату здачі'; out.className = we && we >= localDate() ? 'ok-text' : ''; }
    return saveSoon();
  }
  if (a === 'q-answer') {
    const row = el.closest('[data-qid]');
    const q = p.questions.find(x => x.id === row.dataset.qid);
    q.answer = el.value;
    updateQRow(row, q);
    return saveSoon();
  }
  if (a === 'st-label') {
    p.stages.find(s => s.id === el.closest('[data-sid]').dataset.sid).label = el.value;
    return saveSoon();
  }
  if (a === 'dg') {
    p.contract[el.dataset.k] = el.value;
    const box = $('#dg-sum');
    if (box) box.innerHTML = contractSumHtml(p);
    return saveSoon();
  }
  if (a === 'kp') {
    p.offer[el.dataset.k] = el.value;
    return saveSoon();
  }
  if (a === 'kpl') {
    findKpItem(p, el).list[Number(el.closest('[data-li]').dataset.li)] = el.value;
    return saveSoon();
  }
  if (a === 'kpi') {
    const it = findKpItem(p, el);
    it[el.dataset.k] = el.value;
    if (el.dataset.k === 'qty' || el.dataset.k === 'price') {
      el.closest('[data-kid]').querySelector('.kp-sum b').textContent = kpSumText(it);
      const t = $('#kp-total');
      if (t) t.textContent = money(p.offer.items.reduce((s, x) => s + kpTotal(x), 0));
    }
    return saveSoon();
  }
});

app.addEventListener('change', async e => {
  const el = e.target;
  const a = el.dataset.action;
  const p = state.current;
  try {
    if (el.dataset.field && p) {
      renderHead();
      if (el.dataset.field === 'client') await rememberContact('client', p.client, { phone: p.phone || '', address: p.address || '' });
      return;
    }
    if (a === 'status') return changeStatus(p, el.value);
    if (a === 'logo-file') {
      const f = el.files[0];
      if (!f) return;
      state.settings.logo = await readLogo(f);
      saveSettingsSoon();
      return viewSettings();
    }
    if (a === 'kp-upload') { const files = [...el.files]; el.value = ''; return await kpAddImages(p, findKpItem(p, el), files); }
    if (a === 'upload-cat') { state.uploadCategory = el.value; return; }
    if (a === 'inv-files') { const files = [...el.files]; el.value = ''; return await uploadInvoices(files); }
    if (a === 'file-input') { await handleUpload(el.files, el.dataset.cat); el.value = ''; return; }
    if (a === 'file-cat') {
      const r = await request('PATCH', `/api/projects/${p.id}/files/${el.dataset.fid}`, { category: el.value });
      p.files = r.files;
      return renderTab();
    }
    if (a === 'rem-done') {
      const { p: rp, r } = findReminder(el);
      r.done = el.checked;
      r.doneAt = r.done ? new Date().toISOString() : null;
      if (r.done) addLog(rp, `Нагадування виконано: ${r.text}`, true);
      await saveNow(rp);
      return rerenderReminders();
    }
    if (a === 'st-done') {
      const s = p.stages.find(x => x.id === el.closest('[data-sid]').dataset.sid);
      s.done = el.checked;
      s.doneAt = s.done ? localDate() : '';
      if (s.done) addLog(p, `Етап виконано: ${s.label}`, true);
      saveSoon(0);
      return refreshTab();
    }
    if (a === 'st-doneat') {
      p.stages.find(x => x.id === el.closest('[data-sid]').dataset.sid).doneAt = el.value;
      saveSoon(0);
      return;
    }
    if (a === 'st-plan') {
      p.stages.find(x => x.id === el.closest('[data-sid]').dataset.sid).plan = el.value;
      saveSoon(0);
      return renderTab();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

app.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const ref = e.target.dataset.ref;
  if (ref === 'log-text' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addLogFromInput(); }
  if (ref === 'rem-text') { e.preventDefault(); addReminderFromInput(); }
  if (e.target.dataset.action === 'kpl' && state.current) {
    e.preventDefault();
    kpAddLine(findKpItem(state.current, e.target), Number(e.target.closest('[data-li]').dataset.li));
  }
});

// перетягування: файли у зону завантаження, картки на дошці
app.addEventListener('dragstart', e => {
  const card = e.target.closest?.('.kcard');
  if (!card) return;
  e.dataTransfer.setData('text/x-pid', card.dataset.pid);
  e.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
});
app.addEventListener('dragend', e => e.target.closest?.('.kcard')?.classList.remove('dragging'));
app.addEventListener('dragover', e => {
  const d = e.target.closest('[data-drop]');
  if (d) d.classList.add('over');
  const col = e.target.closest('[data-col]');
  if (col && e.dataTransfer.types.includes('text/x-pid')) {
    app.querySelectorAll('.col.over').forEach(c => c !== col && c.classList.remove('over'));
    col.classList.add('over');
  }
});
app.addEventListener('dragleave', e => {
  const d = e.target.closest('[data-drop], [data-col]');
  if (d && !d.contains(e.relatedTarget)) d.classList.remove('over');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  const pid = e.dataTransfer.getData('text/x-pid');
  if (pid) {
    const col = e.target.closest?.('[data-col]');
    const p = state.projects.find(x => x.id === pid);
    if (col && p) changeStatus(p, col.dataset.col);
    if (state.page === 'board') viewBoard();
    return;
  }
  const d = e.target.closest?.('[data-drop]');
  if (d) d.classList.remove('over');
  // На вкладці «Рахунки» файл, кинутий будь-куди, — рахунок; на «Файлах» — просто файл.
  if (state.current && state.tab === 'invoices') uploadInvoices(e.dataTransfer.files);
  else if (d || (state.current && state.tab === 'files')) handleUpload(e.dataTransfer.files);
});

// Ctrl+V на вкладці «КП» — знімок екрана йде у виріб, у якому зараз фокус (або в останній)
document.addEventListener('paste', e => {
  const p = state.current;
  if (!p || state.tab !== 'offer') return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  const card = document.activeElement?.closest?.('[data-kid]');
  let it = card && p.offer.items.find(x => x.id === card.dataset.kid);
  if (!it) it = p.offer.items[p.offer.items.length - 1];
  if (!it) p.offer.items.push((it = newKpItem(p)));
  kpAddImages(p, it, files).catch(err => toast('Помилка завантаження: ' + err.message, true));
});

window.addEventListener('hashchange', route);

// ---------- старт

async function init() {
  $('#furniture-types').innerHTML = FURNITURE_TYPES.map(t => `<option value="${t}">`).join('');
  try {
    const d = await request('GET', '/api/data');
    state.projects = d.projects.map(ensureProject);
    state.template = d.template;
    state.contacts = d.contacts || [];
    state.settings = d.settings || {};
    state.dataDir = d.dataDir;
  } catch {
    app.innerHTML = '<div class="empty">Не вдалося з\'єднатися з сервером. Запустіть <b>start.bat</b> і оновіть сторінку.</div>';
    return;
  }
  refreshDatalists();
  route();
  checkReminders();
  setInterval(checkReminders, 60 * 1000);
}

init();
