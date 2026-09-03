# Spieleabend – Cloudflare Gamesite

Eine Sammlung kleiner Browser-Spiele für den Spieleabend — dazu ein paar
**Werkzeuge** (KI-Kochstudio, Sprit-Radar, Feuerwehr-NÖ-Monitor, Tages-Briefing).
Gehostet als **Cloudflare Pages**-Projekt (`philip-stack`). Alles läuft ohne
Build-Schritt: statisches HTML/CSS/JS in `public/`, dazu Pages Functions als
API, eine **D1**-Datenbank für geteilte Spiele und Bestenlisten und ein
separater Worker für Echtzeit (Durable Objects) und Crons. Kein Framework, kein
Bundler, keine Fremd-Skripte, keine bezahlten Dienste — alles im
Gratis-Kontingent.

**Live:** https://philip-stack.pages.dev/

## Die Spiele

| Spiel | Pfad | Was es ist |
|---|---|---|
| 🎲 **Würfelpoker** | `/wuerfelpoker/` | Escalero-Verrechnungsblatt — mehrere Runden pro Spiel, 1–n Spalten pro Spieler, Live-Ranking in Gold/Silber/Bronze; lokal spielen oder per Beitritts-Code teilen |
| 💎 **Funkelfeld** | `/funkelfeld/` | 8×8-Puzzle — Funkelsteine sammeln, Combos jagen, Skins freispielen |
| ☄️ **Komet** | `/komet/` | One-Touch-Arcade — am Lichtseil von Stern zu Stern schwingen |
| 🐦 **Flatterfink** | `/flatterfink/` | One-Touch-Flatter-Arcade — als Stieglitz durch die Lücken in den Hecken, Körndl sammeln (auch in Ketten), Doppelhecken ab Tor 24; Score = Tore × 10 + Körndl × 5. Fairer Einstieg (die ersten zwei Lücken liegen auf Vogelhöhe), Skins & Abzeichen |
| 🚀 **Sternensturm** | `/sternensturm/` | Roguelite-Space-Shooter — Wellen, Upgrades, NOVA, Bosse |
| 🦄 **Galopp** | `/galopp/` | Temple-Run-artiger Endless-Runner — springen, ducken, abbiegen, und das wütende Einhorn nicht aufholen lassen |
| 🦝 **WUMMS!** | `/wumms/` | Comic-Block-Puzzle mit Tier-Helden — Blöcke aufs 8×8-Feld legen, Reihen abräumen, Helden-Ultimates (Bombe/Laser/Nuke) zünden, Combo-Ketten bauen und den Bösewicht zurückschlagen, der Reihen von unten hochschiebt |
| 🐹 **MEERI-MANIA** | `/meeri/` | Merge-Idle mit Meerschweinchen — Meeries kaufen, gleiche zusammenziehen für immer absurdere Evolutionen (Baby → Punk → Ritter → … → Drachen → Galaxie), Münz-Blasen antippen, Wiese ausbauen, Offline-Einnahmen, alle 16 im Meeri-Album entdecken. Fortschritt lokal; **weltweite Bestenliste** (höchste Evolution) über `/api/scores` |
| 🐍 **Neon-Schlange** | `/schlange/` | Slither-**Arena** — große Welt mit Kamera & Minimap, **KI-Gegner** zum Abschneiden (laufen sie in dich, zerfallen sie in Orbs), **Power-ups** (Magnet/Schild/×2/Geist). Ziehen lenkt, ⚡/Halten boostet; Orbs fressen & wachsen, nicht selbst beißen. Skins & Meilensteine, weltweite Bestenliste |
| 🎨 **Kritzeln & Raten** | `/kritzeln/` | **Echtzeit-Multiplayer** (2–10) — einer malt, die anderen raten live im Chat; Raum per Code teilen, **Kategorien & Rundenzahl** (Host), Wortwahl aus 3, Live-Striche mit **Fülleimer/Radierer/Undo**, Buchstaben-Hinweise, **Speed-/Platz-Punkte**, Runden-Zusammenfassung, Konfetti/Sound, Sieger:in & Revanche. Server = Durable Object (`DrawRoom`); dazu eine **dauerhafte, geräteübergreifende Bestenliste** (🏆), die das DO am Spielende autoritativ in D1 schreibt (Gesamtpunkte, Spiele, Siege, Bestleistung) |
| 🧠 **Wer weiß's?** | `/quiz/` | **Echtzeit-Live-Trivia** (2–10) — alle beantworten dieselbe Multiple-Choice-Frage gleichzeitig; **richtig + schnell = mehr Punkte**, Kategorien wählbar (11 Kategorien inkl. „Kopfnüsse", ~240-Fragen-Satz de-AT), Fragenzahl (Host), Optionen pro Spiel gemischt, **keine schnelle Wiederholung** (Raum merkt gestellte Fragen über mehrere Spiele), Reveal mit Auflösung, Sieger:in & Revanche, **Meilensteine**. Server = Durable Object (`QuizRoom`); dazu eine **dauerhafte D1-Bestenliste** (`quiz_score`), die das DO am Spielende autoritativ schreibt |

Alle Spiele sind mobile-first (Touch-Gesten), haben aber auch
Tastatur-Steuerung. Funkelfeld, Komet, Flatterfink, Sternensturm, Galopp, WUMMS!,
MEERI-MANIA und Neon-Schlange teilen sich eine globale Bestenliste pro Spiel
(Top 50, pro Name zählt der Highscore). Welche Spiele gewertet sind, steht
server-seitig an EINER Stelle (`functions/api/_gamemeta.js`) — vorher pflegten
Saison-Liga und Bestenlisten-API getrennte Listen, was Neon-Schlange still aus
der Wochenwertung geworfen hatte.

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
- **Meilensteine** (Galopp, Sternensturm, Komet, Flatterfink, WUMMS!, Neon-Schlange,
  Funkelfeld, MEERI-MANIA, Wer weiß's?): Abzeichen für Lauf- und Lebenszeit-Erfolge, lokal
  gespeichert, im Spielmenü einsehbar; ihre Zahl fließt in Profil-Level & XP ein.
- **Skins** (Galopp, Komet, Flatterfink, Sternensturm): freispielbare Farbvarianten der
  Spielfigur, an die Zahl der Abzeichen gekoppelt, im Menü wählbar. Funkelfeld
  hat eigene Skins; WUMMS! schaltet über Abzeichen **Tier-Helden** frei.
- **Begrüßung beim ersten Besuch**: Wer ohne gespeicherten Namen auf die
  Startseite kommt, wird in einem nativen `<dialog>` nach einem Namen gefragt —
  ohne Namen zählt kein Punktestand, und das stand vorher nirgends. Dazu die
  Datenschutz-Info in drei Stufen: ein Satz sofort (kein Konto, keine E-Mail,
  kein Passwort), Details zum Aufklappen, ganze Erklärung verlinkt. **Kein
  Zwang** — Wegklicken, Esc und Hintergrund-Klick gelten als „später", werden
  gemerkt (`bb_onboard_v1`) und hinterlassen nur einen leisen Hinweis in der
  Spieleliste. Geprüft wird gegen **`/api/name`**: Form *und* ob der Name schon
  einem anderen Gerät gehört — **vor** dem ersten Spiel statt als `409` nach dem
  ersten Punktestand. Die Regeln (`nameProblem`) und die Eigentums-Abfrage
  (`nameOwner`) liegen in `_util.js` und werden von Begrüßung **und** Einsendung
  benutzt; sonst sagt die eine „frei", was die andere ablehnt. Der Browser kennt
  absichtlich nur die Mindestlänge — die Regeln stehen nicht doppelt.
- **Werkzeuge auf der Startseite**: Die Neben-Apps (KI-Kochstudio, Sprit-Radar,
  Feuerwehr NÖ) stehen unter einer eigenen Überschrift **🔧 Werkzeuge**, gebaut
  aus derselben Registry wie die Spielkarten. Einträge mit `onlyFor` (das
  Tages-Briefing) erscheinen **nur unter einem bestimmten Namen**; dieselbe
  Erkennung zeigt dem Betreiber einen `🔧 Betrieb`-Link in der Fußzeile. Das ist
  Aufräumen, **kein Schutz** — geschützt sind diese Seiten serverseitig über
  `ADMIN_TOKEN`, ein Name im localStorage ist keine Berechtigung.
- **Tagesquests & Level** (`GS.level`, `GS.quests`): 3 Quests pro Tag,
  deterministisch aus dem Datum gewählt (auf allen Geräten dieselben), mit
  XP-Belohnung. XP fließen in **ein** Spieleabend-Level über alle Spiele
  (Abzeichen·100 + Rekorde·80 + gespielte Spiele·40 + Bonus, 400 XP je Level,
  Titel von „Frischling" bis „Unantastbar"). Hub und Profil rechnen dieselbe
  Formel an derselben Stelle — vorher zwei Zahlen für dasselbe.
- **Duelle & Ergebnis-Bild** (`GS.duelLink`, `GS.shareCard`): Aus jedem
  Game-Over lässt sich ein **Duell-Link** teilen („schlag meine 4.310"); wer ihn
  öffnet, sieht die Herausforderung als Karte auf der Startseite. Dazu ein auf
  Canvas gezeichnetes **Ergebnis-Bild** zum Weiterschicken — kein externer Dienst.
- **Anonyme Nutzungsmessung** (`/api/stat`, `stat_daily`): pro Kalendertag und
  Schlüssel eine reine Anzahl (`play:galopp`, `duel`, `share`, `ai:koch`,
  `ai:briefing`). **Keine IP, kein Gerät, kein Name, keine Sitzung, kein
  Zeitpunkt** — die Client-IP dient nur der Flut-Drossel und landet nicht in der
  Tabelle. Damit ist überhaupt erst sichtbar, welche Spiele laufen, statt zu raten.
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
- **Betreiber-Dashboard** (`/admin/`, `/api/admin` — nicht in der Registry,
  `noindex`; für den Betreiber selbst über den `🔧 Betrieb`-Link in der
  Fußzeile): privater Live-Monitor an einem Ort, gegliedert in **vier
  Ansichten** — *Überblick*, *Fehler*, *Moderation*, *System*. Die Ansicht
  bestimmt auch, **was der Server überhaupt abfragt** (`?view=…`): statt 44
  Abfragen bei jedem Laden nur die der offenen Ansicht, und die parallel.
  - **Überblick**: **Ampel-Gesamtstatus**, Reichweite/Nutzung aus `stat_daily`,
    Scores/Einsendungen/Weltrekorde je Spiel, **Trends als Sparklines** (Scores,
    aktive Geräte, Fehler pro Tag; Zeitraum 7/30/90 Tage, Hover/Touch zeigt
    Datum + exakte Zahl), laufende Echtzeit-Räume.
  - **Fehler**: Server-Fehler **nach Häufigkeit gruppiert** (User-Agent,
    Seiten-Filter, externe `522` separat gezählt), getrennt davon die
    Client-Meldungen aus `client_log`, dazu der **Vorfall-Verlauf**
    (`ops_log`: eine Zeile je Statuswechsel, nicht je Cron-Lauf).
  - **Moderation**: **echte Top-50 je Spiel** mit Direkt-Löschen (erwischt
    eingenistete Fakes auf Platz 1), **Suche nach Name/Gerät** über alle Spiele,
    Sperrliste, gemeldete Quiz-Fragen.
  - **System**: Push-Abos/Warteschlange, Cron-Health, DB-Hilfstabellen,
    **Cloudflare-Kontingente** und **Workers-AI-Verbrauch** (siehe unten),
    Briefing-Einstellungen und das **Zugriffs-Protokoll** (`admin_log`).
  Geschützte **Aktionen** (POST, nur mit Header-Schlüssel → CSRF-resistent):
  Fake-**Score löschen**, **Gerät sperren** (`banned_device`, blockt weitere
  Einsendungen), Fehler-Log/Push-Queue leeren, Fire-Cron manuell auslösen,
  Cloudflare-Zahlen neu holen, Briefing speichern/jetzt erzeugen.
  **Tastatur**: `1`–`4` Ansicht, `T` Zeitraum, `R` neu laden, `A` Auto-Refresh,
  `/` Suche, `?` Hilfe. Der Auto-Refresh **pausiert**, solange ein Feld den
  Fokus hat oder in den letzten 90 s etwas geändert wurde — sonst setzt er eine
  gerade getroffene Auswahl beim Neuzeichnen zurück.
  Ein optionaler **Betreiber-Alarm** pusht bei „Achtung" an einen konfigurierten
  Bestenlisten-Namen. Was „Achtung" heißt, steht an **einer** Stelle
  (`functions/api/_ops.js`: veraltete Crons, Push-Stau, Fehlerspitze …) und wird
  von Ampel **und** Alarm benutzt — vorher hatten beide ihre eigene Meinung dazu.
  Fehlgeschlagene Anmeldeversuche landen im `admin_log` (max. 1 Zeile pro IP und
  Minute); der versuchte Schlüssel wird **nie** gespeichert.
  Zugriff nur mit dem Pages-Secret `ADMIN_TOKEN` (selbst erzeugt, gratis, kein
  externer Dienst), konstantzeitig verglichen; ohne Schlüssel `401`.
- **Cloudflare-Zahlen im eigenen Panel** (`functions/api/_cf.js`): Anfragen,
  D1-Zeilen (gelesen/geschrieben), Worker- und Durable-Object-Aufrufe samt
  Fehlerquote und **Workers-AI-Neuronen** — jeweils mit dem Abstand zum
  **Gratis-Tageskontingent**, damit man nicht extra ins Cloudflare-Dashboard
  muss. Eine GraphQL-Abfrage plus REST für DB-Größe/Region, **10 Minuten
  gecacht** (`app_config.cf_stats`) und mit Knopf zum sofortigen Neuholen.
  Fällt die API aus, bleibt der alte Stand stehen und wird als **veraltet**
  markiert statt überschrieben. Ohne `CF_API_TOKEN`/`CF_ACCOUNT_ID` fragt das
  Panel gar nicht erst. Die **KI-Aufrufe** zählt es aus dem eigenen Zähler
  (`ai:koch` / `ai:briefing`) getrennt auf — Cloudflare selbst kann Kochstudio
  und Briefing nicht unterscheiden, beide laufen auf demselben Modell.
- **Automatische Tests** (`tests/`, per GitHub Actions bei jedem Push, `npm test`):
  Syntaxprüfung aller JS-Dateien (auch `worker-rt/` mit den Durable Objects),
  ein **statischer Qualitäts-/A11y-Check** aller HTML-Seiten (keine externen
  Ressourcen, alt-Texte, lang/viewport) und Modul-Tests mit gemocktem D1 für
  QR-Encoder, Scores/Cloud/Party/Saison/Push/Stat-API, **Namensvergabe**
  (`/api/name` + die Regeln, plus statisch die Barrierefreiheit und die
  Datenschutz-Texte der Begrüßung), **Betriebsstatus** (`_ops.js`),
  **Cloudflare-Zahlen** (`_cf.js`, inkl. „API kaputt → alter Stand bleibt"),
  **Tages-Briefing** (Zahlen-Formulierung, Zeitzone, KI-Ausgabe wird geprüft
  statt geglaubt), **Kochstudio**, **Health** und ein **Flow-/E2E-Test** des
  geteilten Würfelpoker-Pfades (anlegen → laden → eintragen → volle Runde).
  Dazu WUMMS!- und MEERI-Logik, die **Kritzeln-Logik** (`worker-rt/draw-logic.js`:
  Wort-Normalisierung, Levenshtein, Kategorien/eigene Wörter, Punkte), die
  **Quiz-Logik** (`worker-rt/quiz-logic.js`), die **Raum-Basis**
  (`worker-rt/base-room.js` in Node), die **Fire-Cron-Orchestrierung** und der
  **Cron-Dead-Man's-Switch** (`/api/health`). Eigen ist der **Panel-UI-Test**
  (`tests/admin-ui.test.mjs`): das Inline-Skript des Dashboards läuft in
  `node:vm` gegen einen minimalen DOM — er hat schon zwei echte Fehler gefangen,
  bevor sie live gingen. Zusätzlich ein **Lighthouse-Budget**
  (`lighthouserc.json`) als eigener, nicht-blockierender Workflow für
  Performance, Barrierefreiheit, Best Practices & SEO.

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

Kein Spiel, sondern ein KI-Helfer unter `/kochstudio/` — auf der Startseite
unter **🔧 Werkzeuge** verlinkt. Man gibt ein, was im Kühlschrank/Vorrat ist,
und bekommt:

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
Jeder KI-Aufruf zählt anonym als `ai:koch` in `stat_daily` — nur so lässt sich
im Panel sagen, wie viel vom Gratis-Tageskontingent auf das Kochstudio geht und
wie viel aufs Briefing.

Die Seite ist eine **PWA**: Am Handy über „Zum Startbildschirm hinzufügen"
(bzw. den Installieren-Hinweis im Browser) wird sie zur App mit eigenem Icon
und Vollbild — bereits besuchte Spiele funktionieren auch offline
(Bestenlisten und geteilte Spiele brauchen Internet).

## ☀️ Tages-Briefing

**Live:** https://philip-stack.pages.dev/briefing/ (privat, Schlüssel nötig)

Ein persönliches Morgen-Briefing unter `/briefing/`: Wetter am Wohnort,
günstigster Sprit in der Nähe und Feuerwehr-Einsätze im Heimatbezirk — in drei
Sätzen, jeden Morgen automatisch.

- **Die KI formuliert nur, sie liefert keine Fakten.** Alle Zahlen kommen aus
  den Quellen, die die Seite schon hat (open-meteo, E-Control über
  `sprit/_ec.js`, NÖ-Feuerwehr). Der Prompt verbietet Erfindungen; die Antwort
  wird **geprüft** (Länge, alle Blöcke vorhanden, der Spritpreis muss
  tatsächlich vorkommen) und sonst durch einen **deterministisch gebauten Text**
  ersetzt. Das ist kein Misstrauen ins Modell, sondern der einzige Weg, dem Text
  am Morgen glauben zu können — beim ersten echten Lauf hatte die KI den
  Spritpreis weggelassen, obwohl er in den Daten stand.
- **Erzeugt wird ausschließlich im Cron**, nie beim Seitenaufruf: sonst kostet
  jedes Nachschauen einen KI-Aufruf und der Text ändert sich unter der Hand.
  Gespeichert in `briefing` (Text + Rohwerte als JSON), 14 Tage Verlauf.
- **Zeitzone ernst genommen**: Der Worker läuft in UTC, „heute" und „zu früh"
  richten sich aber nach Wien — `Intl.DateTimeFormat` mit `Europe/Vienna` und
  `formatToParts`, damit die Sommerzeit nicht zweimal im Jahr das Briefing
  verschiebt.
- **Push am Morgen** (optional), Uhrzeit/Wohnort/Bezirk/Kraftstoff im
  Betriebs-Panel unter *System* einstellbar.
- **Privat**: nicht in der öffentlichen Registry (`onlyFor`), und die Lese-API
  verlangt den `ADMIN_TOKEN` — der Text nennt Bezirk und Tankstelle in
  Wohnortnähe. Das Ausblenden allein wäre kein Schutz gewesen.

Backend: `functions/api/briefing/` (`_gen.js` erzeugt, `cron.js` löst aus,
`index.js` liest), Frontend `public/briefing/` — als Seite **innerhalb der
Hub-PWA**, damit keine vierte App mit eigenem Manifest und eigenem Service
Worker entsteht.

## 🚒 Feuerwehr-NÖ-Einsatzmonitor

**Live:** https://philip-stack.pages.dev/fire/noe/

Eine **eigenständige App** unter `/fire/noe/` (eigenes rotes Theme, eigener
Service Worker mit Scope `/fire/noe/`, auf der Startseite unter **🔧 Werkzeuge**
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
mit Scope `/tanken/`, auf der Startseite unter **🔧 Werkzeuge** verlinkt). Findet die
**günstigsten Tankstellen** in Österreich — im **Umkreis** und **entlang einer
Route** — komplett gratis und ohne API-Schlüssel:

- Preise vom **E-Control-Spritpreisrechner** (`_ec.js`), Routing über **OSRM**,
  Karte/Geocoding über **OpenStreetMap** (Leaflet als selbst gehostetes
  Vendor-Skript). Kartenkacheln laufen über einen **eigenen Same-Origin-Proxy**
  (`functions/sprit/tiles/…`) — die CSP erlaubt `connect-src 'self'`, also darf
  die Seite gar nicht direkt zu `tile.openstreetmap.org`. Der Proxy liegt
  bewusst **nicht** unter `/api/` (dort erzwingen die Header `no-store`) und
  cacht die Kacheln einen Tag lang. Adress-Suche über **Nominatim** mit
  dauerhaftem D1-Cache (`geo_cache`, geteilt mit der Feuerwehr-App), auch
  Fehltreffer werden gemerkt — fair use gegenüber einem gratis Dienst.
- **Favoriten**, **Preis-Alarm** per Web-Push (Ziel-Preis je Kraftstoff),
  **Preisverlauf-Sparkline** und Filter **„nur offene"**.
- Eigener **Cron** auf `/api/sprit/cron` (ebenfalls per `CRON_TOKEN` geschützt,
  vom `philip-stack-rt`-Worker angepingt): prüft die abonnierten Alarme und
  protokolliert den Preisverlauf (`sprit_price_log`).

Beide Apps teilen den zentralen **Web-Push-Mechanismus** (`/api/push`, VAPID-
„Tickle"), haben aber ihren eigenen Service Worker und ihr eigenes Manifest.
Insgesamt gibt es **vier installierbare PWAs** (vier Manifeste: Hub,
Kochstudio, Sprit-Radar, Feuerwehr) und **drei Service Worker** — Kochstudio
und Briefing haben ein eigenes App-Icon, laufen aber im Cache des Hub-SW. Android friert die Farbe der Statusleiste **je Installation**
ein (aus dem Manifest, nicht aus dem laufenden Hell/Dunkel-Modus), daher steht
dort eine gedämpfte Kompromissfarbe, die in beiden Modi trägt.

Alle drei Crons hängen am selben `scheduled`-Handler des Workers
`philip-stack-rt` (alle 2 min): er pingt `/api/fire/cron`, `/api/sprit/cron`
und `/api/briefing/cron` mit dem `x-cron-key`. Cloudflare Pages kann selbst
keine Cron-Trigger — deshalb der Umweg über den Worker.

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
  geschützt per `ADMIN_TOKEN`). Client-Meldungen liegen in einer **eigenen
  Tabelle** (`client_log`, Migration 0010): vorher teilten sie sich `error_log`
  mit echten Server-Fehlern, und der 1000-Zeilen-Trim hätte sich mit genug
  Fake-Meldungen zum Verdrängen echter Fehler missbrauchen lassen.
- **Namen werden vor dem Spiel geprüft** (`/api/name`): Form und Eigentum, damit
  niemand erst nach dem ersten Punktestand erfährt, dass der Name vergeben ist.
  Die Antwort sagt nur *ob* ein Name frei ist, **nie wem** er gehört. Die
  Prüfung ist bewusst **fehlertolerant** (ohne Datenbank oder bei Netzfehler
  gilt der Name als frei) — verbindlich entschieden wird beim Einsenden, wo die
  Abfrage ohnehin noch einmal läuft.
- **Betriebszustand an einer Stelle** (`_ops.js`): Ampel im Panel und der
  Push-Alarm werten dieselben Bedingungen aus. Statuswechsel landen in
  `ops_log` — nur der Wechsel, nicht jeder Cron-Lauf.

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
│   └── 0002…0013_*.sql        additive Änderungen: draw_score-Gerät, fire_alert-Arten/Geo,
│                              sprit_alert/-price_log, quiz_score, live_room+admin_log (0009),
│                              client_log getrennt (0010), stat_daily (0011), ops_log (0012),
│                              briefing (0013). Anwenden: wrangler d1 migrations apply wuerfelpoker --remote
├── reset-dev.sql              ⚠️ nur lokal: setzt Würfelpoker-Tabellen zurück (enthält DROPs)
├── schema.sql                 nur noch Hinweis-Datei (zeigt auf migrations/)
├── public/                    statische Spiele (1 Ordner = 1 Spiel)
│   ├── index.html             Landing Page: App-Karten, Werkzeuge, Suche, Challenge,
│   │                          Begrüßung beim ersten Besuch (Namensabfrage)
│   ├── games.js               zentrale Spiele-Registry (Quelle für Startseite/Profil/Party)
│   ├── theme.js               Hell/Dunkel + Energiesparen + SW-Registrierung + Fehler-Melder
│   ├── shared.js              gemeinsame Spiele-Schicht (Scores, Name, Meilensteine, Skins, Sound, Teilen, Cloud-Sync)
│   ├── qr.js                  eigenständiger QR-Code-Encoder (Beitritt/Sync teilen)
│   ├── _headers               Security-Header (CSP, HSTS, nosniff, …)
│   ├── styles/core.css        gemeinsames Design-Fundament ("Midnight Felt"): Tokens,
│   │                          Topbar, Overlays, Bestenliste, [hidden]-Regel
│   ├── fonts/                 selbst gehostete Schriften (Fraunces, Outfit) — kein Google-Fonts-CDN
│   ├── profil/                Spieler-Profil & Hub (Avatar, Level, Rahmen, Cloud, Freunde, Push, bester Weltrang)
│   ├── admin/                 privates Betreiber-Dashboard (noindex, Schlüssel via ADMIN_TOKEN)
│   ├── party/                 Spieleabend-Raum (Räume, Live-Rangliste)
│   ├── saison/                Saison & Liga (wöchentliche Gesamtwertung)
│   ├── impressum/             Impressum (§ 5 ECG / § 25 MedienG)
│   ├── datenschutz/           Datenschutzerklärung (DSGVO)
│   ├── kochstudio/            KI-Kochstudio (eigenes Manifest, Hub-SW)
│   ├── briefing/              Tages-Briefing (privat, Schlüssel wie /admin/)
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
│   ├── flatterfink/           One-Touch-Flatter-Arcade
│   ├── schlange/              Slither-Arena mit KI-Gegnern
│   ├── kritzeln/              Echtzeit: einer malt, alle raten
│   ├── quiz/                  Echtzeit-Live-Trivia ("Wer weiß's?")
│   ├── wumms/                 Comic-Block-Puzzle mit Tier-Helden
│   ├── meeri/                 Merge-Idle mit Meerschweinchen (MEERI-MANIA)
│   ├── fire/noe/              eigenständige App: Feuerwehr-NÖ-Einsatzmonitor (eigener sw.js, Scope /fire/noe/)
│   └── tanken/                eigenständige App: Sprit-Radar AT (eigener sw.js, Scope /tanken/, Leaflet-Vendor)
├── functions/api/             Cloudflare Pages Functions
│   ├── _util.js               gemeinsame Helfer (json, Codes, Spiel laden, Client-IP,
│   │                          Rate-Limit, Namensregeln + Namens-Eigentum)
│   ├── _gamemeta.js           gewertete Spiele (eine Quelle für Saison + Bestenlisten)
│   ├── _ops.js                Betriebszustand: was „Achtung" heißt (Ampel + Alarm)
│   ├── _cf.js                 Cloudflare-Analytics/Kontingente (GraphQL + REST, 10 min Cache)
│   ├── _ws.js                 gemeinsamer WebSocket-Upgrade-Proxy zu den Raum-DOs
│   ├── name.js                Namensprüfung für die Begrüßung (Form + frei?)
│   ├── stat.js                anonyme Nutzungszähler (stat_daily) + bumpStat()
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
│   ├── kritzeln-live.js / -scores.js   Kritzeln: WS-Upgrade + dauerhafte Bestenliste
│   ├── quiz-live.js / -scores.js       Quiz: WS-Upgrade + dauerhafte Bestenliste
│   ├── briefing/              Tages-Briefing: _gen.js (erzeugen+prüfen), cron.js, index.js (lesen)
│   ├── fire/                  Feuerwehr-NÖ: noe.js (Quelle), geo/_bezirk (Geocoding), alert.js (Abos), cron.js, stats.js
│   └── sprit/                 Sprit-Radar: near/route/suggest (Preise+Routing), _ec.js (E-Control),
│                              _geo.js (Nominatim+Cache), alert.js, cron.js, _logic.js
├── functions/sprit/tiles/     Same-Origin-Proxy für OSM-Kacheln (außerhalb /api/, 1 Tag Cache)
├── tests/                     Node-Tests: Syntax (inkl. worker-rt), Qualität/A11y, QR,
│                              Scores/Cloud/Party/Saison/Push/Stat/Name-API, Flow-E2E,
│                              WUMMS/MEERI/Kritzeln/Quiz/Raum-Basis, Fire-Cron, Health,
│                              Ops, Cloudflare-Zahlen, Briefing, Kochstudio,
│                              admin-ui (Panel-Skript in node:vm gegen DOM-Stub)
├── scripts/
│   └── bump-assets.mjs        Cache-Busting: setzt ?v=<Inhaltshash> für lokale JS/CSS (npm run bump; CI prüft mit --check)
├── worker-rt/                 separater Worker: Echtzeit-Durable-Objects (PartyRoom/DrawRoom/
│                              QuizRoom), base-room.js (gemeinsame Raum-Basis, in Node testbar),
│                              rt-db.js (D1-Helfer), draw-logic.js/quiz-logic.js
│                              + Cron (*/2 min) → pingt /api/fire/cron, /api/sprit/cron
│                              und /api/briefing/cron (x-cron-key: CRON_TOKEN)
├── lighthouserc.json          Lighthouse-Budget (Performance/A11y/Best-Practices/SEO)
└── .github/workflows/
    ├── ci.yml                 CI: führt `npm test` bei jedem Push aus
    └── lighthouse.yml         Lighthouse-Budget-Check (nicht blockierend)
```

Tests lokal ausführen: `npm test` (Node ≥ 22). Nach jeder Änderung an geteiltem
JS/CSS `npm run bump` ausführen (setzt inhaltsbasierte `?v=`-Hashes); die CI prüft
das mit `--check` und schlägt fehl, wenn ein Bump vergessen wurde.

**Design-Konvention:** Das gemeinsame Fundament liegt in
`public/styles/core.css` — Design-Tokens, Topbar, Overlays, Bestenlisten-Optik
und Regeln, die überall gelten müssen (etwa `[hidden]`, das sonst gegen jede
eigene `display`-Regel verliert). Davor waren Tokens und Topbar in jede Seite
kopiert und drifteten frei auseinander. Regel für neue Seiten: `core.css`
einbinden und nur die eigene Akzentfarbe (`--accent`) setzen.

Was **spiel-spezifisch** ist, bleibt im jeweiligen `style.css`: Spielbrett, HUD
und vor allem die eigene Palette — die Themes sind bewusst unterschiedlich
(Kritzeln orange, Neon-Schlange grün, Würfelpoker/Funkelfeld gold), das soll
core.css nicht einebnen. Universelle Primitive rund um Verhalten (Hell/Dunkel,
Reduced-Motion, Energiesparen, Fokusring) liegen in `theme.js`, Schriften in
`fonts/fonts.css`.

Übernommen haben core.css bisher die Hub-Seiten; `/tanken/`, `/fire/noe/` und
`/wuerfelpoker/` sind noch Ausreißer mit eigenem Fundament — bewusst nicht
nachgezogen, weil ein Umbau dort mehr Risiko als Nutzen wäre.

Jedes Spiel ist bewusst **selbst enthalten**: ein Ordner mit `index.html`,
`app.js`, `style.css` — kein Framework, kein Bundler. Die Spiele rendern
auf Canvas (Komet, Sternensturm, Galopp) bzw. DOM (Würfelpoker, Funkelfeld)
und teilen sich das „Midnight Felt“-Design-System (Fraunces + Outfit,
Gold-Folie, dunkle Karten-Optik).

## Betrieb & Deployment

Das Projekt hat **keine Git-Integration** bei Cloudflare: ein `git push`
veröffentlicht **nichts**. Live schalten und Code sichern sind zwei getrennte
Schritte.

```bash
npm test                                  # muss grün sein
npm run bump                              # ?v=-Hashes aktualisieren
npx wrangler pages deploy public --project-name philip-stack --branch main
cd worker-rt && npx wrangler deploy       # nur bei Änderungen an Echtzeit/Cron
npx wrangler d1 migrations apply wuerfelpoker --remote   # nur bei neuer Migration
```

Beim Ändern der `SHELL`-Liste **oder** einer vorab gecachten Datei die
`CACHE`-Version in `public/sw.js` hochzählen — sonst bekommen installierte PWAs
weiter die alte Seite aus dem Cache. Die drei Service Worker (`public/sw.js`,
`public/tanken/sw.js`, `public/fire/noe/sw.js`) zählen unabhängig voneinander.

**Secrets** liegen ausschließlich als Pages-Secrets (nie im Repo), gesetzt mit
`npx wrangler pages secret put <NAME> --project-name philip-stack`:

| Secret | Wofür | Ohne das Secret |
|---|---|---|
| `ADMIN_TOKEN` | Betriebs-Panel + Briefing-API | `401`, Panel gesperrt |
| `SCORE_SECRET` | HMAC der Lauf-Token (Anti-Cheat) | Einsendungen scheitern |
| `CRON_TOKEN` | schützt die Cron-Routen | Crons laufen nicht |
| `VAPID_PRIVATE_JWK` | Web-Push-Signatur | kein Push |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | Cloudflare-Zahlen im Panel | Panel fragt nicht, Rest läuft |

Der Worker `philip-stack-rt` ist ein eigenes Projekt und teilt die
Pages-Secrets **nicht**: `CRON_TOKEN` dort separat setzen
(`npx wrangler secret put CRON_TOKEN -c worker-rt/wrangler.toml`). Seine
Bindings (dieselbe D1, die DO-Klassen, der Cron-Trigger) stehen in
`worker-rt/wrangler.toml`.

**Gesundheitszustand:** `/api/health` (öffentlich, verrät keine Werte — nur ob
DB, Secrets und Bindings da sind). Mit `?require=cron` wird daraus ein **Dead
Man's Switch**: `503`, wenn der letzte Cron-Lauf zu lange her ist — dafür taugt
die Route als externer Wachhund.

## Ein neues Spiel hinzufügen

1. Ordner `public/<name>/` mit `index.html`, `app.js`, `style.css` anlegen
   (bestehendes Spiel als Vorlage kopieren).
2. Spiel in der **Registry** `public/games.js` eintragen (Name, Icon,
   Beschreibung, Bestenlisten-Schlüssel) — Startseite, Profil und Spieleabend-
   Raum übernehmen es automatisch.
3. Für eine Bestenliste **zwei** Stellen eintragen:
   - `functions/api/scores/[game].js` — Allowlist mit Score-Obergrenze und
     optionaler Plausibilitätsprüfung (keine neue Tabelle nötig),
   - `functions/api/_gamemeta.js` — die Liste der gewerteten Spiele für die
     Saison-Liga. **Wird das vergessen, zählt das Spiel in keiner Wochenwertung**
     — genau das war Neon-Schlange schon einmal passiert.

   Im Spiel `shared.js` einbinden und `GS.scoreFlow`/`GS.showLeaderboard`
   verwenden.
4. `public/styles/core.css` einbinden und `--accent` setzen, dann im eigenen
   `style.css` nur noch das Spiel-Eigene ergänzen.
5. Soll das Spiel offline starten, in die `SHELL`-Liste in `public/sw.js`
   aufnehmen **und die `CACHE`-Version dort hochzählen** — sonst behalten
   bestehende Installationen die alte Liste.
6. `npm run bump` (setzt die `?v=`-Hashes) und `npm test`.

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
