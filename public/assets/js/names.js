// Board editions for display: the same forty positions under other cities'
// names and currencies. The engine always plays the London board; a viewer
// chooses how to read it, and every name and amount on the page follows.
// Add an edition by giving all forty squares in board order (GO is 0).
import { makeBoard } from './board.js';

const london = makeBoard('standard').map((s) => s.name);

export const NAME_SETS = [
  { id: 'london', label: 'London', region: 'United Kingdom · the classic', currency: { symbol: '£' }, names: london },
  {
    id: 'us', label: 'Atlantic City', region: 'United States · the original', currency: { symbol: '$' },
    names: ['GO', 'Mediterranean Avenue', 'Community Chest', 'Baltic Avenue', 'Income Tax', 'Reading Railroad', 'Oriental Avenue', 'Chance', 'Vermont Avenue', 'Connecticut Avenue',
      'Jail / Just Visiting', 'St. Charles Place', 'Electric Company', 'States Avenue', 'Virginia Avenue', 'Pennsylvania Railroad', 'St. James Place', 'Community Chest', 'Tennessee Avenue', 'New York Avenue',
      'Free Parking', 'Kentucky Avenue', 'Chance', 'Indiana Avenue', 'Illinois Avenue', 'B. & O. Railroad', 'Atlantic Avenue', 'Ventnor Avenue', 'Water Works', 'Marvin Gardens',
      'Go To Jail', 'Pacific Avenue', 'North Carolina Avenue', 'Community Chest', 'Pennsylvania Avenue', 'Short Line', 'Chance', 'Park Place', 'Luxury Tax', 'Boardwalk'],
  },
  {
    id: 'paris', label: 'Paris', region: 'France', currency: { symbol: '€', after: true },
    names: ['Départ', 'Boulevard de Belleville', 'Caisse de communauté', 'Rue Lecourbe', 'Impôts sur le revenu', 'Gare Montparnasse', 'Rue de Vaugirard', 'Chance', 'Rue de Courcelles', 'Avenue de la République',
      'Prison / Simple visite', 'Boulevard de la Villette', 'Compagnie de distribution d’électricité', 'Avenue de Neuilly', 'Rue de Paradis', 'Gare de Lyon', 'Avenue Mozart', 'Caisse de communauté', 'Boulevard Saint-Michel', 'Place Pigalle',
      'Parc gratuit', 'Avenue Matignon', 'Chance', 'Boulevard Malesherbes', 'Avenue Henri-Martin', 'Gare du Nord', 'Faubourg Saint-Honoré', 'Place de la Bourse', 'Compagnie des eaux', 'Rue La Fayette',
      'Allez en prison', 'Avenue de Breteuil', 'Avenue Foch', 'Caisse de communauté', 'Boulevard des Capucines', 'Gare Saint-Lazare', 'Chance', 'Avenue des Champs-Élysées', 'Taxe de luxe', 'Rue de la Paix'],
  },
  {
    id: 'germany', label: 'Germany', region: 'the classic German board', currency: { symbol: '€', after: true },
    names: ['Los', 'Badstraße', 'Gemeinschaftsfeld', 'Turmstraße', 'Einkommensteuer', 'Südbahnhof', 'Chausseestraße', 'Ereignisfeld', 'Elisenstraße', 'Poststraße',
      'Gefängnis / Nur zu Besuch', 'Seestraße', 'Elektrizitätswerk', 'Hafenstraße', 'Neue Straße', 'Westbahnhof', 'Münchner Straße', 'Gemeinschaftsfeld', 'Wiener Straße', 'Berliner Straße',
      'Frei Parken', 'Theaterstraße', 'Ereignisfeld', 'Museumstraße', 'Opernplatz', 'Nordbahnhof', 'Lessingstraße', 'Schillerstraße', 'Wasserwerk', 'Goethestraße',
      'Gehen Sie in das Gefängnis', 'Rathausplatz', 'Hauptstraße', 'Gemeinschaftsfeld', 'Bahnhofstraße', 'Hauptbahnhof', 'Ereignisfeld', 'Parkstraße', 'Zusatzsteuer', 'Schloßallee'],
  },
  {
    id: 'italy', label: 'Italy', region: 'the classic Italian board (1930s Milan)', currency: { symbol: '€', after: true },
    names: ['Via!', 'Vicolo Corto', 'Probabilità', 'Vicolo Stretto', 'Tassa patrimoniale', 'Stazione Sud', 'Bastioni Gran Sasso', 'Imprevisti', 'Viale Monterosa', 'Viale Vesuvio',
      'Prigione / In visita', 'Via Accademia', 'Società Elettrica', 'Corso Ateneo', 'Piazza Università', 'Stazione Ovest', 'Via Verdi', 'Probabilità', 'Corso Raffaello', 'Piazza Dante',
      'Parcheggio gratuito', 'Via Marco Polo', 'Imprevisti', 'Corso Magellano', 'Largo Colombo', 'Stazione Nord', 'Viale Costantino', 'Viale Traiano', 'Società Acqua Potabile', 'Piazza Giulio Cesare',
      'Andate in prigione', 'Via Roma', 'Corso Impero', 'Probabilità', 'Largo Augusto', 'Stazione Est', 'Imprevisti', 'Viale dei Giardini', 'Tassa di lusso', 'Parco della Vittoria'],
  },
  {
    id: 'netherlands', label: 'Netherlands', region: 'the classic Dutch board, eight towns', currency: { symbol: '€', after: true },
    names: ['Start', 'Dorpsstraat (Ons Dorp)', 'Algemeen Fonds', 'Brink (Ons Dorp)', 'Inkomstenbelasting', 'Station Zuid', 'Steenstraat (Arnhem)', 'Kans', 'Ketelstraat (Arnhem)', 'Velperplein (Arnhem)',
      'Gevangenis / Op bezoek', 'Barteljorisstraat (Haarlem)', 'Elektriciteitsbedrijf', 'Zijlweg (Haarlem)', 'Houtstraat (Haarlem)', 'Station West', 'Neude (Utrecht)', 'Algemeen Fonds', 'Biltstraat (Utrecht)', 'Vreeburg (Utrecht)',
      'Vrij parkeren', 'A-Kerkhof (Groningen)', 'Kans', 'Grote Markt (Groningen)', 'Herestraat (Groningen)', 'Station Noord', 'Spui (Den Haag)', 'Plein (Den Haag)', 'Waterleiding', 'Lange Poten (Den Haag)',
      'Ga naar de gevangenis', 'Hofplein (Rotterdam)', 'Blaak (Rotterdam)', 'Algemeen Fonds', 'Coolsingel (Rotterdam)', 'Station Oost', 'Kans', 'Leidsestraat (Amsterdam)', 'Extra belasting', 'Kalverstraat (Amsterdam)'],
  },
  {
    id: 'world2008', label: 'World Edition', region: 'Here & Now, 2008 · cities chosen by vote', currency: { symbol: '$' },
    names: ['GO', 'Gdynia', 'Community Chest', 'Taipei', 'Income Tax', 'Monopoly Rail', 'Tokyo', 'Chance', 'Barcelona', 'Athens',
      'Jail / Just Visiting', 'Istanbul', 'Electric Company', 'Kyiv', 'Toronto', 'Monopoly Air', 'Rome', 'Community Chest', 'Shanghai', 'Vancouver',
      'Free Parking', 'Sydney', 'Chance', 'New York', 'London', 'Monopoly Cruise', 'Beijing', 'Hong Kong', 'Water Works', 'Jerusalem',
      'Go To Jail', 'Paris', 'Belgrade', 'Community Chest', 'Cape Town', 'Monopoly Space', 'Chance', 'Riga', 'Luxury Tax', 'Montreal'],
  },
];

export function nameSet(id) { return NAME_SETS.find((s) => s.id === id) || NAME_SETS[0]; }

// Money in the edition's currency: £200, $200, 200 €.
export function moneyIn(set, n) {
  const v = Math.round(Number(n) || 0).toLocaleString('en-GB');
  const c = set.currency || { symbol: '£' };
  return c.after ? `${v} ${c.symbol}` : `${c.symbol}${v}`;
}

// Hooks for a game object so the shared formatter reads the edition: the
// square names by position (standard board only), London names inside text,
// and amounts in the currency.
export function dressGame(game, set) {
  const standard = game.edition === 'standard' && Array.isArray(set.names) && set.names.length === game.board.length;
  if (standard) for (const s of game.board) s.name = set.names[s.i];
  const pairs = standard ? london.map((name, i) => [name, set.names[i]]).filter(([a, b]) => a !== b).sort((a, b) => b[0].length - a[0].length) : [];
  game.nameSet = set;
  game.fmtMoney = (n) => moneyIn(set, n);
  game.displayName = (name) => { const i = standard ? london.indexOf(name) : -1; return i >= 0 ? set.names[i] : name; };
  game.displayText = (text) => {
    if (typeof text !== 'string' || !text) return text;
    let out = text;
    for (const [a, b] of pairs) out = out.split(a).join(b);
    return out.replace(/£(\d[\d,]*)/g, (m, d) => moneyIn(set, Number(d.replace(/,/g, ''))));
  };
  return game;
}
