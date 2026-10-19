#!/usr/bin/env node
// Сервер карты Млечного Пути: раздаёт статику и управляет освещением у всех зрителей.
// Без зависимостей — нужен только Node.js 18+.
//
//   node server.js                      → http://localhost:8080
//   PORT=3000 ADMIN_TOKEN=secret node server.js
//
// API:
//   GET   /api/lighting                 текущее состояние
//   PATCH /api/lighting                 изменить часть параметров (JSON или form)
//   PUT   /api/lighting                 заменить всё (недостающее → по умолчанию)
//   POST  /api/lighting/preset/<имя>    применить пресет
//   POST  /api/lighting/reset           сбросить
//   GET   /api/events                   поток событий (Server-Sent Events)
//   GET   /api/config                   схема параметров и пресеты
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.ADMIN_TOKEN || '';
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, 'lighting-state.json');

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'lighting.json'), 'utf8'));
const SCHEMA = CONFIG.schema;
const PRESETS = CONFIG.presets;

const defaults = () => Object.fromEntries(Object.entries(SCHEMA).map(([k, f]) => [k, f.default]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let state = { ...defaults(), preset: 'standard', rev: 0, updatedAt: Date.now() };

// ---------- проверка входных значений ----------
function sanitize(input) {
  const values = {}, errors = [];
  for (const [k, v] of Object.entries(input || {})) {
    if (k === 'transition' || k === 'preset' || k === 'rev' || k === 'updatedAt') continue;
    const f = SCHEMA[k];
    if (!f) { errors.push(`${k}: неизвестный параметр`); continue; }
    if (f.type === 'bool') {
      if (typeof v === 'boolean') values[k] = v;
      else if (['true', '1', 'on', 'yes', 1].includes(v)) values[k] = true;
      else if (['false', '0', 'off', 'no', 0].includes(v)) values[k] = false;
      else errors.push(`${k}: нужно true/false`);
    } else if (f.type === 'color') {
      const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(v).trim());
      if (!m) { errors.push(`${k}: нужен цвет вида #ffaa00`); continue; }
      let h = m[1].toLowerCase();
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      values[k] = '#' + h;
    } else {
      const n = Number(v);
      if (v === '' || v === null || !Number.isFinite(n)) { errors.push(`${k}: нужно число`); continue; }
      values[k] = clamp(n, f.min, f.max);
    }
  }
  return { values, errors };
}

function transitionOf(input, fallback) {
  const n = Number(input && input.transition);
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 20000) : fallback;
}

try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  Object.assign(state, sanitize(saved).values);
  if (typeof saved.preset === 'string') state.preset = saved.preset;
} catch { /* первого запуска файла ещё нет */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), err => {
      if (err) console.warn('Не удалось сохранить состояние:', err.message);
    });
  }, 400);
}

// ---------- рассылка событий (SSE) ----------
const clients = new Map(); // res → { role }

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data) {
  for (const res of clients.keys()) send(res, event, data);
}
function counts() {
  let viewers = 0, admins = 0;
  for (const c of clients.values()) c.role === 'admin' ? admins++ : viewers++;
  return { viewers, admins };
}

function update(values, { preset = 'custom', transition = 300, source = 'api' } = {}) {
  Object.assign(state, values);
  state.preset = preset;
  state.rev++;
  state.updatedAt = Date.now();
  save();
  broadcast('lighting', { state, transition, source });
  return state;
}

function applyPreset(name, transition, source) {
  const p = PRESETS[name];
  if (!p) return null;
  return update(sanitize(p.values).values, { preset: name, transition, source });
}

setInterval(() => { for (const res of clients.keys()) res.write(': ping\n\n'); }, 20000).unref();

// ---------- HTTP ----------
function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function authorized(req, url) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-admin-token'] || url.searchParams.get('token') || '');
  const a = Buffer.from(String(given)), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 16 * 1024) { reject(Object.assign(new Error('Слишком большое тело запроса'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('json') || raw.startsWith('{')) resolve(JSON.parse(raw));
        else resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;

  if (p === '/api/events' && m === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    clients.set(res, { role: url.searchParams.get('role') === 'admin' ? 'admin' : 'viewer' });
    send(res, 'lighting', { state, transition: 0, source: 'hello' });
    broadcast('clients', counts());
    req.on('close', () => { clients.delete(res); broadcast('clients', counts()); });
    return;
  }
  if (p === '/api/config' && m === 'GET') return sendJSON(res, 200, { ...CONFIG, auth: !!TOKEN });
  if (p === '/api/lighting' && m === 'GET') return sendJSON(res, 200, { state, clients: counts(), auth: !!TOKEN });
  if (p === '/api/status' && m === 'GET') return sendJSON(res, 200, { ok: true, rev: state.rev, clients: counts(), uptime: process.uptime() });

  const writes = (p === '/api/lighting' && ['PATCH', 'POST', 'PUT'].includes(m)) ||
                 (p.startsWith('/api/lighting/') && m === 'POST');
  if (!writes) return sendJSON(res, 404, { error: 'Нет такого метода API' });
  if (!authorized(req, url)) return sendJSON(res, 401, { error: 'Нужен токен администратора' });

  const body = await readBody(req);
  const source = String(req.headers['x-source'] || 'api').slice(0, 40);

  if (p === '/api/lighting') {
    const { values, errors } = sanitize(body);
    if (!Object.keys(values).length && errors.length) return sendJSON(res, 400, { error: 'Нечего менять', errors });
    const base = m === 'PUT' ? defaults() : {};
    update({ ...base, ...values }, { transition: transitionOf(body, 300), source });
    return sendJSON(res, 200, { state, errors });
  }
  if (p === '/api/lighting/reset') {
    update(defaults(), { preset: 'standard', transition: transitionOf(body, 1200), source });
    return sendJSON(res, 200, { state });
  }
  const pm = /^\/api\/lighting\/preset\/([\w-]+)$/.exec(p);
  if (pm) {
    const s = applyPreset(pm[1], transitionOf(body, 1500), source);
    return s ? sendJSON(res, 200, { state: s }) : sendJSON(res, 404, { error: `Нет пресета «${pm[1]}»`, presets: Object.keys(PRESETS) });
  }
  return sendJSON(res, 404, { error: 'Нет такого метода API' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const HIDDEN = new Set(['server.js', 'package.json', path.basename(STATE_FILE)]);

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'Метод не поддерживается' });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return sendJSON(res, 400, { error: 'Плохой путь' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  const name = path.basename(file);
  if (!file.startsWith(ROOT + path.sep) || name.startsWith('.') || HIDDEN.has(name) || !MIME[path.extname(file)]) {
    return sendJSON(res, 404, { error: 'Не найдено' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return sendJSON(res, 404, { error: 'Не найдено' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token, X-Source');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url).catch(e => sendJSON(res, e.status || 500, { error: e.message }));
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Карта Млечного Пути:  http://localhost:${PORT}/`);
  console.log(`Пульт освещения:      http://localhost:${PORT}/admin.html`);
  console.log(TOKEN ? 'Изменение света защищено токеном ADMIN_TOKEN.' : 'Внимание: ADMIN_TOKEN не задан — менять свет может любой.');
  if (process.stdin.isTTY) console.log('Консоль: введите help для списка команд.');
});

// ---------- управление из консоли сервера ----------
if (process.stdin.isTTY && !process.env.NO_CONSOLE) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'свет> ' });
  const show = () => {
    for (const [k, f] of Object.entries(SCHEMA)) console.log(`  ${k.padEnd(17)} ${String(state[k]).padEnd(9)} ${f.label}`);
    console.log(`  пресет: ${state.preset}, зрителей: ${counts().viewers}, пультов: ${counts().admins}`);
  };
  const help = () => console.log([
    '  show                       текущие значения',
    '  set <ключ> <знач> [...]    изменить, напр.: set exposure 1.4 bloom 2',
    '  preset <имя>               пресеты: ' + Object.keys(PRESETS).join(', '),
    '  reset                      значения по умолчанию',
    '  lock | unlock              запретить/разрешить зрителям менять свет',
    '  clients                    сколько подключено',
    '  exit                       остановить сервер',
  ].join('\n'));
  rl.on('line', line => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    switch ((cmd || '').toLowerCase()) {
      case '': break;
      case 'help': case '?': help(); break;
      case 'show': case 'ls': show(); break;
      case 'set': {
        const input = {};
        for (let i = 0; i + 1 < args.length; i += 2) input[args[i]] = args[i + 1];
        const { values, errors } = sanitize(input);
        errors.forEach(e => console.log('  ! ' + e));
        if (Object.keys(values).length) { update(values, { source: 'console' }); console.log('  ок'); }
        break;
      }
      case 'preset':
        console.log(applyPreset(args[0], 1500, 'console') ? '  ок' : '  нет такого пресета: ' + Object.keys(PRESETS).join(', '));
        break;
      case 'reset': update(defaults(), { preset: 'standard', transition: 1200, source: 'console' }); console.log('  ок'); break;
      case 'lock': update({ lockClients: true }, { preset: state.preset, source: 'console' }); console.log('  зрители не могут менять свет'); break;
      case 'unlock': update({ lockClients: false }, { preset: state.preset, source: 'console' }); console.log('  зрители снова могут менять свет'); break;
      case 'clients': console.log('  ', counts()); break;
      case 'exit': case 'quit': shutdown(); return;
      default: console.log('  неизвестная команда, введите help');
    }
    rl.prompt();
  });
  setTimeout(() => rl.prompt(), 50);
}

function shutdown() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
  for (const res of clients.keys()) res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
