// Aggregations over the stored games for the two statistics pages.
import { makeBoard, GROUPS, EDITION_INFO } from '../public/assets/app/board.js';

const EXPECTED = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);
const parse = (s, d) => { if (s == null) return d; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return d; } };
const avg = (sum, n) => (n ? Math.round((sum / n) * 100) / 100 : 0);

// games: rows of the games table (finished), with summary JSON.
export function aggregateMonopoly(games) {
  const out = { games: games.length, byEdition: {}, endReasons: {}, rolls: new Array(13).fill(0), rollCount: 0, expected: EXPECTED, lengths: {}, boards: {} };
  const sums = { rounds: 0, turns: 0, durationMs: 0, trades: 0, auctions: 0, bought: 0, bankruptcies: 0, housesBuilt: 0, rent: 0, bankIn: 0, bankOut: 0, between: 0, go: 0, winnerNetWorth: 0, players: 0, messages: 0 };
  for (const g of games) {
    const s = parse(g.summary, {});
    const m = s.match || {};
    const ed = g.edition || s.edition || 'standard';
    out.byEdition[ed] = (out.byEdition[ed] || 0) + 1;
    const er = g.end_reason || s.endReason || 'unknown';
    out.endReasons[er] = (out.endReasons[er] || 0) + 1;
    sums.rounds += g.rounds || s.rounds || 0;
    sums.turns += g.turns || s.turns || 0;
    sums.durationMs += g.duration_ms || s.durationMs || 0;
    sums.trades += m.trades || 0; sums.auctions += m.auctions || 0; sums.bought += m.bought || 0;
    sums.bankruptcies += s.bankruptcies || 0; sums.housesBuilt += s.housesBuilt || 0;
    sums.rent += m.rent || 0; sums.bankIn += m.bankIn || 0; sums.bankOut += m.bankOut || 0; sums.between += m.between || 0; sums.go += m.go || 0;
    sums.winnerNetWorth += (s.winner && s.winner.netWorth) || 0;
    sums.players += s.players || 0;
    sums.messages += s.messages || 0;
    if (Array.isArray(m.rolls)) for (let t = 2; t <= 12; t++) { out.rolls[t] += m.rolls[t] || 0; }
    out.rollCount += m.rollCount || 0;
    const bucket = Math.floor((g.rounds || s.rounds || 0) / 10) * 10;
    out.lengths[bucket] = (out.lengths[bucket] || 0) + 1;
    const b = out.boards[ed] || (out.boards[ed] = { games: 0, squares: {} });
    b.games++;
    for (const [i, ps] of Object.entries(s.props || {})) {
      const q = b.squares[i] || (b.squares[i] = { landings: 0, rent: 0, bought: 0, auction: 0, auctionPrice: 0, ownerChanges: 0, maxLevelSum: 0 });
      q.landings += ps.landings || 0; q.rent += ps.rent || 0;
      if (ps.bought != null) q.bought++;
      if (ps.auction) { q.auction++; q.auctionPrice += ps.price || 0; }
      q.ownerChanges += ps.ownerChanges || 0;
      q.maxLevelSum += ps.maxLevel || 0;
    }
  }
  const n = games.length;
  out.avg = { rounds: avg(sums.rounds, n), turns: avg(sums.turns, n), durationMs: Math.round(n ? sums.durationMs / n : 0), trades: avg(sums.trades, n), auctions: avg(sums.auctions, n), bought: avg(sums.bought, n), bankruptcies: avg(sums.bankruptcies, n), housesBuilt: avg(sums.housesBuilt, n), rent: avg(sums.rent, n), bankIn: avg(sums.bankIn, n), bankOut: avg(sums.bankOut, n), between: avg(sums.between, n), go: avg(sums.go, n), winnerNetWorth: avg(sums.winnerNetWorth, n), players: avg(sums.players, n), messages: avg(sums.messages, n) };
  out.rollShare = out.rolls.map((c) => (out.rollCount ? c / out.rollCount : 0));
  for (const [ed, b] of Object.entries(out.boards)) {
    const board = makeBoard(ed);
    b.label = EDITION_INFO[ed] ? EDITION_INFO[ed].label : ed;
    const groups = {};
    b.squares = board.map((sq) => {
      const q = b.squares[sq.i] || { landings: 0, rent: 0, bought: 0, auction: 0, auctionPrice: 0, ownerChanges: 0, maxLevelSum: 0 };
      const row = { i: sq.i, name: sq.name, type: sq.type, group: sq.group || null, price: sq.price || null, landingsPerGame: avg(q.landings, b.games), rentPerGame: avg(q.rent, b.games), boughtShare: sq.price ? avg(q.bought, b.games) : null, auctionShare: sq.price ? avg(q.auction, b.games) : null, avgAuctionPrice: q.auction ? Math.round(q.auctionPrice / q.auction) : null, ownerChangesPerGame: sq.price ? avg(q.ownerChanges, b.games) : null, avgMaxLevel: sq.type === 'street' ? avg(q.maxLevelSum, b.games) : null };
      if (sq.group && GROUPS[sq.group]) { const gr = groups[sq.group] || (groups[sq.group] = { group: sq.group, name: GROUPS[sq.group].name, colour: GROUPS[sq.group].colour, rent: 0, landings: 0 }); gr.rent += q.rent; gr.landings += q.landings; }
      return row;
    });
    b.groups = Object.values(groups).map((gr) => ({ ...gr, rentPerGame: avg(gr.rent, b.games), landingsPerGame: avg(gr.landings, b.games) })).sort((a, c) => c.rentPerGame - a.rentPerGame);
  }
  return out;
}

// players: rows of game_players joined to finished games.
export function aggregateModels(players) {
  const by = {};
  for (const r of players) {
    const st = parse(r.stats, {});
    const eng = st.engine || {}, inc = st.income || {}, calls = st.calls || {};
    const a = by[r.model_key] || (by[r.model_key] = {
      key: r.model_key, provider: r.provider, model: r.model, effort: r.effort || null, names: {}, servedModels: {}, colours: {},
      games: 0, wins: 0, rankSum: 0, netWorth: 0, cash: 0, bankrupt: 0, bankruptRoundSum: 0,
      rentCollected: 0, rentPaid: 0, bought: 0, auctionsWon: 0, trades: 0, housesBuilt: 0, jail: 0, messages: 0,
      madeTotal: 0, madeRent: 0, madeGo: 0, madeBank: 0, madePlayers: 0, paidTotal: 0,
      calls: 0, fallbacks: 0, illegal: 0, errors: 0, latencyMs: 0, input: 0, output: 0, cached: 0, reasoning: 0,
      rolls: new Array(13).fill(0), rollCount: 0, turns: 0,
    });
    a.games++;
    a.names[r.name] = (a.names[r.name] || 0) + 1;
    if (r.colour) a.colours[r.colour] = (a.colours[r.colour] || 0) + 1;
    for (const [m, c] of Object.entries(calls.servedModels || {})) a.servedModels[m] = (a.servedModels[m] || 0) + c;
    if (r.rank === 1) a.wins++;
    a.rankSum += r.rank || 0;
    a.netWorth += r.final_net_worth || 0; a.cash += r.final_cash || 0;
    if (r.bankrupt) { a.bankrupt++; a.bankruptRoundSum += r.bankrupt_round || 0; }
    a.rentCollected += eng.rentCollected || 0; a.rentPaid += eng.rentPaid || 0; a.bought += eng.bought || 0; a.auctionsWon += eng.auctionsWon || 0;
    a.trades += eng.trades || 0; a.housesBuilt += eng.housesBuilt || 0; a.jail += eng.jail || 0; a.messages += eng.messages || 0;
    a.madeTotal += inc.total || 0; a.madeRent += inc.rentTotal || 0; a.madeGo += inc.go || 0; a.madeBank += inc.bank || 0; a.madePlayers += inc.players || 0; a.paidTotal += inc.paidTotal || 0;
    a.calls += calls.n || 0; a.fallbacks += calls.fallbacks || 0; a.illegal += calls.illegal || 0; a.errors += calls.errors || 0; a.latencyMs += calls.latencyMs || 0;
    a.input += calls.input || 0; a.output += calls.output || 0; a.cached += calls.cached || 0; a.reasoning += calls.reasoning || 0;
    if (Array.isArray(st.rolls)) for (let t = 2; t <= 12; t++) a.rolls[t] += st.rolls[t] || 0;
    a.rollCount += st.rollCount || 0; a.turns += st.turns || 0;
  }
  const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k]) => k)[0] || null;
  const models = Object.values(by).map((a) => {
    const n = a.games;
    let rollSum = 0; for (let t = 2; t <= 12; t++) rollSum += t * a.rolls[t];
    return {
      key: a.key, provider: a.provider, model: a.model, effort: a.effort, name: top(a.names), colour: top(a.colours), servedModels: a.servedModels,
      games: n, wins: a.wins, winRate: n ? a.wins / n : 0, avgRank: avg(a.rankSum, n), avgNetWorth: Math.round(n ? a.netWorth / n : 0), avgCash: Math.round(n ? a.cash / n : 0),
      bankruptcies: a.bankrupt, bankruptRate: n ? a.bankrupt / n : 0, avgBankruptRound: avg(a.bankruptRoundSum, a.bankrupt),
      perGame: { rentCollected: avg(a.rentCollected, n), rentPaid: avg(a.rentPaid, n), bought: avg(a.bought, n), auctionsWon: avg(a.auctionsWon, n), trades: avg(a.trades, n), housesBuilt: avg(a.housesBuilt, n), jail: avg(a.jail, n), messages: avg(a.messages, n), made: avg(a.madeTotal, n), madeRent: avg(a.madeRent, n), madeGo: avg(a.madeGo, n), madeBank: avg(a.madeBank, n), madePlayers: avg(a.madePlayers, n), paid: avg(a.paidTotal, n), calls: avg(a.calls, n), turns: avg(a.turns, n) },
      calls: { n: a.calls, fallbacks: a.fallbacks, illegal: a.illegal, errors: a.errors, avgLatencyMs: a.calls ? Math.round(a.latencyMs / a.calls) : 0, input: a.input, output: a.output, cached: a.cached, reasoning: a.reasoning, avgInput: a.calls ? Math.round(a.input / a.calls) : 0, avgOutput: a.calls ? Math.round(a.output / a.calls) : 0 },
      rolls: a.rolls, rollCount: a.rollCount, rollMean: a.rollCount ? Math.round((rollSum / a.rollCount) * 100) / 100 : null,
    };
  }).sort((x, y) => y.winRate - x.winRate || y.avgNetWorth - x.avgNetWorth);
  return { models, games: new Set(players.map((r) => r.game_id)).size };
}
