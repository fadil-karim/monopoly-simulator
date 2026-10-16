// The AI decider: turns an engine decision request into a prompt, calls the
// player's model, parses the JSON reply, and records everything for analytics.
// Any failure (network, invalid JSON, timeout) falls back to the heuristics so a
// game always finishes.

import { callModel, PROVIDERS } from './providers.js';
import { heuristicDecide } from './heuristics.js';
import { GROUPS } from './board.js';
import { HOTEL, SKYSCRAPER } from './engine.js';

const gbp = (n) => `£${n}`;

export function rulesText(game) {
  const mega = game.edition === 'mega';
  const lines = [
    `You are an expert Monopoly player in a simulated game (London edition${mega ? ', MEGA rules, 52 squares' : ', standard 40-square board'}). Every player is an AI. The goal is to be the last solvent player, or to have the highest net worth when the round limit (${game.config.maxRounds} rounds) is reached.`,
    '',
    'RULES IN FORCE',
    `- Each player starts with ${gbp(game.config.startingCash || game.info.startingCash)}. Passing GO pays ${gbp(game.config.salary)}.`,
    '- Landing on an unowned property: buy it at list price or it goes to a sealed-bid auction among all players (highest bid wins, pays their bid; a bid of 0 abstains).',
    `- Rent: unimproved street rent doubles when the owner holds the whole colour group. Stations: ${gbp(25)}/${gbp(50)}/${gbp(100)}/${gbp(200)} for 1-4 owned${mega ? ' (doubled on a station with a Train Depot; depots cost £100 and need all four stations)' : ''}. Utilities: 4x dice with one, 10x with two${mega ? ', 20x with three' : ''}.`,
    mega
      ? '- Building: you may build houses once you own a MAJORITY of a colour group (2 of 3, 3 of 4); hotels and skyscrapers need the whole group. Build evenly across the group members you own. Levels: 1-4 houses, 5 = hotel, 6 = skyscraper. Skyscraper rent = hotel rent + £500 (first two board sides) or + £1000 (last two sides). Each house/hotel/skyscraper step costs the group house price. Bank stock: 32 houses, 12 hotels, 12 skyscrapers.'
      : '- Building: you need the whole colour group, build evenly (no property may be more than one house ahead of another in the group), 4 houses then a hotel. Each step costs the group house price. Bank stock: 32 houses, 12 hotels; if the bank runs out nobody can build.',
    '- Mortgage: receive half the list price; no rent is collected on a mortgaged property; unmortgage for 55% of list price (mortgage value plus 10% interest). You cannot mortgage a street while any property in that group has buildings. Selling buildings returns half their cost.',
    `- Jail: pay ${gbp(game.config.jailFine)} before rolling, use a Get Out of Jail Free card, or try for doubles for up to three turns (then you must pay). Three doubles in one turn sends you to Jail.`,
    '- Income Tax £200, Super Tax £100. Chance and Community Chest cards as in the UK edition.',
    '- Trading: on your turn, before rolling, you may propose trades (properties without buildings and/or cash) to opponents. The other side can accept, reject, or counter with their own offer, and the negotiation continues back and forth until someone accepts or walks away.',
    '- Bankruptcy: if you cannot pay, you must sell buildings and mortgage until you can; if that is impossible your assets go to the creditor (or the bank, which auctions them).',
  ];
  if (mega) {
    lines.push(
      '- SPEED DIE: rolled with the two dice every turn (not when rolling from Jail). Faces 1/2/3 add to the move. "Mr Monopoly": after resolving your landing you move on to the next unowned property (buy or auction); if none are left you move to the next property where you owe rent. "Bus": you take a Bus Ticket (16 in the bank). TRIPLES (both dice and speed die equal): move to any square you choose; no extra roll.',
      '- Bus Ticket: on a later turn, instead of rolling, move to any square ahead of you on your current side of the board (up to and including the next corner).',
      '- Auction square: you pick any unowned property and it is auctioned to everybody. Bus Ticket square: take a ticket. Birthday Gift square: collect £100 from the bank.',
      '- Gas Company is a third utility.',
    );
  }
  lines.push(
    '',
    'TABLE TALK',
    'This is a real table of players, so talk like one. In any reply you may add "say": "..." (heard by everyone) and/or "tell": {"to": "<playerId>", "message": "..."} (a private word with one player). Use it the way people do at a Monopoly table: open negotiations, pitch deals, push back, bluff, make alliances, needle an opponent, react to what others said. When someone addresses you, you get a chance to answer. Everything said is recorded; what others said recently appears under RECENT TABLE TALK. Keep each message to a sentence or two.',
    '',
    'RESPONSE FORMAT',
    'Reply with exactly one JSON object and nothing else: no markdown fences, no prose. Include a "reason" string of at most one short sentence. Use property indexes (the numbers in the board table) when naming properties. Never propose an action that is not in the legal options you are given.',
  );
  return lines.join('\n');
}

export function boardText(game) {
  const out = ['BOARD (index name [group] price | rent: base/1h/2h/3h/4h/hotel' + (game.edition === 'mega' ? '/skyscraper' : '') + ' | house cost)'];
  for (const s of game.board) {
    if (s.type === 'street') {
      const sky = game.edition === 'mega' ? `/${s.rents[HOTEL] + (s.side < 2 ? 500 : 1000)}` : '';
      out.push(`${s.i} ${s.name} [${GROUPS[s.group].name}] £${s.price} | ${s.rents.join('/')}${sky} | £${s.houseCost}`);
    } else if (s.type === 'station') out.push(`${s.i} ${s.name} [Station] £200`);
    else if (s.type === 'utility') out.push(`${s.i} ${s.name} [Utility] £150`);
    else out.push(`${s.i} ${s.name}${s.amount ? ` (pay £${s.amount})` : ''}`);
  }
  return out.join('\n');
}

export function stateText(game, p) {
  const lines = [`STATE: round ${game.round}, turn ${game.turn}. You are ${p.name} (id "${p.id}").`, 'Players:'];
  for (const o of game.players) {
    const flags = [o.inJail ? 'IN JAIL' : null, o.jailCards ? `${o.jailCards} jail card` : null, o.busTickets ? `${o.busTickets} bus ticket` : null, o.bankrupt ? 'BANKRUPT' : null].filter(Boolean);
    lines.push(`- ${o.id} ${o.name}${o.id === p.id ? ' (you)' : ''}: cash £${o.cash}, on ${o.pos} ${game.sqName(o.pos)}, net worth £${o.bankrupt ? 0 : game.netWorth(o)}${flags.length ? ' [' + flags.join(', ') + ']' : ''}`);
  }
  lines.push('Properties (index name: owner, buildings, status):');
  const groups = {};
  for (const i of Object.keys(game.props).map(Number)) {
    const s = game.board[i], pr = game.props[i];
    const g = GROUPS[s.group].name;
    const lvl = pr.level === 0 ? '' : pr.level === HOTEL ? ', hotel' : pr.level === SKYSCRAPER ? ', skyscraper' : `, ${pr.level} house${pr.level > 1 ? 's' : ''}`;
    const st = pr.mortgaged ? ', MORTGAGED' : '';
    const dep = pr.depot ? ', depot' : '';
    (groups[g] = groups[g] || []).push(`${i} ${s.name}: ${pr.owner ? pr.owner : 'unowned'}${lvl}${st}${dep}`);
  }
  for (const [g, arr] of Object.entries(groups)) lines.push(`  ${g}: ` + arr.join(' | '));
  lines.push(`Bank: ${game.bank.houses} houses, ${game.bank.hotels} hotels${game.edition === 'mega' ? `, ${game.bank.skyscrapers} skyscrapers, ${game.bank.depots} depots, ${game.bank.busTickets} bus tickets` : ''}.`);
  const recent = game.chat.filter((c) => c.to == null || c.to === p.id || c.from === p.id).slice(-30);
  if (recent.length) {
    lines.push('RECENT TABLE TALK:');
    for (const c of recent) lines.push(`- [r${c.round}] ${game.player(c.from).name}${c.to ? ` (privately to ${c.to === p.id ? 'you' : game.player(c.to).name})` : ''}: ${c.message}`);
  }
  return lines.join('\n');
}

export function decisionText(game, p, type, ctx) {
  switch (type) {
    case 'buy':
      return `DECISION: buy\nYou landed on ${ctx.property.i} ${ctx.property.name} [${GROUPS[ctx.property.group].name}], list price £${ctx.property.price}. You have £${ctx.cash}. If you decline it is auctioned.\nRespond: {"buy": true|false, "say": "...", "reason": "..."}`;
    case 'bid':
      return `DECISION: bid\nSealed-bid auction for ${ctx.property.i} ${ctx.property.name} [${GROUPS[ctx.property.group].name}], list price £${ctx.property.price}. Bidders: ${ctx.bidders.join(', ')}. You have £${ctx.cash}. Highest bid wins and pays that amount; 0 means no bid.\nRespond: {"bid": <integer 0..${ctx.cash}>, "say": "...", "reason": "..."}`;
    case 'trade_response': {
      const o = ctx.offer;
      return `DECISION: trade_response${ctx.round ? ` (negotiation round ${ctx.round + 1})` : ''}\n${game.player(o.from).name} (${o.from}) offers you: ${o.giveNames.length ? o.giveNames.map((n, k) => `${o.give.props[k]} ${n}`).join(', ') : 'no properties'}${o.give.cash ? ` + £${o.give.cash}` : ''}. In return they want: ${o.getNames.length ? o.getNames.map((n, k) => `${o.get.props[k]} ${n}`).join(', ') : 'no properties'}${o.get.cash ? ` + £${o.get.cash}` : ''}.${o.message ? ` Their message: "${o.message}"` : ''}\nYou may accept, reject, or counter with your own offer (written from YOUR side: "give" is what you hand over, "get" is what you receive; only properties without buildings).\nRespond: {"accept": true|false, "counter": {"give": {"properties": [i], "cash": n}, "get": {"properties": [i], "cash": n}, "message": "..."} (optional, only when accept is false), "say": "...", "reason": "..."}`;
    }
    case 'choose_space':
      return `DECISION: choose_space (${ctx.purpose === 'triples' ? 'you rolled TRIPLES and may move to any square' : 'choose a square'})\nOptions (index name, owner): ${ctx.options.map((o) => `${o.i} ${o.name}${o.price ? ` £${o.price} ${o.owner ? 'owner ' + o.owner : 'unowned'}` : ''}`).join('; ')}\nRespond: {"space": <index>, "reason": "..."}`;
    case 'choose_property':
      return `DECISION: choose_property\nYou landed on the Auction square: choose an unowned property to be auctioned among all players. Options: ${ctx.options.map((o) => `${o.i} ${o.name} £${o.price}`).join('; ')}\nRespond: {"property": <index>, "reason": "..."}`;
    case 'reply':
      return `DECISION: reply\n${ctx.fromName} (${ctx.from}) just ${ctx.private ? 'said to you privately' : 'said at the table'}: "${ctx.message}"\nAnswer them if you want to (or stay silent with empty strings). You cannot take game actions here; propose trades on your own turn.\nRespond: {"say": "...", "tell": {"to": "${ctx.from}", "message": "..."}, "reason": "..."}`;
    case 'raise_cash':
      return `DECISION: raise_cash\nYou owe £${ctx.needed} (${ctx.reason}) but have £${ctx.cash}: shortfall £${ctx.shortfall}. Choose what to liquidate, in order. Sell options (refund each): ${ctx.canSell.map((s) => `${s.i} ${s.name} level ${s.level} → £${s.refund}`).join('; ') || 'none'}. Mortgage options: ${ctx.canMortgage.map((m) => `${m.i} ${m.name} → £${m.value}`).join('; ') || 'none'}.\nRespond: {"actions": [{"type": "mortgage", "property": i} | {"type": "sell_house", "property": i, "count": n}], "reason": "..."}`;
    case 'preroll': {
      const parts = ['DECISION: preroll (before you roll). Choose any legal actions, or none.'];
      if (ctx.inJail) parts.push(`You are in Jail (turn ${ctx.jailTurns + 1} of 3). Choose "jail": "pay" (£${game.config.jailFine}), "card" (you hold ${ctx.jailCards}), or "roll" (try for doubles).`);
      parts.push(`Build options (index name current level → cost per step): ${ctx.canBuild.map((b) => `${b.i} ${b.name} L${b.level} → £${b.cost}`).join('; ') || 'none'}`);
      if (ctx.canDepot && ctx.canDepot.length) parts.push(`Depot options: ${ctx.canDepot.map((d) => `${d.i} ${d.name} £100`).join('; ')}`);
      parts.push(`Sell buildings: ${ctx.canSell.map((s) => `${s.i} ${s.name} L${s.level} → +£${s.refund}`).join('; ') || 'none'}`);
      parts.push(`Mortgage: ${ctx.canMortgage.map((m) => `${m.i} ${m.name} → +£${m.value}`).join('; ') || 'none'}`);
      parts.push(`Unmortgage: ${ctx.canUnmortgage.map((m) => `${m.i} ${m.name} → -£${m.cost}`).join('; ') || 'none'}`);
      if (ctx.busTargets.length) parts.push(`Bus ticket: instead of rolling, move to one of: ${ctx.busTargets.map((i) => `${i} ${game.sqName(i)}`).join('; ')}`);
      const others = game.alive().filter((o) => o.id !== p.id);
      const tradeable = others.map((o) => `${o.id}: ${game.ownedBy(o).filter((i) => game.props[i].level === 0).map((i) => `${i} ${game.sqName(i)}`).join(', ') || 'nothing tradeable'}`);
      parts.push(`Trade: you may propose trades (each one is negotiated to a conclusion before the next). Only properties without buildings can change hands. Opponents' tradeable properties: ${tradeable.join(' || ')}`);
      parts.push('Respond: {"actions": [ {"type":"build","property":i,"count":n} | {"type":"sell_house","property":i,"count":n} | {"type":"mortgage","property":i} | {"type":"unmortgage","property":i} | {"type":"build_depot","property":i} | {"type":"use_bus_ticket","target":i} | {"type":"propose_trade","to":"playerId","give":{"properties":[i],"cash":n},"get":{"properties":[i],"cash":n},"message":"your pitch, said aloud"} ], "jail": "pay"|"card"|"roll", "say": "...", "tell": {"to": "playerId", "message": "..."}, "reason": "..."}  Use an empty actions array to do nothing. Actions are applied in order and each must be affordable at that point.');
      return parts.join('\n');
    }
    default:
      return `DECISION: ${type}\n${JSON.stringify(ctx)}`;
  }
}

export function parseJsonReply(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch { /* try repair */ }
  try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch { return null; }
}

export class AIDecider {
  // playerConfigs: { [playerId]: { provider, model, effort, instructions, temperature } }
  // options: { keys: {provider: key}, baseUrls: {provider: url}, universal, maxTokens, timeoutMs, concurrency, logPrompts }
  constructor(playerConfigs, options = {}) {
    this.cfg = playerConfigs;
    this.opt = { maxTokens: 4000, timeoutMs: 600000, concurrency: 8, logPrompts: true, ...options };
    this.cache = new WeakMap();
  }

  systemBlocks(game, p) {
    let shared = this.cache.get(game);
    if (!shared) { shared = `${rulesText(game)}\n\n${boardText(game)}`; this.cache.set(game, shared); }
    const pc = this.cfg[p.id] || {};
    const personal = [`You are playing as ${p.name} (id "${p.id}").`];
    if (this.opt.universal && this.opt.universal.trim()) personal.push(`UNIVERSAL STRATEGY INSTRUCTIONS (given to every player):\n${this.opt.universal.trim()}`);
    if (pc.instructions && pc.instructions.trim()) personal.push(`YOUR PERSONAL STRATEGY INSTRUCTIONS:\n${pc.instructions.trim()}`);
    return [{ text: shared, cache: true }, { text: personal.join('\n\n'), cache: false }];
  }

  async decide({ game, player: p, type, ctx }) {
    const pc = this.cfg[p.id] || { provider: 'heuristic' };
    if (!pc.provider || pc.provider === 'heuristic' || PROVIDERS[pc.provider]?.kind === 'none') {
      return { ...heuristicDecide(game, p, type, ctx), __source: 'heuristic' };
    }
    const system = this.systemBlocks(game, p);
    const user = `${stateText(game, p)}\n\n${decisionText(game, p, type, ctx)}`;
    const rec = {
      seq: ++game.seq, game: game.id, round: game.round, turn: game.turn, player: p.id, playerName: p.name, decision: type,
      provider: pc.provider, model: pc.model, effort: pc.effort || null, startedAt: Date.now(),
      system: this.opt.logPrompts ? system.map((b) => b.text) : undefined, user: this.opt.logPrompts ? user : undefined,
    };
    p.stats.llmCalls++;
    try {
      const out = await callModel({
        provider: pc.provider, model: pc.model, effort: pc.effort, apiKey: this.opt.keys[pc.provider], baseUrl: this.opt.baseUrls[pc.provider] || pc.baseUrl,
        system, user, maxTokens: this.opt.maxTokens, temperature: pc.temperature == null || pc.temperature === '' ? null : Number(pc.temperature),
        timeoutMs: this.opt.timeoutMs, signal: this.opt.signal, concurrency: this.opt.concurrency, price: pc.price || null,
      });
      rec.latencyMs = out.latencyMs;
      rec.usage = out.usage;
      rec.cost = out.cost; rec.costSource = out.costSource;
      rec.stopReason = out.stopReason;
      rec.servedModel = out.servedModel || null;
      rec.response = out.text;
      const parsed = parseJsonReply(out.text);
      rec.parsed = parsed;
      if (!parsed) {
        rec.error = 'unparseable response';
        rec.fallback = true;
        game.llmCalls.push(rec); game.onLlm(rec, game);
        game.log('ai_fallback', { player: p.id, decision: type, reason: rec.error });
        return { ...heuristicDecide(game, p, type, ctx), __source: 'heuristic-fallback', reason: 'fallback: unparseable reply' };
      }
      game.llmCalls.push(rec); game.onLlm(rec, game);
      return { ...parsed, __source: 'ai' };
    } catch (e) {
      rec.latencyMs = Date.now() - rec.startedAt;
      rec.error = String(e && e.message || e);
      rec.fallback = true;
      game.llmCalls.push(rec); game.onLlm(rec, game);
      game.log('ai_fallback', { player: p.id, decision: type, reason: rec.error });
      return { ...heuristicDecide(game, p, type, ctx), __source: 'heuristic-fallback', reason: `fallback: ${rec.error.slice(0, 120)}` };
    }
  }
}
