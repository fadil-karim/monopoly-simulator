// Board definitions: London edition (standard, 40 squares) and Mega edition (52 squares).
// Prices and rents in pounds. Rent arrays: [base, 1 house, 2, 3, 4, hotel].

const RENT = {
  '60a': [2, 10, 30, 90, 160, 250],
  '60b': [4, 20, 60, 180, 320, 450],
  '80': [4, 20, 60, 180, 320, 450],
  '100': [6, 30, 90, 270, 400, 550],
  '120': [8, 40, 100, 300, 450, 600],
  '140': [10, 50, 150, 450, 625, 750],
  '160': [12, 60, 180, 500, 700, 900],
  '180': [14, 70, 200, 550, 750, 950],
  '200': [16, 80, 220, 600, 800, 1000],
  '220': [18, 90, 250, 700, 875, 1050],
  '240': [20, 100, 300, 750, 925, 1100],
  '260': [22, 110, 330, 800, 975, 1150],
  '280': [24, 120, 360, 850, 1025, 1200],
  '300': [26, 130, 390, 900, 1100, 1275],
  '320': [28, 150, 450, 1000, 1200, 1400],
  '350': [35, 175, 500, 1100, 1300, 1500],
  '400': [50, 200, 600, 1400, 1700, 2000],
};

export const GROUPS = {
  brown: { name: 'Brown', colour: '#8b4513', houseCost: 50 },
  lightblue: { name: 'Light Blue', colour: '#87ceeb', houseCost: 50 },
  pink: { name: 'Pink', colour: '#d63384', houseCost: 100 },
  orange: { name: 'Orange', colour: '#f28c28', houseCost: 100 },
  red: { name: 'Red', colour: '#d7263d', houseCost: 150 },
  yellow: { name: 'Yellow', colour: '#f2d41e', houseCost: 150 },
  green: { name: 'Green', colour: '#1a9e4b', houseCost: 200 },
  darkblue: { name: 'Dark Blue', colour: '#1f4ea3', houseCost: 200 },
  station: { name: 'Stations', colour: '#444', houseCost: 0 },
  utility: { name: 'Utilities', colour: '#999', houseCost: 0 },
};

const st = (name, group, price, rentKey) => ({ type: 'street', name, group, price, rents: RENT[rentKey || String(price)], houseCost: GROUPS[group].houseCost });
const station = (name) => ({ type: 'station', name, group: 'station', price: 200 });
const utility = (name) => ({ type: 'utility', name, group: 'utility', price: 150 });
const sq = (type, name, extra = {}) => ({ type, name, ...extra });

export const STANDARD_BOARD = [
  sq('go', 'GO'),
  st('Old Kent Road', 'brown', 60, '60a'),
  sq('chest', 'Community Chest'),
  st('Whitechapel Road', 'brown', 60, '60b'),
  sq('tax', 'Income Tax', { amount: 200 }),
  station("King's Cross Station"),
  st('The Angel Islington', 'lightblue', 100),
  sq('chance', 'Chance'),
  st('Euston Road', 'lightblue', 100),
  st('Pentonville Road', 'lightblue', 120),
  sq('jail', 'Jail / Just Visiting'),
  st('Pall Mall', 'pink', 140),
  utility('Electric Company'),
  st('Whitehall', 'pink', 140),
  st('Northumberland Avenue', 'pink', 160),
  station('Marylebone Station'),
  st('Bow Street', 'orange', 180),
  sq('chest', 'Community Chest'),
  st('Marlborough Street', 'orange', 180),
  st('Vine Street', 'orange', 200),
  sq('freeparking', 'Free Parking'),
  st('Strand', 'red', 220),
  sq('chance', 'Chance'),
  st('Fleet Street', 'red', 220),
  st('Trafalgar Square', 'red', 240),
  station('Fenchurch Street Station'),
  st('Leicester Square', 'yellow', 260),
  st('Coventry Street', 'yellow', 260),
  utility('Water Works'),
  st('Piccadilly', 'yellow', 280),
  sq('gotojail', 'Go To Jail'),
  st('Regent Street', 'green', 300),
  st('Oxford Street', 'green', 300),
  sq('chest', 'Community Chest'),
  st('Bond Street', 'green', 320),
  station('Liverpool Street Station'),
  sq('chance', 'Chance'),
  st('Park Lane', 'darkblue', 350),
  sq('tax', 'Super Tax', { amount: 100 }),
  st('Mayfair', 'darkblue', 400),
];

// Mega edition: 13 squares a side. Extra streets per colour group (UK names from the
// Winning Moves Mega edition), a third utility (Gas Company), and the Auction,
// Bus Ticket and Birthday Gift action squares.
export const MEGA_BOARD = [
  sq('go', 'GO'),
  st('Old Kent Road', 'brown', 60, '60a'),
  sq('chest', 'Community Chest'),
  st('Whitechapel Road', 'brown', 60, '60b'),
  st('Elephant & Castle', 'brown', 80),
  sq('tax', 'Income Tax', { amount: 200 }),
  station("King's Cross Station"),
  st('The Angel Islington', 'lightblue', 100),
  sq('chance', 'Chance'),
  utility('Gas Company'),
  st('Euston Road', 'lightblue', 100),
  st('Edgware Road', 'lightblue', 100),
  st('Pentonville Road', 'lightblue', 120),
  sq('jail', 'Jail / Just Visiting'),
  sq('auction', 'Auction'),
  st('Pall Mall', 'pink', 140),
  utility('Electric Company'),
  st('Whitehall', 'pink', 140),
  st('Downing Street', 'pink', 140),
  st('Northumberland Avenue', 'pink', 160),
  station('Marylebone Station'),
  st('Bow Street', 'orange', 180),
  sq('chest', 'Community Chest'),
  st('Marlborough Street', 'orange', 180),
  st('High Holborn', 'orange', 200),
  st('Vine Street', 'orange', 200),
  sq('freeparking', 'Free Parking'),
  st('Strand', 'red', 220),
  sq('chance', 'Chance'),
  st('Fleet Street', 'red', 220),
  st('Trafalgar Square', 'red', 240),
  st('Aldwych', 'red', 240),
  station('Fenchurch Street Station'),
  st('Leicester Square', 'yellow', 260),
  st('Coventry Street', 'yellow', 260),
  utility('Water Works'),
  st('Piccadilly', 'yellow', 280),
  st('Shaftesbury Avenue', 'yellow', 280),
  sq('busticket', 'Bus Ticket'),
  sq('gotojail', 'Go To Jail'),
  st('Regent Street', 'green', 300),
  st('Savile Row', 'green', 300),
  st('Oxford Street', 'green', 300),
  sq('chest', 'Community Chest'),
  st('Bond Street', 'green', 320),
  station('Liverpool Street Station'),
  sq('birthday', 'Birthday Gift'),
  sq('chance', 'Chance'),
  st('Park Lane', 'darkblue', 350),
  st('Knightsbridge', 'darkblue', 350),
  sq('tax', 'Super Tax', { amount: 100 }),
  st('Mayfair', 'darkblue', 400),
];

export function makeBoard(edition) {
  const src = edition === 'mega' ? MEGA_BOARD : STANDARD_BOARD;
  const perSide = src.length / 4;
  return src.map((s, i) => ({ ...s, i, side: Math.floor(i / perSide) }));
}

export function groupMembers(board, group) {
  return board.filter((s) => s.group === group).map((s) => s.i);
}

// UK Chance cards. `fn` names are resolved by the engine.
export const CHANCE_CARDS = [
  { id: 'ch1', text: 'Advance to GO. Collect £200.', action: 'moveTo', target: 'go' },
  { id: 'ch2', text: 'Advance to Trafalgar Square. If you pass GO collect £200.', action: 'moveTo', target: 'Trafalgar Square' },
  { id: 'ch3', text: 'Advance to Mayfair.', action: 'moveTo', target: 'Mayfair' },
  { id: 'ch4', text: 'Advance to Pall Mall. If you pass GO collect £200.', action: 'moveTo', target: 'Pall Mall' },
  { id: 'ch5', text: 'Advance to the nearest Station. If unowned you may buy it from the Bank. If owned, pay the owner twice the rental.', action: 'nearestStation' },
  { id: 'ch6', text: 'Advance to the nearest Station. If unowned you may buy it from the Bank. If owned, pay the owner twice the rental.', action: 'nearestStation' },
  { id: 'ch7', text: 'Advance to the nearest Utility. If unowned you may buy it. If owned, throw the dice and pay the owner ten times the amount thrown.', action: 'nearestUtility' },
  { id: 'ch8', text: 'Bank pays you a dividend of £50.', action: 'collect', amount: 50 },
  { id: 'ch9', text: 'Get Out of Jail Free. This card may be kept until needed or traded.', action: 'jailCard' },
  { id: 'ch10', text: 'Go back three spaces.', action: 'back3' },
  { id: 'ch11', text: 'Go to Jail. Go directly to Jail. Do not pass GO. Do not collect £200.', action: 'gotoJail' },
  { id: 'ch12', text: 'Make general repairs on all your property: for each house pay £25, for each hotel pay £100.', action: 'repairs', house: 25, hotel: 100 },
  { id: 'ch13', text: 'Speeding fine £15.', action: 'pay', amount: 15 },
  { id: 'ch14', text: "Take a trip to King's Cross Station. If you pass GO collect £200.", action: 'moveTo', target: "King's Cross Station" },
  { id: 'ch15', text: 'You have been elected Chairman of the Board. Pay each player £50.', action: 'payEach', amount: 50 },
  { id: 'ch16', text: 'Your building loan matures. Collect £150.', action: 'collect', amount: 150 },
];

export const CHEST_CARDS = [
  { id: 'cc1', text: 'Advance to GO. Collect £200.', action: 'moveTo', target: 'go' },
  { id: 'cc2', text: 'Bank error in your favour. Collect £200.', action: 'collect', amount: 200 },
  { id: 'cc3', text: "Doctor's fee. Pay £50.", action: 'pay', amount: 50 },
  { id: 'cc4', text: 'From sale of stock you get £50.', action: 'collect', amount: 50 },
  { id: 'cc5', text: 'Get Out of Jail Free. This card may be kept until needed or traded.', action: 'jailCard' },
  { id: 'cc6', text: 'Go to Jail. Go directly to Jail. Do not pass GO. Do not collect £200.', action: 'gotoJail' },
  { id: 'cc7', text: 'Holiday fund matures. Receive £100.', action: 'collect', amount: 100 },
  { id: 'cc8', text: 'Income tax refund. Collect £20.', action: 'collect', amount: 20 },
  { id: 'cc9', text: 'It is your birthday. Collect £10 from every player.', action: 'collectEach', amount: 10 },
  { id: 'cc10', text: 'Life insurance matures. Collect £100.', action: 'collect', amount: 100 },
  { id: 'cc11', text: 'Pay hospital fees of £100.', action: 'pay', amount: 100 },
  { id: 'cc12', text: 'Pay school fees of £50.', action: 'pay', amount: 50 },
  { id: 'cc13', text: 'Receive £25 consultancy fee.', action: 'collect', amount: 25 },
  { id: 'cc14', text: 'You are assessed for street repairs: £40 per house, £115 per hotel.', action: 'repairs', house: 40, hotel: 115 },
  { id: 'cc15', text: 'You have won second prize in a beauty contest. Collect £10.', action: 'collect', amount: 10 },
  { id: 'cc16', text: 'You inherit £100.', action: 'collect', amount: 100 },
];

export const EDITION_INFO = {
  standard: {
    label: 'London (standard)',
    startingCash: 1500,
    houses: 32,
    hotels: 12,
    skyscrapers: 0,
    depots: 0,
    busTickets: 0,
  },
  mega: {
    label: 'London Mega edition',
    startingCash: 2500,
    houses: 32,
    hotels: 12,
    skyscrapers: 12,
    depots: 4,
    busTickets: 16,
  },
};
