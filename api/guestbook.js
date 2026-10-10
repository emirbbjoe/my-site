// GET  /api/guestbook  -> latest notes
// POST /api/guestbook  -> add a note {name, text}
const crypto = require('crypto');
const L = require('./_lib');

module.exports = async (req, res) => {
  if (!L.configured()) return L.send(res, 503, { error: 'not configured' });
  try {
    if (req.method === 'GET') {
      const [items, cfg] = await Promise.all([L.listItems(60), L.getCfg()]);
      return L.send(res, 200, { items, locked: cfg.locked }, 's-maxage=5, stale-while-revalidate=20');
    }
    if (req.method !== 'POST') return L.send(res, 405, { error: 'method' });

    const b = L.body(req);
    if (b.website) return L.send(res, 200, { ok: true }); // honeypot: bots fill this, pretend success
    const cfg = await L.getCfg();
    if (cfg.locked) return L.send(res, 403, { error: 'the wall is locked right now' });

    const name = L.clean(b.name, 24) || 'anon';
    const text = L.clean(b.text, 200);
    if (text.length < 1) return L.send(res, 400, { error: 'write something first' });
    if (/https?:|www\.|\.(com|net|org|ru|xyz|io|lol)\b/i.test(text + ' ' + name)) return L.send(res, 400, { error: 'no links please' });

    const ip = L.ipHash(req);
    const first = await L.redis(['SET', 'rl:gb:' + ip, '1', 'NX', 'EX', '30']);
    if (!first) return L.send(res, 429, { error: 'slow down a little' });
    const day = await L.redis(['INCR', 'rl:gbd:' + ip]);
    if (day === 1) await L.redis(['EXPIRE', 'rl:gbd:' + ip, '86400']);
    if (day > 10) return L.send(res, 429, { error: 'daily limit reached' });

    const item = { id: crypto.randomBytes(4).toString('hex'), n: name, t: text, ts: Date.now() };
    await L.pipe([
      ['HSET', 'gb:items', item.id, JSON.stringify(item)],
      ['ZADD', 'gb:idx', String(item.ts), item.id]
    ]);
    return L.send(res, 200, { ok: true, item });
  } catch (e) {
    return L.send(res, 502, { error: 'try again later' });
  }
};
