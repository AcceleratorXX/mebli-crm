'use strict';
// Текст із PDF без сторонніх бібліотек — щоб розібрати рахунок: номер, дату, суму, постачальника.
// Підтримує те, що видають програми рахунків: стиснені (FlateDecode) потоки, потоки об'єктів,
// шрифти Type0/Identity-H з таблицею ToUnicode. Скан (картинка) тексту не має — тоді порожньо.
const zlib = require('node:zlib');

function inflate(buf) {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(buf); } catch { /* наступний спосіб */ }
  }
  try { return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return Buffer.alloc(0); }
}

function ascii85(buf) {
  const s = buf.toString('latin1').replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = [];
  let group = [];
  const flush = (len) => {
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + ((group[k] ?? 84));
    for (let k = 0; k < len - 1; k++) out.push((v >>> (24 - 8 * k)) & 255);
  };
  for (const ch of s) {
    if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) { flush(5); group = []; }
  }
  if (group.length) flush(group.length);
  return Buffer.from(out);
}

// Потік за фільтрами по черзі; картинки (DCT тощо) — не текст, тож null.
function decodeStream(dict, raw) {
  const m = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  const filters = m ? m[1].match(/\/\w+/g).map(f => f.slice(1)) : [];
  for (const f of filters) {
    if (f === 'FlateDecode' || f === 'Fl') raw = inflate(raw);
    else if (f === 'ASCII85Decode' || f === 'A85') raw = ascii85(raw);
    else if (f === 'ASCIIHexDecode' || f === 'AHx') raw = Buffer.from(raw.toString('latin1').replace(/[^0-9a-fA-F]/g, ''), 'hex');
    else return null;
  }
  return raw;
}

// Об'єкти файлу: номер → { dict (текст словника), stream (розпакований потік або null) }.
function readObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    let body = s.slice(start, end);
    let stream = null;
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = lenMatch ? dataStart + Number(lenMatch[1]) : -1;
      if (dataEnd < 0 || s.slice(dataEnd, dataEnd + 30).indexOf('endstream') < 0) dataEnd = s.indexOf('endstream', dataStart);
      body = dict;
      stream = decodeStream(dict, buf.subarray(dataStart, dataEnd));
    }
    objs.set(num, { dict: body, stream });
    re.lastIndex = end;
  }
  // Потоки об'єктів (PDF 1.5+): словники шрифтів і сторінок бувають усередині.
  for (const { dict, stream } of [...objs.values()]) {
    if (!stream || !/\/Type\s*\/ObjStm/.test(dict)) continue;
    const n = Number((/\/N\s+(\d+)/.exec(dict) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(dict) || [])[1] || 0);
    const text = stream.toString('latin1');
    const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const [num, off] = [nums[2 * i], nums[2 * i + 1]];
      const next = i + 1 < n ? nums[2 * i + 3] : text.length - first;
      if (!objs.has(num)) objs.set(num, { dict: text.slice(first + off, first + next), stream: null });
    }
  }
  return objs;
}

const refNum = (text, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(text); return m ? Number(m[1]) : null; };

// Вміст `<< … >>` після ключа (з урахуванням вкладених), або словник за посиланням.
function subDict(objs, text, key) {
  const ref = refNum(text, key);
  if (ref !== null) return objs.get(ref)?.dict || '';
  const at = text.search(new RegExp(`/${key}\\s*<<`));
  if (at < 0) return '';
  let i = text.indexOf('<<', at), depth = 0;
  for (let j = i; j < text.length - 1; j++) {
    if (text[j] === '<' && text[j + 1] === '<') { depth++; j++; }
    else if (text[j] === '>' && text[j + 1] === '>') { depth--; j++; if (!depth) return text.slice(i + 2, j - 1); }
  }
  return '';
}

// Таблиця ToUnicode: код гліфа → символи.
function parseCMap(text) {
  const map = new Map();
  let bytes = 1;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
  if (cs) bytes = cs[1].length / 2;
  const hex = h => { let out = ''; for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return out; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(src, 16), hex(dst));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const [a, b] = [parseInt(lo, 16), parseInt(hi, 16)];
      if (rest.startsWith('[')) {
        [...rest.matchAll(/<([0-9a-fA-F]*)>/g)].forEach(([, d], k) => map.set(a + k, hex(d)));
      } else {
        const d = rest.slice(1, -1);
        const base = parseInt(d.slice(-4) || '0', 16), prefix = hex(d.slice(0, -4));
        for (let c = a; c <= b && c - a < 65536; c++) map.set(c, prefix + String.fromCharCode(base + c - a));
      }
    }
  }
  return { map, bytes };
}

// Рядок PDF (байти) → текст за шрифтом.
function decode(bytes, font) {
  if (!font?.cmap) return Buffer.from(bytes).toString('latin1');
  const { map, bytes: w } = font.cmap;
  let out = '';
  for (let i = 0; i + w <= bytes.length; i += w) {
    let code = 0;
    for (let k = 0; k < w; k++) code = code * 256 + bytes[i + k];
    out += map.get(code) ?? (w === 1 ? String.fromCharCode(code) : '');
  }
  return out;
}

// Токени потоку вмісту: рядки (байти), числа, імена, оператори, масиви.
function* tokens(s) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      const out = [];
      let depth = 1; i++;
      while (i < n && depth) {
        let ch = s[i];
        if (ch === '\\') {
          const nx = s[++i];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }[nx];
          if (esc !== undefined) { out.push(esc); i++; }
          else if (/[0-7]/.test(nx)) { let o = ''; while (o.length < 3 && /[0-7]/.test(s[i])) o += s[i++]; out.push(parseInt(o, 8) & 255); }
          else if (nx === '\r' || nx === '\n') { i++; if (nx === '\r' && s[i] === '\n') i++; }
          else { out.push(nx.charCodeAt(0)); i++; }
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')' && !--depth) { i++; break; }
        out.push(ch.charCodeAt(0) & 255); i++;
      }
      yield { t: 'str', v: out }; continue;
    }
    if (c === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i);
      let h = s.slice(i + 1, end).replace(/\s+/g, '');
      if (h.length % 2) h += '0';
      const out = [];
      for (let k = 0; k < h.length; k += 2) out.push(parseInt(h.slice(k, k + 2), 16));
      i = end + 1;
      yield { t: 'str', v: out }; continue;
    }
    if (c === '<' || c === '>') { i += 2; yield { t: 'op', v: c + c }; continue; }
    if (c === '[' || c === ']') { i++; yield { t: c }; continue; }
    if (c === '/') { let j = i + 1; while (j < n && !/[\s/[\]()<>{}%]/.test(s[j])) j++; yield { t: 'name', v: s.slice(i + 1, j) }; i = j; continue; }
    let j = i;
    while (j < n && !/[\s/[\]()<>{}%]/.test(s[j])) j++;
    if (j === i) { i++; continue; }
    const w = s.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { t: 'num', v: Number(w) };
    else {
      yield { t: 'op', v: w };
      if (w === 'BI') { const e = s.indexOf('EI', i); i = e < 0 ? n : e + 2; } // вбудована картинка
    }
  }
}

// Текст однієї сторінки: шматки з координатами, складені в рядки згори донизу.
function pageText(objs, page) {
  const res = subDict(objs, page.dict, 'Resources');
  const fontDict = subDict(objs, res, 'Font');
  const fonts = {};
  for (const [, name, num] of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) {
    const f = objs.get(Number(num));
    const tu = f && refNum(f.dict, 'ToUnicode');
    const cm = tu !== null && tu !== undefined ? objs.get(tu)?.stream : null;
    fonts[name] = { cmap: cm ? parseCMap(cm.toString('latin1')) : null };
  }
  const contents = [];
  const arr = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict);
  if (arr) for (const [, num] of arr[1].matchAll(/(\d+)\s+\d+\s+R/g)) contents.push(Number(num));
  else { const one = refNum(page.dict, 'Contents'); if (one !== null) contents.push(one); }
  const src = contents.map(num => objs.get(num)?.stream?.toString('latin1') || '').join('\n');

  const pieces = [];
  let font = null, x = 0, y = 0, lx = 0, ly = 0, leading = 0;
  let stack = [], arrStack = null;
  const ctm = [[1, 0, 0, 1, 0, 0]];
  const put = text => { if (text) { const m = ctm[ctm.length - 1]; pieces.push({ x: m[0] * x + m[4], y: m[3] * y + m[5], text }); } };
  for (const tok of tokens(src)) {
    if (tok.t === '[') { arrStack = []; continue; }
    if (tok.t === ']') { stack.push({ t: 'arr', v: arrStack }); arrStack = null; continue; }
    if (arrStack) { arrStack.push(tok); continue; }
    if (tok.t !== 'op') { stack.push(tok); continue; }
    const a = stack.map(t => t.v);
    switch (tok.v) {
      case 'q': ctm.push([...ctm[ctm.length - 1]]); break;
      case 'Q': if (ctm.length > 1) ctm.pop(); break;
      case 'cm': if (a.length >= 6) { const [p, q, r, s2, e, f] = a.slice(-6); const m = ctm[ctm.length - 1]; ctm[ctm.length - 1] = [p * m[0] + q * m[2], p * m[1] + q * m[3], r * m[0] + s2 * m[2], r * m[1] + s2 * m[3], e * m[0] + f * m[2] + m[4], e * m[1] + f * m[3] + m[5]]; } break;
      case 'BT': x = y = lx = ly = 0; break;
      case 'Tf': font = fonts[a[a.length - 2]] || null; break;
      case 'TL': leading = a[a.length - 1]; break;
      case 'Td': lx += a[a.length - 2]; ly += a[a.length - 1]; x = lx; y = ly; break;
      case 'TD': lx += a[a.length - 2]; ly += a[a.length - 1]; leading = -a[a.length - 1]; x = lx; y = ly; break;
      case 'Tm': lx = x = a[a.length - 2]; ly = y = a[a.length - 1]; break;
      case 'T*': ly -= leading; x = lx; y = ly; break;
      case 'Tj': if (stack.length) put(decode(stack[stack.length - 1].v, font)); break;
      case "'": ly -= leading; x = lx; y = ly; if (stack.length) put(decode(stack[stack.length - 1].v, font)); break;
      case '"': ly -= leading; x = lx; y = ly; if (stack.length) put(decode(stack[stack.length - 1].v, font)); break;
      case 'TJ': {
        const items = stack[stack.length - 1]?.v || [];
        let text = '';
        for (const it of items) {
          if (it.t === 'str') text += decode(it.v, font);
          else if (it.t === 'num' && it.v < -250) text += ' ';
        }
        put(text);
        break;
      }
    }
    stack = [];
  }
  // У рядок — шматки з однаковою висотою (з допуском), зліва направо.
  pieces.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines = [];
  for (const p of pieces) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) < 3) line.items.push(p);
    else lines.push({ y: p.y, items: [p] });
  }
  return lines.map(l => l.items.sort((p, q) => p.x - q.x).map(p => ({ x: p.x, text: p.text.replace(/\s+/g, ' ').trim() })).filter(p => p.text)).filter(l => l.length);
}

// Документ: `rows` — рядки згори донизу, кожен — шматки тексту з x; `text` — ті самі рядки текстом.
function pdfDoc(buf) {
  const objs = readObjects(buf);
  const pages = [...objs.values()].filter(o => /\/Type\s*\/Page(?![s\w])/.test(o.dict));
  const rows = pages.flatMap(page => { try { return pageText(objs, page); } catch { return []; } });
  return { rows, text: rows.map(r => r.map(p => p.text).join(' ')).join('\n') };
}
const pdfText = buf => pdfDoc(buf).text;

// ---------- поля рахунку з тексту

const MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'верес', 'жовт', 'листоп', 'груд'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сент', 'окт', 'ноя', 'дек'];
const pad = n => String(n).padStart(2, '0');

function parseDate(text) {
  let m = /(\d{1,2})\s+([А-Яа-яЇїІіЄєҐґ']+)\s+(\d{4})/.exec(text);
  if (m) {
    const word = m[2].toLowerCase();
    let k = MONTHS.findIndex(p => word.startsWith(p));
    if (k < 0) k = MONTHS_RU.findIndex(p => word.startsWith(p));
    if (k >= 0) return `${m[3]}-${pad(k + 1)}-${pad(m[1])}`;
  }
  m = /(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b/.exec(text);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return '';
}

const MONEY = /(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2}|\d+)/;
const toNum = s => Number(s.replace(/[   ]/g, '').replace(',', '.'));

// Підсумок — за найнадійнішою з назв рядка; з кількох однакових — останній (підсумок унизу).
// «до сплати» буває й у тексті («Рахунок дійсний до сплати 2 календарних днів») — тож лише як назва з двокрапкою.
const TOTAL_LABELS = [
  /(?:всього|усього|разом)\s+до\s+сплати/i, /(?:^|\s)до\s+сплати\s*:/i, /к\s+оплате\s*:/i,
  /(?:всього|усього|разом)\s+з\s+пдв/i, /(?:всего|итого)\s+с\s+ндс/i,
  /сума\s+до\s+оплати/i, /загальна\s+сума/i, /(?:^|\s)(?:всього|усього|разом|итого|всего)\s*:/i,
];
// Підсумок — сума з копійками («15 191,00»), не кількість чи дні.
const TOTAL_MONEY = /(\d{1,3}(?:[ \u00a0\u202f]\d{3})*[.,]\d{2})(?!\d)/;

function findTotal(lines) {
  for (const label of TOTAL_LABELS) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const at = lines[i].search(label);
      if (at < 0) continue;
      const after = lines[i].slice(at).replace(label, '');
      const m = TOTAL_MONEY.exec(after) || (lines[i + 1] && TOTAL_MONEY.exec(lines[i + 1]));
      if (m && toNum(m[1]) > 0) return toNum(m[1]);
    }
  }
  return 0;
}

// Позиції рахунку: рядки, що починаються з номера по порядку (1, 2, 3…) і мають суми.
// Назва — без кодів товару спереду й до першої колонки (одиниця, кількість); перенесені рядки назви дописуємо.
const UNIT = /^(м2|м²|м\.п\.|пог\.?\s?м|шт\.?|компл\.?|кг|уп\.?|пар[аи]?|л|м|лист|рул\.?)$/i;
const DECIMAL = /^\d+[.,]\d+$/;
const ROW_END = /\s(?:Складська|Не складська|Не)$/i;

function parseItems(lines, rows = []) {
  const items = [];
  let expect = 1, current = null, column = null;
  const NOT_NAME = p => /^(?:не\s+)?складська$|^не$/i.test(p.text) || UNIT.test(p.text) || /^\d+[.,]\d+/.test(p.text);
  const money = l => (l.match(/\d+[.,]\d{2}\b/g) || []).length;
  for (const [li, line] of lines.entries()) {
    const pieces = rows[li] || [];
    const m = /^(\d{1,3})\s+(.+)$/.exec(line);
    if (m && Number(m[1]) === expect && money(line) >= 2) {
      const words = m[2].split(' ');
      // Код товару постачальника (ВіЯр: «29705») — перше число після номера рядка; у договорі це «Артикул».
      const code = /^\d{3,}$/.test(words[0]) ? words[0] : '';
      while (words.length > 1 && /\d/.test(words[0]) && !/[a-zа-яіїєґ]/.test(words[0])) words.shift(); // коди товару
      let cut = words.findIndex((w, k) => (UNIT.test(w) && /^[\d]/.test(words[k + 1] || '')) || DECIMAL.test(w));
      if (cut < 0) cut = words.length;
      // Одиниця — лише перед кількістю: «М» у «висота М (108 мм)» — не метри.
      const unitAt = words.findIndex((w, k) => UNIT.test(w) && /^\d/.test(words[k + 1] || ''));
      const nums = words.slice(cut).filter(w => /^\d/.test(w));
      // Сума — остання колонка; тисячі відокремлено пробілом («1 248,59»), тож дописуємо зліва лише 1–3 цифри без коми.
      const tail = line.split(' ');
      while (tail.length && !DECIMAL.test(tail[tail.length - 1])) tail.pop();
      let sum = tail.length > 2 ? tail.pop() : '';
      if (sum) while (/^\d{1,3}$/.test(tail[tail.length - 1] || '') && tail.length > 2) sum = tail.pop() + sum;
      // Колонка назви: від шматка, з якого починається назва, до наступного шматка, що вже не назва.
      // Початок — перший шматок зі звичайними словами (малі літери): колонки коду й артикулу («Z96.10E1 FRO-ST») — ні.
      const start = pieces.findIndex((p, k) => k > 0 && /[a-zа-яіїєґ]{2,}/.test(p.text) && !NOT_NAME(p));
      const stop = start >= 0 ? pieces.findIndex((p, k) => k > start && NOT_NAME(p)) : -1;
      column = start >= 0 ? { from: pieces[start].x - 3, to: stop > 0 ? pieces[stop].x - 1 : Infinity } : null;
      let name = words.slice(0, cut).join(' ');
      if (start >= 0) {
        const own = pieces.slice(start, stop > 0 ? stop : undefined).map(p => p.text).join(' ').split(' ');
        while (own.length > 1 && /\d/.test(own[0]) && !/[a-zа-яіїєґ]/.test(own[0])) own.shift();
        const ownCut = own.findIndex((w, k) => (UNIT.test(w) && /^\d/.test(own[k + 1] || '')) || DECIMAL.test(w));
        name = own.slice(0, ownCut < 0 ? undefined : ownCut).join(' ');
      }
      current = {
        name: name.replace(ROW_END, '').trim(),
        code,
        unit: unitAt >= 0 ? words[unitAt] : '',
        qty: nums.length ? Number(nums[0].replace(',', '.')) : 0,
        sum: sum ? toNum(sum) : 0,
      };
      items.push(current);
      expect++;
      continue;
    }
    if (!current) continue;
    // Підсумок чи текст після таблиці — позиції скінчилися.
    if (money(line) >= 1 && !/[а-яіїєґa-z]{3,}/i.test(line.replace(/складська/gi, ''))) { current = null; continue; }
    if (/всього|разом|усього|итого|до сплати/i.test(line)) { current = null; continue; }
    // \b у JS не працює з кирилицею — межі слова пробілами.
    const own = column && pieces.length ? pieces.filter(p => p.x >= column.from && p.x < column.to).map(p => p.text).join(' ') : line;
    const extra = own.replace(/(?:^|\s)(?:не\s+)?складська(?=\s|$)/gi, '').trim();
    if (extra && extra.length < 80) current.name = `${current.name} ${extra}`.trim();
  }
  return items.filter(it => it.name);
}

// Назва рахунку для списку: дві перші позиції й скільки ще.
function invoiceTitle(items) {
  if (!items.length) return '';
  const short = s => (s.length > 60 ? s.slice(0, 57).trimEnd() + '…' : s);
  const head = items.slice(0, 2).map(it => short(it.name)).join('; ');
  return items.length > 2 ? `${head} + ще ${items.length - 2} поз.` : head;
}

// Відомі постачальники — за словом у тексті рахунку.
// Виробників фурнітури (Blum, Hettich) тут немає: вони в назвах товарів, а не постачальники.
const KNOWN = [[/в[іi]яр|viyar/i, 'ВіЯр'], [/меблев[іи]\s+технолог/i, 'Меблеві технології'], [/новий\s+стиль/i, 'Новий стиль'], [/(?:^|[\s"«])мтм(?=[\s"»]|$)/i, 'МТМ'], [/gtv/i, 'GTV']];
const titleCase = v => v.toLowerCase().replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase());

// Дата готовності замовлення (ВіЯр: «Орієнтовна дата готовності … 19.09.2026», «Дата готовності замовлення на фасад 22.10.2026»).
function readyDate(text) {
  const m = /дат[аиі]\s+готовності[^\n]{0,80}?(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}\s+[А-Яа-яЇїІіЄє']+\s+\d{4})/i.exec(text);
  return m ? parseDate(m[1]) : '';
}

function parseInvoice(text, suppliers = [], rows = []) {
  const lines = text.split('\n');
  const head = lines.find(l => /(рахун|заявк|сч[её]т|invoice|замовлен)[^\n]*№/i.test(l)) || lines.find(l => /№\s*[\w-]/.test(l)) || '';
  const number = (/№\s*([A-Za-zА-Яа-яЇїІіЄє0-9][\w\-\/.А-Яа-яЇїІіЄє]*)/.exec(head) || [])[1] || '';
  const dateSrc = head.split('№')[1] || '';
  const date = parseDate(/від|от|from/i.test(dateSrc) ? dateSrc : head) || parseDate(text);
  const amount = findTotal(lines);
  const items = parseItems(lines, rows);
  // Постачальник — лише з шапки (до таблиці товарів): у назвах товарів бувають бренди (петля Blum).
  const firstRow = lines.findIndex(l => /^1\s/.test(l) && (l.match(/\d+[.,]\d{2}\b/g) || []).length >= 2);
  const header = lines.slice(0, firstRow > 0 ? firstRow : 25).join('\n');
  const m = /(?:Постачальник|Поставщик|Продавець|Виконавець)\s*:?\s*(.*)/i.exec(header);
  let named = m ? m[1].trim() : '';
  if (/^(одержувач|покупець|платник|отримувач)/i.test(named)) named = '';
  // З «Постачальник: ПП "ФІРМА "МЕБЛЕВІ ТЕХНОЛОГІЇ"» — назва в лапках, остання.
  const quoted = named.match(/[«"]([^«»"]{2,})[»"]?\s*$/);
  if (quoted) named = titleCase(quoted[1].trim());
  const where = named || header;
  const known = (KNOWN.find(([re]) => re.test(where)) || KNOWN.find(([re]) => re.test(header)) || [])[1] || '';
  const contact = suppliers.find(s => s && s.length > 2 && where.toLowerCase().includes(s.toLowerCase())) || '';
  const counterparty = known || contact || named.slice(0, 120);
  return { number, date, ready: readyDate(text), amount, counterparty, items, title: invoiceTitle(items), hasText: text.replace(/\s/g, '').length > 20 };
}

module.exports = { pdfText, pdfDoc, parseInvoice };
