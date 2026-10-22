// Cloudflare Worker: relay for the Luxembourg Approach LIVE view.
//   /?lat=..&lon=..&r=..        ADS-B traffic around a point (airplanes.live, then adsb.lol)
//   /route?cs=LGL4592&lat=..&lon=..   likely route for a callsign (adsb.lol, then adsbdb, then hexdb), cached 6 h
const ALLOWED = ['https://ellxapp.github.io'];          // sites allowed to use this relay

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = { 'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], 'vary': 'Origin' };
    const json = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json', ...extra } });
    const u = new URL(req.url);

    if (u.pathname === '/route') {
      const cs = (u.searchParams.get('cs') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!cs) return json({ cs, route: null }, 400);
      const lat = +u.searchParams.get('lat') || 49.6233, lon = +u.searchParams.get('lon') || 6.2044;
      const cache = caches.default, key = new Request('https://route.cache/' + cs);
      const hit = await cache.match(key); if (hit) return new Response(hit.body, { headers: { ...cors, 'content-type': 'application/json' } });
      let route = null, src = null;
      try {                                                   // adsb.lol: checks the route is plausible for the position
        const r = await fetch('https://api.adsb.lol/api/0/routeset', { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': 'lux-app-live/1.0' },
          body: JSON.stringify({ planes: [{ callsign: cs, lat, lng: lon }] }) });
        if (r.ok) { const j = await r.json(); const x = Array.isArray(j) ? j[0] : null;
          if (x && x.airport_codes && x.airport_codes !== 'unknown' && x.plausible !== false && x.plausible !== 0) { route = x.airport_codes; src = 'adsb.lol'; } }
      } catch (e) {}
      if (!route) try {                                       // adsbdb
        const r = await fetch('https://api.adsbdb.com/v0/callsign/' + cs, { headers: { 'User-Agent': 'lux-app-live/1.0' } });
        if (r.ok) { const j = await r.json(); const f = j && j.response && j.response.flightroute;
          if (f && f.origin && f.destination) { route = [f.origin.icao_code, f.midpoint && f.midpoint.icao_code, f.destination.icao_code].filter(Boolean).join('-'); src = 'adsbdb'; } }
      } catch (e) {}
      if (!route) try {                                       // hexdb
        const r = await fetch('https://hexdb.io/api/v1/route/icao/' + cs, { headers: { 'User-Agent': 'lux-app-live/1.0' } });
        if (r.ok) { const j = await r.json(); if (j && j.route) { route = j.route; src = 'hexdb'; } }
      } catch (e) {}
      const res = json({ cs, route, src }, 200, { 'cache-control': 'max-age=21600' });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    const lat = (+u.searchParams.get('lat') || 49.6233).toFixed(4);
    const lon = (+u.searchParams.get('lon') || 6.2044).toFixed(4);
    const r = Math.min(+u.searchParams.get('r') || 60, 100);
    const sources = [
      ['airplanes.live', `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`],
      ['adsb.lol', `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`],
    ];
    for (const [name, s] of sources) {
      try {                                                   // no caching: always fresh, and reject stale snapshots
        const res = await fetch(s + (s.includes('?') ? '&' : '?') + '_=' + Date.now(), { headers: { 'User-Agent': 'lux-app-live/1.0', 'Cache-Control': 'no-cache' }, cf: { cacheTtl: 0, cacheEverything: false } });
        if (!res.ok) continue;
        const j = await res.json();
        const now = +j.now || 0, ms = now > 1e12 ? now : now * 1000;
        if (ms && Date.now() - ms > 60000) continue;           // older than a minute: try the next source
        j.src = name;
        return json(j, 200, { 'cache-control': 'no-store' });
      } catch (e) { /* try the next source */ }
    }
    return json({ ac: [] }, 502);
  },
};
