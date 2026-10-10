// Vercel serverless function: returns only your Steam online state (number).
// Set env vars in Vercel: STEAM_API_KEY and STEAM_ID (your 17-digit SteamID64).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
  res.setHeader('Content-Type', 'application/json');
  const key = process.env.STEAM_API_KEY, id = process.env.STEAM_ID;
  if (!key || !/^\d{17}$/.test(id || '')) return res.status(500).end('{}');
  try {
    const r = await fetch('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=' +
      encodeURIComponent(key) + '&steamids=' + id);
    if (!r.ok) throw new Error('steam');
    const j = await r.json();
    const p = j && j.response && j.response.players && j.response.players[0];
    if (!p) throw new Error('none');
    res.status(200).end(JSON.stringify({ state: Number(p.personastate) || 0 }));
  } catch (e) { res.status(502).end('{}'); }
};
