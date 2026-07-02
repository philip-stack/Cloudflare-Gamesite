export async function onRequestGet({ env }) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS games FROM games").first();
    return Response.json({ ok: true, db: "connected", games: row.games });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
