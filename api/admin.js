// POST /api/admin  {action, ...}
//   login {password}           -> {token}   (2 hours)
//   del   {id}                 -> remove one note
//   clear                      -> remove all notes
//   cfg   {announce,bio,locked}-> change site settings
//   ping                       -> check token
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.send(res, 405, { error: 'method' });
  if (!L.configured() || !L.ADMIN) return L.send(res, 503, { error: 'not configured' });
  try {
    const b = L.body(req);
    const action = String(b.action || '');

    if (action === 'login') {
      const ip = L.ipHash(req);
      const n = await L.redis(['INCR', 'rl:adm:' + ip]);
      if (n === 1) await L.redis(['EXPIRE', 'rl:adm:' + ip, '600']);
      if (n > 8) return L.send(res, 429, { error: 'too many attempts, wait 10 minutes' });
      await new Promise((r) => setTimeout(r, 400)); // slow guessing down
      if (!L.passOk(b.password)) return L.send(res, 401, { error: 'login incorrect' });
      await L.redis(['DEL', 'rl:adm:' + ip]);
      return L.send(res, 200, { token: L.makeToken(2 * 3600 * 1000) });
    }

    if (!L.tokenOk(req)) return L.send(res, 401, { error: 'not logged in' });

    if (action === 'ping') return L.send(res, 200, { ok: true });

    if (action === 'del') {
      const id = String(b.id || '');
      if (!/^[0-9a-f]{8}$/.test(id)) return L.send(res, 400, { error: 'bad id' });
      const r = await L.pipe([['HDEL', 'gb:items', id], ['ZREM', 'gb:idx', id]]);
      return L.send(res, 200, { ok: true, removed: r[0] === 1 });
    }

    if (action === 'clear') {
      await L.redis(['DEL', 'gb:items', 'gb:idx']);
      return L.send(res, 200, { ok: true });
    }

    if (action === 'cfg') {
      const cur = await L.getCfg();
      if (typeof b.announce === 'string') cur.announce = L.clean(b.announce, 120);
      if (Array.isArray(b.bio)) cur.bio = b.bio.map((x) => L.clean(x, 140)).filter(Boolean).slice(0, 6);
      if (b.bio === null) cur.bio = null;
      if (typeof b.locked === 'boolean') cur.locked = b.locked;
      await L.redis(['SET', 'site:cfg', JSON.stringify(cur)]);
      return L.send(res, 200, { ok: true, cfg: cur });
    }

    return L.send(res, 400, { error: 'unknown action' });
  } catch (e) {
    return L.send(res, 502, { error: 'server error' });
  }
};
