// ====================================================================
// Quiz-Duell — REINE Spiel-Logik (keine Durable-Object-/Runtime-Abhängigkeit).
// Ausgelagert aus dem QuizRoom, damit sie ohne laufenden Worker unit-testbar
// ist (tests/quiz.test.mjs). Der QuizRoom importiert diese Funktionen; hier
// steht NUR deterministische Logik + der Fragensatz.
//
// Konvention Fragensatz: die RICHTIGE Antwort steht immer an a[0] (c:0) —
// das macht das Autoren fehlerarm. Der QuizRoom mischt die Optionen pro Spiel
// über shuffleOptions(), damit die Lösung nicht immer an derselben Stelle steht.
// de-AT-Vokabular, bewusst eindeutige Fragen (keine strittigen Fakten).
// ====================================================================

export const Q_TURN = 20;    // Sekunden pro Frage
export const Q_REVEAL = 5;   // Auflösung anzeigen
export const Q_ROUNDS = 10;  // Standard-Fragenzahl
export const Q_ROUND_CHOICES = [5, 10, 15, 20];

// q = Frage, a = [richtig, falsch, falsch, falsch], c = Index der Lösung (immer 0).
export const Q_CATS = {
  allgemein: [
    { q: "Wie viele Minuten hat eine Stunde?", a: ["60", "100", "24", "360"], c: 0 },
    { q: "Welche Farbe ergibt Blau + Gelb?", a: ["Grün", "Orange", "Lila", "Braun"], c: 0 },
    { q: "Wie viele Beine hat eine Spinne?", a: ["8", "6", "4", "10"], c: 0 },
    { q: "Wie viele Tage hat ein Schaltjahr?", a: ["366", "365", "364", "367"], c: 0 },
    { q: "Welche Form hat ein Stoppschild?", a: ["Achteck", "Kreis", "Dreieck", "Quadrat"], c: 0 },
    { q: "Wie viele Ecken hat ein Würfel?", a: ["8", "6", "12", "4"], c: 0 },
    { q: "Was misst man mit einem Thermometer?", a: ["Temperatur", "Gewicht", "Länge", "Zeit"], c: 0 },
    { q: "Wie viele Farben hat ein Regenbogen (klassisch)?", a: ["7", "5", "6", "8"], c: 0 },
    { q: "Welches ist das größte Tier der Welt?", a: ["Blauwal", "Elefant", "Giraffe", "Nashorn"], c: 0 },
    { q: "Wie viele Kontinente gibt es?", a: ["7", "5", "6", "8"], c: 0 },
    { q: "Wie viele Sekunden hat eine Minute?", a: ["60", "100", "30", "90"], c: 0 },
    { q: "Welches Symbol hat das Element Gold?", a: ["Au", "Go", "Ag", "Gd"], c: 0 },
    { q: "Wie viele Seiten hat ein Dreieck?", a: ["3", "4", "5", "6"], c: 0 },
    { q: "Wie viele Monate hat ein Jahr?", a: ["12", "10", "11", "13"], c: 0 },
    { q: "Welche Farbe entsteht aus Rot + Weiß?", a: ["Rosa", "Grau", "Orange", "Violett"], c: 0 },
    { q: "Wie viele Karten hat ein Poker-Kartenspiel (ohne Joker)?", a: ["52", "32", "36", "54"], c: 0 },
  ],
  geografie: [
    { q: "Hauptstadt von Frankreich?", a: ["Paris", "Lyon", "Marseille", "Nizza"], c: 0 },
    { q: "Hauptstadt von Italien?", a: ["Rom", "Mailand", "Venedig", "Neapel"], c: 0 },
    { q: "Hauptstadt von Japan?", a: ["Tokio", "Kyoto", "Osaka", "Peking"], c: 0 },
    { q: "Hauptstadt von Spanien?", a: ["Madrid", "Barcelona", "Sevilla", "Valencia"], c: 0 },
    { q: "Auf welchem Kontinent liegt Ägypten?", a: ["Afrika", "Asien", "Europa", "Südamerika"], c: 0 },
    { q: "Welches ist das flächengrößte Land der Erde?", a: ["Russland", "Kanada", "China", "USA"], c: 0 },
    { q: "Hauptstadt von Deutschland?", a: ["Berlin", "München", "Hamburg", "Köln"], c: 0 },
    { q: "Welcher Ozean ist der größte?", a: ["Pazifik", "Atlantik", "Indischer", "Arktischer"], c: 0 },
    { q: "In welchem Land steht der Eiffelturm?", a: ["Frankreich", "Italien", "Spanien", "Belgien"], c: 0 },
    { q: "Hauptstadt von Griechenland?", a: ["Athen", "Thessaloniki", "Sparta", "Patras"], c: 0 },
    { q: "Hauptstadt der Schweiz?", a: ["Bern", "Zürich", "Genf", "Basel"], c: 0 },
    { q: "Wie heißt der höchste Berg der Welt?", a: ["Mount Everest", "K2", "Mont Blanc", "Kilimandscharo"], c: 0 },
    { q: "Hauptstadt von Großbritannien?", a: ["London", "Manchester", "Liverpool", "Oxford"], c: 0 },
    { q: "Auf welchem Kontinent liegt Brasilien?", a: ["Südamerika", "Afrika", "Asien", "Europa"], c: 0 },
    { q: "Welches Land hat die Form eines Stiefels?", a: ["Italien", "Spanien", "Griechenland", "Portugal"], c: 0 },
    { q: "Hauptstadt der USA?", a: ["Washington, D.C.", "New York", "Los Angeles", "Chicago"], c: 0 },
  ],
  natur: [
    { q: "Welches Säugetier legt Eier?", a: ["Schnabeltier", "Delfin", "Fledermaus", "Wal"], c: 0 },
    { q: "Wie viele Beine hat ein Insekt?", a: ["6", "8", "4", "10"], c: 0 },
    { q: "Welcher Baum trägt Eicheln?", a: ["Eiche", "Birke", "Ahorn", "Buche"], c: 0 },
    { q: "Was stellen Bienen her?", a: ["Honig", "Milch", "Seide", "Butter"], c: 0 },
    { q: "Welches ist das schnellste Landtier?", a: ["Gepard", "Löwe", "Pferd", "Gazelle"], c: 0 },
    { q: "Wie nennt man ein Frosch-Baby?", a: ["Kaulquappe", "Larve", "Kitz", "Welpe"], c: 0 },
    { q: "Welches Gas atmen Menschen zum Leben ein?", a: ["Sauerstoff", "Kohlendioxid", "Stickstoff", "Helium"], c: 0 },
    { q: "Wie viele Herzen hat ein Krake?", a: ["3", "1", "2", "4"], c: 0 },
    { q: "Was frisst ein Panda hauptsächlich?", a: ["Bambus", "Fleisch", "Fisch", "Gras"], c: 0 },
    { q: "Welcher Vogel kann nicht fliegen?", a: ["Pinguin", "Adler", "Spatz", "Taube"], c: 0 },
    { q: "Wie nennt man versteinerte Überreste von Lebewesen?", a: ["Fossilien", "Mineralien", "Kristalle", "Erze"], c: 0 },
    { q: "Welches Tier hat einen besonders langen Hals?", a: ["Giraffe", "Elefant", "Nashorn", "Kamel"], c: 0 },
  ],
  wissenschaft: [
    { q: "Welcher Planet ist der Sonne am nächsten?", a: ["Merkur", "Venus", "Erde", "Mars"], c: 0 },
    { q: "Welches Element hat das Symbol O?", a: ["Sauerstoff", "Gold", "Osmium", "Wasserstoff"], c: 0 },
    { q: "Wie viele Planeten hat unser Sonnensystem?", a: ["8", "9", "7", "10"], c: 0 },
    { q: "Was ist H₂O?", a: ["Wasser", "Salz", "Zucker", "Luft"], c: 0 },
    { q: "Wer entwickelte die Relativitätstheorie?", a: ["Einstein", "Newton", "Darwin", "Tesla"], c: 0 },
    { q: "Welcher Planet heißt „der rote Planet\"?", a: ["Mars", "Jupiter", "Venus", "Saturn"], c: 0 },
    { q: "Welches Material zieht ein Magnet an?", a: ["Eisen", "Holz", "Glas", "Plastik"], c: 0 },
    { q: "Welches Organ pumpt das Blut?", a: ["Herz", "Lunge", "Leber", "Niere"], c: 0 },
    { q: "Woraus besteht die Sonne hauptsächlich?", a: ["Wasserstoff", "Sauerstoff", "Eisen", "Gestein"], c: 0 },
    { q: "Was entsteht, wenn Wasser gefriert?", a: ["Eis", "Dampf", "Nebel", "Rauch"], c: 0 },
    { q: "Wie nennt man Tiere, die Fleisch fressen?", a: ["Fleischfresser", "Pflanzenfresser", "Allesfresser", "Aasfresser"], c: 0 },
    { q: "Wie schnell ist ungefähr das Licht?", a: ["300.000 km/s", "300 km/s", "3.000 km/s", "30 km/s"], c: 0 },
    { q: "Wie viele Zähne hat ein erwachsener Mensch normalerweise?", a: ["32", "28", "30", "36"], c: 0 },
    { q: "Welches dieser Tiere ist ein Wirbeltier?", a: ["Hund", "Qualle", "Regenwurm", "Krake"], c: 0 },
    { q: "Was misst die Einheit „Volt\"?", a: ["Spannung", "Gewicht", "Temperatur", "Zeit"], c: 0 },
    { q: "Welcher Teil der Pflanze nimmt Wasser aus dem Boden auf?", a: ["Wurzel", "Blüte", "Blatt", "Frucht"], c: 0 },
  ],
  geschichte: [
    { q: "Wer war der erste Mensch am Mond?", a: ["Neil Armstrong", "Buzz Aldrin", "Juri Gagarin", "Michael Collins"], c: 0 },
    { q: "In welchem Jahr fiel die Berliner Mauer?", a: ["1989", "1961", "1991", "1979"], c: 0 },
    { q: "Welches Volk baute die Pyramiden von Gizeh?", a: ["Ägypter", "Römer", "Griechen", "Maya"], c: 0 },
    { q: "Wer schrieb „Hamlet\"?", a: ["Shakespeare", "Goethe", "Mozart", "Dante"], c: 0 },
    { q: "Wie hieß das Schiff, das 1912 sank?", a: ["Titanic", "Lusitania", "Bismarck", "Mayflower"], c: 0 },
    { q: "Welches Reich baute das Kolosseum?", a: ["Römisches Reich", "Griechenland", "Ägypten", "Osmanen"], c: 0 },
    { q: "Wann begann der Erste Weltkrieg?", a: ["1914", "1918", "1939", "1905"], c: 0 },
    { q: "Welche war eine berühmte ägyptische Königin?", a: ["Kleopatra", "Viktoria", "Elisabeth", "Maria Theresia"], c: 0 },
    { q: "Welches Land schenkte den USA die Freiheitsstatue?", a: ["Frankreich", "England", "Spanien", "Italien"], c: 0 },
    { q: "Wer erreichte 1492 Amerika?", a: ["Kolumbus", "Magellan", "Marco Polo", "Vasco da Gama"], c: 0 },
    { q: "Welches Bauwerk steht in China?", a: ["Chinesische Mauer", "Kolosseum", "Taj Mahal", "Big Ben"], c: 0 },
    { q: "Womit schrieb man im Mittelalter oft?", a: ["Gänsefeder", "Kugelschreiber", "Bleistift", "Füller"], c: 0 },
  ],
  sport: [
    { q: "Wie viele Fußballspieler stehen pro Team am Feld?", a: ["11", "9", "10", "12"], c: 0 },
    { q: "In welchem Sport gibt es einen „Slam Dunk\"?", a: ["Basketball", "Tennis", "Fußball", "Golf"], c: 0 },
    { q: "Wie viele Ringe hat das olympische Symbol?", a: ["5", "4", "6", "3"], c: 0 },
    { q: "In welchem Sport ist Lionel Messi berühmt?", a: ["Fußball", "Basketball", "Tennis", "Formel 1"], c: 0 },
    { q: "Wie lang ist ein Marathon ungefähr?", a: ["42 km", "21 km", "10 km", "100 km"], c: 0 },
    { q: "Welcher Sport wird in Wimbledon gespielt?", a: ["Tennis", "Golf", "Cricket", "Rugby"], c: 0 },
    { q: "Womit wird beim Eishockey gespielt?", a: ["Puck", "Ball", "Feder", "Ring"], c: 0 },
    { q: "In welchem Sport gibt es einen „Strike\"?", a: ["Bowling", "Fußball", "Schwimmen", "Reiten"], c: 0 },
    { q: "Wie viele Basketballspieler stehen pro Team am Feld?", a: ["5", "6", "7", "4"], c: 0 },
    { q: "Wie sieht die Zielflagge im Motorsport aus?", a: ["Schwarz-weiß kariert", "Rot", "Grün", "Blau"], c: 0 },
    { q: "Wie oft finden die Olympischen Sommerspiele statt?", a: ["Alle 4 Jahre", "Jedes Jahr", "Alle 2 Jahre", "Alle 5 Jahre"], c: 0 },
    { q: "Was ruft man beim Golf zur Warnung?", a: ["Fore", "Out", "Fault", "Time"], c: 0 },
    { q: "Wie viele Löcher hat eine Standard-Golfrunde?", a: ["18", "9", "12", "24"], c: 0 },
    { q: "In welchem Land ist Sumo-Ringen zu Hause?", a: ["Japan", "China", "Korea", "Thailand"], c: 0 },
    { q: "Wie viele Punkte bringt ein Touchdown im American Football?", a: ["6", "3", "7", "2"], c: 0 },
    { q: "Welche Sportart spielt man mit Schläger und Federball?", a: ["Badminton", "Tennis", "Squash", "Tischtennis"], c: 0 },
  ],
  kultur: [
    { q: "Wer komponierte die „Kleine Nachtmusik\"?", a: ["Mozart", "Beethoven", "Bach", "Haydn"], c: 0 },
    { q: "Wie heißt der Zauberschüler aus J. K. Rowlings Büchern?", a: ["Harry Potter", "Frodo", "Percy", "Bilbo"], c: 0 },
    { q: "Welches Instrument hat 88 Tasten?", a: ["Klavier", "Gitarre", "Geige", "Harfe"], c: 0 },
    { q: "Wer malte die „Mona Lisa\"?", a: ["Leonardo da Vinci", "Picasso", "Van Gogh", "Michelangelo"], c: 0 },
    { q: "Wie viele Saiten hat eine klassische Gitarre?", a: ["6", "4", "5", "7"], c: 0 },
    { q: "In welchem Film heißt es „Möge die Macht mit dir sein\"?", a: ["Star Wars", "Star Trek", "Herr der Ringe", "Avatar"], c: 0 },
    { q: "Welche Band sang „Hey Jude\"?", a: ["The Beatles", "Rolling Stones", "Queen", "ABBA"], c: 0 },
    { q: "Wer schrieb „Faust\"?", a: ["Goethe", "Schiller", "Kafka", "Mann"], c: 0 },
    { q: "Wie heißt Micky Maus' Hund?", a: ["Pluto", "Goofy", "Rex", "Bello"], c: 0 },
    { q: "Welches ist ein Blechblasinstrument?", a: ["Trompete", "Geige", "Klavier", "Flöte"], c: 0 },
    { q: "Aus welchem Land kommt die Band ABBA?", a: ["Schweden", "Norwegen", "England", "USA"], c: 0 },
    { q: "Wer schrieb „Romeo und Julia\"?", a: ["Shakespeare", "Goethe", "Molière", "Ibsen"], c: 0 },
  ],
  oesterreich: [
    { q: "Was ist die Hauptstadt von Österreich?", a: ["Wien", "Graz", "Linz", "Salzburg"], c: 0 },
    { q: "Welcher Fluss fließt durch Wien?", a: ["Donau", "Inn", "Salzach", "Mur"], c: 0 },
    { q: "Wie heißt der höchste Berg Österreichs?", a: ["Großglockner", "Wildspitze", "Dachstein", "Watzmann"], c: 0 },
    { q: "Welche Mehlspeise ist typisch österreichisch?", a: ["Sachertorte", "Schwarzwälder", "Tiramisu", "Baklava"], c: 0 },
    { q: "Wie viele Bundesländer hat Österreich?", a: ["9", "8", "10", "7"], c: 0 },
    { q: "Welcher Komponist wurde in Salzburg geboren?", a: ["Mozart", "Beethoven", "Strauß", "Haydn"], c: 0 },
    { q: "Wie heißt Österreichs Währung heute?", a: ["Euro", "Schilling", "Krone", "Franken"], c: 0 },
    { q: "Welches Tier ist im österreichischen Wappen?", a: ["Adler", "Löwe", "Bär", "Pferd"], c: 0 },
    { q: "Welcher See liegt im Salzkammergut?", a: ["Wolfgangsee", "Bodensee", "Gardasee", "Genfersee"], c: 0 },
    { q: "Wie heißt der Wiener Vergnügungspark mit dem Riesenrad?", a: ["Prater", "Oktoberfest", "Disneyland", "Europapark"], c: 0 },
    { q: "Welche Farben hat die österreichische Flagge?", a: ["Rot-Weiß-Rot", "Schwarz-Rot-Gold", "Blau-Weiß", "Rot-Weiß-Grün"], c: 0 },
    { q: "In welchem Bundesland liegt die Stadt Innsbruck?", a: ["Tirol", "Salzburg", "Kärnten", "Vorarlberg"], c: 0 },
  ],
  essen: [
    { q: "Woraus wird Wein gemacht?", a: ["Trauben", "Äpfel", "Gerste", "Hopfen"], c: 0 },
    { q: "Woraus wird Brot hauptsächlich gemacht?", a: ["Mehl", "Reis", "Zucker", "Erdäpfel"], c: 0 },
    { q: "Woraus macht man Pommes frites?", a: ["Erdäpfel", "Mais", "Reis", "Bohnen"], c: 0 },
    { q: "Welches Gewürz macht Speisen scharf?", a: ["Chili", "Zimt", "Vanille", "Basilikum"], c: 0 },
    { q: "Welches Heißgetränk wird aus Blättern gemacht?", a: ["Tee", "Kakao", "Cola", "Limonade"], c: 0 },
    { q: "Welche Nuss steckt in Marzipan?", a: ["Mandel", "Walnuss", "Haselnuss", "Erdnuss"], c: 0 },
    { q: "Was ist Mozzarella?", a: ["Käse", "Wurst", "Brot", "Gemüse"], c: 0 },
    { q: "Welche Frucht hat eine harte Schale mit Flüssigkeit innen?", a: ["Kokosnuss", "Melone", "Ananas", "Mango"], c: 0 },
    { q: "Was ist Sushi typischerweise?", a: ["Reis mit Fisch", "Nudeln mit Käse", "Brot mit Wurst", "Fleischspieß"], c: 0 },
    { q: "Welches Getränk enthält Koffein?", a: ["Kaffee", "Wasser", "Milch", "Apfelsaft"], c: 0 },
    { q: "Woraus wird Guacamole hauptsächlich gemacht?", a: ["Avocado", "Tomate", "Erbse", "Gurke"], c: 0 },
    { q: "Aus welchem Getreide wird Bier hauptsächlich gebraut?", a: ["Gerste", "Reis", "Mais", "Hafer"], c: 0 },
  ],
  film: [
    { q: "In welchem Film gibt es den Zauberer Gandalf?", a: ["Herr der Ringe", "Harry Potter", "Narnia", "Merlin"], c: 0 },
    { q: "Welche Firma machte „Der König der Löwen\"?", a: ["Disney", "Pixar", "DreamWorks", "Netflix"], c: 0 },
    { q: "Wie heißt der gesuchte Clownfisch?", a: ["Nemo", "Dory", "Marlin", "Bruce"], c: 0 },
    { q: "Welches grüne Wesen lebt in einem Sumpf?", a: ["Shrek", "Hulk", "Yoda", "Grinch"], c: 0 },
    { q: "Welcher Superheld hat Spinnenkräfte?", a: ["Spider-Man", "Batman", "Superman", "Iron Man"], c: 0 },
    { q: "Wie heißt die Eiskönigin in „Frozen\"?", a: ["Elsa", "Anna", "Belle", "Arielle"], c: 0 },
    { q: "Welches Studio steht für „Toy Story\"?", a: ["Pixar", "DreamWorks", "Illumination", "Ghibli"], c: 0 },
    { q: "Wie heißt der grüne Jedi-Meister in Star Wars?", a: ["Yoda", "Obi-Wan", "Anakin", "Luke"], c: 0 },
    { q: "In welchem Film fährt „Lightning McQueen\"?", a: ["Cars", "Turbo", "Speed", "Fast & Furious"], c: 0 },
    { q: "Wie heißt das Zaubererinternat bei Harry Potter?", a: ["Hogwarts", "Narnia", "Camelot", "Winterfell"], c: 0 },
    { q: "Welche Prinzessin verliert einen Schuh um Mitternacht?", a: ["Aschenputtel", "Schneewittchen", "Rapunzel", "Arielle"], c: 0 },
    { q: "Welcher Held trägt einen roten Umhang und ein „S\"?", a: ["Superman", "Batman", "Flash", "Thor"], c: 0 },
  ],
};
export const Q_CAT_KEYS = Object.keys(Q_CATS);

// Menschlich lesbares Label je Kategorie (für Client-Auswahl/Hinweis).
export const Q_CAT_LABELS = {
  allgemein: "Allgemein", geografie: "Geografie", natur: "Natur & Tiere",
  wissenschaft: "Wissenschaft", geschichte: "Geschichte", sport: "Sport",
  kultur: "Kultur", oesterreich: "Österreich", essen: "Essen & Trinken",
  film: "Film & Serien",
};

// Fragen-Pool aus gewählten Kategorien (leer = alle). Liefert die Frage-Objekte.
export function questionPool(cats) {
  const keys = (Array.isArray(cats) && cats.length) ? cats.filter(k => Q_CATS[k]) : Q_CAT_KEYS;
  const use = keys.length ? keys : Q_CAT_KEYS;
  const out = [];
  for (const k of use) for (const q of Q_CATS[k]) out.push(q);
  return out;
}

// n verschiedene Fragen zufällig ziehen (Objekt-Referenzen). rnd injizierbar.
export function pickQuestions(pool, n, rnd = Math.random) {
  const out = [], used = new Set(); let guard = 0;
  const cap = Math.min(n, pool.length);
  while (out.length < cap && guard++ < 2000) {
    const i = Math.floor(rnd() * pool.length);
    if (!used.has(i)) { used.add(i); out.push(pool[i]); }
  }
  return out;
}

// Optionen mischen (Fisher-Yates) und den neuen Index der Lösung zurückgeben.
// rnd injizierbar → deterministisch testbar. Verändert das Original NICHT.
export function shuffleOptions(question, rnd = Math.random) {
  const opts = question.a.slice();
  const correctText = question.a[question.c];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { options: opts, correct: opts.indexOf(correctText) };
}

// Punkte für eine Antwort: nur bei richtig. 100 Basis + Tempo-Bonus (früher =
// mehr, bis +100). Falsch/keine Antwort = 0.
export function answerGain({ remain, total = Q_TURN, correct }) {
  if (!correct) return 0;
  const speed = Math.round((Math.max(0, remain) / total) * 100);
  return 100 + speed;
}
