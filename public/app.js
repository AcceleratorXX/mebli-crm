'use strict';

// ---------- довідники

const STATUSES = [
  { key: 'new',       label: 'Новий',         color: '#64748b' },
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

const FILE_CATEGORIES = ['Вхідні від клієнта', 'Заміри', 'Креслення / проєкт', 'Фото', 'Фото до', 'Фото після', 'Рахунки', 'Документи', 'Інше'];
const FURNITURE_TYPES = ['Кухня', 'Шафа-купе', 'Гардероб', 'Передпокій', 'Ванна кімната', 'Дитяча', 'Спальня', 'Вітальня', 'Офісні меблі', 'Інше'];
const DEFAULT_STAGES = ['Замір', 'Конструювання / креслення', 'Погодження з клієнтом', 'Аванс отримано', 'Замовлення матеріалів',
  'Порізка та кромкування', 'Присадка / свердління', 'Збірка', 'Доставка', 'Монтаж', 'Здача клієнту'];
const MATERIAL_CATEGORIES = ['Плита (ДСП / МДФ)', 'Фасади', 'Кромка', 'Фурнітура', 'Стільниця', 'Скло / дзеркало',
  'Підсвітка / електрика', 'Техніка', 'Мийка / сантехніка', 'Інше'];
const MAT_STATUS = [
  { key: 'need',     label: 'Потрібно',  cls: 'bad' },
  { key: 'ordered',  label: 'Замовлено', cls: 'warn' },
  { key: 'received', label: 'Отримано',  cls: 'ok' },
];
const DEFAULT_WORKS = ['Конструювання', 'Порізка та кромкування', 'Збірка', 'Доставка', 'Монтаж'];
const DEFAULT_OFFER_NOTE = 'Термін виготовлення — за погодженням після внесення авансу.\nОстаточна вартість може змінитися при зміні проєкту.';

const TABS = [
  { key: 'overview',  label: 'Огляд' },
  { key: 'questions', label: 'Питання' },
  { key: 'stages',    label: 'Етапи' },
  { key: 'reminders', label: 'Нагадування' },
  { key: 'materials', label: 'Матеріали' },
  { key: 'estimate',  label: 'Кошторис' },
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
  p.materials ||= [];
  p.estimate ||= { works: DEFAULT_WORKS.map(name => ({ id: uid(), name, amount: 0 })), markup: 30, discount: 0, advancePct: 50, validDays: 14 };
  p.approvals ||= [];
  p.handover ||= { date: '', warrantyMonths: 24, note: '' };
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

function finance(p) {
  const sum = (kind, field) => p.invoices.filter(i => i.kind === kind).reduce((a, i) => a + num(i[field]), 0);
  const order = sum('client', 'amount'), paid = sum('client', 'paid'), costs = sum('supplier', 'amount');
  return { order, paid, due: order - paid, costs, costsPaid: sum('supplier', 'paid'), margin: order - costs };
}

const matSum = m => num(m.qty) * num(m.price);
function estimate(p) {
  const e = p.estimate;
  const byCat = {};
  let materials = 0;
  for (const m of p.materials) {
    const s = matSum(m);
    materials += s;
    const c = m.category || 'Інше';
    byCat[c] = (byCat[c] || 0) + s;
  }
  const k = 1 + num(e.markup) / 100;
  const materialsPrice = materials * k;
  const works = e.works.reduce((a, w) => a + num(w.amount), 0);
  const subtotal = materialsPrice + works;
  const discount = num(e.discount);
  const total = Math.max(0, subtotal - discount);
  return { byCat, k, materials, materialsPrice, works, subtotal, discount, total, advance: total * num(e.advancePct) / 100, profit: total - materials };
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
    nav = isArchived(p) ? 'archive' : '';
    viewProject();
  } else {
    state.current = null;
    if (page === 'settings') viewSettings();
    else if (page === 'board') viewBoard();
    else if (page === 'calendar') viewCalendar(id);
    else if (page === 'contacts') viewContacts();
    else viewList(page === 'archive');
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

function viewList(archived) {
  state.listArchived = archived;
  const pool = state.projects.filter(p => isArchived(p) === archived);
  const chips = archived ? '' : `
    <div class="chips">
      <button class="chip ${state.filter === 'all' ? 'on' : ''}" data-action="filter" data-v="all">Усі <b>${pool.length}</b></button>
      ${STATUSES.filter(s => !s.archived).map(s => {
        const n = pool.filter(p => p.status === s.key).length;
        return `<button class="chip ${state.filter === s.key ? 'on' : ''}" data-action="filter" data-v="${s.key}" style="--c:${s.color}"><i></i>${s.label} <b>${n}</b></button>`;
      }).join('')}
    </div>`;

  app.innerHTML = `
    <div class="page-head">
      <h1>${archived ? 'Архів' : 'Проєкти'}</h1>
      <div class="spacer"></div>
      <input type="search" class="search" placeholder="Пошук: назва, клієнт, телефон…" value="${esc(state.search)}" data-action="search">
      ${archived ? '' : '<button class="btn primary" data-action="new-project">+ Новий проєкт</button>'}
    </div>
    ${archived ? '' : '<div id="rem-panel"></div>'}
    ${chips}
    <div id="list-body"></div>`;
  if (!archived) renderReminderPanel();
  renderListBody();
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
  const archived = state.listArchived;
  const q = state.search.trim().toLowerCase();
  let list = state.projects.filter(p => isArchived(p) === archived);
  if (!archived && state.filter !== 'all') list = list.filter(p => p.status === state.filter);
  if (q) list = list.filter(p => [p.number, p.name, p.client, p.phone, p.address, p.furnitureType].join(' ').toLowerCase().includes(q));

  if (archived) list.sort((a, b) => (b.closedAt || b.updatedAt).localeCompare(a.closedAt || a.updatedAt));
  else list.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || b.updatedAt.localeCompare(a.updatedAt));

  const body = $('#list-body');
  if (!list.length) {
    body.innerHTML = `<div class="empty">${
      state.projects.length === 0 && !archived
        ? 'Ще немає жодного проєкту. Натисніть «+ Новий проєкт», щоб почати.'
        : archived ? 'Архів порожній. Сюди потрапляють проєкти зі статусом «Закритий» або «Скасований».' : 'Нічого не знайдено.'
    }</div>`;
    return;
  }
  const today = localDate();
  body.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>№</th><th>Проєкт</th><th>Клієнт</th><th>Статус</th><th>${archived ? 'Гарантія до' : 'Етап'}</th><th>Дедлайн</th><th>Питання</th><th>${archived ? 'Закрито' : 'Оновлено'}</th>
      </tr></thead>
      <tbody>${list.map(p => {
        const s = STATUS[p.status] || STATUSES[0];
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

function newProjectDialog() {
  const form = openDialog({
    title: 'Новий проєкт',
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
      const p = ensureProject(await request('POST', '/api/projects', data));
      state.projects.push(p);
      await rememberContact('client', data.client, { phone: data.phone, address: data.address });
      location.hash = `#/project/${p.id}/questions`;
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
      <button class="btn primary" data-action="new-project">+ Новий проєкт</button>
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
    for (const m of p.materials) if (sameName(m.supplier, c.name)) projects.add(p);
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
  const archived = isArchived(p);
  const s = STATUS[p.status] || STATUSES[0];
  $('#proj-head').innerHTML = `
    <a class="back" href="${archived ? '#/archive' : '#/'}">← ${archived ? 'Архів' : 'Проєкти'}</a>
    <div class="title-row">
      <span class="num-big">№${p.number}</span>
      <h1>${esc(p.name)}</h1>
      <div class="spacer"></div>
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
    materials: p.materials.filter(m => m.status !== 'received').length,
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
    updateNav(isArchived(p) ? 'archive' : '');
  }
}

// --- Огляд

TAB_VIEWS.overview = p => {
  const F = (field, label, type = 'text', cls = '', attrs = '') =>
    `<label class="field ${cls}"><span>${label}</span><input type="${type}" data-field="${field}" value="${esc(p[field] ?? '')}" ${attrs}></label>`;
  const qs = qStats(p), f = finance(p), st = stageStats(p), e = estimate(p);
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
          ${e.total ? `<div class="kv"><span>За кошторисом</span><b>${money(e.total)}</b></div>` : ''}
          <div class="kv"><span>Виставлено клієнту</span><b>${money(f.order)}</b></div>
          <div class="kv"><span>Оплачено</span><b>${money(f.paid)}</b></div>
          <div class="kv"><span>Залишок</span><b class="${f.due > 0 ? 'warn-text' : ''}">${money(f.due)}</b></div>
          <div class="kv"><span>Витрати</span><b>${money(f.costs)}</b></div>
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
          <span class="st-doneat small">${s.done ? `✓ ${fmtDate(s.doneAt)}` : ''}</span>
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
      <label class="field"><span>Що погоджено *</span><input name="title" required placeholder="Проєкт v2, колір фасадів, розміри, кошторис…"></label>
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

// --- Матеріали

function matStatsHtml(p) {
  const total = p.materials.reduce((a, m) => a + matSum(m), 0);
  const cnt = k => p.materials.filter(m => m.status === k).length;
  return `
    <div class="stat"><div class="muted small">Позицій</div><div class="stat-v">${p.materials.length}</div></div>
    <div class="stat"><div class="muted small">Сума матеріалів</div><div class="stat-v">${money(total)}</div></div>
    <div class="stat ${cnt('need') ? 'bad' : ''}"><div class="muted small">Потрібно замовити</div><div class="stat-v">${cnt('need')}</div></div>
    <div class="stat ${cnt('ordered') ? 'warn' : ''}"><div class="muted small">Замовлено, чекаємо</div><div class="stat-v">${cnt('ordered')}</div></div>
    <div class="stat ok"><div class="muted small">Отримано</div><div class="stat-v">${cnt('received')}</div></div>`;
}

TAB_VIEWS.materials = p => {
  const f = state.matFilter;
  const items = p.materials.filter(m => f === 'all' || m.status === f);
  return `
    <div class="stats" id="mat-stats">${matStatsHtml(p)}</div>
    <div class="toolbar">
      <div class="seg">
        <button class="${f === 'all' ? 'on' : ''}" data-action="mat-filter" data-v="all">Усі</button>
        ${MAT_STATUS.map(s => `<button class="${f === s.key ? 'on' : ''}" data-action="mat-filter" data-v="${s.key}">${s.label}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <button class="btn" data-action="mat-copy" title="Скопіювати список «Потрібно» по постачальниках">📋 Список для замовлення</button>
      <button class="btn primary" data-action="mat-add">+ Позиція</button>
    </div>
    ${p.materials.length ? `
      <div class="table-wrap"><table class="table compact mat-table">
        <thead><tr><th>Найменування</th><th>Категорія</th><th>Постачальник</th><th class="r">К-сть</th><th>Од.</th><th class="r">Ціна</th><th class="r">Сума</th><th>Статус</th><th></th></tr></thead>
        <tbody>${items.map(m => {
          const s = MAT_STATUS.find(x => x.key === m.status) || MAT_STATUS[0];
          return `<tr data-mid="${m.id}">
            <td><input data-action="mat" data-k="name" value="${esc(m.name)}" placeholder="ДСП Egger W1000 18мм"></td>
            <td><select data-action="mat" data-k="category">${MATERIAL_CATEGORIES.map(c => `<option ${c === m.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
            <td><input data-action="mat" data-k="supplier" value="${esc(m.supplier)}" list="suppliers-list" autocomplete="off"></td>
            <td><input class="r w-num" type="number" step="any" data-action="mat" data-k="qty" value="${esc(m.qty)}"></td>
            <td><input class="w-unit" data-action="mat" data-k="unit" value="${esc(m.unit)}" list="units-list"></td>
            <td><input class="r w-num" type="number" step="any" data-action="mat" data-k="price" value="${esc(m.price)}"></td>
            <td class="r nowrap m-sum">${money(matSum(m))}</td>
            <td><select class="pill-select ${s.cls}" data-action="mat" data-k="status">${MAT_STATUS.map(x => `<option value="${x.key}" ${x.key === m.status ? 'selected' : ''}>${x.label}</option>`).join('')}</select></td>
            <td><button class="icon-btn" data-action="mat-del" title="Видалити">✕</button></td>
          </tr>`;
        }).join('') || '<tr><td colspan="9" class="muted">Немає позицій з таким статусом</td></tr>'}</tbody>
      </table></div>` : '<div class="empty">Додайте матеріали та фурнітуру, які потрібні для проєкту: плиту, кромку, петлі, шухляди, стільницю…<br>Сума автоматично піде в «Кошторис».</div>'}`;
};

function copyOrderList(p) {
  const need = p.materials.filter(m => m.status === 'need' && m.name.trim());
  if (!need.length) return toast('Немає позицій зі статусом «Потрібно»');
  const bySupplier = {};
  for (const m of need) (bySupplier[m.supplier.trim() || 'Без постачальника'] ||= []).push(m);
  const text = Object.entries(bySupplier).map(([s, items]) =>
    `${s}:\n${items.map(m => `- ${m.name} — ${fmtNum(m.qty)} ${m.unit}`).join('\n')}`).join('\n\n');
  copyText(`Замовлення для проєкту «${p.name}»\n\n${text}`, `Скопійовано ${need.length} позицій`);
}

// --- Кошторис

function estMatHtml(p) {
  const c = estimate(p);
  const cats = Object.entries(c.byCat);
  return `
    <div class="card-head"><h3>Матеріали та фурнітура</h3><div class="spacer"></div><a class="small" href="#/project/${p.id}/materials">редагувати →</a></div>
    ${cats.length ? `<table class="table compact">
      <thead><tr><th>Категорія</th><th class="r">Собівартість</th><th class="r">З націнкою</th></tr></thead>
      <tbody>${cats.map(([cat, s]) => `<tr><td>${esc(cat)}</td><td class="r nowrap">${money(s)}</td><td class="r nowrap">${money(s * c.k)}</td></tr>`).join('')}
        <tr class="total-row"><td>Разом</td><td class="r nowrap">${money(c.materials)}</td><td class="r nowrap">${money(c.materialsPrice)}</td></tr>
      </tbody></table>` : '<div class="muted">Матеріалів ще немає — додайте їх на вкладці «Матеріали».</div>'}`;
}

function estSummaryHtml(p) {
  const c = estimate(p), e = p.estimate;
  return `
    <div class="kv"><span>Матеріали (собівартість)</span><b>${money(c.materials)}</b></div>
    <div class="kv"><span>Матеріали з націнкою ${fmtNum(e.markup)}%</span><b>${money(c.materialsPrice)}</b></div>
    <div class="kv"><span>Роботи та послуги</span><b>${money(c.works)}</b></div>
    ${c.discount ? `<div class="kv"><span>Знижка</span><b>− ${money(c.discount)}</b></div>` : ''}
    <div class="kv total"><span>До сплати клієнтом</span><b>${money(c.total)}</b></div>
    <div class="kv"><span>Аванс ${fmtNum(e.advancePct)}%</span><b>${money(c.advance)}</b></div>
    <div class="kv"><span>Ваш заробіток (без матеріалів)</span><b class="ok-text">${money(c.profit)}</b></div>`;
}

TAB_VIEWS.estimate = p => {
  const e = p.estimate;
  const E = (k, label, step = 'any') => `<label class="field"><span>${label}</span><input type="number" step="${step}" data-action="est" data-k="${k}" value="${esc(e[k])}"></label>`;
  return `
    <div class="grid-side">
      <div>
        <div class="card" id="est-mat">${estMatHtml(p)}</div>
        <div class="card">
          <div class="card-head"><h3>Роботи та послуги</h3><div class="spacer"></div><button class="btn small" data-action="work-add">+ Робота</button></div>
          ${e.works.map(w => `
            <div class="work-row" data-wid="${w.id}">
              <input data-action="work" data-k="name" value="${esc(w.name)}" placeholder="Назва роботи">
              <input class="r" type="number" step="any" data-action="work" data-k="amount" value="${esc(w.amount)}" placeholder="0">
              <span class="muted small">грн</span>
              <button class="icon-btn" data-action="work-del" title="Видалити">✕</button>
            </div>`).join('') || '<div class="muted">Немає</div>'}
        </div>
      </div>
      <div class="side">
        <div class="card">
          <h3>Параметри</h3>
          <div class="form-grid">
            ${E('markup', 'Націнка на матеріали, %')}
            ${E('discount', 'Знижка, грн')}
            ${E('advancePct', 'Аванс, %')}
            ${E('validDays', 'Пропозиція дійсна, днів', '1')}
          </div>
        </div>
        <div class="card" id="est-summary">${estSummaryHtml(p)}</div>
        <div class="card stack">
          <button class="btn primary" data-action="est-print">🖨 Комерційна пропозиція (PDF)</button>
          <button class="btn" data-action="est-budget">Записати суму в бюджет проєкту</button>
          <span class="muted small">Ваші реквізити для документів заповнюються в «Налаштуваннях».</span>
        </div>
      </div>
    </div>`;
};

function printOffer(p) {
  const c = estimate(p), e = p.estimate, s = state.settings;
  let n = 0;
  const rows = [
    ...Object.entries(c.byCat).map(([cat, sum]) => [cat, sum * c.k]),
    ...e.works.filter(w => num(w.amount)).map(w => [w.name, num(w.amount)]),
  ];
  printDoc(`Комерційна пропозиція — ${p.name}`, `
    <h1>Комерційна пропозиція</h1>
    <div class="doc-meta">№${p.number} від ${fmtDate(localDate())}</div>
    ${partiesHtml(p)}
    <p>Виріб: <b>${esc([p.furnitureType, p.name].filter(Boolean).join(' — '))}</b>${p.address ? `<br>Адреса об'єкта: ${esc(p.address)}` : ''}</p>
    <table class="doc-table">
      <thead><tr><th>№</th><th>Найменування</th><th class="r">Сума, грн</th></tr></thead>
      <tbody>
        ${rows.map(([name, sum]) => `<tr><td>${++n}</td><td>${esc(name)}</td><td class="r">${fmtNum(sum)}</td></tr>`).join('')}
        ${c.discount ? `<tr><td></td><td class="r">Разом</td><td class="r">${fmtNum(c.subtotal)}</td></tr><tr><td></td><td class="r">Знижка</td><td class="r">− ${fmtNum(c.discount)}</td></tr>` : ''}
        <tr class="doc-total"><td></td><td class="r">До сплати</td><td class="r">${fmtNum(c.total)}</td></tr>
      </tbody>
    </table>
    <p>Аванс ${fmtNum(e.advancePct)}%: <b>${money(c.advance)}</b>, решта — після монтажу.</p>
    <p>Пропозиція дійсна ${fmtNum(e.validDays)} днів.</p>
    <p class="doc-small">${nl2br(s.offerNote ?? DEFAULT_OFFER_NOTE)}</p>
    <div class="doc-sign"><div>Виконавець ____________________ ${esc(s.companyName || '')}</div></div>`);
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
      ${stat('Виставлено клієнту', money(f.order))}
      ${stat('Оплачено клієнтом', money(f.paid), 'ok')}
      ${stat('Залишок до оплати', money(f.due), f.due > 0 ? 'warn' : '')}
      ${stat('Витрати постачальникам', money(f.costs))}
      ${stat('Різниця (виставлено − витрати)', money(f.margin))}
    </div>
    ${invTable(p, 'client', 'Рахунки клієнту', '+ Рахунок клієнту')}
    ${invTable(p, 'supplier', 'Рахунки від постачальників', '+ Рахунок постачальника')}`;
};

function invTable(p, kind, title, addLabel) {
  const items = p.invoices.filter(i => i.kind === kind).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const files = Object.fromEntries(p.files.map(f => [f.id, f]));
  return `
    <div class="card">
      <div class="card-head"><h3>${title}</h3><div class="spacer"></div><button class="btn small" data-action="inv-add" data-kind="${kind}">${addLabel}</button></div>
      ${items.length ? `<div class="table-wrap"><table class="table compact">
        <thead><tr><th>Дата</th><th>№</th><th>${kind === 'client' ? 'Опис' : 'Постачальник / опис'}</th><th class="r">Сума</th><th class="r">Оплачено</th><th>Статус</th><th>Файл</th><th></th></tr></thead>
        <tbody>${items.map(i => {
          const st = invStatus(i);
          const file = i.fileId && files[i.fileId];
          return `<tr data-iid="${i.id}">
            <td>${fmtDate(i.date)}</td>
            <td>${esc(i.number || '—')}</td>
            <td>${i.counterparty ? `<div class="strong">${esc(i.counterparty)}</div>` : ''}<div class="small">${esc(i.description || '')}</div></td>
            <td class="r nowrap">${money(i.amount)}</td>
            <td class="r nowrap">${money(i.paid)}</td>
            <td><span class="pill ${st.cls}">${st.label}</span></td>
            <td>${file ? `<a href="${fileUrl(p, file)}" target="_blank" title="${esc(file.name)}">📎</a>` : ''}</td>
            <td class="nowrap"><button class="icon-btn" data-action="inv-edit">✎</button><button class="icon-btn" data-action="inv-del">✕</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="muted">Поки немає.</div>'}
    </div>`;
}

function invoiceDialog(kind, inv) {
  const p = state.current;
  const i = inv || { kind, number: '', date: localDate(), counterparty: kind === 'client' ? p.client || '' : '', description: '', amount: '', paid: '', fileId: null };
  const curFile = i.fileId && p.files.find(f => f.id === i.fileId);
  const form = openDialog({
    title: inv ? 'Редагувати рахунок' : kind === 'client' ? 'Рахунок клієнту' : 'Рахунок від постачальника',
    body: `
      <div class="row2">
        <label class="field"><span>Тип</span><select name="kind">
          <option value="client" ${i.kind === 'client' ? 'selected' : ''}>Клієнту</option>
          <option value="supplier" ${i.kind === 'supplier' ? 'selected' : ''}>Від постачальника</option>
        </select></label>
        <label class="field"><span>Дата</span><input type="date" name="date" value="${i.date || ''}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Номер рахунку</span><input name="number" value="${esc(i.number)}"></label>
        <label class="field"><span>Платник / постачальник</span><input name="counterparty" value="${esc(i.counterparty)}" list="${i.kind === 'client' ? 'clients-list' : 'suppliers-list'}" autocomplete="off"></label>
      </div>
      <label class="field"><span>Опис</span><input name="description" value="${esc(i.description)}" placeholder="Аванс, ДСП, фурнітура, стільниця…"></label>
      <div class="row2">
        <label class="field"><span>Сума, грн</span><input type="number" step="0.01" name="amount" value="${esc(i.amount)}" required></label>
        <label class="field"><span>Оплачено, грн <button type="button" class="link-btn" data-fill-paid>= вся сума</button></span><input type="number" step="0.01" name="paid" value="${esc(i.paid)}"></label>
      </div>
      <label class="field"><span>Файл рахунку ${curFile ? `(зараз: ${esc(curFile.name)})` : ''}</span><input type="file" name="file"></label>`,
    onSubmit: async form => {
      const d = Object.fromEntries(new FormData(form));
      let fileId = i.fileId || null;
      if (d.file && d.file.size) fileId = (await uploadFiles([d.file], 'Рахунки')).id;
      const data = {
        kind: d.kind, number: d.number.trim(), date: d.date, counterparty: d.counterparty.trim(),
        description: d.description.trim(), amount: num(d.amount), paid: num(d.paid), fileId,
      };
      if (inv) Object.assign(inv, data);
      else p.invoices.push({ id: uid(), ...data });
      await saveNow();
      if (data.kind === 'supplier') await rememberContact('supplier', data.counterparty);
      refreshTab();
    },
  });
  form.querySelector('[data-fill-paid]').onclick = () => (form.elements.paid.value = form.elements.amount.value);
  form.elements.kind.onchange = () => form.elements.counterparty.setAttribute('list', form.elements.kind.value === 'client' ? 'clients-list' : 'suppliers-list');
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
          <span class="muted small">Сума в акті береться з «Кошторису», а якщо він порожній — з рахунків клієнту.</span>
        </div>
      </div>
    </div>
    <div class="photo-cols">${photos('Фото до')}${photos('Фото після')}</div>`;
};

function printAct(p) {
  const c = estimate(p), e = p.estimate, s = state.settings, h = p.handover;
  const total = c.total || finance(p).order;
  const we = warrantyEnd(p);
  let n = 0;
  const rows = [[`Виготовлення меблів: ${[p.furnitureType, p.name].filter(Boolean).join(' — ')}`, c.total ? c.materialsPrice : total]];
  if (c.total) for (const w of e.works) if (num(w.amount)) rows.push([w.name, num(w.amount)]);
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
        ${c.total && c.discount ? `<tr><td></td><td class="r">Знижка</td><td class="r">− ${fmtNum(c.discount)}</td></tr>` : ''}
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
        <label class="field full"><span>Реквізити (IBAN, ІПН / ЄДРПОУ…)</span><textarea data-set="details" rows="2">${esc(s.details || '')}</textarea></label>
        <label class="field full"><span>Умови в комерційній пропозиції</span><textarea data-set="offerNote" rows="3">${esc(s.offerNote ?? DEFAULT_OFFER_NOTE)}</textarea></label>
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
      case 'new-project': return newProjectDialog();
      case 'filter': state.filter = el.dataset.v; return viewList(false);
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

      // матеріали
      case 'mat-filter': state.matFilter = el.dataset.v; return renderTab();
      case 'mat-add': {
        const last = p.materials[p.materials.length - 1];
        p.materials.push({ id: uid(), name: '', category: last?.category || MATERIAL_CATEGORIES[0], supplier: last?.supplier || '', qty: 1, unit: 'шт', price: 0, status: 'need' });
        state.matFilter = 'all';
        saveSoon();
        refreshTab();
        return [...app.querySelectorAll('[data-k="name"]')].pop()?.focus();
      }
      case 'mat-del': {
        const id = el.closest('[data-mid]').dataset.mid;
        const m = p.materials.find(x => x.id === id);
        if (m.name && !confirm(`Видалити «${m.name}»?`)) return;
        p.materials = p.materials.filter(x => x.id !== id);
        saveSoon(0);
        return refreshTab();
      }
      case 'mat-copy': return copyOrderList(p);

      // кошторис
      case 'work-add':
        p.estimate.works.push({ id: uid(), name: '', amount: 0 });
        saveSoon();
        renderTab();
        return [...app.querySelectorAll('.work-row [data-k="name"]')].pop()?.focus();
      case 'work-del':
        p.estimate.works = p.estimate.works.filter(w => w.id !== el.closest('[data-wid]').dataset.wid);
        saveSoon(0);
        return renderTab();
      case 'est-print': return printOffer(p);
      case 'est-budget': {
        const total = estimate(p).total;
        p.budget = String(Math.round(total * 100) / 100);
        saveSoon(0);
        return toast(`Бюджет проєкту: ${money(total)}`);
      }

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
      case 'inv-add': return invoiceDialog(el.dataset.kind);
      case 'inv-edit': return invoiceDialog(null, p.invoices.find(i => i.id === el.closest('[data-iid]').dataset.iid));
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
  if (a === 'mat' && el.tagName === 'INPUT') {
    const row = el.closest('[data-mid]');
    const m = p.materials.find(x => x.id === row.dataset.mid);
    m[el.dataset.k] = el.value;
    if (el.dataset.k === 'qty' || el.dataset.k === 'price') {
      row.querySelector('.m-sum').textContent = money(matSum(m));
      $('#mat-stats').innerHTML = matStatsHtml(p);
    }
    return saveSoon();
  }
  if (a === 'est') {
    p.estimate[el.dataset.k] = el.value;
    $('#est-summary').innerHTML = estSummaryHtml(p);
    if (el.dataset.k === 'markup') $('#est-mat').innerHTML = estMatHtml(p);
    return saveSoon();
  }
  if (a === 'work') {
    const w = p.estimate.works.find(x => x.id === el.closest('[data-wid]').dataset.wid);
    w[el.dataset.k] = el.value;
    $('#est-summary').innerHTML = estSummaryHtml(p);
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
    if (a === 'upload-cat') { state.uploadCategory = el.value; return; }
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
    if (a === 'st-plan') {
      p.stages.find(x => x.id === el.closest('[data-sid]').dataset.sid).plan = el.value;
      saveSoon(0);
      return renderTab();
    }
    if (a === 'mat') {
      const row = el.closest('[data-mid]');
      const m = p.materials.find(x => x.id === row.dataset.mid);
      if (el.tagName === 'SELECT') {
        m[el.dataset.k] = el.value;
        if (el.dataset.k === 'status') {
          el.className = 'pill-select ' + MAT_STATUS.find(x => x.key === m.status).cls;
          $('#mat-stats').innerHTML = matStatsHtml(p);
          renderTabs();
        }
        saveSoon(0);
      } else if (el.dataset.k === 'supplier') {
        await rememberContact('supplier', m.supplier);
      }
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
  if (d) { d.classList.remove('over'); handleUpload(e.dataTransfer.files); }
  else if (state.current && state.tab === 'files') handleUpload(e.dataTransfer.files);
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
