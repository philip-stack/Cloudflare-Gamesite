# Spieleabend – Cloudflare Gamesite

Eine Sammlung kleiner Browser-Spiele für den Spieleabend, gehostet als
**Cloudflare Pages**-Projekt (`philip-stack`). Alles läuft ohne Build-Schritt:
statisches HTML/CSS/JS in `public/`, dazu Pages Functions als API und eine
**D1**-Datenbank für geteilte Spiele und globale Bestenlisten.

**Live:** https://philip-stack.pages.dev/

## Die Spiele

| Spiel | Pfad | Was es ist |
|---|---|---|
| 🎲 **Würfelpoker** | `/wuerfelpoker/` | Escalero-Verrechnungsblatt — mehrere Runden pro Spiel, 1–n Spalten pro Spieler, Live-Ranking in Gold/Silber/Bronze; lokal spielen oder per Beitritts-Code teilen |
| 💎 **Funkelfeld** | `/funkelfeld/` | 8×8-Puzzle — Funkelsteine sammeln, Combos jagen, Skins freispielen |
| ☄️ **Komet** | `/komet/` | One-Touch-Arcade — am Lichtseil von Stern zu Stern schwingen |
| 🚀 **Sternensturm** | `/sternensturm/` | Roguelite-Space-Shooter — Wellen, Upgrades, NOVA, Bosse |
| 🦄 **Galopp** | `/galopp/` | Temple-Run-artiger Endless-Runner — springen, ducken, abbiegen, und das wütende Einhorn nicht aufholen lassen |
| 🦝 **WUMMS!** | `/wumms/` | Comic-Block-Puzzle mit Tier-Helden — Blöcke aufs 8×8-Feld legen, Reihen abräumen, Helden-Ultimates (Bombe/Laser/Nuke) zünden, Combo-Ketten bauen und den Bösewicht zurückschlagen, der Reihen von unten hochschiebt |
| 🐹 **MEERI-MANIA** | `/meeri/` | Merge-Idle mit Meerschweinchen — Meeries kaufen, gleiche zusammenziehen für immer absurdere Evolutionen (Baby → Punk → Ritter → … → Drachen → Galaxie), Münz-Blasen antippen, Wiese ausbauen, Offline-Einnahmen, alle 16 im Meeri-Album entdecken. Fortschritt lokal; **weltweite Bestenliste** (höchste Evolution) über `/api/scores` |
| 🐍 **Neon-Schlange** | `/schlange/` | Slither-**Arena** — große Welt mit Kamera & Minimap, **KI-Gegner** zum Abschneiden (laufen sie in dich, zerfallen sie in Orbs), **Power-ups** (Magnet/Schild/×2/Geist). Ziehen lenkt, ⚡/Halten boostet; Orbs fressen & wachsen, nicht selbst beißen. Skins & Meilensteine, weltweite Bestenliste |
| 🎨 **Kritzeln & Raten** | `/kritzeln/` | **Echtzeit-Multiplayer** (2–10) — einer malt, die anderen raten live im Chat; Raum per Code teilen, **Kategorien & Rundenzahl** (Host), Wortwahl aus 3, Live-Striche mit **Fülleimer/Radierer/Undo**, Buchstaben-Hinweise, **Speed-/Platz-Punkte**, Runden-Zusammenfassung, Konfetti/Sound, Sieger:in & Revanche. Server = Durable Object (`DrawRoom`); dazu eine **dauerhafte, geräteübergreifende Bestenliste** (🏆), die das DO am Spielende autoritativ in D1 schreibt (Gesamtpunkte, Spiele, Siege, Bestleistung) |
| 🧠 **Wer weiß's?** | `/quiz/` | **Echtzeit-Live-Trivia** (2–10) — alle beantworten dieselbe Multiple-Choice-Frage gleichzeitig; **richtig + schnell = mehr Punkte**, Kategorien wählbar (11 Kategorien inkl. „Kopfnüsse", ~240-Fragen-Satz de-AT), Fragenzahl (Host), Optionen pro Spiel gemischt, **keine schnelle Wiederholung** (Raum merkt gestellte Fragen über mehrere Spiele), Reveal mit Auflösung, Sieger:in & Revanche, **Meilensteine**. Server = Durable Object (`QuizRoom`); dazu eine **dauerhafte D1-Bestenliste** (`quiz_score`), die das DO am Spielende autoritativ schreibt |

Alle Spiele sind mobile-first (Touch-Gesten), haben aber auch
Tastatur-Steuerung. Funkelfeld, Komet, Sternensturm, Galopp, WUMMS! und Neon-Schlange teilen
sich eine globale Bestenliste pro Spiel (Top 50, pro Name zählt der Highscore).

Die ganze Seite kann zwischen **Hell- und Dunkelmodus** umgeschaltet werden
(🌙/☀️-Button in jeder App); die Wahl gilt app-übergreifend und wird auf dem
Gerät gespeichert. Die Spielszenen der Canvas-Spiele bleiben bewusst dunkel,
der Rahmen passt sich an. Ein **Energiesparen-Modus** (Profil → Einstellungen)
schaltet teure Dauer-Effekte ab und drosselt die Bildrate für schwächere Geräte;
`prefers-reduced-motion` wird ebenfalls respektiert.

**Plattform-Features:**

- **Spieler-Profil & Hub** (`/profil/`): eigener Bereich mit **Emoji-Avatar**
  (Auswahl aus 32), **Spieleabend-Level & XP** (aus Abzeichen, Rekorden und
  gespielten Spielen), **Avatar-Rahmen** und **Titeln**, die mit dem Level
  freischalten (Neuling → … → Lebende Legende), einer Übersicht aller eigenen
  Rekorde, einem **Tage-Streak** (an aufeinanderfolgenden Tagen gespielt), dem
  **besten Weltrang über alle Spiele** und **plattformweiten Erfolgen** (quer
  über alle Spiele). Die **Profil-Karte** steht auf der Startseite ganz oben.
- **Cloud-Speicher** (`/api/cloud`): alle Spielstände, Rekorde & Abzeichen mit
  einem Code sichern und auf jedem Gerät zurückholen — inkl. **QR-Code** des
  Codes und Anzeige, **wann zuletzt gesichert** wurde. `shared.js` synct beim
  Verlassen der Seite automatisch und zeigt beim Laden **nur dann** einen
  Hinweis, wenn ein **echt neuerer Stand von einem anderen Gerät** existiert
  (geräte-lokale Schreiber-Kennung, kein Popup-Spam bei eigenen Uploads).
- **Spieleabend-Raum** (`/party/`, `/api/party`): Raum per 6-stelligem Code
  (oder QR) erstellen/beitreten, gemeinsame Spiele auswählen, **Live-Rangliste**
  über den Abend mit Rang-Punkten und „Sieger des Abends“. Score-Ergebnisse
  werden bei aktivem Raum automatisch eingereicht; ein Name im Raum gehört dem
  **ersten Gerät**, das ihn nutzt. Dazu **Live-Emoji-Reaktionen**, ein
  **Revanche**-Knopf (neuer Raum, gleiche Spiele), eine teilbare
  **Abend-Zusammenfassung** und ein lokaler **Verlauf** vergangener Abende.
  **Echtzeit** via **Durable Object** (separater Worker `philip-stack-rt`): der
  Raum bekommt Änderungen sofort per WebSocket gepusht (Pub/Sub-Relay pro Raum),
  mit einem langsamen Poll als Fallback.
- **Saison & Liga** (`/saison/`, `/api/season`): eine **wöchentliche Liga über
  alle gewerteten Spiele**. Pro Spiel gibt es Liga-Punkte nach Platzierung in
  der Wochen-Bestenliste; über alle Spiele summiert ergibt das die Saison-
  Tabelle. Mit Live-Reset-Countdown (Montag), Spitzenreiter je Spiel und
  Vorsaison-Champion (Hall of Fame). Kommt **ohne neue Daten** aus — eine Saison
  ist nur ein Zeitfenster (`strftime('%Y-%W')`) über die vorhandenen Scores.
- **Web-Push-Benachrichtigungen** (`/api/push`): opt-in im Profil. Meldet z. B.
  „Dein Rekord wurde geschlagen". Umgesetzt als **VAPID-signierter „Tickle"-Push
  ohne verschlüsselte Payload** — der Service Worker holt die eigentlichen
  Nachrichten aus einer serverseitigen Warteschlange (nach Push-Endpoint) und
  zeigt sie an. Test-Knopf im Profil zum Prüfen am eigenen Gerät.
- **Tages- & Wochen-Wertung** — zwei Spielarten:
  - **Geseedete Challenge** (Galopp, WUMMS!): Alle laufen dieselbe, per Datum-
    bzw. Wochen-Seed erzeugte Strecke — je mit **eigener** Bestenliste, im
    Spielmenü wählbar (Galopp 🗓️/📅; WUMMS! `?daily=1`, fester Seed für Teile-
    und Bösewicht-Abfolge). Die Startseite zeigt eine **Heutige Challenge** mit
    wechselndem Spiel des Tages.
  - **Zeit-gescopte Bestenliste** (Funkelfeld, Komet, Sternensturm, Neon-Schlange):
    normale Läufe, nur nach Datum gefiltert — die Bestenliste hat einen
    **Tab-Umschalter Weltweit / Heute / Diese Woche** (server-seitig über das
    Config-Flag `scoped`, geteilter Bucket + Datumsfilter, kein eigener Bucket).
- **Meilensteine** (Galopp, Sternensturm, Komet, WUMMS!, Neon-Schlange, Funkelfeld,
  MEERI-MANIA, Wer weiß's?): Abzeichen für Lauf- und Lebenszeit-Erfolge, lokal
  gespeichert, im Spielmenü einsehbar; ihre Zahl fließt in Profil-Level & XP ein.
- **Skins** (Galopp, Komet, Sternensturm): freispielbare Farbvarianten der
  Spielfigur, an die Zahl der Abzeichen gekoppelt, im Menü wählbar. Funkelfeld
  hat eigene Skins; WUMMS! schaltet über Abzeichen **Tier-Helden** frei.
- **Onboarding**: Beim ersten Start jedes Spiels ein kurzer Steuerungs-Hinweis.
- **Teilen-Button** in jedem Game-Over (Web-Share mit Zwischenablage-Fallback);
  Würfelpoker lädt per **QR-Code** zum Beitreten ein (eigener QR-Encoder in
  `public/qr.js`, kein externes Skript).
- **Klang & Haptik**: gemeinsamer, abschaltbarer Sound-/Vibrations-Layer
  (`GS.sound` / `GS.haptic`), u. a. beim Würfeln und Eintragen in Würfelpoker.
- Die Landing Page zeigt **eigene Rekorde + Weltrang** pro Spiel, eine
  **Weiterspielen-Karte** für laufende Würfelpoker-Spiele, das **zuletzt
  gespielte** Spiel ganz oben, eine **Live-Suche** über alle Spiele und die
  Challenge-Führenden; Würfelpoker führt eine **Statistik** (Siege, Spiele,
  Punkteschnitt) über abgeschlossene Spiele.
- **Zentrale Spiele-Registry** (`public/games.js`): eine einzige Quelle für
  Name, Icon, Beschreibung und Bestenlisten-Schlüssel jedes Spiels — Startseite,
  Profil und Spieleabend-Raum bauen daraus ihre Karten/Listen.
- **Gemeinsame Bestenlisten-API** (`/api/scores/<spiel>`, eine D1-Tabelle)
  mit Geräte-Token, Namensschutz (ein Name gehört dem Gerät, das ihn zuerst
  benutzt), Plausibilitätsprüfung der Scores, Rate-Limit und einem
  **signierten Lauf-Token** (HMAC): jede Einsendung muss ein kurz vorher
  ausgestelltes Token mitschicken, was blindes Absenden per Skript erschwert.
  Das Token ist **nur einmal gültig** (Replay-Schutz über die Tabelle
  `used_token`), und Ausstellung wie Einsendung sind zusätzlich **pro IP**
  gedrosselt (die Geräte-Kennung ist client-seitig fälschbar, die IP nicht).
  Gemeinsamer Client-Code in `public/shared.js`.
- **Betreiber-Dashboard** (`/admin/`, `/api/admin` — bewusst **nicht** auf der
  Landing Page, `noindex`): privater Live-Monitor an einem Ort — **Ampel-
  Gesamtstatus** und **Auto-Refresh**, Scores/Einsendungen/Weltrekorde je Spiel,
  **Trends als Sparklines** (Scores, aktive Geräte, Fehler pro Tag, 30 Tage),
  Fehler-Log **nach Häufigkeit gruppiert** (mit User-Agent, Seiten-Filter,
  externe `522` separat gezählt), Push-Abos/Warteschlange, Feuerwehr-Cron-Health
  und DB-Hilfstabellen. Dazu geschützte **Aktionen** (POST, nur mit Header-
  Schlüssel → CSRF-resistent): Fake-**Score löschen**, **Gerät sperren**
  (`banned_device`, blockt weitere Einsendungen), Fehler-Log/Push-Queue leeren,
  Fire-Cron manuell auslösen. Für gezielte Moderation: **echte Top-50 je Spiel**
  mit Direkt-Löschen (erwischt eingenistete Fakes auf Platz 1) und **Suche nach
  Name/Gerät** über alle Spiele. Der **Trend-Zeitraum** ist auf 7/30/90 Tage
  umschaltbar, Sparklines zeigen beim **Hover/Touch** Datum + exakte Zahl. Ein
  optionaler **Betreiber-Alarm** pusht bei „Achtung" (Fehlerspitze /
  Push-Queue-Stau) an einen konfigurierten Bestenlisten-Namen (Auswertung im
  Fire-Cron, Konfig in `app_config`). Zugriff nur mit dem Pages-Secret `ADMIN_TOKEN`
  (selbst erzeugt, gratis, kein externer Dienst); ohne Schlüssel `401`.
- **Automatische Tests** (`tests/`, per GitHub Actions bei jedem Push):
  Syntaxprüfung aller JS-Dateien (jetzt auch `worker-rt/` mit den Durable
  Objects), ein **statischer Qualitäts-/A11y-Check** aller HTML-Seiten (keine
  externen Ressourcen, alt-Texte, lang/viewport), Tests für QR-Encoder, Scores-,
  Cloud- und Party-API (mit gemocktem D1), ein **Flow-/E2E-Test** des geteilten
  Würfelpoker-Pfades (anlegen → laden → eintragen → volle Runde), WUMMS!- und
  MEERI-Logik, die **Kritzeln-Logik** (`worker-rt/draw-logic.js`: Wort-
  Normalisierung, Levenshtein, Kategorien/eigene Wörter, Punkte-Berechnung),
  die **Quiz-Logik** (`worker-rt/quiz-logic.js`: Fragensatz-Integrität, Options-
  Mischen, Punkte) sowie die **Fire-Cron-Orchestrierung** und der
  **Cron-Dead-Man's-Switch** (`/api/health`). Zusätzlich ein **Lighthouse-Budget**
  (`lighthouserc.json`) als eigener,
  nicht-blockierender Workflow für Performance, Barrierefreiheit, Best Practices & SEO.

### Echtzeit-Architektur & bewusste Trade-offs

Die Echtzeitspiele (Spieleabend-Raum, **Kritzeln & Raten**, **Wer weiß's?**) laufen über Durable
Objects im separaten Worker `philip-stack-rt`. Ein paar bewusst getroffene
Entscheidungen, damit sie nachvollziehbar bleiben:

- **State im RAM, nicht persistiert.** Der Spielzustand (laufende Runde, Punkte,
  Zeichnung) lebt im DO-Speicher. Bei Redeploy/Eviction **mitten im Spiel** ist
  die laufende Runde weg — die Clients verbinden neu in eine frische Lobby.
  Bereits **gewertete** Spiele stehen sicher in D1 (`draw_score`); nur die gerade
  laufende Runde geht verloren. Für ein Partyspiel bewusst so gelassen (Aufwand
  für `ctx.storage`-Persistenz ≫ Nutzen).
- **Reine Logik ist ausgelagert & getestet.** `worker-rt/draw-logic.js` enthält
  nur deterministische Funktionen (keine DO-/Runtime-Abhängigkeit) und wird von
  `tests/kritzeln.test.mjs` abgesichert.
- **Härtung gegen böse Clients.** Der `DrawRoom` deckelt Strich-Größe, gepufferte
  Zeichen-Ops pro Zug und die Nachrichten-Rate pro Verbindung; der Host kann
  Spieler:innen kicken. Raum-Codes sind kurz (Partyspiel) — Grätscher fängt der
  Kick ab.
- **Doppelte Merge-Logik.** Die Strich-Zusammenführung (`s`-Flag → neuer Strich
  bzw. anhängen) existiert im Server (`opStroke`) **und** im Client
  (`public/kritzeln/app.js`); beide müssen synchron bleiben, sonst weicht der
  Reconnect-Snapshot vom Live-Bild ab. Bewusste Kopplung zugunsten simpler
  Protokoll-Nachrichten.
- **Barrierefreiheit**: Dialoge als `role="dialog"`/`aria-modal` mit
  Escape-zum-Schließen und Fokus-Rückgabe, `aria-live`-Statusmeldungen,
  beschriftete Eingabefelder und ein plattformweit injizierter, sichtbarer
  **Tastatur-Fokusring** (`:focus-visible`, greift auch dort, wo eigenes CSS
  den Fokus wegstylt). Wer im Betriebssystem **„Bewegung reduzieren"** wählt,
  bekommt keine langen CSS-Animationen/Übergänge mehr und automatisch den
  Energiesparen-Modus (Canvas-Spiele drosseln) — beides zentral in `theme.js`.

## 🍳 KI-Kochstudio

**Live:** https://philip-stack.pages.dev/kochstudio/

Kein Spiel, sondern ein KI-Helfer unter `/kochstudio/` (bewusst **nicht** auf
der Landing Page verlinkt — nur direkt erreichbar). Man gibt ein, was im
Kühlschrank/Vorrat ist, und bekommt:

- **Zwei passende Rezepte** mit Dauer, Schwierigkeit, Mengen (2 Portionen),
  nummerierter Zubereitung und Profi-Tipp — generiert von **Cloudflare
  Workers AI** (Llama 3.3 70B, mit 8B-Modell als Fallback; kein externer
  API-Schlüssel, kostenloses Tageskontingent).
- **Echte Rezept-Links aus dem Netz** über eine serverseitige DuckDuckGo-Suche
  (mit Chefkoch-/GuteKueche-Such-Links als Fallback); die Treffer fließen der
  KI auch als Inspiration zu.
- **Verlauf pro Gerät** (localStorage): letzte Rezepte anklickbar wieder öffnen
  (ohne neue KI-Anfrage) oder löschen.
- Ausgabe **kopieren, teilen (Web-Share) oder als `.txt` speichern**.

Eingaben werden zur Erzeugung an Workers AI und als Suchanfrage an DuckDuckGo
geschickt, aber nicht serverseitig gespeichert (siehe Datenschutzerklärung).
Backend: `functions/api/koch.js`, benötigt das `AI`-Binding in `wrangler.toml`.

Die Seite ist eine **PWA**: Am Handy über „Zum Startbildschirm hinzufügen"
(bzw. den Installieren-Hinweis im Browser) wird sie zur App mit eigenem Icon
und Vollbild — bereits besuchte Spiele funktionieren auch offline
(Bestenlisten und geteilte Spiele brauchen Internet).

## 🚒 Feuerwehr-NÖ-Einsatzmonitor

**Live:** https://philip-stack.pages.dev/fire/noe/

Eine **eigenständige App** unter `/fire/noe/` (eigenes rotes Theme, eigener
Service Worker mit Scope `/fire/noe/`, bewusst **nicht** auf der Landing Page
verlinkt). Zeigt die **aktuellen Feuerwehr-Einsätze in Niederösterreich** aus
der öffentlichen NÖ-Quelle (serverseitig geholt über `functions/api/fire/noe.js`,
Geocoding + Bezirks-Zuordnung in `_bezirk.js`/`geo.js`), mit Liste, Karte und
Heimat-Marker.

- **Bezirks-Alarm** per Web-Push: Bezirke abonnieren und bei neuen Einsätzen
  benachrichtigt werden — plus **Umkreis-Alarm** (Heimatort + Radius 5/10/20/50 km).
- **Einsatz-Push** unterscheidet **neu**, **Alarmstufen-Eskalation** und
  **„Einsatz beendet"**; ein neuer Einsatz macht optional Ton + Highlight.
- **Einstellungen** für Einsatzarten-Filter (Brand/Technisch/Schadstoff), Ton,
  Heimatort und eine **Wochentag-Statistik**.
- Angetrieben von einem **Cron** (Worker `philip-stack-rt`, alle 2 min) auf
  `/api/fire/cron` (geschützt per `CRON_TOKEN`-Header): erkennt frische Einsätze,
  verschickt die Pushes und rollt Tages-Statistik + Wartung ab.

## ⛽ Sprit-Radar (Tanken)

**Live:** https://philip-stack.pages.dev/tanken/

Eine **eigenständige App** unter `/tanken/` (grünes Theme, eigener Service Worker
mit Scope `/tanken/`, bewusst **nicht** auf der Landing Page verlinkt). Findet die
**günstigsten Tankstellen** in Österreich — im **Umkreis** und **entlang einer
Route** — komplett gratis und ohne API-Schlüssel:

- Preise vom **E-Control-Spritpreisrechner** (`_ec.js`), Routing über **OSRM**,
  Karte/Geocoding über **OpenStreetMap** (Leaflet als selbst gehostetes Vendor-Skript).
- **Favoriten**, **Preis-Alarm** per Web-Push (Ziel-Preis je Kraftstoff),
  **Preisverlauf-Sparkline** und Filter **„nur offene"**.
- Eigener **Cron** auf `/api/sprit/cron` (ebenfalls per `CRON_TOKEN` geschützt,
  vom `philip-stack-rt`-Worker angepingt): prüft die abonnierten Alarme und
  protokolliert den Preisverlauf (`sprit_price_log`).

Beide Apps teilen den zentralen **Web-Push-Mechanismus** (`/api/push`, VAPID-
„Tickle"), haben aber ihren eigenen Service Worker und ihr eigenes Manifest.

## Sicherheit

- **Security-Header** via `public/_headers`: strenge **Content-Security-Policy**
  (`connect-src 'self'`, `frame-ancestors none`, `object-src none`), `nosniff`,
  `Referrer-Policy`, `Permissions-Policy` und HSTS. Alle Assets (Schriften, QR-
  Encoder) sind selbst gehostet — kein externes CDN, keine Fremd-Skripte.
- **Geräte-Bindung**: In Bestenlisten und Spieleabend-Räumen gehört ein Name dem
  Gerät, das ihn zuerst benutzt — kein Einreichen unter fremdem Namen.
- **Signierte Lauf-Token** (HMAC, `SCORE_SECRET` als Pages-Secret) gegen
  blindes Score-Absenden — **einmal gültig** (Replay-Schutz via `used_token`),
  plus D1-gestütztes **Rate-Limit** pro Gerät **und pro IP** auf allen APIs.
- **Cloud-Speicher** hält beim Überschreiben die vorherige Version vor,
  begrenzt die Größe und ist rate-limitiert.
- **Anonymer Fehler-Melder** (`/api/log`): JS-Fehler auf fremden Geräten landen
  gedrosselt und dedupliziert in D1 (selbst-beschränkt auf die letzten 1000),
  damit Defekte auffallen — einsehbar im **Betreiber-Dashboard** (`/admin/`,
  geschützt per `ADMIN_TOKEN`).

## Leistung & Akku

Rundenbasierte Spiele (Würfelpoker, Funkelfeld, WUMMS!) zeichnen
**ereignisgesteuert** statt in einer Dauerschleife. Für die Idle-/Effekt-Last
gibt es mehrere Sparmaßnahmen: MEERI drosselt das Zeichnen (~30 fps, volle Rate
nur bei Effekten) und pausiert unter Overlays, die Canvas-Auflösung ist per
**DPR-Cap** gedeckelt, teure Dauereffekte (animierte Weichzeichnung, Grain,
pulsierende Zellen) laufen statisch, und Hintergrund-Polls (Party, geteilte
Spiele) pausieren bei verstecktem Tab. Würfelpoker trägt Züge **optimistisch**
sofort ein und synct im Hintergrund.

## Struktur

```
wuerfelpoker/
├── wrangler.toml              Pages-Config + D1-Binding (DB) + AI-Binding (Kochstudio)
├── migrations/                D1-Schema als versionierte, idempotente Migrationen
│   ├── 0001_init.sql          Baseline (Würfelpoker, scores, used_token, banned_device, cloud_saves, party*, push_*, error_log, rate, draw_score, fire_*)
│   └── 0002…0008_*.sql        additive Änderungen (u. a. draw_score-Gerät, fire_alert-Arten/Geo, sprit_price_log, quiz_score; apply: wrangler d1 migrations apply wuerfelpoker --remote)
├── reset-dev.sql              ⚠️ nur lokal: setzt Würfelpoker-Tabellen zurück (enthält DROPs)
├── schema.sql                 nur noch Hinweis-Datei (zeigt auf migrations/)
├── public/                    statische Spiele (1 Ordner = 1 Spiel)
│   ├── index.html             Landing Page mit App-Karten, Suche & Challenge
│   ├── games.js               zentrale Spiele-Registry (Quelle für Startseite/Profil/Party)
│   ├── theme.js               Hell/Dunkel + Energiesparen + SW-Registrierung + Fehler-Melder
│   ├── shared.js              gemeinsame Spiele-Schicht (Scores, Name, Meilensteine, Skins, Sound, Teilen, Cloud-Sync)
│   ├── qr.js                  eigenständiger QR-Code-Encoder (Beitritt/Sync teilen)
│   ├── _headers               Security-Header (CSP, HSTS, nosniff, …)
│   ├── fonts/                 selbst gehostete Schriften (Fraunces, Outfit) — kein Google-Fonts-CDN
│   ├── profil/                Spieler-Profil & Hub (Avatar, Level, Rahmen, Cloud, Freunde, Push, bester Weltrang)
│   ├── admin/                 privates Betreiber-Dashboard (noindex, Schlüssel via ADMIN_TOKEN)
│   ├── party/                 Spieleabend-Raum (Räume, Live-Rangliste)
│   ├── saison/                Saison & Liga (wöchentliche Gesamtwertung)
│   ├── impressum/             Impressum (§ 5 ECG / § 25 MedienG)
│   ├── datenschutz/           Datenschutzerklärung (DSGVO)
│   ├── kochstudio/            KI-Kochstudio (index.html + app.js + style.css)
│   ├── favicon.ico            Browser-Tab-Icon
│   ├── 404.html               Fehlerseite
│   ├── manifest.webmanifest   PWA-Manifest (installierbare App)
│   ├── sw.js                  Hub-Service-Worker (Scope /, offline-fähig, network-first + App-Shell)
│   ├── icons/                 App-Icons
│   ├── _redirects
│   ├── wuerfelpoker/          index.html + app.js + style.css
│   ├── funkelfeld/
│   ├── komet/
│   ├── sternensturm/
│   ├── galopp/
│   ├── wumms/                 Comic-Block-Puzzle mit Tier-Helden
│   ├── meeri/                 Merge-Idle mit Meerschweinchen (MEERI-MANIA)
│   ├── fire/noe/              eigenständige App: Feuerwehr-NÖ-Einsatzmonitor (eigener sw.js, Scope /fire/noe/)
│   └── tanken/                eigenständige App: Sprit-Radar AT (eigener sw.js, Scope /tanken/, Leaflet-Vendor)
├── functions/api/             Cloudflare Pages Functions
│   ├── _util.js               gemeinsame Helfer (json, Codes, Spiel laden, Client-IP, Rate-Limit)
│   ├── health.js
│   ├── games/                 Würfelpoker: geteilte Spiele (CRUD + Zellen)
│   ├── scores/[game].js       Bestenlisten aller Spiele (GET/POST, ?daily=1, ?weekly=1, ?player=)
│   ├── cloud.js               Cloud-Speicher (Sichern/Laden per Code, Vorversion)
│   ├── party.js               Spieleabend-Räume (erstellen/beitreten/einreichen/Stand/Reaktion)
│   ├── party-live.js          WebSocket-Upgrade → Echtzeit-DO (Binding PARTY_ROOM)
│   ├── season.js              Saison/Liga (Wochenwertung über alle Spiele)
│   ├── push.js                Web-Push (VAPID, Abo/Queue/Versand)
│   ├── log.js                 anonymer Fehler-Melder (→ D1, selbst-beschränkt)
│   ├── admin.js               Betreiber-Dashboard-Aggregat (geschützt per ADMIN_TOKEN)
│   ├── koch.js                KI-Kochstudio (Workers AI + DuckDuckGo-Websuche)
│   ├── fire/                  Feuerwehr-NÖ: noe.js (Quelle), geo/_bezirk (Geocoding), alert.js (Abos), cron.js, stats.js
│   └── sprit/                 Sprit-Radar: near/route/suggest (Preise+Routing), _ec.js (E-Control), alert.js, cron.js, _logic.js
├── tests/                     Node-Tests (Syntax inkl. worker-rt, Qualität/A11y, QR, Scores/Cloud/Party/Saison/Push-API, Flow-E2E, WUMMS/MEERI/Kritzeln/Quiz, Fire-Cron, Health)
├── scripts/
│   └── bump-assets.mjs        Cache-Busting: setzt ?v=<Inhaltshash> für lokale JS/CSS (npm run bump; CI prüft mit --check)
├── worker-rt/                 separater Worker: Echtzeit-Durable-Objects (PartyRoom/DrawRoom/QuizRoom) + draw-logic.js/quiz-logic.js
│                              + Cron (*/2 min) → pingt /api/fire/cron und /api/sprit/cron (x-cron-key: CRON_TOKEN)
├── lighthouserc.json          Lighthouse-Budget (Performance/A11y/Best-Practices/SEO)
└── .github/workflows/
    ├── ci.yml                 CI: führt `npm test` bei jedem Push aus
    └── lighthouse.yml         Lighthouse-Budget-Check (nicht blockierend)
```

Tests lokal ausführen: `npm test` (Node ≥ 22). Nach jeder Änderung an geteiltem
JS/CSS `npm run bump` ausführen (setzt inhaltsbasierte `?v=`-Hashes); die CI prüft
das mit `--check` und schlägt fehl, wenn ein Bump vergessen wurde.

**Design-Konvention:** Jedes Spiel bringt sein eigenes Farb-Theme in `style.css`
mit (bewusst pro Spiel unterschiedlich — z. B. Kritzeln blau, Neon-Schlange grün,
Würfelpoker/Funkelfeld gold). Universelle Primitive (Schriften, Foil-Verlauf,
Reduced-Motion) liegen zentral in `fonts.css` + `theme.js` — kein gemeinsames
Farb-Stylesheet, weil das die Themes einebnen würde.

Jedes Spiel ist bewusst **selbst enthalten**: ein Ordner mit `index.html`,
`app.js`, `style.css` — kein Framework, kein Bundler. Die Spiele rendern
auf Canvas (Komet, Sternensturm, Galopp) bzw. DOM (Würfelpoker, Funkelfeld)
und teilen sich das „Midnight Felt“-Design-System (Fraunces + Outfit,
Gold-Folie, dunkle Karten-Optik).

## Ein neues Spiel hinzufügen

1. Ordner `public/<name>/` mit `index.html`, `app.js`, `style.css` anlegen
   (bestehendes Spiel als Vorlage kopieren).
2. Spiel in der **Registry** `public/games.js` eintragen (Name, Icon,
   Beschreibung, Bestenlisten-Schlüssel) — Startseite, Profil und Spieleabend-
   Raum übernehmen es automatisch.
3. Für eine Bestenliste: Spiel in der Allowlist von
   `functions/api/scores/[game].js` eintragen (Score-Obergrenze +
   optionale Plausibilitätsprüfung) — fertig, keine neue Tabelle nötig.
   Im Spiel `shared.js` einbinden und `GS.scoreFlow`/`GS.showLeaderboard`
   verwenden.

## Würfelpoker: Spielregeln (Escalero)

Digitale Nachbildung des Piatnik **Eskalero-Würfelpoker-Verrechnungsblatts**.
Gespielt wird mit echten Würfeln am Tisch, die App ist das Punkteblatt —
lokal im Browser (`localStorage`) oder geteilt über D1 mit Beitritts-Code.

Gespielt mit **5 Poker-Würfeln** (Bilder: 9, 10, B, D, K, A). Pro Zug bis zu
**3×** würfeln – Würfel liegen lassen und nachwerfen.

- Am Anfang würfelt jeder einmal: **höchste Zahl beginnt.** Danach reihum im Kreis.
- Nach dem Zug trägt man das Ergebnis in **ein freies Feld einer eigenen Spalte** ein.
- Passt nichts (oder man will nicht), muss man **ein freies Feld streichen** = 0 Punkte.
- Eine **Runde** endet, wenn alle Felder jedes Spielers gefüllt sind.
- Danach: **weitere Runden im selben Spiel** spielen (Sieger beginnt oder im
  Kreis weiter) oder das Spiel abschließen. Es gibt Sieger je Runde; am Ende
  gewinnt die **höchste Gesamtsumme** über alle Runden.
- **Spalten:** Vor Spielbeginn wählbar, wie viele Blätter (Spalten) jeder
  gleichzeitig spielt (1–n). Pro Zug füllt man ein Feld in einer beliebigen
  eigenen Spalte; die Tabelle zeigt kompakt die Summe, der Spieler am Zug ist
  aufgeklappt, andere lassen sich per Tipp auf den Namen aufklappen.
- Die Total-Zeile zeigt live die Platzierung in **Gold/Silber/Bronze**
  (Platz 4+ in Blau).

### Punkte

| Zeile | Bedeutung | Punkte |
|---|---|---|
| 9 / 10 / B / D / K / A | Anzahl Würfel × Wert (9=1, 10=2, B=3, D=4, K=5, A=6) | z. B. 3 Könige = 3×5 = 15 |
| S | Straße | 20 (serviert 25) |
| F | Full House | 30 (serviert 35) |
| P | Poker (Vierling) | 40 (serviert 45) |
| G | Grande (Fünfling) | 50 (serviert 80) |

**Serviert** = die Kombination gleich im 1. Wurf, ohne Nachwerfen.
