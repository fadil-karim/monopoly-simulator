// Rebuilds a game's state from its event log alone, so the viewer can show any
// moment of a game stored in the database without re-running the engine, and
// so a live game can be followed by applying events as they arrive. The state
// mirrors the engine's own (players, props, round, turn, chat, result) and the
// same methods the board renderer and the statistics use. scripts/check-replay.mjs
// proves it matches the engine after every event.
import { makeBoard, EDITION_INFO } from './board.js';
import { DEFAULT_CONFIG } from './engine.js';

const STATS = () => ({ rentPaid: 0, rentCollected: 0, bought: 0, auctionsWon: 0, trades: 0, jail: 0, housesBuilt: 0, llmCalls: 0, fallbacks: 0, messages: 0, forfeits: 0, turnMs: 0, turnsTimed: 0 });

export class ReplayGame {
  // meta: { id, edition, config, seed, startedAt, players: [{ id, name, provider, model, effort, colour, ... }] } in seat order.
  // Players may be left out: the game_start event then supplies them in seat order.
  constructor(meta = {}) {
    this.id = meta.id || '';
    this.config = { ...DEFAULT_CONFIG, ...(meta.config || {}) };
    if (meta.edition) this.config.edition = meta.edition;
    this.edition = this.config.edition === 'mega' ? 'mega' : 'standard';
    this.info = EDITION_INFO[this.edition];
    this.board = makeBoard(this.edition);
    this.perSide = this.board.length / 4;
    this.seed = meta.seed ?? null;
    this.startedAt = meta.startedAt || null;
    this.jailIndex = this.board.findIndex((s) => s.type === 'jail');
    this.players = [];
    if (meta.players && meta.players.length) this.setPlayers(meta.players);
    this.props = {};
    for (const s of this.board) if (s.price) this.props[s.i] = { owner: null, level: 0, mortgaged: false, depot: false };
    this.round = 0;
    this.turn = 0;
    this.events = [];
    this.llmCalls = [];
    this.chat = [];
    this.result = null;
    this.freeParkingPot = 0;
    this.status = 'running';
  }
  setPlayers(list) {
    const cash = this.config.startingCash || this.info.startingCash;
    this.players = list.map((p, idx) => ({
      id: p.id || `p${idx + 1}`, name: p.name || `Player ${idx + 1}`, meta: p,
      cash, pos: 0, inJail: false, jailTurns: 0, jailCards: 0, busTickets: 0, bankrupt: false, bankruptRound: null, forcedFine: false,
      stats: STATS(),
    }));
  }
  // ---- the engine's read-only surface ----
  player(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => !p.bankrupt); }
  sqName(i) { const s = this.board[i]; return s ? s.name : `#${i}`; }
  ownedBy(p) { return Object.keys(this.props).map(Number).filter((i) => this.props[i].owner === p.id); }
  buildingValue(i) {
    const s = this.board[i], pr = this.props[i];
    let v = 0;
    if (s.type === 'street') v += pr.level * s.houseCost;
    if (pr.depot) v += 100;
    return v;
  }
  netWorth(p) {
    let v = p.cash;
    for (const i of this.ownedBy(p)) {
      const s = this.board[i], pr = this.props[i];
      v += pr.mortgaged ? s.price / 2 : s.price;
      v += this.buildingValue(i);
    }
    return Math.round(v);
  }
  // ---- applying the log ----
  applyAll(events) { for (const e of events) this.apply(e); return this; }
  addCall(rec) {
    this.llmCalls.push(rec);
    const p = this.player(rec.player);
    if (p) p.stats.llmCalls++;
  }
  apply(e) {
    this.events.push(e);
    // a counter-offer logged before v1.19 carried the negotiation's step in place of the game's round
    if (e.round != null && e.type !== 'trade_counter') this.round = e.round;
    if (e.turn != null) this.turn = e.turn;
    const P = (id) => this.player(id);
    const PR = (i) => this.props[i];
    switch (e.type) {
      case 'game_start':
        if (!this.players.length && Array.isArray(e.players)) this.setPlayers(e.players);
        if (e.seed != null) this.seed = e.seed;
        break;
      case 'turn_start': { const p = P(e.player); if (p) { if (e.cash != null) p.cash = e.cash; if (e.pos != null) p.pos = e.pos; if (e.inJail != null) p.inJail = !!e.inJail; } break; }
      case 'move': { const p = P(e.player); if (p) { p.pos = e.to; if (p.forcedFine) { p.inJail = false; p.forcedFine = false; } } break; }
      case 'pass_go': { const p = P(e.player); if (p) p.cash = e.cash; break; }
      case 'go_to_jail': { const p = P(e.player); if (p) { p.pos = this.jailIndex; p.inJail = true; p.jailTurns = 0; p.stats.jail++; } break; }
      case 'free_parking': { const p = P(e.player); if (p) p.cash += e.amount; this.freeParkingPot = 0; break; }
      case 'birthday_gift': case 'collect': case 'jail_fine_paid': { const p = P(e.player); if (p) { p.cash = e.cash; if (e.type === 'jail_fine_paid') p.inJail = false; } break; }
      case 'payment': {
        const from = P(e.from);
        if (from) from.cash = e.cashFrom;
        if (e.to === 'bank') { if (this.config.freeParkingJackpot) this.freeParkingPot += e.amount; }
        else { const to = P(e.to); if (to) to.cash = e.cashTo; }
        if (typeof e.reason === 'string' && e.reason.startsWith('rent for ')) {
          if (from) from.stats.rentPaid += e.amount;
          const to = P(e.to); if (to) to.stats.rentCollected += e.amount;
        }
        break;
      }
      case 'jail_forced_fine': { const p = P(e.player); if (p) p.forcedFine = true; break; } // the engine leaves jail after the fine is paid, as the move that follows shows
      case 'jail_card_used': { const p = P(e.player); if (p) { p.jailCards = Math.max(0, p.jailCards - 1); p.inJail = false; } break; }
      case 'jail_escape': { const p = P(e.player); if (p) p.inJail = false; break; }
      case 'jail_card_received': { const p = P(e.player); if (p) p.jailCards = e.cards; break; }
      case 'purchase': { const p = P(e.player), pr = PR(e.property); if (pr) pr.owner = e.player; if (p) { p.cash = e.cash; p.stats.bought++; } break; }
      case 'auction_won': { const p = P(e.player), pr = PR(e.property); if (pr) pr.owner = e.player; if (p) { p.cash = e.cash; p.stats.auctionsWon++; } break; }
      case 'build': { const p = P(e.player), pr = PR(e.property); if (pr) pr.level = e.level; if (p) { p.cash = e.cash; p.stats.housesBuilt++; } break; }
      case 'sell_building': { const p = P(e.player), pr = PR(e.property); if (pr) pr.level = e.level; if (p) p.cash = e.cash; break; }
      case 'mortgage': { const p = P(e.player), pr = PR(e.property); if (pr) pr.mortgaged = true; if (p) p.cash = e.cash; break; }
      case 'unmortgage': { const p = P(e.player), pr = PR(e.property); if (pr) pr.mortgaged = false; if (p) p.cash = e.cash; break; }
      case 'build_depot': { const p = P(e.player), pr = PR(e.property); if (pr) pr.depot = true; if (p) p.cash = e.cash; break; }
      case 'bankrupt': {
        const p = P(e.player);
        if (!p) break;
        p.bankrupt = true; p.bankruptRound = e.round; p.inJail = false;
        for (const i of e.properties || []) { const pr = PR(i); if (pr) { pr.level = 0; pr.depot = false; } }
        if (e.creditor === 'bank') {
          for (const i of e.properties || []) { const pr = PR(i); if (pr) { pr.owner = null; pr.mortgaged = false; } }
          p.cash = 0; p.jailCards = 0; p.busTickets = 0;
        } else p.cash = e.cashHandedOver || 0;
        break;
      }
      case 'assets_transferred': {
        const from = P(e.from), to = P(e.to);
        if (to) { to.cash += e.cash || 0; if (from) { to.jailCards += from.jailCards; to.busTickets += from.busTickets; } }
        for (const i of e.properties || []) { const pr = PR(i); if (pr) pr.owner = e.to; }
        if (from) { from.cash = 0; from.jailCards = 0; from.busTickets = 0; from.inJail = false; }
        break;
      }
      case 'trade_completed': {
        const from = P(e.from), to = P(e.to);
        for (const i of (e.give && e.give.props) || []) { const pr = PR(i); if (pr) pr.owner = e.to; }
        for (const i of (e.get && e.get.props) || []) { const pr = PR(i); if (pr) pr.owner = e.from; }
        if (from) { from.cash = e.cashFrom; from.stats.trades++; }
        if (to) { to.cash = e.cashTo; to.stats.trades++; }
        break;
      }
      case 'chat': { const p = P(e.player); this.chat.push({ seq: e.seq, round: e.round, turn: e.turn, from: e.player, to: e.to || null, message: e.message }); if (p) p.stats.messages++; break; }
      case 'bus_ticket_taken': { const p = P(e.player); if (p) p.busTickets = e.tickets; break; }
      case 'bus_ticket_used': { const p = P(e.player); if (p) p.busTickets = Math.max(0, p.busTickets - 1); break; }
      case 'illegal_decision': case 'decider_error': { const p = P(e.player); if (p) p.stats.fallbacks++; break; } // games played before v2.0, when the bot stood in
      case 'forfeit': { const p = P(e.player); if (p) p.stats.forfeits++; break; }
      case 'turn_end': { const p = P(e.player); if (p && e.ms != null) { p.stats.turnMs += e.ms; p.stats.turnsTimed++; } break; }
      case 'game_end': {
        const { seq, t, round, turn, type, ...result } = e;
        this.result = result;
        this.status = 'finished';
        break;
      }
      default: break;
    }
  }
}

// The state after the first n events (and the calls made by then).
export function replayTo(meta, events, n, calls = []) {
  const g = new ReplayGame(meta);
  const upto = Math.max(0, Math.min(n, events.length));
  for (let k = 0; k < upto; k++) g.apply(events[k]);
  const lastSeq = upto ? events[upto - 1].seq : 0;
  for (const c of calls) if (c.seq <= lastSeq) g.addCall(c);
  return g;
}
