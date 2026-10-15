// Small SVG charts for the statistics pages.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function barChart(items, { width = 900, height = 260, valueLabel = (v) => v, labelLength = 16 } = {}) {
  // items: [{label, value, colour}]; the labels turn when there are many bars
  const tilt = items.length > 8;
  const padL = 64, padB = tilt ? 72 : 50, padT = 10, padR = 10;
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  const w = (width - padL - padR) / Math.max(1, items.length);
  let s = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const y = padT + (height - padT - padB) * (1 - k / 4);
    s += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/><text x="${padL - 4}" y="${y + 4}" text-anchor="end">${esc(valueLabel(Math.round((max * k) / 4 * 100) / 100))}</text>`;
  }
  items.forEach((it, idx) => {
    const h = (height - padT - padB) * (it.value / max);
    const x = padL + idx * w + w * 0.15;
    const y = height - padB - h;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(w * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${esc(it.colour || '#ed1b24')}"><title>${esc(it.label)}: ${esc(valueLabel(it.value))}</title></rect>`;
    const lab = esc(it.label.length > labelLength ? it.label.slice(0, labelLength - 1) + '…' : it.label);
    const lx = (x + w * 0.35).toFixed(1), ly = height - padB + 14;
    s += tilt ? `<text x="${lx}" y="${ly}" text-anchor="end" transform="rotate(-35 ${lx} ${ly})">${lab}</text>` : `<text x="${lx}" y="${ly}" text-anchor="middle">${lab}</text>`;
  });
  s += `<line class="axis" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"/></svg>`;
  return s;
}
