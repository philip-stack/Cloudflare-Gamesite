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

Alle Spiele sind mobile-first (Touch-Gesten), haben aber auch
Tastatur-Steuerung. Funkelfeld, Komet, Sternensturm und Galopp teilen sich
eine globale Bestenliste pro Spiel (Top 50, pro Name zählt der Highscore).

Die ganze Seite kann zwischen **Hell- und Dunkelmodus** umgeschaltet werden
(🌙/☀️-Button in jeder App); die Wahl gilt app-übergreifend und wird auf dem
Gerät gespeichert. Die Spielszenen der Canvas-Spiele bleiben bewusst dunkel,
der Rahmen passt sich an.

**Plattform-Features:**

- **Tages- & Wochen-Challenge** (Galopp): Alle laufen dieselbe, per Datum-
  bzw. Wochen-Seed erzeugte Strecke — je mit eigener Bestenliste. Karten auf
  der Landing Page.
- **Meilensteine** (Galopp, Sternensturm, Komet): Abzeichen für Lauf- und
  Lebenszeit-Erfolge, lokal gespeichert, im Spielmenü einsehbar.
- **Skins** (Galopp, Komet, Sternensturm): freispielbare Farbvarianten der
  Spielfigur, an die Zahl der Abzeichen gekoppelt, im Menü wählbar. Funkelfeld
  hat eigene Skins.
- **Onboarding**: Beim ersten Start jedes Spiels ein kurzer Steuerungs-Hinweis.
- **Teilen-Button** in jedem Game-Over (Web-Share mit Zwischenablage-Fallback);
  Würfelpoker lädt per **QR-Code** zum Beitreten ein (eigener QR-Encoder in
  `public/qr.js`, kein externes Skript).
- **Klang & Haptik**: gemeinsamer, abschaltbarer Sound-/Vibrations-Layer
  (`GS.sound` / `GS.haptic`), u. a. beim Würfeln und Eintragen in Würfelpoker.
- Die Landing Page zeigt **eigene Rekorde + Weltrang** pro Spiel, eine
  **Weiterspielen-Karte** für laufende Würfelpoker-Spiele, das **zuletzt
  gespielte** Spiel ganz oben und die Challenge-Führenden; Würfelpoker führt
  eine **Statistik** (Siege, Spiele, Punkteschnitt) über abgeschlossene Spiele.
- **Gemeinsame Bestenlisten-API** (`/api/scores/<spiel>`, eine D1-Tabelle)
  mit Geräte-Token, Namensschutz (ein Name gehört dem Gerät, das ihn zuerst
  benutzt), Plausibilitätsprüfung der Scores, Rate-Limit und einem
  **signierten Lauf-Token** (HMAC): jede Einsendung muss ein kurz vorher
  ausgestelltes Token mitschicken, was blindes Absenden per Skript erschwert.
  Gemeinsamer Client-Code in `public/shared.js`.
- **Automatische Tests** (`tests/`, per GitHub Actions bei jedem Push):
  Syntaxprüfung aller JS-Dateien, QR-Encoder- und Scores-API-Tests.

Die Seite ist eine **PWA**: Am Handy über „Zum Startbildschirm hinzufügen"
(bzw. den Installieren-Hinweis im Browser) wird sie zur App mit eigenem Icon
und Vollbild — bereits besuchte Spiele funktionieren auch offline
(Bestenlisten und geteilte Spiele brauchen Internet).

## Struktur

```
wuerfelpoker/
├── wrangler.toml              Pages-Config + D1-Binding (DB)
├── schema.sql                 D1-Schema (Würfelpoker-Tabellen + *_scores)
├── public/                    statische Spiele (1 Ordner = 1 Spiel)
│   ├── index.html             Landing Page mit App-Karten
│   ├── theme.js               Hell/Dunkel-Umschalter + SW-Registrierung + Update-Hinweis
│   ├── shared.js              gemeinsame Spiele-Schicht (Scores, Name, Meilensteine, Skins, Sound, Teilen)
│   ├── qr.js                  eigenständiger QR-Code-Encoder (Beitritt teilen)
│   ├── favicon.ico            Browser-Tab-Icon
│   ├── 404.html               Fehlerseite
│   ├── manifest.webmanifest   PWA-Manifest (installierbare App)
│   ├── sw.js                  Service Worker (offline-fähig)
│   ├── icons/                 App-Icons
│   ├── _redirects
│   ├── wuerfelpoker/          index.html + app.js + style.css
│   ├── funkelfeld/
│   ├── komet/
│   ├── sternensturm/
│   └── galopp/
├── functions/api/             Cloudflare Pages Functions
│   ├── _util.js               gemeinsame Helfer (json, Codes, Spiel laden)
│   ├── health.js
│   ├── games/                 Würfelpoker: geteilte Spiele (CRUD + Zellen)
│   └── scores/[game].js       Bestenlisten aller Spiele (GET/POST, ?daily=1, ?weekly=1)
├── tests/                     Node-Tests (Syntax, QR-Encoder, Scores-API)
└── .github/workflows/ci.yml   CI: führt die Tests bei jedem Push aus
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
2. App-Karte in `public/index.html` ergänzen (`--i` hochzählen).
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
