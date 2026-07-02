# Würfelpoker – Escalero-Verrechnungsblatt (Cloudflare Pages)

Digitale Nachbildung des Piatnik **Eskalero-Würfelpoker-Verrechnungsblatts**.
Läuft komplett im Browser – die App würfelt nur am Anfang aus, wer beginnt.
Gespielt wird mit echten Würfeln am Tisch, die App ist das Punkteblatt.

Alle Spielstände liegen lokal im Browser (`localStorage`) – kein Backend nötig,
kein Login, keine Datenbank.

## Struktur

```
wuerfelpoker/
├── wrangler.toml              Pages-Config
├── public/
│   ├── _redirects            /  →  /wuerfelpoker/
│   └── wuerfelpoker/
│       ├── index.html
│       ├── app.js            Spiel-Logik + Verrechnungsblatt (clientseitig)
│       └── style.css
└── functions/                (ungenutzt – altes D1-Backend, kann bleiben oder weg)
```

## Spielregeln (Escalero / Würfelpoker)

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

## Lokal ansehen

Einfach `public/wuerfelpoker/index.html` im Browser öffnen, oder:

```
npx wrangler pages dev ./public
```

## Deploy (Cloudflare Pages)

```
npm install -g wrangler
wrangler login
wrangler pages deploy ./public --project-name=philip-stack
```

Danach erreichbar unter https://philip-stack.pages.dev/
