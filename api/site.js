// GET /api/site -> public settings you can change from the terminal (announcement, bio, lock)
const L = require('./_lib');
module.exports = async (req, res) => {
  if (!L.configured()) return L.send(res, 503, { error: 'not configured' });
  const cfg = await L.getCfg();
  return L.send(res, 200, cfg, 's-maxage=20, stale-while-revalidate=60');
};
