// ====================================================================
// Karten-Kacheln als Same-Origin-Proxy: /fire/tiles/{z}/{x}/{y}
// Holt dunkle Basemap-Kacheln (CARTO, © OpenStreetMap-Mitwirkende) und
// liefert sie unter eigener Herkunft aus — so bleibt die strikte CSP
// (img-src 'self') unangetastet, ohne externe Hosts freizugeben.
// Bewusst NICHT unter /api/ (dort erzwingt _headers no-store); Kacheln
// sind unveränderlich → sehr langer Cache in Browser und Edge.
// ====================================================================
const UA = "Mozilla/5.0 (Spieleabend/fire-noe; +https://philip-stack.pages.dev/fire/noe/)";

export async function onRequestGet({ params }) {
  const yRaw = String(params.y || "").replace(/\.png$/i, "");
  const r2x = /@2x$/i.test(yRaw) ? "@2x" : "";
  const z = Number(params.z), x = Number(params.x), y = Number(yRaw.replace(/@2x$/i, ""));

  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20 || x < 0 || y < 0) {
    return new Response("bad tile", { status: 400 });
  }

  const sub = "abc"[(x + y) % 3];
  const url = `https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}${r2x}.png`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "image/png,image/*" },
      cf: { cacheTtl: 2592000, cacheEverything: true },   // 30 Tage am Edge
    });
    if (!res.ok) return new Response("tile error", { status: 502 });
    const out = new Response(res.body, res);
    out.headers.set("Content-Type", "image/png");
    out.headers.set("Cache-Control", "public, max-age=1209600, immutable"); // 14 Tage im Browser
    out.headers.delete("Set-Cookie");
    return out;
  } catch (_) {
    return new Response("tile error", { status: 502 });
  }
}
