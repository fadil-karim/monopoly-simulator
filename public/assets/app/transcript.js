// One line of plain English per event, shared by the viewer's feeds, the
// runner's recap prompt and the Worker's transcript endpoint. A game dressed
// for another edition (names.js) supplies sqName, displayName, displayText
// and fmtMoney; a bare engine game reads as London in pounds.
function nm(game, id) { const p = game.player(id); return p ? p.name : id; }

// A duration as people say it: 850 ms, 42 s, 3 min 5 s.
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}
// What a forfeited choice came to, for the line that reports it.
const FORFEITED = {
  preroll: 'it does nothing before the roll', buy: 'it does not buy', bid: 'it bids nothing', trade_response: 'the offer is rejected',
  reply: 'it says nothing', raise_cash: "the bank's forced sale settles the debt", choose_space: 'it stays put', choose_property: 'nothing is auctioned',
};
const FORFEIT_KINDS = { error: 'the call failed', none: 'no answer', empty: 'an empty answer', unparseable: 'no JSON in the answer', invalid: 'an answer against the rules' };
// The question a forfeit was the answer to.
const QUESTION = {
  preroll: 'its question before the roll', buy: 'the offer to buy', bid: 'the auction', trade_response: 'the trade offer', reply: 'the table talk',
  raise_cash: 'what to sell to pay', choose_space: 'where to go on triples', choose_property: 'what to auction',
};

export function fmtEvent(e, game) {
  const P = (id) => nm(game, id);
  const S = (i) => (i == null ? '' : game.sqName(i));
  const N = (name) => (game.displayName ? game.displayName(name) : name);
  const T = (text) => (game.displayText ? game.displayText(text) : text);
  const M = (n) => (game.fmtMoney ? game.fmtMoney(n) : '£' + n);
  const offer = (o) => `${o.props.map(S).join(', ') || '—'}${o.cash ? ' + ' + M(o.cash) : ''}`;
  switch (e.type) {
    case 'game_start': return `Game ${game.id} starts (${e.edition}, seed ${e.seed}).`;
    case 'turn_start': return `— ${P(e.player)}'s turn (${M(e.cash)}) —`;
    case 'roll': return `rolls ${e.dice.join('+')}${e.speed != null ? ' + ' + (e.speed === 'mr' ? 'Mr Monopoly' : e.speed === 'bus' ? 'Bus' : e.speed) : ''}${e.triples ? ' TRIPLES!' : e.doubles ? ' (doubles)' : ''}${e.purpose ? ' [' + e.purpose + ']' : ''}`;
    case 'move': return `moves to ${e.to} ${S(e.to)}${e.via && e.via !== 'direct' ? ' (' + e.via + ')' : ''}`;
    case 'pass_go': return `passes ${S(0)}, collects ${M(e.amount)}`;
    case 'buy_decision': return `${e.buy ? 'buys' : 'declines'} ${S(e.property)}${e.reason ? ' — ' + T(e.reason) : ''}`;
    case 'purchase': return `buys ${S(e.property)} for ${M(e.price)} (cash ${M(e.cash)})`;
    case 'auction_start': return `AUCTION for ${S(e.property)} (list ${M(e.price)})`;
    case 'auction_bids': return `bids: ${e.bids.map((b) => `${P(b.player)} ${M(b.bid)}`).join(', ')}`;
    case 'auction_won': return `${P(e.player)} wins ${S(e.property)} at auction for ${M(e.price)}`;
    case 'auction_unsold': return `${S(e.property)} unsold`;
    case 'rent_due': return `owes ${M(e.amount)} rent to ${P(e.to)} for ${S(e.property)}`;
    case 'rent_skipped': return `no rent (mortgaged)`;
    case 'payment': return `${P(e.from)} pays ${M(e.amount)} to ${e.to === 'bank' ? 'the bank' : P(e.to)} (${T(e.reason)})`;
    case 'tax': return `${N(e.name)}: ${M(e.amount)}`;
    case 'card': return `draws ${e.deck === 'chance' ? N('Chance') : N('Community Chest')}: ${T(e.text)}`;
    case 'collect': return `collects ${M(e.amount)}`;
    case 'free_parking': return `collects the ${N('Free Parking')} pot, ${M(e.amount)}`;
    case 'go_to_jail': return `goes to Jail`;
    case 'jail_stay': return `stays in jail (turn ${e.jailTurns})`;
    case 'jail_escape': return `rolls doubles and leaves jail`;
    case 'jail_fine_paid': return `pays ${M(e.amount)} to leave jail`;
    case 'jail_forced_fine': return `must pay ${M(e.amount)} after three turns in jail`;
    case 'jail_card_used': return `uses a Get Out of Jail Free card`;
    case 'jail_card_received': return `keeps a Get Out of Jail Free card`;
    case 'build': return `builds on ${S(e.property)} → level ${e.level} (${M(e.cost)})`;
    case 'sell_building': return `sells a building on ${S(e.property)} → level ${e.level} (+${M(e.refund)})`;
    case 'mortgage': return `mortgages ${S(e.property)} (+${M(e.value)})`;
    case 'unmortgage': return `unmortgages ${S(e.property)} (−${M(e.cost)})`;
    case 'build_depot': return `builds a depot on ${S(e.property)}`;
    case 'raise_cash': return `must raise ${M(e.needed)} (has ${M(e.cash)}) for ${T(e.reason)}`;
    case 'bankrupt': return `${P(e.player)} is BANKRUPT (owed ${M(e.owed)} to ${e.creditor === 'bank' ? 'the bank' : P(e.creditor)})`;
    case 'assets_transferred': return `assets go to ${P(e.to)}`;
    case 'trade_proposed': return `${P(e.from)} proposes to ${P(e.to)}: gives ${offer(e.give)} for ${offer(e.get)}${e.message ? ' — "' + T(e.message) + '"' : ''}`;
    case 'trade_response': return `${P(e.to)} ${e.accept ? 'ACCEPTS' : 'rejects'}${e.reason ? ' — ' + T(e.reason) : ''}`;
    case 'trade_counter': return `${P(e.from)} counters: gives ${offer(e.give)} for ${offer(e.get)}${e.reason ? ' — ' + T(e.reason) : ''}`;
    case 'trade_lapsed': return `negotiation between ${P(e.from)} and ${P(e.to)} ends without a deal`;
    case 'trade_completed': return `trade completed: ${P(e.from)} gives ${offer(e.give)}, ${P(e.to)} gives ${offer(e.get)}`;
    case 'chat': return e.to ? `whispers to ${P(e.to)}: “${T(e.message)}”` : `says: “${T(e.message)}”`;
    case 'repairs': return `repairs: ${e.houses} houses, ${e.hotels} hotels → ${M(e.amount)}`;
    case 'mr_monopoly': return e.kind === 'nothing' ? 'Mr Monopoly: nothing to move to' : `Mr Monopoly sends ${P(e.player)} to ${S(e.to)}`;
    case 'bus_ticket_taken': return `takes a bus ticket (${e.via})`;
    case 'bus_ticket_used': return `uses a bus ticket to move to ${S(e.to)}`;
    case 'bus_ticket_none': return 'no bus tickets left';
    case 'triples': return e.to == null ? 'TRIPLES, but no square chosen: stays put' : `TRIPLES: chooses ${S(e.to)}${e.reason ? ' — ' + T(e.reason) : ''}`;
    case 'auction_square': return e.result === 'no valid answer' ? 'Auction square, but no property chosen: nothing auctioned' : e.result ? 'Auction square: nothing to auction' : `Auction square: puts ${e.chosen != null ? S(e.chosen) : N(e.name)} up for auction`;
    case 'birthday_gift': return `Birthday Gift: ${M(e.amount)}`;
    case 'three_doubles': return `three doubles in a row!`;
    case 'forfeit': return `gives no valid answer to ${QUESTION[e.decision] || String(e.decision).replace(/_/g, ' ')} (${FORFEIT_KINDS[e.kind] || e.kind}: ${T(String(e.reason))}), so ${FORFEITED[e.decision] || 'the choice is forfeited'}`;
    case 'forced_sale': return `the bank's forced sale: owes ${M(e.needed)} with ${M(e.cash)} in hand`;
    case 'turn_end': return `finishes its turn in ${fmtDuration(e.ms)}`;
    case 'illegal_decision': return `(model gave an illegal ${e.decision} decision: ${T(e.reason)}; using fallback)`;
    case 'illegal_action': return `(illegal action ignored: ${T(e.reason)})`;
    case 'ai_fallback': return `(model call failed for ${e.decision}: ${e.reason}; heuristic used)`;
    case 'decider_error': return `(decider error for ${e.decision}: ${e.error})`;
    case 'engine_error': return `(engine error: ${String(e.error).slice(0, 200)})`;
    case 'game_end': return `GAME OVER after ${e.rounds} rounds: ${e.winnerName} wins (${e.endReason}).`;
    default: return `${e.type} ${JSON.stringify(e).slice(0, 120)}`;
  }
}

// Events whose actor is named inside the line already.
const SELF_NAMED = new Set(['payment', 'bankrupt', 'auction_won', 'trade_proposed', 'trade_response', 'trade_counter', 'trade_lapsed', 'trade_completed', 'mr_monopoly', 'turn_start', 'game_start', 'game_end', 'engine_error']);

// `round` is the game's round at the event, for a counter-offer logged before v1.19, which carried the negotiation's
// step in its place.
export function eventLine(e, game, round) {
  const who = e.player && !SELF_NAMED.has(e.type) ? nm(game, e.player) + ' ' : '';
  return `[r${e.type === 'trade_counter' && e.negotiationRound == null && round != null ? round : e.round}] ${who}${fmtEvent(e, game)}`;
}

const NOISE = new Set(['roll', 'move', 'turn_start', 'turn_end', 'buy_decision', 'rent_due', 'auction_start', 'auction_bids', 'raise_cash', 'jail_stay', 'illegal_action', 'rent_skipped', 'bus_ticket_none']);

// A plain-text account of a game for a reader or a model: the players, then
// one line per event. `compact` drops the dice, moves and other noise;
// `maxChars` trims the middle of a long game and says so.
export function transcript(game, { compact = false, maxChars = 0 } = {}) {
  const M = (n) => (game.fmtMoney ? game.fmtMoney(n) : '£' + n);
  const head = [`Monopoly, ${game.info ? game.info.label : game.edition}${game.nameSet && game.nameSet.id !== 'london' ? ` read as the ${game.nameSet.label} edition` : ''}. Game ${game.id}.`, 'Players, in seat order:'];
  for (const p of game.players) {
    const m = p.meta || {};
    head.push(`- ${p.name}: ${m.provider === 'heuristic' ? 'rule-based bot' : `${m.provider || '?'} ${m.model || ''}${m.effort ? ' @' + m.effort : ''}`}`);
  }
  head.push('');
  const lines = [];
  let round = 0;
  for (const e of game.events) {
    if (e.type !== 'trade_counter' && e.round != null) round = e.round;
    if (compact && NOISE.has(e.type)) continue;
    lines.push(eventLine(e, game, round));
  }
  const tail = [];
  if (game.result) {
    tail.push('');
    tail.push(`Result: ${game.result.winnerName} wins after ${game.result.rounds} rounds (${game.result.endReason}).`);
    for (const r of game.result.ranking || []) tail.push(`- ${r.name}: ${r.bankrupt ? `bankrupt in round ${r.bankruptRound}` : `net worth ${M(r.netWorth)}, cash ${M(r.cash)}`}`);
  }
  let body = lines.join('\n');
  const limit = maxChars ? maxChars - head.join('\n').length - tail.join('\n').length - 80 : 0;
  if (limit > 0 && body.length > limit) {
    const keepHead = Math.floor(limit * 0.45), keepTail = Math.floor(limit * 0.45);
    const dropped = body.length - keepHead - keepTail;
    body = `${body.slice(0, keepHead)}\n\n[... ${dropped.toLocaleString()} characters of the middle of the game left out ...]\n\n${body.slice(body.length - keepTail)}`;
  }
  return `${head.join('\n')}\n${body}${tail.length ? '\n' + tail.join('\n') : ''}\n`;
}
