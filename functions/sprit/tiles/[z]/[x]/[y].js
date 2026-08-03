// ====================================================================
// Same-Origin-Proxy für OpenStreetMap-Kacheln (Leaflet-Karte der Tank-App).
//   GET /sprit/tiles/{z}/{x}/{y}.png  →  tile.openstreetmap.org
// Bewusst NICHT unter /api/ (dort erzwingt _headers "no-store"); Kacheln
// werden lange am Edge/Browser gecacht. Fair use: valider User-Agent,
// starkes Caching, OSM-Attribution in der App. Nur zulässige z/x/y.
// ====================================================================

const UA = "SpieleabendTanken/1.0 (+https://philip-stack.pages.dev/tanken/; privat)";

export async function onRequestGet({ params }) {
  const z = parseInt(params.z, 10);
  const x = parseInt(params.x, 10);
  const y = parseInt(String(params.y).replace(/\.png$/i, ""), 10);
  if (!Number.isInteger(z) || z < 0 || z > 19) return new Response("bad z", { status: 400 });
  const max = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= max || y >= max) {
    return new Response("bad xy", { status: 400 });
  }

  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "image/png,image/*" },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return new Response("tile error", { status: 502 });
    const r = new Response(res.body, res);
    r.headers.set("Content-Type", "image/png");
    r.headers.set("Cache-Control", "public, max-age=86400, immutable");
    r.headers.delete("set-cookie");
    return r;
  } catch (_) {
    return new Response("tile fetch failed", { status: 502 });
  }
}
