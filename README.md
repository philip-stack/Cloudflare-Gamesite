# Würfelpoker – Stack (Cloudflare Pages + Functions + D1)

Kostenlos, kein Sleep, Daten bleiben persistent in D1 (SQLite bei Cloudflare).

## Struktur

```
wuerfelpoker/
├── wrangler.toml              Pages-Config + D1-Binding
├── schema.sql                 Tabellen: games, players, rounds
├── public/index.html          Platzhalter-Frontend (wird durch die App ersetzt)
└── functions/api/
    ├── health.js              GET  /api/health
    ├── games/index.js         GET/POST  /api/games
    └── games/[id]/
        ├── index.js           GET/PATCH /api/games/:id
        └── rounds.js          POST/DELETE /api/games/:id/rounds
```

## Deploy (einmalig)

```
npm install -g wrangler
wrangler login
wrangler d1 create wuerfelpoker
```

Die ausgegebene `database_id` in `wrangler.toml` eintragen, dann:

```
wrangler d1 execute wuerfelpoker --remote --file=./schema.sql
wrangler pages project create philip-stack --production-branch=main
wrangler pages deploy ./public --project-name=philip-stack
```

Danach: https://philip-stack.pages.dev/api/health

## Lokal entwickeln

```
wrangler pages dev
```

Nutzt eine lokale D1-Kopie. Schema lokal einspielen:

```
wrangler d1 execute wuerfelpoker --local --file=./schema.sql
```

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | /api/health | DB-Check |
| POST | /api/games | Spiel anlegen `{name?, players: ["A","B"], scoring?}` |
| GET | /api/games | Letzte 50 Spiele |
| GET | /api/games/:id | Spielstand: Spieler, Runden, Punktesummen, `next_starter_player_id` |
| PATCH | /api/games/:id | `{status: "finished"}` Spiel beenden |
| POST | /api/games/:id/rounds | Runde eintragen `{winner_player_id, hand, points?}` |
| DELETE | /api/games/:id/rounds | Letzte Runde rückgängig |

## Punkteschema (Default, pro Spiel überschreibbar)

| Hand | Punkte |
|---|---|
| Hoher Wurf | 1 |
| Straße / serviert | 2 / 4 |
| Full / serviert | 3 / 6 |
| Poker / serviert | 4 / 8 |
| Grande / serviert | 5 / 10 |

Beim Anlegen eines Spiels kann ein eigenes `scoring`-Objekt mitgegeben werden
(`{"Poker serviert": 12, ...}`) – Hausregeln pro Runde also anpassbar.
