// Cloudflare Worker: relay for the Luxembourg Approach LIVE view.
// Fetches ADS-B traffic around ELLX and adds the header that lets the browser game read it.
const ALLOWED = ['https://ellxapp.github.io'];          // sites allowed to use this relay

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = { 'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], 'vary': 'Origin' };
    const u = new URL(req.url);
    const lat = (+u.searchParams.get('lat') || 49.6233).toFixed(4);
    const lon = (+u.searchParams.get('lon') || 6.2044).toFixed(4);
    const r = Math.min(+u.searchParams.get('r') || 60, 100);
    const sources = [
      `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
    ];
    for (const s of sources) {
      try {
        const res = await fetch(s, { headers: { 'User-Agent': 'lux-app-live/1.0' }, cf: { cacheTtl: 4, cacheEverything: true } });
        if (res.ok) return new Response(res.body, { headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'max-age=4' } });
      } catch (e) { /* try the next source */ }
    }
    return new Response('{"ac":[]}', { status: 502, headers: { ...cors, 'content-type': 'application/json' } });
  },
};
