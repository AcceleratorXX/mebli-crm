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

const FILE_CATEGORIES = ['Вхідні від клієнта', 'Заміри', 'Креслення / проєкт', 'Фото', 'Рахунки', 'Інше'];
const FURNITURE_TYPES = ['Кухня', 'Шафа-купе', 'Гардероб', 'Передпокій', 'Ванна кімната', 'Дитяча', 'Спальня', 'Вітальня', 'Офісні меблі', 'Інше'];
const TABS = [
  { key: 'overview',  label: 'Огляд' },
  { key: 'questions', label: 'Питання' },
  { key: 'reminders', label: 'Нагадування' },
  { key: 'files',     label: 'Файли' },
  { key: 'invoices',  label: 'Рахунки' },
  { key: 'log',       label: 'Журнал' },
];

const state = {
  projects: [], template: [], dataDir: '',
  filter: 'all', search: '', qOnlyOpen: false,
  current: null, tab: 'overview', page: null,
  uploadCategory: FILE_CATEGORIES[0],
  draft: null, draftDirty: false,
};

const app = document.getElementById('app');
const $ = sel => document.querySelector(sel);

// ---------- утиліти

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d = new Date()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };

function fmtDate(v) {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return new Date(v).toLocaleDateString('uk-UA');
}
const fmtDateTime = v => new Date(v).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const money = n => (Number(n) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 }) + ' грн';
function fmtSize(b) {
  if (b < 1024) return b + ' Б';
  if (b < 1024 ** 2) return (b / 1024).toFixed(0) + ' КБ';
  return (b / 1024 ** 2).toFixed(1) + ' МБ';
}

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

// ---------- обчислення

const qState = q => (q.na ? 'na' : (q.answer || '').trim() ? 'done' : 'open');
function qStats(p) {
  const s = { done: 0, open: 0, na: 0 };
  for (const q of p.questions || []) s[qState(q)]++;
  s.total = s.done + s.open;
  s.pct = s.total ? Math.round((s.done / s.total) * 100) : 100;
  return s;
}

function finance(p) {
  const inv = p.invoices || [];
  const sum = (kind, field) => inv.filter(i => i.kind === kind).reduce((a, i) => a + (Number(i[field]) || 0), 0);
  const order = sum('client', 'amount'), paid = sum('client', 'paid'), costs = sum('supplier', 'amount');
  return { order, paid, due: order - paid, costs, costsPaid: sum('supplier', 'paid'), margin: order - costs };
}

function invStatus(i) {
  const a = Number(i.amount) || 0, pd = Number(i.paid) || 0;
  if (a > 0 && pd >= a) return { label: 'Оплачено', cls: 'ok' };
  if (pd > 0) return { label: 'Частково', cls: 'warn' };
  return { label: 'Не оплачено', cls: 'bad' };
}

const remDue = r => `${r.date}T${r.time || '09:00'}`;
function remKind(r) {
  if (r.done) return 'done';
  const nowKey = localDateTime();
  if (remDue(r) <= nowKey) return 'overdue';
  if (r.date === localDate()) return 'today';
  return 'later';
}
const openReminders = p => (p.reminders || []).filter(r => !r.done);
const dueReminders = p => openReminders(p).filter(r => r.date <= localDate());

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

function addLog(p, text, auto = false) {
  (p.log ||= []).push({ id: uid(), at: new Date().toISOString(), text, auto });
}

// ---------- діалог

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
}

// ---------- маршрутизація

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
    else viewList(page === 'archive');
  }
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  if (pageChanged) window.scrollTo(0, 0);
}

// ---------- список проєктів

function badge(s) {
  return `<span class="badge" style="--c:${s.color}"><i></i>${s.label}</span>`;
}
function progress(qs) {
  return `<div class="progress" title="Відповіді: ${qs.done} з ${qs.total}"><div style="width:${qs.pct}%"></div></div>
          <div class="muted small">${qs.done}/${qs.total}</div>`;
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
        <th>№</th><th>Проєкт</th><th>Клієнт</th><th>Статус</th><th>Дедлайн</th><th>Питання</th><th>${archived ? 'Закрито' : 'Оновлено'}</th>
      </tr></thead>
      <tbody>${list.map(p => {
        const s = STATUS[p.status] || STATUSES[0];
        const overdue = !archived && p.deadline && p.deadline < today;
        const due = archived ? 0 : dueReminders(p).length;
        return `<tr data-go="#/project/${p.id}">
          <td class="num">${p.number}</td>
          <td><div class="strong">${esc(p.name)}${due ? ` <span class="bell" title="Нагадування на сьогодні / прострочені">🔔${due}</span>` : ''}</div>
              <div class="muted small">${esc(p.furnitureType || '')}</div></td>
          <td>${esc(p.client || '—')}<div class="muted small">${esc(p.phone || '')}</div></td>
          <td>${badge(s)}</td>
          <td class="${overdue ? 'overdue' : ''}">${fmtDate(p.deadline)}</td>
          <td class="prog-cell">${progress(qStats(p))}</td>
          <td class="muted small">${fmtDate(archived ? p.closedAt || p.updatedAt : p.updatedAt)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function newProjectDialog() {
  openDialog({
    title: 'Новий проєкт',
    submitLabel: 'Створити',
    body: `
      <label class="field"><span>Назва *</span><input name="name" required placeholder="Напр.: Кухня, вул. Шевченка 10"></label>
      <label class="field"><span>Тип меблів</span><input name="furnitureType" list="furniture-types"></label>
      <div class="row2">
        <label class="field"><span>Клієнт</span><input name="client"></label>
        <label class="field"><span>Телефон</span><input name="phone" type="tel"></label>
      </div>
      <label class="field"><span>Адреса</span><input name="address"></label>
      <label class="field"><span>Дедлайн</span><input name="deadline" type="date"></label>
      <p class="muted small">Питання для проєкту буде скопійовано з шаблону.</p>`,
    onSubmit: async form => {
      const p = await request('POST', '/api/projects', Object.fromEntries(new FormData(form)));
      state.projects.push(p);
      location.hash = `#/project/${p.id}/questions`;
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
  const counts = {
    questions: qStats(p).open,
    reminders: openReminders(p).length,
    files: (p.files || []).length,
    invoices: (p.invoices || []).length,
    log: (p.log || []).length,
  };
  const alert = dueReminders(p).length > 0;
  $('#tabs').innerHTML = TABS.map(t => {
    const c = counts[t.key];
    const cls = t.key === 'reminders' && alert ? 'cnt alert' : 'cnt';
    return `<a href="#/project/${p.id}/${t.key}" class="${t.key === state.tab ? 'on' : ''}">${t.label}${c ? ` <span class="${cls}">${c}</span>` : ''}</a>`;
  }).join('');
}

function renderTab() {
  const views = { overview: tabOverview, questions: tabQuestions, reminders: tabReminders, files: tabFiles, invoices: tabInvoices, log: tabLog };
  $('#tab-body').innerHTML = views[state.tab](state.current);
}

function changeStatus(p, key) {
  const was = p.status;
  if (was === key) return;
  const wasArchived = isArchived(p);
  p.status = key;
  addLog(p, `Статус: ${STATUS[was]?.label || was} → ${STATUS[key].label}`, true);
  if (isArchived(p) && !wasArchived) {
    p.closedAt = new Date().toISOString();
    toast('Проєкт перенесено в архів');
  } else if (!isArchived(p) && wasArchived) {
    p.closedAt = null;
    toast('Проєкт повернуто в активні');
  }
  saveNow();
  renderHead();
  renderTabs();
  if (state.tab === 'log' || state.tab === 'overview') renderTab();
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (isArchived(p) ? 'archive' : '')));
}

// --- Огляд

function tabOverview(p) {
  const F = (field, label, type = 'text', cls = '') =>
    `<label class="field ${cls}"><span>${label}</span><input type="${type}" data-field="${field}" value="${esc(p[field] ?? '')}"${field === 'furnitureType' ? ' list="furniture-types"' : ''}></label>`;
  const qs = qStats(p), f = finance(p);
  const nextRem = openReminders(p).sort((a, b) => remDue(a).localeCompare(remDue(b)))[0];
  const fileCounts = FILE_CATEGORIES.map(c => [c, (p.files || []).filter(x => x.category === c).length]).filter(([, n]) => n);

  return `
    <div class="grid-side">
      <div class="card">
        <h3>Дані проєкту</h3>
        <div class="form-grid">
          ${F('name', 'Назва проєкту')}
          ${F('furnitureType', 'Тип меблів')}
          ${F('client', 'Клієнт')}
          ${F('phone', 'Телефон', 'tel')}
          ${F('address', 'Адреса', 'text', 'full')}
          ${F('deadline', 'Дедлайн', 'date')}
          ${F('budget', 'Бюджет, грн', 'number')}
          <label class="field full"><span>Нотатки</span><textarea data-field="notes" rows="6" placeholder="Загальні нотатки по проєкту…">${esc(p.notes || '')}</textarea></label>
        </div>
      </div>
      <div class="side">
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
          <div class="kv"><span>Сума замовлення</span><b>${money(f.order)}</b></div>
          <div class="kv"><span>Оплачено</span><b>${money(f.paid)}</b></div>
          <div class="kv"><span>Залишок</span><b class="${f.due > 0 ? 'warn-text' : ''}">${money(f.due)}</b></div>
          <div class="kv"><span>Витрати</span><b>${money(f.costs)}</b></div>
        </a>
        <a class="card link-card" href="#/project/${p.id}/files">
          <h3>Файли</h3>
          ${fileCounts.length ? fileCounts.map(([c, n]) => `<div class="kv"><span>${c}</span><b>${n}</b></div>`).join('') : '<div class="muted">Ще немає файлів</div>'}
        </a>
        <div class="card muted small">
          Створено: ${fmtDateTime(p.createdAt)}<br>Оновлено: ${fmtDateTime(p.updatedAt)}
          ${p.closedAt ? `<br>Закрито: ${fmtDateTime(p.closedAt)}` : ''}
          <div class="danger-zone"><button class="btn danger small" data-action="project-del">Видалити проєкт</button></div>
        </div>
      </div>
    </div>`;
}

// --- Питання

function tabQuestions(p) {
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
      <button class="btn primary" data-action="q-copy" title="Скопіювати список питань без відповіді, щоб надіслати клієнту">📋 Скопіювати відкриті</button>
    </div>
    ${groups || `<div class="empty">${state.qOnlyOpen ? 'Усі питання мають відповіді 🎉' : 'Питань немає.'}</div>`}`;
}

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
  const group = row.closest('.q-group');
  const gName = state.current.questions.find(x => x.id === q.id).group;
  const items = state.current.questions.filter(x => x.group === gName);
  group.querySelector('.g-count').textContent = `${items.filter(x => qState(x) !== 'open').length}/${items.length}`;
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
      renderTab();
      renderTabs();
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
  navigator.clipboard.writeText(text.join('\n').trim())
    .then(() => toast(`Скопійовано ${n} питань — можна вставити у Viber / Telegram`))
    .catch(() => toast('Не вдалося скопіювати', true));
}

// --- Нагадування

function tabReminders(p) {
  const list = [...(p.reminders || [])];
  const open = list.filter(r => !r.done).sort((a, b) => remDue(a).localeCompare(remDue(b)));
  const done = list.filter(r => r.done).sort((a, b) => remDue(b).localeCompare(remDue(a)));
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
}

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

// Перевірка нагадувань щохвилини: сповіщення браузера + підказка на сторінці
function checkReminders() {
  const nowKey = localDateTime();
  for (const p of state.projects) {
    if (isArchived(p)) continue;
    let changed = false;
    for (const r of p.reminders || []) {
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

// --- Файли

const fileUrl = (p, f) => `/api/projects/${p.id}/files/${f.id}`;
const IMG_EXT = /^\.(jpe?g|png|gif|webp|bmp|svg)$/;

function tabFiles(p) {
  const files = p.files || [];
  const cats = [...new Set([...FILE_CATEGORIES, ...files.map(f => f.category)])];
  const catOptions = sel => cats.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');

  const groups = cats.map(c => {
    const items = files.filter(f => f.category === c);
    if (!items.length) return '';
    return `
      <div class="file-group">
        <h3>${esc(c)} <span class="muted">${items.length}</span></h3>
        <div class="file-grid">${items.map(f => {
          const url = fileUrl(p, f);
          const ext = (f.ext || '').slice(1).toUpperCase() || 'ФАЙЛ';
          return `
            <div class="file-card">
              <a class="thumb" href="${url}" target="_blank">${IMG_EXT.test(f.ext) ? `<img src="${url}" loading="lazy" alt="">` : `<span class="ext">${esc(ext)}</span>`}</a>
              <div class="file-info">
                <a href="${url}" target="_blank" class="file-name" title="${esc(f.name)}">${esc(f.name)}</a>
                <div class="muted small">${fmtSize(f.size)} · ${fmtDate(f.uploadedAt)}</div>
                <div class="file-actions">
                  <select data-action="file-cat" data-fid="${f.id}" title="Перемістити в категорію">${catOptions(f.category)}</select>
                  <a href="${url}?download=1" class="icon-btn" title="Завантажити">⬇</a>
                  <button class="icon-btn" data-action="file-del" data-fid="${f.id}" title="Видалити">✕</button>
                </div>
              </div>
            </div>`;
        }).join('')}</div>
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
}

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

async function handleUpload(fileList) {
  if (!fileList.length) return;
  try { await uploadFiles(fileList); } catch (e) { toast('Помилка завантаження: ' + e.message, true); }
  if (state.current && state.tab === 'files') { renderTab(); renderTabs(); }
}

// --- Рахунки

function tabInvoices(p) {
  const f = finance(p);
  const stat = (label, value, cls = '') => `<div class="stat ${cls}"><div class="muted small">${label}</div><div class="stat-v">${value}</div></div>`;
  return `
    <div class="stats">
      ${stat('Сума замовлення', money(f.order))}
      ${stat('Оплачено клієнтом', money(f.paid), 'ok')}
      ${stat('Залишок до оплати', money(f.due), f.due > 0 ? 'warn' : '')}
      ${stat('Витрати постачальникам', money(f.costs))}
      ${stat('Різниця (замовлення − витрати)', money(f.margin))}
    </div>
    ${invTable(p, 'client', 'Рахунки клієнту', '+ Рахунок клієнту')}
    ${invTable(p, 'supplier', 'Рахунки від постачальників', '+ Рахунок постачальника')}`;
}

function invTable(p, kind, title, addLabel) {
  const items = (p.invoices || []).filter(i => i.kind === kind).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const files = Object.fromEntries((p.files || []).map(f => [f.id, f]));
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
  const i = inv || { kind, number: '', date: localDate(), counterparty: '', description: '', amount: '', paid: '', fileId: null };
  const curFile = i.fileId && (p.files || []).find(f => f.id === i.fileId);
  openDialog({
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
        <label class="field"><span>${i.kind === 'client' ? 'Платник' : 'Постачальник'}</span><input name="counterparty" value="${esc(i.counterparty)}" placeholder="${i.kind === 'client' ? p.client ? esc(p.client) : '' : 'Напр.: Віяр, MTM, Blum'}"></label>
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
        description: d.description.trim(), amount: Number(d.amount) || 0, paid: Number(d.paid) || 0, fileId,
      };
      if (inv) Object.assign(inv, data);
      else (p.invoices ||= []).push({ id: uid(), ...data });
      await saveNow();
      renderTab();
      renderTabs();
    },
  });
  const form = $('#dlg form');
  form.querySelector('[data-fill-paid]').onclick = () => (form.elements.paid.value = form.elements.amount.value);
}

// --- Журнал

function tabLog(p) {
  const items = [...(p.log || [])].reverse();
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
}

function addLogFromInput() {
  const ta = $('[data-ref="log-text"]');
  const text = ta.value.trim();
  if (!text) return;
  addLog(state.current, text);
  saveNow();
  renderTab();
  renderTabs();
}

// ---------- налаштування (шаблон питань)

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
  const d = state.draft;
  app.innerHTML = `
    <div class="page-head">
      <h1>Шаблон питань</h1>
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
  if (go && !e.target.closest('a, button, select, input')) { location.hash = go.dataset.go; return; }

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

      // питання
      case 'q-filter': state.qOnlyOpen = el.dataset.v === 'open'; return renderTab();
      case 'q-na': {
        const q = p.questions.find(x => x.id === el.closest('[data-qid]').dataset.qid);
        q.na = !q.na;
        saveSoon(0);
        renderTab(); renderTabs();
        return;
      }
      case 'q-del': {
        const id = el.closest('[data-qid]').dataset.qid;
        const q = p.questions.find(x => x.id === id);
        if (!confirm(`Видалити питання «${q.text}» з цього проєкту?`)) return;
        p.questions = p.questions.filter(x => x.id !== id);
        saveSoon(0);
        renderTab(); renderTabs();
        return;
      }
      case 'q-add': return addQuestionDialog();
      case 'q-copy': return copyOpenQuestions();
      case 'q-sync': {
        const have = new Set(p.questions.map(q => q.id));
        const add = state.template.filter(t => !have.has(t.id));
        p.questions.push(...add.map(t => ({ ...t, answer: '', na: false })));
        saveSoon(0);
        toast(`Додано питань: ${add.length}`);
        renderTab(); renderTabs();
        return;
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

      // файли
      case 'file-del': {
        const f = p.files.find(x => x.id === el.dataset.fid);
        if (!confirm(`Видалити файл «${f.name}»?`)) return;
        const r = await request('DELETE', `/api/projects/${p.id}/files/${f.id}`);
        p.files = r.files; p.invoices = r.invoices;
        renderTab(); renderTabs();
        return;
      }

      // рахунки
      case 'inv-add': return invoiceDialog(el.dataset.kind);
      case 'inv-edit': return invoiceDialog(null, p.invoices.find(i => i.id === el.closest('[data-iid]').dataset.iid));
      case 'inv-del': {
        const id = el.closest('[data-iid]').dataset.iid;
        if (!confirm('Видалити рахунок? (Прикріплений файл залишиться у «Файлах»)')) return;
        p.invoices = p.invoices.filter(i => i.id !== id);
        await saveNow();
        renderTab(); renderTabs();
        return;
      }

      // журнал
      case 'log-add': return addLogFromInput();
      case 'log-del': {
        const id = el.closest('[data-lid]').dataset.lid;
        if (!confirm('Видалити запис з журналу?')) return;
        p.log = p.log.filter(x => x.id !== id);
        saveSoon(0);
        renderTab(); renderTabs();
        return;
      }
    }
  } catch (err) {
    toast(err.message, true);
  }
});

function addReminderFromInput() {
  const text = $('[data-ref="rem-text"]').value.trim();
  const date = $('[data-ref="rem-date"]').value;
  const time = $('[data-ref="rem-time"]').value;
  if (!text) { $('[data-ref="rem-text"]').focus(); return toast('Напишіть текст нагадування'); }
  if (!date) return toast('Оберіть дату');
  (state.current.reminders ||= []).push({ id: uid(), text, date, time, done: false, notified: false, createdAt: new Date().toISOString() });
  saveSoon(0);
  renderTab(); renderTabs();
  toast('Нагадування додано');
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

app.addEventListener('input', e => {
  const el = e.target;
  const p = state.current;
  if (el.dataset.action === 'search') { state.search = el.value; return renderListBody(); }

  if (el.dataset.field && p) {
    p[el.dataset.field] = el.value;
    return saveSoon();
  }
  if (el.dataset.action === 'q-answer') {
    const row = el.closest('[data-qid]');
    const q = p.questions.find(x => x.id === row.dataset.qid);
    q.answer = el.value;
    updateQRow(row, q);
    return saveSoon();
  }
  if (state.draft && el.dataset.action?.startsWith('t-')) {
    const g = state.draft[Number(el.dataset.g)];
    if (el.dataset.action === 't-group') g.name = el.value;
    if (el.dataset.action === 't-text') g.items[Number(el.dataset.i)].text = el.value;
    if (el.dataset.action === 't-hint') g.items[Number(el.dataset.i)].hint = el.value;
    markDirty();
  }
});

app.addEventListener('change', async e => {
  const el = e.target;
  const a = el.dataset.action;
  const p = state.current;
  try {
    if (el.dataset.field && p) { renderHead(); return; }
    if (a === 'status') return changeStatus(p, el.value);
    if (a === 'upload-cat') { state.uploadCategory = el.value; return; }
    if (a === 'file-input') { await handleUpload(el.files); el.value = ''; return; }
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

// перетягування файлів
app.addEventListener('dragover', e => {
  const d = e.target.closest('[data-drop]');
  if (d) d.classList.add('over');
});
app.addEventListener('dragleave', e => {
  const d = e.target.closest('[data-drop]');
  if (d && !d.contains(e.relatedTarget)) d.classList.remove('over');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
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
    state.projects = d.projects;
    state.template = d.template;
    state.dataDir = d.dataDir;
  } catch {
    app.innerHTML = '<div class="empty">Не вдалося з\'єднатися з сервером. Запустіть <b>start.bat</b> і оновіть сторінку.</div>';
    return;
  }
  route();
  checkReminders();
  setInterval(checkReminders, 60 * 1000);
}

init();
