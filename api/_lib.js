// Shared helpers for the guestbook + admin functions (underscore = not a public route).
const crypto = require('crypto');

const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ADMIN = process.env.ADMIN_PASSWORD || '';

const configured = () => !!(RURL && RTOK);

async function redis(cmd) {
  const r = await fetch(RURL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function pipe(cmds) {
  const r = await fetch(RURL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('pipeline failed');
  return j.map((x) => x.result);
}

function send(res, code, obj, cache) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(code).end(JSON.stringify(obj));
}

function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  return sha('ip:' + (ADMIN || 'x') + ip).slice(0, 24); // never store the raw IP
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// admin tokens: "<expiry>.<hmac>", signed with a key derived from ADMIN_PASSWORD (never leaves the server)
const key = () => sha('tok:' + ADMIN);
function makeToken(ttlMs) {
  const exp = String(Date.now() + ttlMs);
  return exp + '.' + crypto.createHmac('sha256', key()).update(exp).digest('hex');
}
function tokenOk(req) {
  if (!ADMIN) return false;
  const h = String(req.headers.authorization || '');
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [exp, mac] = t.split('.');
  if (!exp || !mac || !(+exp > Date.now())) return false;
  const want = crypto.createHmac('sha256', key()).update(exp).digest('hex');
  const a = Buffer.from(mac), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function passOk(p) {
  if (!ADMIN) return false;
  const a = Buffer.from(sha(String(p))), b = Buffer.from(sha(ADMIN));
  return crypto.timingSafeEqual(a, b);
}

async function getCfg() {
  try {
    const raw = await redis(['GET', 'site:cfg']);
    const c = raw ? JSON.parse(raw) : {};
    return {
      announce: typeof c.announce === 'string' ? c.announce : '',
      bio: Array.isArray(c.bio) ? c.bio.filter((x) => typeof x === 'string').slice(0, 6) : null,
      locked: c.locked === true,
      theme: typeof c.theme === 'string' && /^[a-z]{2,12}$/.test(c.theme) ? c.theme : '',
      themeAt: Number(c.themeAt) || 0
    };
  } catch (e) { return { announce: '', bio: null, locked: false }; }
}

async function listItems(n) {
  const ids = await redis(['ZREVRANGE', 'gb:idx', '0', String((n || 60) - 1)]);
  if (!ids || !ids.length) return [];
  const rows = await redis(['HMGET', 'gb:items', ...ids]);
  const out = [];
  (rows || []).forEach((r) => { try { if (r) out.push(JSON.parse(r)); } catch (e) { /* skip */ } });
  return out;
}

const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/clips\/[A-Za-z0-9._\-\/]+$/;
async function getClip() {
  try {
    const raw = await redis(['GET', 'clip:cur']);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || typeof c.url !== 'string' || !BLOB_URL.test(c.url)) return null;
    return { url: c.url, title: clean(c.title, 80), ts: Number(c.ts) || 0, size: Number(c.size) || 0, type: typeof c.type === 'string' ? c.type.slice(0, 40) : '' };
  } catch (e) { return null; }
}

module.exports = { BLOB_URL, getClip, configured, redis, pipe, send, body, ipHash, clean, makeToken, tokenOk, passOk, getCfg, listItems, ADMIN };
