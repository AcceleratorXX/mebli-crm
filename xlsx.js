'use strict';
// Мінімальне читання .xlsx без залежностей: zip (stored / deflate) + XML аркушів.
// Повертає [{ name, rows: [[значення клітинок…], …] }] — лише значення, без форматування.
const zlib = require('node:zlib');

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Це не файл .xlsx (якщо це старий .xls — збережіть його в Excel як .xlsx)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    files.set(name.replace(/\\/g, '/'), () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('Непідтримуване стиснення у файлі');
    });
  }
  return files;
}

const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// Текст рядка: усі <t> поза фонетичними підказками <rPh>
const textOf = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function readXlsx(buf) {
  const files = unzip(buf);
  const read = name => files.get(name)?.().toString('utf8') ?? '';

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));

  const rels = {};
  for (const [tag] of read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const target = attr(tag, 'Target') || '';
    rels[attr(tag, 'Id')] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }

  const sheets = [];
  for (const [tag] of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const xml = read(rels[attr(tag, 'r:id')]);
    const rows = [];
    for (const [, rowAttrs, body] of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rn = attr(rowAttrs, 'r');
      const r = rn ? Number(rn) - 1 : rows.length;
      const row = [];
      for (const [, cAttrs, inner = ''] of (body || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cAttrs, 'r');
        const i = ref ? colIndex(ref) : row.length;
        const t = attr(cAttrs, 't');
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = null;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str' || t === 'e') val = v == null ? null : decode(v);
        else if (t === 'b') val = v === '1';
        else if (v != null) val = Number(v);
        if (val !== null && val !== '') row[i] = val;
      }
      rows[r] = row;
    }
    sheets.push({ name: decode(attr(tag, 'name') || 'Аркуш'), rows: Array.from(rows, r => Array.from(r || [], c => c ?? null)) });
  }
  if (!sheets.length) throw new Error('У файлі не знайдено аркушів');
  return sheets;
}

module.exports = { readXlsx };
