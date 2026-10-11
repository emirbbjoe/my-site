// POST /api/admin  {action, ...}
//   login {password}           -> {token}   (2 hours)
//   del   {id}                 -> remove one note
//   clear                      -> remove all notes
//   cfg   {announce,bio,locked}-> change site settings
//   ping                       -> check token
const L = require('./_lib');
const MAX_CLIP = 100 * 1024 * 1024; // 100 MB keeps you inside the free Blob limits

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
      if (typeof b.bg === 'string') {
        const bg = b.bg.toLowerCase();
        if (bg === '' || ['aurora', 'warp', 'flow'].indexOf(bg) >= 0) { cur.bg = bg; cur.bgAt = Date.now(); }
      }
      if (typeof b.theme === 'string') {
        const th = b.theme.toLowerCase();
        if (th === '' || /^[a-z]{2,12}$/.test(th)) { cur.theme = th; cur.themeAt = Date.now(); }
      }
      await L.redis(['SET', 'site:cfg', JSON.stringify(cur)]);
      return L.send(res, 200, { ok: true, cfg: cur });
    }

    // ---- clip of the day ----
    if (action === 'clip-sign') {
      // hand the browser a one-time upload URL straight to Vercel Blob (files are too big for a function)
      const type = String(b.type || '').toLowerCase();
      const size = Number(b.size) || 0;
      const EXT = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
      if (!EXT[type]) return L.send(res, 400, { error: 'use an mp4 or webm file' });
      if (!(size > 0) || size > MAX_CLIP) return L.send(res, 400, { error: 'file is over 100 MB. compress it first' });
      const blob = await import('@vercel/blob');
      const pathname = 'clips/clip-' + Date.now() + EXT[type];
      const token = await blob.issueSignedToken({
        pathname, operations: ['put'], allowedContentTypes: [type], maximumSizeInBytes: MAX_CLIP,
        validUntil: Date.now() + 30 * 60 * 1000
      });
      const { presignedUrl } = await blob.presignUrl(token, {
        operation: 'put', pathname, access: 'public', allowedContentTypes: [type], maximumSizeInBytes: MAX_CLIP,
        addRandomSuffix: true, allowOverwrite: false, cacheControlMaxAge: 30 * 24 * 3600,
        validUntil: Date.now() + 30 * 60 * 1000
      });
      return L.send(res, 200, { url: presignedUrl, pathname });
    }

    if (action === 'clip-set') {
      const url = String(b.url || '');
      if (!L.BLOB_URL.test(url)) return L.send(res, 400, { error: 'that is not a clip stored on your Vercel Blob' });
      const blob = await import('@vercel/blob');
      let info;
      try { info = await blob.head(url); } catch (e) { return L.send(res, 400, { error: 'could not find that file in Blob' }); }
      const old = await L.getClip();
      const clip = {
        url, title: L.clean(b.title, 80), ts: Date.now(),
        size: Number(info && info.size) || 0, type: String((info && info.contentType) || '').slice(0, 40)
      };
      await L.redis(['SET', 'clip:cur', JSON.stringify(clip)]);
      if (old && old.url !== url) { try { await blob.del(old.url); } catch (e) { /* old file stays, harmless */ } }
      return L.send(res, 200, { ok: true, clip });
    }

    if (action === 'clip-title') {
      const cur = await L.getClip();
      if (!cur) return L.send(res, 400, { error: 'no clip yet' });
      cur.title = L.clean(b.title, 80);
      await L.redis(['SET', 'clip:cur', JSON.stringify(cur)]);
      return L.send(res, 200, { ok: true, clip: cur });
    }

    if (action === 'clip-del') {
      const cur = await L.getClip();
      await L.redis(['DEL', 'clip:cur']);
      if (cur) { try { const blob = await import('@vercel/blob'); await blob.del(cur.url); } catch (e) { /* ignore */ } }
      return L.send(res, 200, { ok: true });
    }

    return L.send(res, 400, { error: 'unknown action' });
  } catch (e) {
    // clip errors are only reachable with a valid admin token, so showing the reason is safe
    const act = String((req.body && req.body.action) || '');
    if (act.indexOf('clip-') === 0) return L.send(res, 502, { error: ('clip: ' + String((e && e.message) || e)).slice(0, 160) });
    return L.send(res, 502, { error: 'server error' });
  }
};
