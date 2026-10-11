// GET /api/clip -> the current clip of the day (or null)
const L = require('./_lib');
module.exports = async (req, res) => {
  if (!L.configured()) return L.send(res, 503, { error: 'not configured' });
  try {
    const clip = await L.getClip();
    return L.send(res, 200, { clip }, 's-maxage=10, stale-while-revalidate=30');
  } catch (e) {
    return L.send(res, 502, { error: 'try again later' });
  }
};
