// Live match statistics derived from the event log: a ledger and rent history
// per property, income by source per player, and the distribution of rolls.
// Pure data: no DOM. The tracker is incremental so a long game costs nothing
// per frame; it also runs over a saved record's events in one pass.

const ROLL_MIN = 2, ROLL_MAX = 12;
export const EXPECTED_ROLLS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);

function hist() { return new Array(ROLL_MAX + 1).fill(0); }

export class StatsTracker {
  constructor(game) {
    this.game = game;
    this.n = 0;
    this.nameIndex = {};
    for (const s of game.board) this.nameIndex[s.name] = s.i;
    this.props = {};
    for (const s of game.board) if (s.price) this.props[s.i] = { landings: 0, rent: 0, rentBy: {}, ledger: [] };
    this.players = {};
    for (const p of game.players) this.players[p.id] = this.blankPlayer();
    this.match = { turns: 0, rolls: hist(), rollCount: 0, bought: 0, auctions: 0, trades: 0, bankIn: 0, bankOut: 0, between: 0, rent: 0, go: 0 };
  }
  blankPlayer() {
    return { rolls: hist(), rollCount: 0, turns: 0, made: { rent: {}, rentTotal: 0, go: 0, bank: 0, players: 0, total: 0 }, paid: { bank: 0, players: 0, total: 0 }, bought: 0, auctions: 0, trades: 0 };
  }
  player(id) { return this.players[id] || (this.players[id] = this.blankPlayer()); }
  ledger(i, round, text) {
    const pr = this.props[i];
    if (!pr) return;
    pr.ledger.push({ round, text });
    if (pr.ledger.length > 40) pr.ledger.shift();
  }
  name(id) { const p = this.game.player(id); return p ? p.name : id; }
  sq(i) { const s = this.game.board[i]; return s ? s.name : `#${i}`; }
  // money from the bank to a player
  fromBank(id, amount, kind) {
    const pl = this.player(id);
    if (kind === 'go') pl.made.go += amount; else pl.made.bank += amount;
    pl.made.total += amount;
    this.match.bankIn += amount;
    if (kind === 'go') this.match.go += amount;
  }
  toBank(id, amount) {
    const pl = this.player(id);
    pl.paid.bank += amount; pl.paid.total += amount;
    this.match.bankOut += amount;
  }
  between(from, to, amount, propertyIndex) {
    const a = this.player(from), b = this.player(to);
    a.paid.players += amount; a.paid.total += amount;
    if (propertyIndex != null && this.props[propertyIndex]) {
      b.made.rent[propertyIndex] = (b.made.rent[propertyIndex] || 0) + amount;
      b.made.rentTotal += amount;
      const pr = this.props[propertyIndex];
      pr.rent += amount;
      pr.rentBy[to] = (pr.rentBy[to] || 0) + amount;
      this.match.rent += amount;
    } else b.made.players += amount;
    b.made.total += amount;
    this.match.between += amount;
  }
  update() {
    const ev = this.game.events;
    for (; this.n < ev.length; this.n++) this.apply(ev[this.n]);
    return this;
  }
  apply(e) {
    const m = this.match, r = e.round;
    switch (e.type) {
      case 'turn_start': m.turns++; this.player(e.player).turns++; break;
      case 'roll': {
        if (e.purpose === 'utility card') break;
        const t = e.dice[0] + e.dice[1];
        if (t >= ROLL_MIN && t <= ROLL_MAX) { m.rolls[t]++; m.rollCount++; const pl = this.player(e.player); pl.rolls[t]++; pl.rollCount++; }
        break;
      }
      case 'move': if (this.props[e.to]) this.props[e.to].landings++; break;
      case 'pass_go': this.fromBank(e.player, e.amount, 'go'); break;
      case 'collect': case 'birthday_gift': case 'free_parking': this.fromBank(e.player, e.amount, 'bank'); break;
      case 'mortgage': this.fromBank(e.player, e.value, 'bank'); this.ledger(e.property, r, `${this.name(e.player)} mortgaged it for £${e.value}`); break;
      case 'unmortgage': this.toBank(e.player, e.cost); this.ledger(e.property, r, `${this.name(e.player)} unmortgaged it for £${e.cost}`); break;
      case 'sell_building': this.fromBank(e.player, e.refund, 'bank'); this.ledger(e.property, r, `${this.name(e.player)} sold a building (+£${e.refund}), level ${e.level}`); break;
      case 'build': this.toBank(e.player, e.cost); this.ledger(e.property, r, `${this.name(e.player)} built to level ${e.level} for £${e.cost}`); break;
      case 'build_depot': this.toBank(e.player, e.cost); this.ledger(e.property, r, `${this.name(e.player)} built a depot for £${e.cost}`); break;
      case 'purchase': this.toBank(e.player, e.price); m.bought++; this.player(e.player).bought++; this.ledger(e.property, r, `Bought by ${this.name(e.player)} for £${e.price}`); break;
      case 'auction_won': this.toBank(e.player, e.price); m.bought++; m.auctions++; this.player(e.player).auctions++; this.ledger(e.property, r, `Won at auction by ${this.name(e.player)} for £${e.price}`); break;
      case 'jail_fine_paid': this.toBank(e.player, e.amount); break;
      case 'payment': {
        if (e.to === 'bank') { this.toBank(e.from, e.amount); break; }
        let pi = null;
        if (typeof e.reason === 'string' && e.reason.startsWith('rent for ')) { const i = this.nameIndex[e.reason.slice(9)]; if (i != null) pi = i; }
        this.between(e.from, e.to, e.amount, pi);
        break;
      }
      case 'bankrupt':
        if (e.creditor === 'bank') {
          if (e.cashHandedOver) this.toBank(e.player, e.cashHandedOver);
          for (const i of e.properties || []) this.ledger(i, r, `Returned to the bank when ${this.name(e.player)} went bankrupt`);
        }
        break;
      case 'assets_transferred':
        if (e.cash) this.between(e.from, e.to, e.cash, null);
        for (const i of e.properties || []) this.ledger(i, r, `Passed from ${this.name(e.from)} to ${this.name(e.to)} in bankruptcy`);
        break;
      case 'trade_completed': {
        m.trades++;
        this.player(e.from).trades++; this.player(e.to).trades++;
        const A = this.name(e.from), B = this.name(e.to);
        const gives = e.give.props.map((i) => this.sq(i)).concat(e.give.cash ? [`£${e.give.cash}`] : []).join(', ') || 'nothing';
        const gets = e.get.props.map((i) => this.sq(i)).concat(e.get.cash ? [`£${e.get.cash}`] : []).join(', ') || 'nothing';
        for (const i of e.give.props) this.ledger(i, r, `Traded by ${A} to ${B} for ${gets}`);
        for (const i of e.get.props) this.ledger(i, r, `Traded by ${B} to ${A} for ${gives}`);
        if (e.give.cash) this.between(e.from, e.to, e.give.cash, null);
        if (e.get.cash) this.between(e.to, e.from, e.get.cash, null);
        break;
      }
      default: break;
    }
  }
}

// Stats for a saved record (events + players + board) in one pass.
export function statsFor(game) { return new StatsTracker(game).update(); }

// Mean roll of a histogram, or null when empty.
export function meanRoll(h) {
  let n = 0, s = 0;
  for (let t = ROLL_MIN; t <= ROLL_MAX; t++) { n += h[t]; s += t * h[t]; }
  return n ? s / n : null;
}
