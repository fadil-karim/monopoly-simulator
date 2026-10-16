// Small SVG charts for the statistics pages.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Horizontal bars, one row an item, largest first: its label with a second line (`sub`) under it on the left, the
// value at the end of its bar. It takes any number of rows and keeps every label whole.
export function hbarChart(items, { width = 900, row = 36, valueLabel = (v) => v, labelWidth = 240 } = {}) {
  const rows = [...items].sort((a, b) => b.value - a.value);
  const padT = 4, padR = 80;
  const height = padT * 2 + row * rows.length;
  const max = Math.max(1e-9, ...rows.map((i) => i.value));
  const span = width - labelWidth - padR;
  let s = `<svg class="chart hbar" viewBox="0 0 ${width} ${height}" role="img">`;
  rows.forEach((it, k) => {
    const y = padT + k * row;
    const w = Math.max(1, span * (it.value / max));
    s += `<text class="lab" x="${labelWidth - 10}" y="${y + (it.sub ? 15 : 22)}" text-anchor="end">${esc(it.label)}</text>`;
    if (it.sub) s += `<text class="sub" x="${labelWidth - 10}" y="${y + 29}" text-anchor="end">${esc(it.sub)}</text>`;
    s += `<rect x="${labelWidth}" y="${y + 7}" width="${w.toFixed(1)}" height="${row - 14}" rx="2" fill="${esc(it.colour || '#ed1b24')}"><title>${esc(it.label)}${it.sub ? ' · ' + esc(it.sub) : ''}: ${esc(valueLabel(it.value))}</title></rect>`;
    s += `<text class="val" x="${(labelWidth + w + 6).toFixed(1)}" y="${y + row / 2 + 4}">${esc(valueLabel(it.value))}</text>`;
  });
  s += `<line class="axis" x1="${labelWidth}" x2="${labelWidth}" y1="${padT}" y2="${height - padT}"/></svg>`;
  return s;
}

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
