# Spieleabend – Cloudflare Gamesite

Eine Sammlung kleiner Browser-Spiele für den Spieleabend, gehostet als
**Cloudflare Pages**-Projekt (`philip-stack`). Alles läuft ohne Build-Schritt:
statisches HTML/CSS/JS in `public/`, dazu Pages Functions als API und eine
**D1**-Datenbank für geteilte Spiele und globale Bestenlisten.

**Live:** https://philip-stack.pages.dev/

## Die Spiele

| Spiel | Pfad | Was es ist |
|---|---|---|
| 🎲 **Würfelpoker** | `/wuerfelpoker/` | Escalero-Verrechnungsblatt — lokal spielen oder per Beitritts-Code teilen |
| 💎 **Funkelfeld** | `/funkelfeld/` | 8×8-Puzzle — Funkelsteine sammeln, Combos jagen, Skins freispielen |
| ☄️ **Komet** | `/komet/` | One-Touch-Arcade — am Lichtseil von Stern zu Stern schwingen |
| 🚀 **Sternensturm** | `/sternensturm/` | Roguelite-Space-Shooter — Wellen, Upgrades, NOVA, Bosse |
| 🦄 **Galopp** | `/galopp/` | Temple-Run-artiger Endless-Runner — springen, ducken, abbiegen, und das wütende Einhorn nicht aufholen lassen |

Alle Spiele sind mobile-first (Touch-Gesten), haben aber auch
Tastatur-Steuerung. Funkelfeld, Komet, Sternensturm und Galopp teilen sich
eine globale Bestenliste pro Spiel (Top 50, pro Name zählt der Highscore).

## Struktur

```
wuerfelpoker/
├── wrangler.toml              Pages-Config + D1-Binding (DB)
├── schema.sql                 D1-Schema (Würfelpoker-Tabellen + *_scores)
├── public/                    statische Spiele (1 Ordner = 1 Spiel)
│   ├── index.html             Landing Page mit App-Karten
│   ├── _redirects
│   ├── wuerfelpoker/          index.html + app.js + style.css
│   ├── funkelfeld/
│   ├── komet/
│   ├── sternensturm/
│   └── galopp/
└── functions/api/             Cloudflare Pages Functions
    ├── _util.js               gemeinsame Helfer (json, Codes, Spiel laden)
    ├── health.js
    ├── games/                 Würfelpoker: geteilte Spiele (CRUD + Zellen)
    ├── funkelfeld/scores.js   Bestenlisten: GET Top 50 / POST Score
    ├── komet/scores.js
    ├── sternensturm/scores.js
    └── galopp/scores.js
```

Jedes Spiel ist bewusst **selbst enthalten**: ein Ordner mit `index.html`,
`app.js`, `style.css` — kein Framework, kein Bundler. Die Spiele rendern
auf Canvas (Komet, Sternensturm, Galopp) bzw. DOM (Würfelpoker, Funkelfeld)
und teilen sich das „Midnight Felt“-Design-System (Fraunces + Outfit,
Gold-Folie, dunkle Karten-Optik).

## API

Bestenlisten (Funkelfeld, Komet, Sternensturm, Galopp):

- `GET /api/<spiel>/scores` → `{ top: [{ name, score }] }` — Top 50, pro Name nur der Highscore
- `POST /api/<spiel>/scores` mit `{ name, score }` → `{ ok, rank, best }`

Würfelpoker (geteilte Spiele, Zugriff nur mit Beitritts-Code `?code=XXXXXX`):

- `POST /api/games` — Spiel anlegen, liefert Beitritts-Code
- `GET /api/games/:id?code=…` — Spielstand laden
- `POST /api/games/:id/cells?code=…` — Zelle eintragen / streichen

## Ein neues Spiel hinzufügen

1. Ordner `public/<name>/` mit `index.html`, `app.js`, `style.css` anlegen
   (bestehendes Spiel als Vorlage kopieren).
2. App-Karte in `public/index.html` ergänzen (`--i` hochzählen).
3. Für eine Bestenliste: Tabelle `<name>_scores` in `schema.sql` ergänzen,
   `functions/api/<name>/scores.js` von einem bestehenden Spiel kopieren,
   Tabelle remote anlegen (siehe unten).

## Lokal entwickeln

```
npx wrangler pages dev ./public
```

## Deploy

```
npx wrangler pages deploy ./public --project-name=philip-stack
```

Neue D1-Tabellen einmalig remote anlegen, z. B.:

```
npx wrangler d1 execute wuerfelpoker --remote --command "CREATE TABLE IF NOT EXISTS ..."
```

## Würfelpoker: Spielregeln (Escalero)

Digitale Nachbildung des Piatnik **Eskalero-Würfelpoker-Verrechnungsblatts**.
Gespielt wird mit echten Würfeln am Tisch, die App ist das Punkteblatt —
lokal im Browser (`localStorage`) oder geteilt über D1 mit Beitritts-Code.

Gespielt mit **5 Poker-Würfeln** (Bilder: 9, 10, B, D, K, A). Pro Zug bis zu
**3×** würfeln – Würfel liegen lassen und nachwerfen.

- Am Anfang würfelt jeder einmal: **höchste Zahl beginnt.** Danach reihum im Kreis.
- Nach dem Zug trägt man das Ergebnis in **ein freies Feld der eigenen Spalte** ein.
- Passt nichts (oder man will nicht), muss man **ein freies Feld streichen** = 0 Punkte.
- Das Spiel endet, wenn **alle 10 Felder** jedes Spielers gefüllt sind.
- Höchste Gesamtsumme gewinnt.
- Nächste Runde: **Sieger beginnt** – oder im Kreis der nächste Spieler.

### Punkte

| Zeile | Bedeutung | Punkte |
|---|---|---|
| 9 / 10 / B / D / K / A | Anzahl Würfel × Wert (9=1, 10=2, B=3, D=4, K=5, A=6) | z. B. 3 Könige = 3×5 = 15 |
| S | Straße | 20 (serviert 25) |
| F | Full House | 30 (serviert 35) |
| P | Poker (Vierling) | 40 (serviert 45) |
| G | Grande (Fünfling) | 50 (serviert 80) |

**Serviert** = die Kombination gleich im 1. Wurf, ohne Nachwerfen.
