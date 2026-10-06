// ====================================================================
// Rennticker — Benachrichtigungen (eigener Service Worker, Scope /f1/)
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, get, M } = window.RT;
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  RT.on("start", () => { $("bell").innerHTML = BELL; });
  const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  let pushPrefs = (() => { try { return JSON.parse(store.get("f1_push") || "null"); } catch (_) { return null; } })() || { on: false, start: true, flags: true, fia: true };
  const b64ToU8 = k => {
    const pad = "=".repeat((4 - k.length % 4) % 4), raw = atob((k + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  async function getSub(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const { key } = await (await fetch("/api/push")).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    return sub;
  }
  const alertApi = async body => {
    const r = await fetch("/api/f1/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Fehler " + r.status);
    return d;
  };
  function pushNote(t, err) { const n = $("push-note"); n.textContent = t || ""; n.classList.toggle("err", !!err); }
  function renderPush() {
    $("push-on").checked = !!pushPrefs.on;
    $("push-start").checked = pushPrefs.start; $("push-flags").checked = pushPrefs.flags; $("push-fia").checked = pushPrefs.fia;
    $("push-opts").disabled = !pushPrefs.on;
    $("push-test").hidden = !pushPrefs.on;
    $("push-state").textContent = pushPrefs.on ? "an" : "aus";
    const d = S.fav && S.race && S.race.drivers.get(S.fav);
    $("push-fia-sub").textContent = d ? `Strafen und Vorladungen zu ${d.first} ${d.last}` : "Tipp zuerst in der Liste auf deinen Fahrer";
    $("bell").classList.toggle("on", !!pushPrefs.on);
  }
  async function savePush(on) {
    pushNote("");
    try {
      if (on) {
        if (!canPush) throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? "Am iPhone: zuerst „Zum Home-Bildschirm“ hinzufügen und von dort öffnen." : "Dieser Browser kann keine Benachrichtigungen.");
        if (await Notification.requestPermission() !== "granted") throw new Error("Benachrichtigungen sind für diese Seite blockiert (Browser-Einstellungen).");
        const sub = await getSub(true);
        await alertApi({ action: "subscribe", subscription: sub.toJSON(), fav: S.fav || null, start: pushPrefs.start, flags: pushPrefs.flags, fia: pushPrefs.fia });
      } else {
        const sub = canPush ? await getSub(false) : null;
        if (sub) await alertApi({ action: "unsubscribe", endpoint: sub.endpoint });
      }
      pushPrefs.on = on;
      store.set("f1_push", JSON.stringify(pushPrefs));
      if (on) pushNote("Gespeichert.");
    } catch (e) {
      pushPrefs.on = false; store.set("f1_push", JSON.stringify(pushPrefs));
      pushNote(e.message || "Hat nicht geklappt.", true);
    }
    renderPush();
  }
  // Abgleich beim Öffnen: Server kennt das Abo noch? (z. B. nach Neuinstallation)
  // Erst nach dem Start-Durchlauf (S.race/S.fav sind weiter unten deklariert).
  setTimeout(async () => {
    if (!canPush || !pushPrefs.on) return renderPush();
    try {
      const sub = await getSub(false);
      const d = sub ? await alertApi({ action: "get", endpoint: sub.endpoint }) : { on: false };
      if (!d.on) pushPrefs.on = false; else Object.assign(pushPrefs, { start: d.start, flags: d.flags, fia: d.fia });
      store.set("f1_push", JSON.stringify(pushPrefs));
    } catch (_) {}
    renderPush();
  }, 0);
  $("bell").addEventListener("click", () => { renderPush(); pushNote(""); $("pushsheet").hidden = false; });
  $("push-close").addEventListener("click", () => { $("pushsheet").hidden = true; });
  $("pushsheet").addEventListener("click", e => { if (e.target.id === "pushsheet") $("pushsheet").hidden = true; });
  $("push-on").addEventListener("change", e => savePush(e.target.checked));
  for (const k of ["start", "flags", "fia"]) $("push-" + k).addEventListener("change", e => { pushPrefs[k] = e.target.checked; savePush(true); });
  $("push-test").addEventListener("click", async () => {
    try {
      const sub = await getSub(false);
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", endpoint: sub.endpoint }) });
      pushNote(r.ok ? "Testmeldung ist unterwegs." : "Test fehlgeschlagen.", !r.ok);
    } catch (_) { pushNote("Test fehlgeschlagen.", true); }
  });
  // Lieblingsfahrer geändert → Abo aktualisieren
  RT.on("S.fav", () => {
    if (pushPrefs.on && canPush) getSub(false).then(sub => sub && alertApi({ action: "subscribe", subscription: sub.toJSON(), fav: S.fav || null, start: pushPrefs.start, flags: pushPrefs.flags, fia: pushPrefs.fia })).catch(() => {});
  });
})();
