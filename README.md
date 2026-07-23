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
| 🐹 **MEERI-MANIA** | `/meeri/` | Merge-Idle mit Meerschweinchen — Meeries kaufen, gleiche zusammenziehen für immer absurdere Evolutionen (Baby → Punk → Ritter → … → Drachen → Galaxie), Münz-Blasen antippen, Wiese ausbauen, Offline-Einnahmen, alle 16 im Meeri-Album entdecken. Rein lokal (kein Server) |

Alle Spiele sind mobile-first (Touch-Gesten), haben aber auch
Tastatur-Steuerung. Funkelfeld, Komet, Sternensturm, Galopp und WUMMS! teilen
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
  Rekorde, einem **Tage-Streak** (an aufeinanderfolgenden Tagen gespielt) und
  **plattformweiten Erfolgen** (quer über alle Spiele). Die **Profil-Karte**
  steht auf der Startseite ganz oben.
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
- **Tages- & Wochen-Challenge** (Galopp): Alle laufen dieselbe, per Datum-
  bzw. Wochen-Seed erzeugte Strecke — je mit eigener Bestenliste. Direkt im
  **Galopp-Startmenü** wählbar (🗓️/📅). WUMMS! hat ebenfalls eine
  **Tages-Challenge** (`?daily=1`, fester Seed für Teile- und Bösewicht-Abfolge),
  im WUMMS!-Menü wählbar. Die Startseite zeigt eine **Heutige Challenge** mit
  wechselndem Spiel des Tages.
- **Meilensteine** (Galopp, Sternensturm, Komet, WUMMS!): Abzeichen für Lauf-
  und Lebenszeit-Erfolge, lokal gespeichert, im Spielmenü einsehbar.
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
  Gemeinsamer Client-Code in `public/shared.js`.
- **Automatische Tests** (`tests/`, per GitHub Actions bei jedem Push):
  Syntaxprüfung aller JS-Dateien, ein **statischer Qualitäts-/A11y-Check** aller
  HTML-Seiten (keine externen Ressourcen, alt-Texte, lang/viewport), Tests für
  QR-Encoder, Scores-, Cloud- und Party-API (mit gemocktem D1), ein
  **Flow-/E2E-Test** des geteilten Würfelpoker-Pfades (anlegen → laden →
  eintragen → volle Runde) sowie WUMMS!- und MEERI-Logik. Zusätzlich ein
  **Lighthouse-Budget** (`lighthouserc.json`) als eigener, nicht-blockierender
  Workflow für Performance, Barrierefreiheit, Best Practices & SEO.
- **Barrierefreiheit**: Dialoge als `role="dialog"`/`aria-modal` mit
  Escape-zum-Schließen und Fokus-Rückgabe, `aria-live`-Statusmeldungen,
  beschriftete Eingabefelder und sichtbarer Fokusrahmen.

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

## Sicherheit

- **Security-Header** via `public/_headers`: strenge **Content-Security-Policy**
  (`connect-src 'self'`, `frame-ancestors none`, `object-src none`), `nosniff`,
  `Referrer-Policy`, `Permissions-Policy` und HSTS. Alle Assets (Schriften, QR-
  Encoder) sind selbst gehostet — kein externes CDN, keine Fremd-Skripte.
- **Geräte-Bindung**: In Bestenlisten und Spieleabend-Räumen gehört ein Name dem
  Gerät, das ihn zuerst benutzt — kein Einreichen unter fremdem Namen.
- **Signierte Lauf-Token** (HMAC, `SCORE_SECRET` als Pages-Secret) gegen
  blindes Score-Absenden, plus D1-gestütztes **Rate-Limit** auf allen APIs.
- **Cloud-Speicher** hält beim Überschreiben die vorherige Version vor,
  begrenzt die Größe und ist rate-limitiert.
- **Anonymer Fehler-Melder** (`/api/log`): JS-Fehler auf fremden Geräten landen
  gedrosselt und dedupliziert in D1 (selbst-beschränkt auf die letzten 1000),
  damit Defekte auffallen.

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
├── schema.sql                 D1-Schema (Würfelpoker, *_scores, cloud_saves, party*, push_*, error_log, rate)
├── public/                    statische Spiele (1 Ordner = 1 Spiel)
│   ├── index.html             Landing Page mit App-Karten, Suche & Challenge
│   ├── games.js               zentrale Spiele-Registry (Quelle für Startseite/Profil/Party)
│   ├── theme.js               Hell/Dunkel + Energiesparen + SW-Registrierung + Fehler-Melder
│   ├── shared.js              gemeinsame Spiele-Schicht (Scores, Name, Meilensteine, Skins, Sound, Teilen, Cloud-Sync)
│   ├── qr.js                  eigenständiger QR-Code-Encoder (Beitritt/Sync teilen)
│   ├── _headers               Security-Header (CSP, HSTS, nosniff, …)
│   ├── fonts/                 selbst gehostete Schriften (Fraunces, Outfit) — kein Google-Fonts-CDN
│   ├── profil/                Spieler-Profil & Hub (Avatar, Level, Rahmen, Cloud, Freunde, Push)
│   ├── party/                 Spieleabend-Raum (Räume, Live-Rangliste)
│   ├── saison/                Saison & Liga (wöchentliche Gesamtwertung)
│   ├── impressum/             Impressum (§ 5 ECG / § 25 MedienG)
│   ├── datenschutz/           Datenschutzerklärung (DSGVO)
│   ├── kochstudio/            KI-Kochstudio (index.html + app.js + style.css)
│   ├── favicon.ico            Browser-Tab-Icon
│   ├── 404.html               Fehlerseite
│   ├── manifest.webmanifest   PWA-Manifest (installierbare App)
│   ├── sw.js                  Service Worker (offline-fähig, network-first + App-Shell)
│   ├── icons/                 App-Icons
│   ├── _redirects
│   ├── wuerfelpoker/          index.html + app.js + style.css
│   ├── funkelfeld/
│   ├── komet/
│   ├── sternensturm/
│   ├── galopp/
│   ├── wumms/                 Comic-Block-Puzzle mit Tier-Helden
│   └── meeri/                 Merge-Idle mit Meerschweinchen (MEERI-MANIA)
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
│   └── koch.js                KI-Kochstudio (Workers AI + DuckDuckGo-Websuche)
├── tests/                     Node-Tests (Syntax, Qualität/A11y, QR, Scores/Cloud/Party/Saison/Push-API, Flow-E2E, WUMMS/MEERI)
├── worker-rt/                 separater Worker: Echtzeit-Durable-Object (PartyRoom)
├── lighthouserc.json          Lighthouse-Budget (Performance/A11y/Best-Practices/SEO)
└── .github/workflows/
    ├── ci.yml                 CI: führt `npm test` bei jedem Push aus
    └── lighthouse.yml         Lighthouse-Budget-Check (nicht blockierend)
```

Tests lokal ausführen: `npm test` (Node ≥ 22).

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
