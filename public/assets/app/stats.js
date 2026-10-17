// Live match statistics derived from the event log: every payment between the players and the bank, every trade
// offer and how it ended, the record of each property, income by source per player, and the distribution of rolls.
// Pure data: no DOM, and no names or amounts written into text, so a reader formats them in whichever edition and
// currency the board is read as. The tracker is incremental so a long game costs nothing per frame; it also runs
// over a saved record's events in one pass.
import { makeBoard } from './board.js';

const ROLL_MIN = 2, ROLL_MAX = 12;
export const EXPECTED_ROLLS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);
// What a payment was for. Every one has a payer and a payee, a player's id or 'bank'.
export const PAYMENT_KINDS = {
  rent: 'Rent', salary: 'Passing GO', tax: 'Tax', card: 'Card', repairs: 'Repairs', purchase: 'Purchase', auction: 'Auction',
  build: 'Building', sell: 'Building sold', mortgage: 'Mortgage', unmortgage: 'Unmortgage', jail: 'Jail fine', trade: 'Trade',
  bankruptcy: 'Bankruptcy', parking: 'Free Parking', gift: 'Birthday gift', other: 'Other',
};

function hist() { return new Array(ROLL_MAX + 1).fill(0); }
const offerOf = (o) => ({ props: (o && Array.isArray(o.props) ? o.props : []).map(Number), cash: (o && Number(o.cash)) || 0 });
// A proposal the rules refused carries the model's own words: { properties: [...], cash }.
const rawOffer = (o) => ({ props: (o && Array.isArray(o.properties) ? o.properties : []).map(Number).filter(Number.isFinite), cash: Math.max(0, Math.floor(Number(o && o.cash) || 0)) });

export class StatsTracker {
  constructor(game) {
    this.game = game;
    this.n = 0;
    // The engine plays the London board and writes London names into its events (a rent payment's reason, a tax);
    // they are looked up on the London board, whatever edition the game is read as.
    this.base = makeBoard(game.edition);
    this.nameIndex = {};
    for (const s of this.base) this.nameIndex[s.name] = s.i;
    this.taxNames = new Set(this.base.filter((s) => s.type === 'tax').map((s) => s.name));
    this.props = {};
    for (const s of this.base) {
      if (!s.price) continue;
      this.props[s.i] = {
        landings: 0, rent: 0, rentBy: {}, ledger: [],
        purchases: 0, auctions: 0, paid: 0, firstPrice: null, firstHow: null,
        builds: 0, buildSpend: 0, sales: 0, saleRefund: 0, maxLevel: 0,
        mortgages: 0, unmortgages: 0, unmortgageSpend: 0,
        trades: 0, handovers: 0, returns: 0, owners: [],
      };
    }
    this.level = {}; this.depot = {};
    this.players = {};
    for (const p of game.players) this.players[p.id] = this.blankPlayer();
    this.match = { turns: 0, rolls: hist(), rollCount: 0, bought: 0, auctions: 0, trades: 0, bankIn: 0, bankOut: 0, between: 0, rent: 0, go: 0, forfeits: 0, answerMs: 0, answers: 0 };
    this.payments = [];
    this.negotiations = [];
    this.open = null; // the negotiation under way
    this.card = null; // the text of the last card drawn this turn, so the payment it causes reads as the card's
  }
  blankPlayer() {
    // forfeits: the choices given up for want of a valid answer, by question; answerMs, answers and longestAnswerMs:
    // how long the table waited for its answers
    return { rolls: hist(), rollCount: 0, turns: 0, made: { rent: {}, rentTotal: 0, go: 0, bank: 0, players: 0, total: 0 }, paid: { bank: 0, players: 0, total: 0 }, bought: 0, auctions: 0, trades: 0, forfeits: 0, forfeitsBy: {}, answerMs: 0, answers: 0, longestAnswerMs: 0 };
  }
  player(id) { return this.players[id] || (this.players[id] = this.blankPlayer()); }
  // The deed's history of a property: what happened to it, newest last, the last forty kept.
  note(i, entry) {
    const pr = this.props[i];
    if (!pr) return;
    pr.ledger.push(entry);
    if (pr.ledger.length > 40) pr.ledger.shift();
  }
  owned(i, id) { const pr = this.props[i]; if (pr && id && !pr.owners.includes(id)) pr.owners.push(id); }
  pay(e, from, to, amount, kind, extra = {}) {
    if (!(amount > 0)) return;
    this.payments.push({ seq: e.seq, round: e.round, turn: e.turn, from, to, amount, kind, ...extra });
  }
  // money from the bank to a player
  fromBank(e, id, amount, kind, extra) {
    const pl = this.player(id);
    if (kind === 'salary') pl.made.go += amount; else pl.made.bank += amount;
    pl.made.total += amount;
    this.match.bankIn += amount;
    if (kind === 'salary') this.match.go += amount;
    this.pay(e, 'bank', id, amount, kind, extra);
  }
  toBank(e, id, amount, kind, extra) {
    const pl = this.player(id);
    pl.paid.bank += amount; pl.paid.total += amount;
    this.match.bankOut += amount;
    this.pay(e, id, 'bank', amount, kind, extra);
  }
  between(e, from, to, amount, kind, extra = {}) {
    const a = this.player(from), b = this.player(to);
    a.paid.players += amount; a.paid.total += amount;
    const i = kind === 'rent' ? extra.property : null;
    if (i != null && this.props[i]) {
      b.made.rent[i] = (b.made.rent[i] || 0) + amount;
      b.made.rentTotal += amount;
      const pr = this.props[i];
      pr.rent += amount;
      pr.rentBy[to] = (pr.rentBy[to] || 0) + amount;
      this.match.rent += amount;
    } else b.made.players += amount;
    b.made.total += amount;
    this.match.between += amount;
    this.pay(e, from, to, amount, kind, extra);
  }
  // A payment event's reason, read: rent for a square, a tax, a card, the jail fine or repairs.
  reasonOf(reason) {
    const r = typeof reason === 'string' ? reason : '';
    if (r.startsWith('rent for ')) { const i = this.nameIndex[r.slice(9)]; return { kind: 'rent', property: i != null ? i : null }; }
    if (r === 'jail fine') return { kind: 'jail' };
    if (r === 'repairs') return { kind: 'repairs' };
    if (this.taxNames.has(r)) return { kind: 'tax', text: r };
    if (this.card && r === this.card) return { kind: 'card', text: r };
    return { kind: 'other', text: r };
  }
  update() {
    const ev = this.game.events;
    for (; this.n < ev.length; this.n++) this.apply(ev[this.n]);
    return this;
  }
  negotiation(e, from, to) {
    const n = { seq: e.seq, round: e.round, turn: e.turn, from, to, steps: [], outcome: 'open', terms: null };
    this.negotiations.push(n);
    return n;
  }
  apply(e) {
    const m = this.match, r = e.round;
    switch (e.type) {
      case 'turn_start': m.turns++; this.player(e.player).turns++; this.card = null; break;
      case 'answer_time': { const q = this.player(e.player), ms = e.ms || 0; q.answerMs += ms; q.answers++; q.longestAnswerMs = Math.max(q.longestAnswerMs, ms); m.answerMs += ms; m.answers++; break; }
      case 'forfeit': { const q = this.player(e.player); q.forfeits++; q.forfeitsBy[e.decision] = (q.forfeitsBy[e.decision] || 0) + 1; m.forfeits++; break; }
      case 'roll': {
        if (e.purpose === 'utility card') break;
        const t = e.dice[0] + e.dice[1];
        if (t >= ROLL_MIN && t <= ROLL_MAX) { m.rolls[t]++; m.rollCount++; const pl = this.player(e.player); pl.rolls[t]++; pl.rollCount++; }
        break;
      }
      case 'move': if (this.props[e.to]) this.props[e.to].landings++; break;
      case 'card': this.card = e.text; break;
      case 'pass_go': this.fromBank(e, e.player, e.amount, 'salary'); break;
      case 'collect': this.fromBank(e, e.player, e.amount, 'card', { text: e.why || this.card || '' }); break;
      case 'birthday_gift': this.fromBank(e, e.player, e.amount, 'gift'); break;
      case 'free_parking': this.fromBank(e, e.player, e.amount, 'parking'); break;
      case 'mortgage': {
        this.fromBank(e, e.player, e.value, 'mortgage', { property: e.property });
        const pr = this.props[e.property]; if (pr) pr.mortgages++;
        this.note(e.property, { round: r, kind: 'mortgage', player: e.player, amount: e.value });
        break;
      }
      case 'unmortgage': {
        this.toBank(e, e.player, e.cost, 'unmortgage', { property: e.property });
        const pr = this.props[e.property]; if (pr) { pr.unmortgages++; pr.unmortgageSpend += e.cost; }
        this.note(e.property, { round: r, kind: 'unmortgage', player: e.player, amount: e.cost });
        break;
      }
      case 'sell_building': {
        this.fromBank(e, e.player, e.refund, 'sell', { property: e.property, level: e.level });
        this.level[e.property] = e.level;
        const pr = this.props[e.property]; if (pr) { pr.sales++; pr.saleRefund += e.refund; }
        this.note(e.property, { round: r, kind: 'sell', player: e.player, amount: e.refund, level: e.level });
        break;
      }
      case 'build': {
        this.toBank(e, e.player, e.cost, 'build', { property: e.property, level: e.level });
        this.level[e.property] = e.level;
        const pr = this.props[e.property]; if (pr) { pr.builds++; pr.buildSpend += e.cost; pr.maxLevel = Math.max(pr.maxLevel, e.level); }
        this.note(e.property, { round: r, kind: 'build', player: e.player, amount: e.cost, level: e.level });
        break;
      }
      case 'build_depot': {
        this.toBank(e, e.player, e.cost, 'build', { property: e.property, depot: true });
        this.depot[e.property] = true;
        const pr = this.props[e.property]; if (pr) { pr.builds++; pr.buildSpend += e.cost; }
        this.note(e.property, { round: r, kind: 'depot', player: e.player, amount: e.cost });
        break;
      }
      case 'purchase': case 'auction_won': {
        const auction = e.type === 'auction_won';
        this.toBank(e, e.player, e.price, auction ? 'auction' : 'purchase', { property: e.property });
        m.bought++; if (auction) { m.auctions++; this.player(e.player).auctions++; } else this.player(e.player).bought++;
        const pr = this.props[e.property];
        if (pr) {
          pr.purchases++; if (auction) pr.auctions++;
          pr.paid += e.price;
          if (pr.firstPrice == null) { pr.firstPrice = e.price; pr.firstHow = auction ? 'auction' : 'purchase'; }
        }
        this.owned(e.property, e.player);
        this.note(e.property, { round: r, kind: auction ? 'auction' : 'purchase', player: e.player, amount: e.price });
        break;
      }
      case 'jail_fine_paid': this.toBank(e, e.player, e.amount, 'jail'); break;
      case 'payment': {
        const why = this.reasonOf(e.reason);
        const extra = why.kind === 'rent' ? { property: why.property } : why.text ? { text: why.text } : {};
        if (e.to === 'bank') this.toBank(e, e.from, e.amount, why.kind, extra);
        else this.between(e, e.from, e.to, e.amount, why.kind, extra);
        break;
      }
      case 'bankrupt': {
        // The bank buys the buildings back at half their cost, and the cash goes to the creditor: to the bank here,
        // or to a player with the assets_transferred event that follows.
        let refund = 0;
        for (const i of e.properties || []) {
          const s = this.base[i];
          if (this.level[i]) refund += (this.level[i] * (s && s.houseCost ? s.houseCost : 0)) / 2;
          if (this.depot[i]) refund += 50;
          this.level[i] = 0; this.depot[i] = false;
        }
        if (refund) this.fromBank(e, e.player, refund, 'bankruptcy', { text: 'buildings sold back to the bank' });
        if (e.creditor === 'bank') {
          if (e.cashHandedOver) this.toBank(e, e.player, e.cashHandedOver, 'bankruptcy', { text: 'all cash to the bank' });
          for (const i of e.properties || []) {
            const pr = this.props[i]; if (pr) pr.returns++;
            this.note(i, { round: r, kind: 'returned', player: e.player });
          }
        }
        break;
      }
      case 'assets_transferred':
        if (e.cash) this.between(e, e.from, e.to, e.cash, 'bankruptcy', { text: 'all cash to the creditor' });
        for (const i of e.properties || []) {
          const pr = this.props[i]; if (pr) pr.handovers++;
          this.owned(i, e.to);
          this.note(i, { round: r, kind: 'handover', player: e.from, other: e.to });
        }
        break;
      // ---- negotiations: every offer, counter-offer and answer, and how each ended ----
      case 'trade_proposed': {
        const n = this.negotiation(e, e.from, e.to);
        n.steps.push({ seq: e.seq, kind: 'offer', by: e.from, to: e.to, give: offerOf(e.give), get: offerOf(e.get), message: e.message || '' });
        n.terms = { from: e.from, to: e.to, give: offerOf(e.give), get: offerOf(e.get) };
        this.open = n;
        break;
      }
      case 'trade_counter': {
        const n = this.open || this.negotiation(e, e.to, e.from);
        n.steps.push({ seq: e.seq, kind: 'counter', by: e.from, to: e.to, give: offerOf(e.give), get: offerOf(e.get), message: e.message || '', reason: e.reason || '', source: e.source });
        n.terms = { from: e.from, to: e.to, give: offerOf(e.give), get: offerOf(e.get) };
        this.open = n;
        break;
      }
      case 'trade_response': {
        const n = this.open;
        if (!n) break;
        n.steps.push({ seq: e.seq, kind: e.accept ? 'accept' : 'reject', by: e.to, to: e.from, reason: e.reason || '', source: e.source });
        if (!e.accept) { n.outcome = 'rejected'; this.open = null; }
        break;
      }
      case 'trade_lapsed': {
        const n = this.open;
        if (!n) break;
        n.steps.push({ seq: e.seq, kind: 'lapsed', reason: e.reason || '' });
        n.outcome = 'lapsed'; this.open = null;
        break;
      }
      case 'trade_completed': {
        m.trades++;
        this.player(e.from).trades++; this.player(e.to).trades++;
        const give = offerOf(e.give), get = offerOf(e.get);
        for (const i of give.props) { const pr = this.props[i]; if (pr) pr.trades++; this.owned(i, e.to); this.note(i, { round: r, kind: 'trade', player: e.from, other: e.to, gets: get }); }
        for (const i of get.props) { const pr = this.props[i]; if (pr) pr.trades++; this.owned(i, e.from); this.note(i, { round: r, kind: 'trade', player: e.to, other: e.from, gets: give }); }
        if (give.cash) this.between(e, e.from, e.to, give.cash, 'trade');
        if (get.cash) this.between(e, e.to, e.from, get.cash, 'trade');
        const n = this.open || this.negotiation(e, e.from, e.to);
        n.outcome = 'completed';
        n.terms = { from: e.from, to: e.to, give, get };
        n.completedSeq = e.seq;
        this.open = null;
        break;
      }
      case 'illegal_action':
        // an offer the rules refused before the other side saw it: a property not the proposer's, one with buildings, too little cash
        if (e.action && e.action.type === 'propose_trade') {
          const a = e.action;
          const to = typeof a.to === 'string' ? a.to : '';
          const n = this.negotiation(e, e.player, to);
          n.steps.push({ seq: e.seq, kind: 'refused', by: e.player, to, give: rawOffer(a.give), get: rawOffer(a.get), message: typeof a.message === 'string' ? a.message : '', reason: e.reason || '' });
          n.terms = { from: e.player, to, give: rawOffer(a.give), get: rawOffer(a.get) };
          n.outcome = 'refused';
        }
        break;
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
