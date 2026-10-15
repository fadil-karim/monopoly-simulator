// Monopoly game engine. Pure logic, no DOM. Works in the browser and in Node.
// Decisions are delegated to a `decider` object with an async decide() method;
// every decision is validated here and falls back to the built-in heuristics
// when the decider returns something illegal, so a game can never stall.

import { makeBoard, GROUPS, CHANCE_CARDS, CHEST_CARDS, EDITION_INFO } from './board.js';
import { heuristicDecide } from './heuristics.js';

export const SPEED_DIE = [1, 2, 3, 'mr', 'mr', 'bus'];
export const HOTEL = 5;
export const SKYSCRAPER = 6;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_CONFIG = {
  edition: 'standard', // 'standard' | 'mega'
  startingCash: null, // null = edition default
  salary: 200,
  maxRounds: null, // null = play until one player remains (hard safety stop at 1000 rounds)
  speedDie: true, // mega edition always rolls the speed die
  speedDieFromStart: true,
  bankAuction: true, // auction properties returned to the bank on bankruptcy
  auctionOnDecline: true,
  aiPreroll: 'always', // 'always' | 'useful' | 'never'
  aiRaiseCash: true, // the model chooses what to liquidate
  maxTradesPerTurn: 10, // sanity cap per turn; negotiation itself is open-ended
  maxNegotiationRounds: 8, // counter-offers per trade before it lapses
  jailFine: 50,
  freeParkingJackpot: false,
  shuffleOrder: true, // randomise seating each game so turn order does not bias results
  turnDelayMs: 0, // a pause before each turn, so a bot-only game can be watched live
};

export class Game {
  constructor({ id, config = {}, players, decider, seed, onEvent, onLlm }) {
    this.id = id || `g${Date.now().toString(36)}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.edition = this.config.edition === 'mega' ? 'mega' : 'standard';
    this.info = EDITION_INFO[this.edition];
    this.board = makeBoard(this.edition);
    this.perSide = this.board.length / 4;
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(this.seed);
    this.decider = decider;
    this.onEvent = onEvent || (() => {});
    this.onLlm = onLlm || (() => {});
    const cash = this.config.startingCash || this.info.startingCash;
    this.players = players.map((p, idx) => ({
      id: p.id || `p${idx + 1}`,
      name: p.name || `Player ${idx + 1}`,
      meta: p,
      cash,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      busTickets: 0,
      bankrupt: false,
      bankruptRound: null,
      passedGo: false,
      stats: { rentPaid: 0, rentCollected: 0, bought: 0, auctionsWon: 0, trades: 0, jail: 0, housesBuilt: 0, llmCalls: 0, fallbacks: 0, messages: 0 },
    }));
    if (this.config.shuffleOrder) this.shuffle(this.players);
    this.props = {};
    for (const s of this.board) if (s.price) this.props[s.i] = { owner: null, level: 0, mortgaged: false, depot: false };
    this.bank = { houses: this.info.houses, hotels: this.info.hotels, skyscrapers: this.info.skyscrapers, depots: this.info.depots, busTickets: this.info.busTickets };
    this.decks = { chance: this.shuffle(CHANCE_CARDS.slice()), chest: this.shuffle(CHEST_CARDS.slice()) };
    this.round = 0;
    this.turn = 0;
    this.seq = 0;
    this.events = [];
    this.llmCalls = [];
    this.chat = [];
    this.snapshots = [];
    this.stopped = false;
    this.freeParkingPot = 0;
    this.startedAt = Date.now();
  }

  // ---------- utilities ----------
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  die() { return 1 + Math.floor(this.rng() * 6); }
  player(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => !p.bankrupt); }
  sqName(i) { return this.board[i].name; }
  log(type, data = {}) {
    const ev = { seq: ++this.seq, t: Date.now() - this.startedAt, round: this.round, turn: this.turn, type, ...data };
    this.events.push(ev);
    this.onEvent(ev, this);
    return ev;
  }
  stop() { this.stopped = true; }

  ownedBy(p) { return Object.keys(this.props).map(Number).filter((i) => this.props[i].owner === p.id); }
  groupIdx(group) { return this.board.filter((s) => s.group === group).map((s) => s.i); }
  ownsCountInGroup(p, group) { return this.groupIdx(group).filter((i) => this.props[i].owner === p.id).length; }
  ownsFullGroup(p, group) { return this.ownsCountInGroup(p, group) === this.groupIdx(group).length; }
  ownsMajority(p, group) {
    const n = this.groupIdx(group).length;
    const c = this.ownsCountInGroup(p, group);
    return this.edition === 'mega' ? c * 2 > n : c === n;
  }
  buildingValue(i) {
    const s = this.board[i];
    const pr = this.props[i];
    let v = 0;
    if (s.type === 'street') v += pr.level * s.houseCost;
    if (pr.depot) v += 100;
    return v;
  }
  netWorth(p) {
    let v = p.cash;
    for (const i of this.ownedBy(p)) {
      const s = this.board[i];
      const pr = this.props[i];
      v += pr.mortgaged ? s.price / 2 : s.price;
      v += this.buildingValue(i);
    }
    return Math.round(v);
  }
  countBuildings(p) {
    let houses = 0, hotels = 0;
    for (const i of this.ownedBy(p)) {
      const l = this.props[i].level;
      if (l >= HOTEL) hotels++; else houses += l;
    }
    return { houses, hotels };
  }

  rentFor(i, payer, diceTotal) {
    const s = this.board[i];
    const pr = this.props[i];
    const owner = this.player(pr.owner);
    if (!owner || pr.mortgaged) return 0;
    if (s.type === 'street') {
      if (pr.level === 0) return this.ownsFullGroup(owner, s.group) ? s.rents[0] * 2 : s.rents[0];
      if (pr.level === SKYSCRAPER) return s.rents[HOTEL] + (s.side < 2 ? 500 : 1000);
      return s.rents[pr.level];
    }
    if (s.type === 'station') {
      const n = this.ownsCountInGroup(owner, 'station');
      const base = [0, 25, 50, 100, 200][n] || 200;
      return pr.depot ? base * 2 : base;
    }
    if (s.type === 'utility') {
      const n = this.ownsCountInGroup(owner, 'utility');
      const mult = this.edition === 'mega' ? [0, 4, 10, 20][n] : [0, 4, 10][n];
      return (mult || 4) * (diceTotal || 7);
    }
    return 0;
  }

  // ---------- public state view (used by prompts/UI) ----------
  view(forPlayer) {
    return {
      id: this.id,
      edition: this.edition,
      round: this.round,
      turn: this.turn,
      you: forPlayer ? forPlayer.id : null,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, cash: p.cash, pos: p.pos, square: this.sqName(p.pos), inJail: p.inJail,
        jailCards: p.jailCards, busTickets: p.busTickets, bankrupt: p.bankrupt, netWorth: this.netWorth(p),
      })),
      properties: Object.keys(this.props).map(Number).map((i) => ({
        i, name: this.board[i].name, type: this.board[i].type, group: this.board[i].group, price: this.board[i].price,
        owner: this.props[i].owner, level: this.props[i].level, mortgaged: this.props[i].mortgaged, depot: this.props[i].depot,
      })),
      bank: { ...this.bank },
    };
  }

  // ---------- decisions ----------
  async decide(p, type, ctx) {
    let result = null;
    let source = 'heuristic';
    if (this.decider) {
      try {
        result = await this.decider.decide({ game: this, player: p, type, ctx });
        if (result && typeof result === 'object') source = result.__source || 'ai';
      } catch (e) {
        this.log('decider_error', { player: p.id, decision: type, error: String(e && e.message || e) });
        result = null;
      }
    }
    const check = this.validate(p, type, ctx, result);
    if (!check.ok) {
      if (result) this.log('illegal_decision', { player: p.id, decision: type, reason: check.reason, given: result });
      p.stats.fallbacks++;
      result = heuristicDecide(this, p, type, ctx);
      source = 'heuristic-fallback';
    }
    await this.handleTalk(p, result, type !== 'reply');
    return { ...result, __source: source };
  }

  // ---------- table talk ----------
  say(p, message, to = null) {
    const text = String(message).trim().slice(0, 600);
    if (!text) return null;
    const rec = { seq: ++this.seq, round: this.round, turn: this.turn, from: p.id, to, message: text };
    this.chat.push(rec);
    p.stats.messages++;
    this.log('chat', { player: p.id, to, message: text });
    return rec;
  }
  addressedIn(p, text) {
    const t = String(text).toLowerCase();
    for (const o of this.alive()) {
      if (o.id === p.id) continue;
      if (t.includes(o.id.toLowerCase()) || (o.name && t.includes(o.name.toLowerCase()))) return o;
    }
    return null;
  }
  async handleTalk(p, r, allowReply) {
    if (!r || typeof r !== 'object') return;
    let target = null;
    let heard = null;
    if (typeof r.say === 'string' && r.say.trim()) {
      const rec = this.say(p, r.say);
      if (rec) { target = this.addressedIn(p, rec.message); heard = rec; }
    }
    if (r.tell && typeof r.tell === 'object' && typeof r.tell.message === 'string' && r.tell.message.trim()) {
      const to = this.player(r.tell.to) || this.addressedIn(p, r.tell.to || '');
      if (to && !to.bankrupt && to.id !== p.id) {
        const rec = this.say(p, r.tell.message, to.id);
        if (rec) { target = to; heard = rec; }
      }
    }
    if (allowReply && target && heard && !target.bankrupt) {
      await this.decide(target, 'reply', { from: p.id, fromName: p.name, message: heard.message, private: heard.to != null });
    }
  }

  validate(p, type, ctx, r) {
    if (!r || typeof r !== 'object') return { ok: false, reason: 'no decision' };
    switch (type) {
      case 'buy': return typeof r.buy === 'boolean' ? { ok: true } : { ok: false, reason: 'buy must be boolean' };
      case 'bid': {
        const b = Number(r.bid);
        if (!Number.isFinite(b) || b < 0) return { ok: false, reason: 'bid must be a number >= 0' };
        return { ok: true };
      }
      case 'trade_response': return typeof r.accept === 'boolean' || (r.counter && typeof r.counter === 'object') ? { ok: true } : { ok: false, reason: 'accept must be boolean (or give a counter offer)' };
      case 'reply': return { ok: true };
      case 'choose_space': {
        const s = Number(r.space);
        return ctx.options.some((o) => o.i === s) ? { ok: true } : { ok: false, reason: 'space not in options' };
      }
      case 'choose_property': {
        const s = Number(r.property);
        return ctx.options.some((o) => o.i === s) ? { ok: true } : { ok: false, reason: 'property not in options' };
      }
      case 'preroll': return Array.isArray(r.actions) || r.jail || r.actions === undefined ? { ok: true } : { ok: false, reason: 'actions must be an array' };
      case 'raise_cash': return Array.isArray(r.actions) ? { ok: true } : { ok: false, reason: 'actions must be an array' };
      default: return { ok: true };
    }
  }

  // ---------- main loop ----------
  async run() {
    this.log('game_start', {
      edition: this.edition, seed: this.seed, config: this.config,
      players: this.players.map((p) => ({ id: p.id, name: p.name, model: p.meta.model, provider: p.meta.provider, effort: p.meta.effort })),
    });
    let endReason = 'last_standing';
    outer: while (true) {
      this.round++;
      const limit = this.config.maxRounds || 1000;
      if (this.round > limit) { this.round--; endReason = this.config.maxRounds ? 'round_limit' : 'safety_stop'; break; }
      for (const p of this.players) {
        if (p.bankrupt) continue;
        if (this.stopped) { endReason = 'stopped'; break outer; }
        await this.playTurn(p);
        if (this.alive().length <= 1) break outer;
      }
      this.snapshots.push({ round: this.round, players: this.players.map((p) => ({ id: p.id, cash: p.cash, netWorth: p.bankrupt ? 0 : this.netWorth(p), props: this.ownedBy(p).length, bankrupt: p.bankrupt })) });
    }
    const ranking = this.players
      .map((p) => ({ id: p.id, name: p.name, bankrupt: p.bankrupt, bankruptRound: p.bankruptRound, cash: p.cash, netWorth: p.bankrupt ? 0 : this.netWorth(p), stats: p.stats }))
      .sort((a, b) => (a.bankrupt !== b.bankrupt ? (a.bankrupt ? 1 : -1) : a.bankrupt ? b.bankruptRound - a.bankruptRound : b.netWorth - a.netWorth));
    this.result = { winnerId: ranking[0].id, winnerName: ranking[0].name, ranking, rounds: this.round, turns: this.turn, endReason, durationMs: Date.now() - this.startedAt, messages: this.chat.length };
    this.log('game_end', this.result);
    return this.result;
  }

  async playTurn(p) {
    if (this.config.turnDelayMs > 0) await new Promise((r) => setTimeout(r, this.config.turnDelayMs));
    this.turn++;
    this.log('turn_start', { player: p.id, cash: p.cash, pos: p.pos, inJail: p.inJail });
    const pre = await this.prerollPhase(p);
    if (p.bankrupt) return;
    if (pre.busTarget != null) {
      this.log('bus_ticket_used', { player: p.id, from: p.pos, to: pre.busTarget });
      p.busTickets--;
      this.bank.busTickets++;
      await this.moveTo(p, pre.busTarget, true);
      return;
    }
    if (p.inJail) {
      await this.jailTurn(p, pre.jail);
      return;
    }
    let doubles = 0;
    while (!p.bankrupt && !this.stopped) {
      const d1 = this.die(), d2 = this.die();
      const useSpeed = this.edition === 'mega' && this.config.speedDie && (this.config.speedDieFromStart || p.passedGo);
      const sd = useSpeed ? SPEED_DIE[Math.floor(this.rng() * 6)] : null;
      const isDouble = d1 === d2;
      const isTriple = useSpeed && isDouble && sd === d1;
      this.log('roll', { player: p.id, dice: [d1, d2], speed: sd, doubles: isDouble, triples: isTriple });
      if (isTriple) {
        await this.triples(p);
        break;
      }
      if (isDouble) {
        doubles++;
        if (doubles === 3) {
          this.log('three_doubles', { player: p.id });
          this.sendToJail(p);
          break;
        }
      }
      let steps = d1 + d2;
      if (typeof sd === 'number') steps += sd;
      await this.move(p, steps, d1 + d2 + (typeof sd === 'number' ? sd : 0));
      if (p.bankrupt || p.inJail) break;
      if (sd === 'mr') await this.mrMonopoly(p);
      else if (sd === 'bus') this.takeBusTicket(p, 'speed die');
      if (p.bankrupt || p.inJail) break;
      if (!isDouble) break;
    }
  }

  async prerollPhase(p) {
    const ctx = this.prerollContext(p);
    const useful = ctx.canBuild.length || ctx.canUnmortgage.length || ctx.tradeable || ctx.inJail || ctx.busTargets.length || ctx.canSell.length;
    const mode = this.config.aiPreroll;
    let r;
    if (mode === 'never' || (mode === 'useful' && !useful)) {
      r = heuristicDecide(this, p, 'preroll', ctx);
    } else {
      r = await this.decide(p, 'preroll', ctx);
    }
    const out = { jail: r.jail, busTarget: null };
    const actions = Array.isArray(r.actions) ? r.actions.slice(0, 20) : [];
    let trades = 0;
    for (const a of actions) {
      if (!a || typeof a !== 'object') continue;
      if (a.type === 'propose_trade') {
        if (trades >= this.config.maxTradesPerTurn) continue;
        trades++;
        await this.proposeTrade(p, a);
        continue;
      }
      if (a.type === 'use_bus_ticket') {
        const t = Number(a.target);
        if (p.busTickets > 0 && ctx.busTargets.includes(t)) out.busTarget = t;
        else this.log('illegal_action', { player: p.id, action: a, reason: 'invalid bus ticket use' });
        continue;
      }
      this.applyAction(p, a);
    }
    return out;
  }

  prerollContext(p) {
    const canBuild = [], canSell = [], canMortgage = [], canUnmortgage = [], canDepot = [];
    for (const i of this.ownedBy(p)) {
      const s = this.board[i], pr = this.props[i];
      const b = this.canBuild(p, i);
      if (b.ok) canBuild.push({ i, name: s.name, level: pr.level, cost: s.houseCost, nextLevel: pr.level + 1 });
      if (s.type === 'street' && pr.level > 0 && this.canSell(p, i).ok) canSell.push({ i, name: s.name, level: pr.level, refund: s.houseCost / 2 });
      if (!pr.mortgaged && this.canMortgage(p, i).ok) canMortgage.push({ i, name: s.name, value: s.price / 2 });
      if (pr.mortgaged) canUnmortgage.push({ i, name: s.name, cost: Math.ceil(s.price * 0.55) });
      if (this.edition === 'mega' && s.type === 'station' && !pr.depot && !pr.mortgaged && this.ownsFullGroup(p, 'station') && this.bank.depots > 0) canDepot.push({ i, name: s.name, cost: 100 });
    }
    const others = this.alive().filter((o) => o.id !== p.id);
    const tradeable = this.ownedBy(p).some((i) => this.props[i].level === 0) || others.some((o) => this.ownedBy(o).some((i) => this.props[i].level === 0));
    const busTargets = p.busTickets > 0 ? this.busTargets(p) : [];
    return {
      inJail: p.inJail, jailTurns: p.jailTurns, jailCards: p.jailCards, cash: p.cash, canBuild, canSell, canMortgage, canUnmortgage, canDepot,
      tradeable: !!tradeable, busTargets, bank: { ...this.bank },
    };
  }

  busTargets(p) {
    const start = p.pos;
    const side = Math.floor(start / this.perSide);
    const corner = ((side + 1) * this.perSide) % this.board.length;
    const out = [];
    for (let i = start + 1; i <= (side + 1) * this.perSide; i++) out.push(i % this.board.length);
    return out.filter((i) => this.board[i].type !== 'gotojail' || i === corner);
  }

  // ---------- building ----------
  canBuild(p, i) {
    const s = this.board[i], pr = this.props[i];
    if (s.type !== 'street') return { ok: false, reason: 'not a street' };
    if (pr.owner !== p.id) return { ok: false, reason: 'not owner' };
    if (pr.mortgaged) return { ok: false, reason: 'mortgaged' };
    const maxLevel = this.edition === 'mega' ? SKYSCRAPER : HOTEL;
    if (pr.level >= maxLevel) return { ok: false, reason: 'fully built' };
    const next = pr.level + 1;
    if (!this.ownsMajority(p, s.group)) return { ok: false, reason: 'need the colour group' };
    if (next >= HOTEL && !this.ownsFullGroup(p, s.group)) return { ok: false, reason: 'hotels need the whole group' };
    const owned = this.groupIdx(s.group).filter((j) => this.props[j].owner === p.id);
    if (owned.some((j) => this.props[j].mortgaged)) return { ok: false, reason: 'a property in the group is mortgaged' };
    const minLevel = Math.min(...owned.map((j) => this.props[j].level));
    if (next - minLevel > 1) return { ok: false, reason: 'build evenly' };
    if (next <= 4 && this.bank.houses < 1) return { ok: false, reason: 'no houses left in the bank' };
    if (next === HOTEL && this.bank.hotels < 1) return { ok: false, reason: 'no hotels left' };
    if (next === SKYSCRAPER && this.bank.skyscrapers < 1) return { ok: false, reason: 'no skyscrapers left' };
    if (p.cash < s.houseCost) return { ok: false, reason: 'cannot afford' };
    return { ok: true };
  }
  build(p, i) {
    const c = this.canBuild(p, i);
    if (!c.ok) { this.log('illegal_action', { player: p.id, action: { type: 'build', property: i }, reason: c.reason }); return false; }
    const s = this.board[i], pr = this.props[i];
    pr.level++;
    if (pr.level <= 4) this.bank.houses--;
    else if (pr.level === HOTEL) { this.bank.hotels--; this.bank.houses += 4; }
    else { this.bank.skyscrapers--; this.bank.hotels++; }
    p.cash -= s.houseCost;
    p.stats.housesBuilt++;
    this.log('build', { player: p.id, property: i, name: s.name, level: pr.level, cost: s.houseCost, cash: p.cash });
    return true;
  }
  canSell(p, i) {
    const s = this.board[i], pr = this.props[i];
    if (s.type !== 'street' || pr.owner !== p.id || pr.level === 0) return { ok: false, reason: 'nothing to sell' };
    const owned = this.groupIdx(s.group).filter((j) => this.props[j].owner === p.id);
    const maxLevel = Math.max(...owned.map((j) => this.props[j].level));
    if (maxLevel - (pr.level - 1) > 1) return { ok: false, reason: 'sell evenly' };
    if (pr.level === HOTEL && this.bank.houses < 4) return { ok: false, reason: 'bank has no houses to replace the hotel' };
    if (pr.level === SKYSCRAPER && this.bank.hotels < 1) return { ok: false, reason: 'bank has no hotel to replace the skyscraper' };
    return { ok: true };
  }
  sell(p, i) {
    const c = this.canSell(p, i);
    if (!c.ok) { this.log('illegal_action', { player: p.id, action: { type: 'sell_house', property: i }, reason: c.reason }); return false; }
    const s = this.board[i], pr = this.props[i];
    if (pr.level === SKYSCRAPER) { this.bank.skyscrapers++; this.bank.hotels--; }
    else if (pr.level === HOTEL) { this.bank.hotels++; this.bank.houses -= 4; }
    else this.bank.houses++;
    pr.level--;
    p.cash += s.houseCost / 2;
    this.log('sell_building', { player: p.id, property: i, name: s.name, level: pr.level, refund: s.houseCost / 2, cash: p.cash });
    return true;
  }
  canMortgage(p, i) {
    const s = this.board[i], pr = this.props[i];
    if (pr.owner !== p.id) return { ok: false, reason: 'not owner' };
    if (pr.mortgaged) return { ok: false, reason: 'already mortgaged' };
    if (s.type === 'street') {
      const owned = this.groupIdx(s.group).filter((j) => this.props[j].owner === p.id);
      if (owned.some((j) => this.props[j].level > 0)) return { ok: false, reason: 'sell buildings in the group first' };
    }
    if (pr.depot) return { ok: false, reason: 'remove depot first' };
    return { ok: true };
  }
  mortgage(p, i) {
    const c = this.canMortgage(p, i);
    if (!c.ok) { this.log('illegal_action', { player: p.id, action: { type: 'mortgage', property: i }, reason: c.reason }); return false; }
    const s = this.board[i];
    this.props[i].mortgaged = true;
    p.cash += s.price / 2;
    this.log('mortgage', { player: p.id, property: i, name: s.name, value: s.price / 2, cash: p.cash });
    return true;
  }
  unmortgage(p, i) {
    const s = this.board[i], pr = this.props[i];
    const cost = Math.ceil(s.price * 0.55);
    if (pr.owner !== p.id || !pr.mortgaged || p.cash < cost) { this.log('illegal_action', { player: p.id, action: { type: 'unmortgage', property: i }, reason: 'cannot unmortgage' }); return false; }
    pr.mortgaged = false;
    p.cash -= cost;
    this.log('unmortgage', { player: p.id, property: i, name: s.name, cost, cash: p.cash });
    return true;
  }
  buildDepot(p, i) {
    const s = this.board[i], pr = this.props[i];
    if (this.edition !== 'mega' || s.type !== 'station' || pr.owner !== p.id || pr.depot || pr.mortgaged || !this.ownsFullGroup(p, 'station') || this.bank.depots < 1 || p.cash < 100) {
      this.log('illegal_action', { player: p.id, action: { type: 'build_depot', property: i }, reason: 'cannot build depot' }); return false;
    }
    pr.depot = true; this.bank.depots--; p.cash -= 100;
    this.log('build_depot', { player: p.id, property: i, name: s.name, cost: 100, cash: p.cash });
    return true;
  }
  applyAction(p, a) {
    const i = Number(a.property);
    const count = Math.max(1, Math.min(6, Number(a.count) || 1));
    switch (a.type) {
      case 'build': for (let k = 0; k < count; k++) if (!this.build(p, i)) break; break;
      case 'sell_house': case 'sell_building': for (let k = 0; k < count; k++) if (!this.sell(p, i)) break; break;
      case 'mortgage': this.mortgage(p, i); break;
      case 'unmortgage': this.unmortgage(p, i); break;
      case 'build_depot': this.buildDepot(p, i); break;
      case 'pay_jail_fine': case 'use_jail_card': case 'roll': break; // handled through `jail`
      default: this.log('illegal_action', { player: p.id, action: a, reason: 'unknown action type' });
    }
  }

  // ---------- movement ----------
  async move(p, steps, diceTotal) {
    const from = p.pos;
    const to = (from + steps) % this.board.length;
    if (to < from || steps >= this.board.length) this.passGo(p);
    p.pos = to;
    this.log('move', { player: p.id, from, to, steps, square: this.sqName(to) });
    await this.resolve(p, { diceTotal });
  }
  async moveTo(p, i, collectGo = true, opts = {}) {
    const from = p.pos;
    if (collectGo && i < from) this.passGo(p);
    p.pos = i;
    this.log('move', { player: p.id, from, to: i, steps: null, square: this.sqName(i), via: opts.via || 'direct' });
    await this.resolve(p, opts);
  }
  passGo(p) {
    p.cash += this.config.salary;
    p.passedGo = true;
    this.log('pass_go', { player: p.id, amount: this.config.salary, cash: p.cash });
  }
  sendToJail(p) {
    p.pos = this.board.findIndex((s) => s.type === 'jail');
    p.inJail = true;
    p.jailTurns = 0;
    p.stats.jail++;
    this.log('go_to_jail', { player: p.id });
  }

  async resolve(p, opts = {}) {
    const s = this.board[p.pos];
    switch (s.type) {
      case 'street': case 'station': case 'utility': await this.landOnProperty(p, s, opts); break;
      case 'tax': {
        this.log('tax', { player: p.id, name: s.name, amount: s.amount });
        await this.pay(p, s.amount, null, s.name);
        break;
      }
      case 'chance': await this.drawCard(p, 'chance'); break;
      case 'chest': await this.drawCard(p, 'chest'); break;
      case 'gotojail': this.sendToJail(p); break;
      case 'freeparking': if (this.config.freeParkingJackpot && this.freeParkingPot) { p.cash += this.freeParkingPot; this.log('free_parking', { player: p.id, amount: this.freeParkingPot }); this.freeParkingPot = 0; } break;
      case 'auction': await this.auctionSquare(p); break;
      case 'busticket': this.takeBusTicket(p, 'bus ticket square'); break;
      case 'birthday': p.cash += 100; this.log('birthday_gift', { player: p.id, amount: 100, cash: p.cash }); break;
      default: break;
    }
  }

  async landOnProperty(p, s, opts = {}) {
    const pr = this.props[s.i];
    if (pr.owner === null) { await this.offerPurchase(p, s); return; }
    if (pr.owner === p.id) return;
    const owner = this.player(pr.owner);
    if (pr.mortgaged) { this.log('rent_skipped', { player: p.id, property: s.i, reason: 'mortgaged' }); return; }
    let diceTotal = opts.diceTotal;
    if (s.type === 'utility' && opts.utilityTenTimes) {
      const d1 = this.die(), d2 = this.die();
      diceTotal = d1 + d2;
      this.log('roll', { player: p.id, dice: [d1, d2], purpose: 'utility card' });
    }
    let rent = opts.utilityTenTimes ? 10 * diceTotal : this.rentFor(s.i, p, diceTotal);
    if (opts.rentMult) rent *= opts.rentMult;
    this.log('rent_due', { player: p.id, to: owner.id, property: s.i, name: s.name, amount: rent });
    await this.pay(p, rent, owner, `rent for ${s.name}`);
    if (!p.bankrupt) { p.stats.rentPaid += rent; owner.stats.rentCollected += rent; }
  }

  async offerPurchase(p, s) {
    const ctx = { property: { i: s.i, name: s.name, type: s.type, group: s.group, price: s.price }, cash: p.cash, canAfford: p.cash >= s.price };
    let buy = false;
    if (p.cash >= s.price) {
      const r = await this.decide(p, 'buy', ctx);
      buy = r.buy;
      this.log('buy_decision', { player: p.id, property: s.i, name: s.name, buy, source: r.__source, reason: r.reason });
    } else {
      this.log('buy_decision', { player: p.id, property: s.i, name: s.name, buy: false, source: 'cannot afford' });
    }
    if (buy) {
      p.cash -= s.price;
      this.props[s.i].owner = p.id;
      p.stats.bought++;
      this.log('purchase', { player: p.id, property: s.i, name: s.name, price: s.price, cash: p.cash });
    } else if (this.config.auctionOnDecline) {
      await this.auction(s);
    }
  }

  async auction(s, opts = {}) {
    const bidders = this.alive().filter((p) => p.cash > 0);
    if (!bidders.length) return null;
    this.log('auction_start', { property: s.i, name: s.name, price: s.price, bidders: bidders.map((b) => b.id) });
    const bids = await Promise.all(bidders.map(async (b) => {
      const ctx = { property: { i: s.i, name: s.name, type: s.type, group: s.group, price: s.price }, cash: b.cash, bidders: bidders.map((x) => x.id) };
      const r = await this.decide(b, 'bid', ctx);
      const bid = Math.max(0, Math.min(b.cash, Math.floor(Number(r.bid) || 0)));
      return { player: b, bid, source: r.__source, reason: r.reason };
    }));
    this.log('auction_bids', { property: s.i, bids: bids.map((b) => ({ player: b.player.id, bid: b.bid, source: b.source, reason: b.reason })) });
    let best = null;
    for (const b of bids) if (b.bid > 0 && (!best || b.bid > best.bid)) best = b;
    if (!best) { this.log('auction_unsold', { property: s.i, name: s.name }); return null; }
    best.player.cash -= best.bid;
    this.props[s.i].owner = best.player.id;
    best.player.stats.auctionsWon++;
    this.log('auction_won', { player: best.player.id, property: s.i, name: s.name, price: best.bid, cash: best.player.cash });
    return best.player;
  }

  async auctionSquare(p) {
    const options = Object.keys(this.props).map(Number).filter((i) => this.props[i].owner === null).map((i) => ({ i, name: this.board[i].name, price: this.board[i].price, group: this.board[i].group }));
    if (!options.length) { this.log('auction_square', { player: p.id, result: 'no unowned property' }); return; }
    const r = await this.decide(p, 'choose_property', { purpose: 'auction_square', options });
    const i = Number(r.property);
    this.log('auction_square', { player: p.id, chosen: i, name: this.board[i].name, source: r.__source, reason: r.reason });
    await this.auction(this.board[i]);
  }

  takeBusTicket(p, via) {
    if (this.bank.busTickets <= 0) { this.log('bus_ticket_none', { player: p.id, via }); return; }
    this.bank.busTickets--;
    p.busTickets++;
    this.log('bus_ticket_taken', { player: p.id, via, tickets: p.busTickets });
  }

  async mrMonopoly(p) {
    const n = this.board.length;
    let target = null;
    for (let k = 1; k < n; k++) {
      const i = (p.pos + k) % n;
      if (this.props[i] && this.props[i].owner === null) { target = i; break; }
    }
    if (target !== null) {
      this.log('mr_monopoly', { player: p.id, to: target, name: this.sqName(target), kind: 'unowned' });
      await this.moveTo(p, target, true, { via: 'mr_monopoly' });
      return;
    }
    for (let k = 1; k < n; k++) {
      const i = (p.pos + k) % n;
      const pr = this.props[i];
      if (pr && pr.owner && pr.owner !== p.id && !pr.mortgaged) { target = i; break; }
    }
    if (target !== null) {
      this.log('mr_monopoly', { player: p.id, to: target, name: this.sqName(target), kind: 'rent' });
      await this.moveTo(p, target, true, { via: 'mr_monopoly', diceTotal: 7 });
    } else this.log('mr_monopoly', { player: p.id, kind: 'nothing' });
  }

  async triples(p) {
    const options = this.board.filter((s) => s.type !== 'gotojail').map((s) => ({ i: s.i, name: s.name, type: s.type, owner: this.props[s.i] ? this.props[s.i].owner : null, price: s.price || null }));
    const r = await this.decide(p, 'choose_space', { purpose: 'triples', options, from: p.pos });
    const i = Number(r.space);
    this.log('triples', { player: p.id, to: i, name: this.sqName(i), source: r.__source, reason: r.reason });
    await this.moveTo(p, i, true, { via: 'triples' });
  }

  // ---------- jail ----------
  async jailTurn(p, choice) {
    p.jailTurns++;
    let c = choice;
    if (c === 'card' && p.jailCards <= 0) c = null;
    if (c === 'pay' && p.cash < this.config.jailFine) c = null;
    if (!c) c = heuristicDecide(this, p, 'jail', { cash: p.cash, jailCards: p.jailCards, jailTurns: p.jailTurns }).jail;
    if (c === 'card' && p.jailCards > 0) {
      p.jailCards--;
      this.returnJailCard();
      p.inJail = false;
      this.log('jail_card_used', { player: p.id });
    } else if (c === 'pay' && p.cash >= this.config.jailFine) {
      p.cash -= this.config.jailFine;
      p.inJail = false;
      this.log('jail_fine_paid', { player: p.id, amount: this.config.jailFine, cash: p.cash });
    }
    const d1 = this.die(), d2 = this.die();
    const isDouble = d1 === d2;
    this.log('roll', { player: p.id, dice: [d1, d2], doubles: isDouble, purpose: p.inJail ? 'jail' : 'after jail' });
    if (p.inJail) {
      if (isDouble) {
        p.inJail = false;
        this.log('jail_escape', { player: p.id, by: 'doubles' });
        await this.move(p, d1 + d2, d1 + d2);
        return;
      }
      if (p.jailTurns >= 3) {
        this.log('jail_forced_fine', { player: p.id, amount: this.config.jailFine });
        await this.pay(p, this.config.jailFine, null, 'jail fine');
        if (p.bankrupt) return;
        p.inJail = false;
        await this.move(p, d1 + d2, d1 + d2);
      } else this.log('jail_stay', { player: p.id, jailTurns: p.jailTurns });
      return;
    }
    await this.move(p, d1 + d2, d1 + d2);
    // Leaving jail by card or fine: a double rolled now does not grant another throw.
  }
  returnJailCard() {
    const deck = this.decks.chance.some((c) => c.action === 'jailCard') ? 'chest' : 'chance';
    const card = (deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS).find((c) => c.action === 'jailCard');
    if (!this.decks[deck].some((c) => c.id === card.id)) this.decks[deck].push(card);
  }

  // ---------- cards ----------
  async drawCard(p, deck) {
    const d = this.decks[deck];
    const card = d.shift();
    if (card.action !== 'jailCard') d.push(card);
    this.log('card', { player: p.id, deck, id: card.id, text: card.text });
    const n = this.board.length;
    switch (card.action) {
      case 'moveTo': {
        const i = card.target === 'go' ? 0 : this.board.findIndex((s) => s.name === card.target);
        await this.moveTo(p, i, true, { via: 'card' });
        break;
      }
      case 'nearestStation': case 'nearestUtility': {
        const type = card.action === 'nearestStation' ? 'station' : 'utility';
        let i = null;
        for (let k = 1; k < n; k++) { const j = (p.pos + k) % n; if (this.board[j].type === type) { i = j; break; } }
        await this.moveTo(p, i, true, type === 'station' ? { via: 'card', rentMult: 2 } : { via: 'card', utilityTenTimes: true });
        break;
      }
      case 'collect': p.cash += card.amount; this.log('collect', { player: p.id, amount: card.amount, cash: p.cash, why: card.text }); break;
      case 'pay': await this.pay(p, card.amount, null, card.text); break;
      case 'jailCard': p.jailCards++; this.log('jail_card_received', { player: p.id, cards: p.jailCards }); break;
      case 'back3': { p.pos = (p.pos - 3 + n) % n; this.log('move', { player: p.id, from: (p.pos + 3) % n, to: p.pos, steps: -3, square: this.sqName(p.pos), via: 'card' }); await this.resolve(p, { diceTotal: 7 }); break; }
      case 'gotoJail': this.sendToJail(p); break;
      case 'repairs': {
        const { houses, hotels } = this.countBuildings(p);
        const amount = houses * card.house + hotels * card.hotel;
        this.log('repairs', { player: p.id, houses, hotels, amount });
        if (amount > 0) await this.pay(p, amount, null, 'repairs');
        break;
      }
      case 'payEach': {
        for (const o of this.alive()) {
          if (o.id === p.id || p.bankrupt) continue;
          await this.pay(p, card.amount, o, card.text);
        }
        break;
      }
      case 'collectEach': {
        for (const o of this.alive()) {
          if (o.id === p.id) continue;
          await this.pay(o, card.amount, p, card.text);
        }
        break;
      }
    }
  }

  // ---------- money ----------
  async pay(p, amount, to, reason) {
    amount = Math.max(0, Math.round(amount));
    if (amount === 0) return true;
    if (p.cash < amount) await this.raiseCash(p, amount, reason);
    if (p.cash >= amount) {
      p.cash -= amount;
      if (to) to.cash += amount;
      else if (this.config.freeParkingJackpot) this.freeParkingPot += amount;
      this.log('payment', { from: p.id, to: to ? to.id : 'bank', amount, reason, cashFrom: p.cash, cashTo: to ? to.cash : null });
      return true;
    }
    await this.bankrupt(p, to, amount, reason);
    return false;
  }

  async raiseCash(p, amount, reason) {
    const ctx = () => ({
      needed: amount, cash: p.cash, shortfall: amount - p.cash, reason,
      canSell: this.ownedBy(p).filter((i) => this.canSell(p, i).ok).map((i) => ({ i, name: this.board[i].name, level: this.props[i].level, refund: this.board[i].houseCost / 2 })),
      canMortgage: this.ownedBy(p).filter((i) => this.canMortgage(p, i).ok).map((i) => ({ i, name: this.board[i].name, value: this.board[i].price / 2 })),
    });
    this.log('raise_cash', { player: p.id, needed: amount, cash: p.cash, reason });
    let c = ctx();
    if (!c.canSell.length && !c.canMortgage.length) return;
    let r;
    if (this.config.aiRaiseCash) r = await this.decide(p, 'raise_cash', c);
    else r = heuristicDecide(this, p, 'raise_cash', c);
    for (const a of (r.actions || []).slice(0, 40)) {
      if (p.cash >= amount) break;
      if (!a || typeof a !== 'object') continue;
      this.applyAction(p, a);
    }
    // Heuristic completion if the model's plan fell short.
    let guard = 0;
    while (p.cash < amount && guard++ < 60) {
      c = ctx();
      if (!c.canSell.length && !c.canMortgage.length) break;
      const h = heuristicDecide(this, p, 'raise_cash', c);
      if (!h.actions.length) break;
      const before = p.cash;
      for (const a of h.actions) { if (p.cash >= amount) break; this.applyAction(p, a); }
      if (p.cash === before) break;
    }
  }

  async bankrupt(p, creditor, amount, reason) {
    p.bankrupt = true;
    p.bankruptRound = this.round;
    const owned = this.ownedBy(p);
    // Buildings are sold back to the bank; the cash goes to the creditor (or bank).
    for (const i of owned) {
      const s = this.board[i], pr = this.props[i];
      if (pr.level > 0) {
        if (pr.level === SKYSCRAPER) { this.bank.skyscrapers++; }
        else if (pr.level === HOTEL) { this.bank.hotels++; }
        else this.bank.houses += pr.level;
        p.cash += (pr.level * s.houseCost) / 2;
        pr.level = 0;
      }
      if (pr.depot) { pr.depot = false; this.bank.depots++; p.cash += 50; }
    }
    this.log('bankrupt', { player: p.id, creditor: creditor ? creditor.id : 'bank', owed: amount, reason, cashHandedOver: p.cash, properties: owned });
    if (creditor) {
      creditor.cash += p.cash;
      creditor.jailCards += p.jailCards;
      creditor.busTickets += p.busTickets;
      for (const i of owned) this.props[i].owner = creditor.id;
      this.log('assets_transferred', { from: p.id, to: creditor.id, cash: p.cash, properties: owned });
    } else {
      for (const i of owned) { this.props[i].owner = null; this.props[i].mortgaged = false; }
      this.bank.busTickets += p.busTickets;
      for (let k = 0; k < p.jailCards; k++) this.returnJailCard();
      if (this.config.bankAuction && this.alive().length > 1) {
        for (const i of owned) await this.auction(this.board[i]);
      }
    }
    p.cash = 0; p.jailCards = 0; p.busTickets = 0; p.inJail = false;
  }

  // ---------- trades ----------
  normaliseOffer(from, to, a) {
    const give = { props: (a.give && Array.isArray(a.give.properties) ? a.give.properties : []).map(Number), cash: Math.max(0, Math.floor(Number(a.give && a.give.cash) || 0)) };
    const get = { props: (a.get && Array.isArray(a.get.properties) ? a.get.properties : []).map(Number), cash: Math.max(0, Math.floor(Number(a.get && a.get.cash) || 0)) };
    if (!to || to.bankrupt || to.id === from.id) return { error: 'invalid counterparty' };
    if (!give.props.length && !get.props.length) return { error: 'trade must involve a property' };
    for (const i of give.props) if (!this.props[i] || this.props[i].owner !== from.id || this.props[i].level > 0) return { error: `cannot give property ${i}` };
    for (const i of get.props) if (!this.props[i] || this.props[i].owner !== to.id || this.props[i].level > 0) return { error: `cannot receive property ${i}` };
    if (give.cash > from.cash) return { error: 'not enough cash to give' };
    if (get.cash > to.cash) return { error: 'counterparty lacks cash' };
    return { offer: { from: from.id, to: to.id, give, get, message: typeof a.message === 'string' ? a.message.slice(0, 400) : undefined } };
  }
  offerCtx(offer) {
    return { ...offer, giveNames: offer.give.props.map((i) => this.board[i].name), getNames: offer.get.props.map((i) => this.board[i].name) };
  }
  async proposeTrade(p, a) {
    const to = this.player(a.to) || this.addressedIn(p, a.to || '');
    const n = this.normaliseOffer(p, to, a);
    if (n.error) { this.log('illegal_action', { player: p.id, action: a, reason: n.error }); return; }
    let offer = n.offer;
    this.log('trade_proposed', offer);
    if (offer.message) this.say(p, offer.message, null);
    // Negotiation: the receiver of the current offer may accept, reject or counter.
    for (let round = 0; round < this.config.maxNegotiationRounds; round++) {
      const receiver = this.player(offer.to), sender = this.player(offer.from);
      const r = await this.decide(receiver, 'trade_response', { offer: this.offerCtx(offer), round });
      if (r.accept === true) {
        this.log('trade_response', { ...offer, accept: true, source: r.__source, reason: r.reason });
        this.executeTrade(offer);
        return;
      }
      if (r.counter && typeof r.counter === 'object') {
        // The counter is written from the receiver's point of view (give = what they give).
        const c = this.normaliseOffer(receiver, sender, { give: r.counter.give, get: r.counter.get, message: r.counter.message });
        if (c.error) { this.log('trade_response', { ...offer, accept: false, source: r.__source, reason: `counter invalid (${c.error}); ${r.reason || ''}` }); return; }
        offer = c.offer;
        this.log('trade_counter', { ...offer, round: round + 1, source: r.__source, reason: r.reason });
        continue;
      }
      this.log('trade_response', { ...offer, accept: false, source: r.__source, reason: r.reason });
      return;
    }
    this.log('trade_lapsed', { ...offer, reason: 'negotiation limit reached' });
  }
  executeTrade(offer) {
    const p = this.player(offer.from), to = this.player(offer.to);
    for (const i of offer.give.props) this.props[i].owner = to.id;
    for (const i of offer.get.props) this.props[i].owner = p.id;
    p.cash -= offer.give.cash; to.cash += offer.give.cash;
    to.cash -= offer.get.cash; p.cash += offer.get.cash;
    p.stats.trades++; to.stats.trades++;
    this.log('trade_completed', { ...offer, cashFrom: p.cash, cashTo: to.cash });
  }
}
