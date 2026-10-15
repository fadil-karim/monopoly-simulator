// One line of plain English per event, shared by the viewer's feeds, the
// runner's recap prompt and the Worker's transcript endpoint.
function nm(game, id) { const p = game.player(id); return p ? p.name : id; }

export function fmtEvent(e, game) {
  const P = (id) => nm(game, id);
  const S = (i) => game.sqName(i);
  switch (e.type) {
    case 'game_start': return `Game ${game.id} starts (${e.edition}, seed ${e.seed}).`;
    case 'turn_start': return `— ${P(e.player)}'s turn (£${e.cash}) —`;
    case 'roll': return `rolls ${e.dice.join('+')}${e.speed != null ? ' + ' + (e.speed === 'mr' ? 'Mr Monopoly' : e.speed === 'bus' ? 'Bus' : e.speed) : ''}${e.triples ? ' TRIPLES!' : e.doubles ? ' (doubles)' : ''}${e.purpose ? ' [' + e.purpose + ']' : ''}`;
    case 'move': return `moves to ${e.to} ${e.square}${e.via && e.via !== 'direct' ? ' (' + e.via + ')' : ''}`;
    case 'pass_go': return `passes GO, collects £${e.amount}`;
    case 'buy_decision': return `${e.buy ? 'buys' : 'declines'} ${e.name}${e.reason ? ' — ' + e.reason : ''}`;
    case 'purchase': return `buys ${e.name} for £${e.price} (cash £${e.cash})`;
    case 'auction_start': return `AUCTION for ${e.name} (list £${e.price})`;
    case 'auction_bids': return `bids: ${e.bids.map((b) => `${P(b.player)} £${b.bid}`).join(', ')}`;
    case 'auction_won': return `${P(e.player)} wins ${e.name} at auction for £${e.price}`;
    case 'auction_unsold': return `${e.name} unsold`;
    case 'rent_due': return `owes £${e.amount} rent to ${P(e.to)} for ${e.name}`;
    case 'rent_skipped': return `no rent (mortgaged)`;
    case 'payment': return `${P(e.from)} pays £${e.amount} to ${e.to === 'bank' ? 'the bank' : P(e.to)} (${e.reason})`;
    case 'tax': return `${e.name}: £${e.amount}`;
    case 'card': return `draws ${e.deck === 'chance' ? 'Chance' : 'Community Chest'}: ${e.text}`;
    case 'collect': return `collects £${e.amount}`;
    case 'free_parking': return `collects the Free Parking pot, £${e.amount}`;
    case 'go_to_jail': return `goes to Jail`;
    case 'jail_stay': return `stays in jail (turn ${e.jailTurns})`;
    case 'jail_escape': return `rolls doubles and leaves jail`;
    case 'jail_fine_paid': return `pays £${e.amount} to leave jail`;
    case 'jail_forced_fine': return `must pay £${e.amount} after three turns in jail`;
    case 'jail_card_used': return `uses a Get Out of Jail Free card`;
    case 'jail_card_received': return `keeps a Get Out of Jail Free card`;
    case 'build': return `builds on ${e.name} → level ${e.level} (£${e.cost})`;
    case 'sell_building': return `sells a building on ${e.name} → level ${e.level} (+£${e.refund})`;
    case 'mortgage': return `mortgages ${e.name} (+£${e.value})`;
    case 'unmortgage': return `unmortgages ${e.name} (−£${e.cost})`;
    case 'build_depot': return `builds a depot on ${e.name}`;
    case 'raise_cash': return `must raise £${e.needed} (has £${e.cash}) for ${e.reason}`;
    case 'bankrupt': return `${P(e.player)} is BANKRUPT (owed £${e.owed} to ${e.creditor === 'bank' ? 'the bank' : P(e.creditor)})`;
    case 'assets_transferred': return `assets go to ${P(e.to)}`;
    case 'trade_proposed': return `${P(e.from)} proposes to ${P(e.to)}: gives ${e.give.props.map(S).join(', ') || '—'}${e.give.cash ? ' + £' + e.give.cash : ''} for ${e.get.props.map(S).join(', ') || '—'}${e.get.cash ? ' + £' + e.get.cash : ''}${e.message ? ' — "' + e.message + '"' : ''}`;
    case 'trade_response': return `${P(e.to)} ${e.accept ? 'ACCEPTS' : 'rejects'}${e.reason ? ' — ' + e.reason : ''}`;
    case 'trade_counter': return `${P(e.from)} counters: gives ${e.give.props.map(S).join(', ') || '—'}${e.give.cash ? ' + £' + e.give.cash : ''} for ${e.get.props.map(S).join(', ') || '—'}${e.get.cash ? ' + £' + e.get.cash : ''}${e.reason ? ' — ' + e.reason : ''}`;
    case 'trade_lapsed': return `negotiation between ${P(e.from)} and ${P(e.to)} ends without a deal`;
    case 'trade_completed': return `trade completed: ${P(e.from)} gives ${e.give.props.map(S).join(', ') || '—'}${e.give.cash ? ' + £' + e.give.cash : ''}, ${P(e.to)} gives ${e.get.props.map(S).join(', ') || '—'}${e.get.cash ? ' + £' + e.get.cash : ''}`;
    case 'chat': return e.to ? `whispers to ${P(e.to)}: “${e.message}”` : `says: “${e.message}”`;
    case 'repairs': return `repairs: ${e.houses} houses, ${e.hotels} hotels → £${e.amount}`;
    case 'mr_monopoly': return e.kind === 'nothing' ? 'Mr Monopoly: nothing to move to' : `Mr Monopoly sends ${P(e.player)} to ${e.name}`;
    case 'bus_ticket_taken': return `takes a bus ticket (${e.via})`;
    case 'bus_ticket_used': return `uses a bus ticket to move to ${S(e.to)}`;
    case 'bus_ticket_none': return 'no bus tickets left';
    case 'triples': return `TRIPLES: chooses ${e.name}${e.reason ? ' — ' + e.reason : ''}`;
    case 'auction_square': return e.result ? 'Auction square: nothing to auction' : `Auction square: puts ${e.name} up for auction`;
    case 'birthday_gift': return `Birthday Gift: £${e.amount}`;
    case 'three_doubles': return `three doubles in a row!`;
    case 'illegal_decision': return `(model gave an illegal ${e.decision} decision: ${e.reason}; using fallback)`;
    case 'illegal_action': return `(illegal action ignored: ${e.reason})`;
    case 'ai_fallback': return `(model call failed for ${e.decision}: ${e.reason}; heuristic used)`;
    case 'decider_error': return `(decider error for ${e.decision}: ${e.error})`;
    case 'engine_error': return `(engine error: ${String(e.error).slice(0, 200)})`;
    case 'game_end': return `GAME OVER after ${e.rounds} rounds: ${e.winnerName} wins (${e.endReason}).`;
    default: return `${e.type} ${JSON.stringify(e).slice(0, 120)}`;
  }
}

// Events whose actor is named inside the line already.
const SELF_NAMED = new Set(['payment', 'bankrupt', 'auction_won', 'trade_proposed', 'trade_response', 'trade_counter', 'trade_lapsed', 'trade_completed', 'mr_monopoly', 'turn_start', 'game_start', 'game_end', 'engine_error']);

export function eventLine(e, game) {
  const who = e.player && !SELF_NAMED.has(e.type) ? nm(game, e.player) + ' ' : '';
  return `[r${e.round}] ${who}${fmtEvent(e, game)}`;
}

const NOISE = new Set(['roll', 'move', 'turn_start', 'buy_decision', 'rent_due', 'auction_start', 'auction_bids', 'raise_cash', 'jail_stay', 'illegal_action', 'rent_skipped', 'bus_ticket_none']);

// A plain-text account of a game for a reader or a model: the players, then
// one line per event. `compact` drops the dice, moves and other noise;
// `maxChars` trims the middle of a long game and says so.
export function transcript(game, { compact = false, maxChars = 0 } = {}) {
  const head = [`Monopoly, ${game.info ? game.info.label : game.edition}. Game ${game.id}.`, 'Players, in seat order:'];
  for (const p of game.players) {
    const m = p.meta || {};
    head.push(`- ${p.name}: ${m.provider === 'heuristic' ? 'rule-based bot' : `${m.provider || '?'} ${m.model || ''}${m.effort ? ' @' + m.effort : ''}`}`);
  }
  head.push('');
  const lines = [];
  for (const e of game.events) {
    if (compact && NOISE.has(e.type)) continue;
    lines.push(eventLine(e, game));
  }
  const tail = [];
  if (game.result) {
    tail.push('');
    tail.push(`Result: ${game.result.winnerName} wins after ${game.result.rounds} rounds (${game.result.endReason}).`);
    for (const r of game.result.ranking || []) tail.push(`- ${r.name}: ${r.bankrupt ? `bankrupt in round ${r.bankruptRound}` : `net worth £${r.netWorth}, cash £${r.cash}`}`);
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
