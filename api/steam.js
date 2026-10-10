// Vercel serverless function: returns only your Steam online state (number).
// Set env vars in Vercel: STEAM_API_KEY and STEAM_ID (your 17-digit SteamID64).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
  res.setHeader('Content-Type', 'application/json');
  const key = process.env.STEAM_API_KEY, id = (process.env.STEAM_ID || '').trim();
  if (!key) return res.status(500).end('{"error":"STEAM_API_KEY missing - redeploy after adding it"}');
  if (!/^\d{17}$/.test(id)) return res.status(500).end('{"error":"STEAM_ID must be 17 digits"}');
  try {
    const r = await fetch('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=' +
      encodeURIComponent(key.trim()) + '&steamids=' + id);
    if (!r.ok) return res.status(502).end('{"error":"steam replied ' + r.status + ' - check the API key"}');
    const j = await r.json();
    const p = j && j.response && j.response.players && j.response.players[0];
    if (!p) return res.status(502).end('{"error":"no player found for this STEAM_ID"}');
    res.status(200).end(JSON.stringify({ state: Number(p.personastate) || 0 }));
  } catch (e) { res.status(502).end('{"error":"request failed"}'); }
};
