'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { DEFAULT_TEMPLATE } = require('./defaults');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4',
};

// ---------- база даних (JSON-файл)

let db;

function loadDb() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    fs.copyFileSync(DB_FILE, path.join(DATA_DIR, 'db.backup.json'));
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = {};
  }
  db.projects ??= [];
  db.template ??= DEFAULT_TEMPLATE;
  db.seq ??= db.projects.length;
}

let writing = Promise.resolve();
function saveDb() {
  const json = JSON.stringify(db, null, 2);
  writing = writing
    .then(async () => {
      const tmp = DB_FILE + '.tmp';
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, DB_FILE);
    })
    .catch(err => console.error('Помилка збереження бази:', err));
  return writing;
}

const newId = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

// ---------- HTTP-утиліти

function send(res, status, body) {
  if (body === undefined) { res.writeHead(status); return res.end(); }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw Object.assign(new Error('Завеликий запит'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const str = (v, max = 2000) => (v == null ? '' : String(v).slice(0, max));

// ---------- API

const EDITABLE = ['name', 'client', 'phone', 'address', 'furnitureType', 'status', 'deadline',
  'budget', 'notes', 'closedAt', 'questions', 'invoices', 'log', 'reminders'];

function findProject(id) {
  return db.projects.find(p => p.id === id);
}

async function api(req, res, parts, url) {
  const [resource, id, sub, subId] = parts;
  const m = req.method;

  if (resource === 'data' && m === 'GET') {
    return send(res, 200, { projects: db.projects, template: db.template, dataDir: DATA_DIR });
  }

  if (resource === 'template') {
    if (id === 'default' && m === 'GET') return send(res, 200, DEFAULT_TEMPLATE);
    if (!id && m === 'PUT') {
      const body = await readJson(req);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Очікується масив питань' });
      db.template = body
        .filter(q => q && str(q.text).trim())
        .map(q => ({ id: str(q.id, 40) || 't' + newId(), group: str(q.group, 200) || 'Інше', text: str(q.text), hint: str(q.hint) }));
      await saveDb();
      return send(res, 200, db.template);
    }
  }

  if (resource !== 'projects') return send(res, 404, { error: 'Не знайдено' });

  if (!id && m === 'POST') {
    const body = await readJson(req);
    const p = {
      id: newId(),
      number: ++db.seq,
      name: str(body.name, 300).trim() || 'Без назви',
      client: str(body.client, 300), phone: str(body.phone, 100), address: str(body.address, 500),
      furnitureType: str(body.furnitureType, 200), deadline: str(body.deadline, 20),
      budget: '', notes: '', status: 'new',
      createdAt: now(), updatedAt: now(), closedAt: null,
      questions: db.template.map(q => ({ ...q, answer: '', na: false })),
      files: [], invoices: [], reminders: [],
      log: [{ id: newId(), at: now(), text: 'Проєкт створено', auto: true }],
    };
    db.projects.push(p);
    await saveDb();
    return send(res, 201, p);
  }

  const p = id && findProject(id);
  if (!p) return send(res, 404, { error: 'Проєкт не знайдено' });

  if (!sub) {
    if (m === 'PUT') {
      const body = await readJson(req);
      for (const key of EDITABLE) if (key in body) p[key] = body[key];
      p.updatedAt = now();
      await saveDb();
      return send(res, 200, p);
    }
    if (m === 'DELETE') {
      db.projects = db.projects.filter(x => x !== p);
      await saveDb();
      await fsp.rm(path.join(UPLOADS_DIR, p.id), { recursive: true, force: true });
      return send(res, 204);
    }
  }

  if (sub === 'files') {
    const dir = path.join(UPLOADS_DIR, p.id);

    if (!subId && m === 'POST') {
      const name = str(url.searchParams.get('name') || 'file', 250);
      const category = str(url.searchParams.get('category') || 'Інше', 200);
      const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
      const fid = newId();
      await fsp.mkdir(dir, { recursive: true });
      const dest = path.join(dir, fid + ext);
      await pipeline(req, fs.createWriteStream(dest));
      const { size } = await fsp.stat(dest);
      const file = { id: fid, name, category, ext, size, uploadedAt: now() };
      p.files.push(file);
      p.updatedAt = now();
      await saveDb();
      return send(res, 201, { file, files: p.files });
    }

    const f = p.files.find(x => x.id === subId);
    if (!f) return send(res, 404, { error: 'Файл не знайдено' });
    const filePath = path.join(dir, f.id + f.ext);

    if (m === 'GET') {
      let stat;
      try { stat = await fsp.stat(filePath); } catch { return send(res, 404, { error: 'Файл відсутній на диску' }); }
      const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
      res.writeHead(200, {
        'Content-Type': MIME[f.ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      });
      return pipeline(fs.createReadStream(filePath), res);
    }
    if (m === 'PATCH') {
      const body = await readJson(req);
      if (body.category) f.category = str(body.category, 200);
      if (body.name) f.name = str(body.name, 250);
      await saveDb();
      return send(res, 200, { files: p.files });
    }
    if (m === 'DELETE') {
      p.files = p.files.filter(x => x !== f);
      for (const inv of p.invoices) if (inv.fileId === f.id) inv.fileId = null;
      await saveDb();
      await fsp.rm(filePath, { force: true });
      return send(res, 200, { files: p.files, invoices: p.invoices });
    }
  }

  send(res, 405, { error: 'Метод не підтримується' });
}

// ---------- статичні файли

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Заборонено' });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Не знайдено' });
  }
}

// ---------- запуск

loadDb();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') await api(req, res, parts.slice(1), url);
    else await serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message || 'Помилка сервера' });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  const link = `http://localhost:${PORT}`;
  console.log(`Меблі CRM працює: ${link}`);
  console.log(`Дані зберігаються в: ${DATA_DIR}`);
  console.log('Щоб зупинити — закрийте це вікно або натисніть Ctrl+C.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    require('node:child_process').exec(`start "" "${link}"`);
  }
});
