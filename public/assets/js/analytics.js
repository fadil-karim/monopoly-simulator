// Aggregations and small SVG charts for saved game records.

export function aggregate(records) {
  const byKey = {};
  for (const r of records) {
    if (!r.result || !r.result.ranking) continue;
    const n = r.players.length;
    for (const p of r.players) {
      const key = `${p.name} · ${p.provider === 'heuristic' ? 'heuristic' : p.model || p.provider}${p.effort ? ' @' + p.effort : ''}`;
      const a = byKey[key] || (byKey[key] = { key, name: p.name, provider: p.provider, model: p.model, effort: p.effort, games: 0, wins: 0, rankSum: 0, bankrupt: 0, netWorth: 0, calls: 0, fallbacks: 0, latency: 0, inTok: 0, outTok: 0, cached: 0, reasoning: 0, trades: 0, auctions: 0, bought: 0, rentCollected: 0, rentPaid: 0, illegal: 0 });
      a.games++;
      const rank = r.result.ranking.findIndex((x) => x.id === p.id) + 1;
      a.rankSum += rank / n;
      if (r.result.winnerId === p.id) a.wins++;
      if (p.bankrupt) a.bankrupt++;
      a.netWorth += p.finalNetWorth || 0;
      a.trades += p.stats.trades; a.auctions += p.stats.auctionsWon; a.bought += p.stats.bought; a.rentCollected += p.stats.rentCollected; a.rentPaid += p.stats.rentPaid;
      for (const c of r.llmCalls || []) {
        if (c.player !== p.id) continue;
        a.calls++;
        if (c.fallback) a.fallbacks++;
        a.latency += c.latencyMs || 0;
        if (c.usage) { a.inTok += c.usage.input || 0; a.outTok += c.usage.output || 0; a.cached += c.usage.cached || 0; a.reasoning += c.usage.reasoning || 0; }
      }
      for (const e of r.events || []) if (e.type === 'illegal_decision' && e.player === p.id) a.illegal++;
    }
  }
  return Object.values(byKey).sort((a, b) => b.wins / b.games - a.wins / a.games);
}

export function csvSummary(records) {
  const rows = [['game', 'created', 'batch', 'edition', 'rounds', 'turns', 'endReason', 'durationMs', 'winner', 'player', 'provider', 'model', 'effort', 'rank', 'finalNetWorth', 'finalCash', 'bankrupt', 'bankruptRound', 'llmCalls', 'fallbacks', 'trades', 'auctionsWon', 'bought', 'rentCollected', 'rentPaid']];
  for (const r of records) {
    for (const p of r.players) {
      const rank = r.result && r.result.ranking ? r.result.ranking.findIndex((x) => x.id === p.id) + 1 : '';
      rows.push([r.id, r.createdAt, r.batchId || '', r.edition, r.result?.rounds ?? '', r.result?.turns ?? '', r.result?.endReason ?? '', r.result?.durationMs ?? '', r.result?.winnerName ?? '', p.name, p.provider, p.model || '', p.effort || '', rank, p.finalNetWorth, p.finalCash, p.bankrupt, p.bankruptRound ?? '', p.stats.llmCalls, p.stats.fallbacks, p.stats.trades, p.stats.auctionsWon, p.stats.bought, p.stats.rentCollected, p.stats.rentPaid]);
    }
  }
  return rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function barChart(items, { width = 900, height = 260, valueLabel = (v) => v } = {}) {
  // items: [{label, value, colour}]
  const padL = 64, padB = 50, padT = 10, padR = 10;
  const max = Math.max(1, ...items.map((i) => i.value));
  const w = (width - padL - padR) / Math.max(1, items.length);
  let s = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const y = padT + (height - padT - padB) * (1 - k / 4);
    s += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/><text x="${padL - 4}" y="${y + 4}" text-anchor="end">${valueLabel(Math.round((max * k) / 4 * 100) / 100)}</text>`;
  }
  items.forEach((it, idx) => {
    const h = (height - padT - padB) * (it.value / max);
    const x = padL + idx * w + w * 0.15;
    const y = height - padB - h;
    s += `<rect x="${x}" y="${y}" width="${w * 0.7}" height="${h}" rx="3" fill="${esc(it.colour || '#1a7f4b')}"><title>${esc(it.label)}: ${esc(valueLabel(it.value))}</title></rect>`;
    s += `<text x="${x + w * 0.35}" y="${height - padB + 14}" text-anchor="middle">${esc(it.label.length > 16 ? it.label.slice(0, 15) + '…' : it.label)}</text>`;
  });
  s += `<line class="axis" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"/></svg>`;
  return s;
}

export function lineChart(series, { width = 900, height = 300, yLabel = (v) => v } = {}) {
  // series: [{label, colour, points: [{x, y}]}]
  const padL = 64, padB = 28, padT = 10, padR = 10;
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const xMax = Math.max(1, ...xs), yMax = Math.max(1, ...ys);
  const X = (x) => padL + ((width - padL - padR) * x) / xMax;
  const Y = (y) => padT + (height - padT - padB) * (1 - y / yMax);
  let s = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const y = Y((yMax * k) / 4);
    s += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/><text x="${padL - 4}" y="${y + 4}" text-anchor="end">${yLabel(Math.round((yMax * k) / 4))}</text>`;
  }
  for (let k = 0; k <= 5; k++) {
    const x = X((xMax * k) / 5);
    s += `<text x="${x}" y="${height - 8}" text-anchor="middle">${Math.round((xMax * k) / 5)}</text>`;
  }
  for (const se of series) {
    const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    s += `<path d="${d}" fill="none" stroke="${esc(se.colour)}" stroke-width="2"><title>${esc(se.label)}</title></path>`;
  }
  s += `<line class="axis" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"/><text x="${width / 2}" y="${height}" text-anchor="middle">round</text></svg>`;
  return s;
}
