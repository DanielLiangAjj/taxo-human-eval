// Shared pieces for the four SVG pictures: colours, text measuring and wrapping, pills, tooltip, motion.
/* global d3 */

export const C = {
  green: '#1B7F3B', amber: '#B26B00', red: '#B3261E', blue: '#1F5FBF', grey: '#BFC5CC',
  ink: '#1d232b', muted: '#56616c', boxLine: '#4b5560', cardLine: '#c3cad2',
  softBlue: '#e9f0fb', softRed: '#fcefee', softGrey: '#eef1f4',
};

export const LABEL_COLOR = {
  right: C.green, 'too broad': C.amber, wrong: C.red,
  'same measurement': C.green, 'same domain': C.amber, neither: C.red,
  'exact node': C.green, 'category only': C.amber, 'not covered': C.red,
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const W = 760; // viewBox width of every picture

const ctx2d = document.createElement('canvas').getContext('2d');

export function measure(text, size, weight = 400) {
  ctx2d.font = `${weight} ${size}px ${FONT}`;
  return ctx2d.measureText(String(text)).width;
}

/**
 * Greedy word wrap. Returns {lines, truncated}. `firstWidth` lets the first line be shorter (for a
 * letter badge in front of it): a word that does not fit there but fits a full line starts on the
 * next line. Lines may break after a hyphen between letters; a word wider than a whole line is
 * broken with a hyphen. Past `maxLines` the last kept line ends with an ellipsis.
 */
export function wrap(text, width, size, weight = 400, maxLines = Infinity, firstWidth = width) {
  const tokens = [];
  for (const word of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    word.replace(/([A-Za-z\u00C0-\u024F])-(?=[A-Za-z])/g, '$1-\u0000').split('\u0000')
      .forEach((part, i) => tokens.push({ text: part, space: i === 0 }));
  }
  const lines = [];
  let line = '';
  const limit = () => (lines.length === 0 ? firstWidth : width);
  const fits = (str) => measure(str, size, weight) <= limit();
  for (const tok of tokens) {
    let piece = tok.text;
    const trial = line ? `${line}${tok.space ? ' ' : ''}${piece}` : piece;
    if (fits(trial)) { line = trial; continue; }
    if (line) { lines.push(line); line = ''; }
    if (lines.length === 0 && !fits(piece) && measure(piece, size, weight) <= width) lines.push('');
    while (!fits(piece)) {
      let k = Math.max(1, piece.length - 1);
      while (k > 1 && !fits(`${piece.slice(0, k)}-`)) k -= 1;
      lines.push(`${piece.slice(0, k)}-`);
      piece = piece.slice(k);
    }
    line = piece;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  const lim = maxLines === 1 ? firstWidth : width;
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`, size, weight) > lim) {
    const cut = last.replace(/\s+\S*$/, '');
    last = cut && cut.length < last.length ? cut : last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last.replace(/[\s,;:]+$/, '')}…`;
  return { lines: kept, truncated: true };
}

/** One <text> with a <tspan> per line; y is the first baseline. */
export function textLines(parent, lines, { x, y, size, lh, weight = 400, fill = C.ink, anchor = 'start', cls = null }) {
  const t = parent.append('text')
    .attr('x', x).attr('y', y)
    .attr('font-size', size).attr('font-weight', weight)
    .attr('fill', fill).attr('text-anchor', anchor);
  if (cls) t.attr('class', cls);
  lines.forEach((line, i) => t.append('tspan').attr('x', x).attr('y', y + i * lh).text(line));
  return t;
}

/** Registered descriptions carry markdown escapes such as \[ and \*; show the plain characters. */
export const cleanText = (s) => (s == null ? '' : String(s).replace(/\\([\\`*_{}[\]()#+\-.!<>&^|~])/g, '$1'));

export const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export const KIND_STYLE = {
  'bottom node': { fill: C.softGrey, stroke: C.cardLine, color: '#3c4650' },
  category: { fill: '#ffffff', stroke: '#8a949e', color: '#3c4650' },
};

export const pillWidth = (text, size = 15, weight = 500, padX = 9) => measure(text, size, weight) + 2 * padX;

/** Rounded label; (x, y) is the top-left corner unless anchor is 'middle' or 'end'. */
export function pill(parent, text, { x, y, size = 15, weight = 500, padX = 9, h = 22, fill, stroke = 'none', color, anchor = 'start', cls = 'pill' }) {
  const w = pillWidth(text, size, weight, padX);
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const g = parent.append('g').attr('class', cls);
  g.append('rect').attr('x', left).attr('y', y).attr('width', w).attr('height', h).attr('rx', h / 2)
    .attr('fill', fill).attr('stroke', stroke).attr('stroke-width', stroke === 'none' ? 0 : 1.2);
  g.append('text').attr('x', left + w / 2).attr('y', y + h / 2).attr('dy', '0.35em')
    .attr('text-anchor', 'middle').attr('font-size', size).attr('font-weight', weight).attr('fill', color).text(text);
  return { g, w };
}

export function kindPill(parent, kind, opts) {
  const style = KIND_STYLE[kind] || KIND_STYLE['bottom node'];
  return pill(parent, kind, { ...style, ...opts });
}

// ---- tooltip (one shared HTML element, shown on hover and keyboard focus) --------------------
let tipEl = null;
const tipNode = () => (tipEl ||= document.getElementById('tooltip'));

export function showTip(target, parts) {
  const el = tipNode();
  if (!el) return;
  el.replaceChildren(...parts.filter((p) => p && p.text).map((p) => {
    const div = document.createElement('div');
    div.className = p.cls || '';
    div.textContent = p.text;
    return div;
  }));
  if (!el.childElementCount) { el.hidden = true; return; }
  el.hidden = false;
  const r = target.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
  let top = r.bottom + 8;
  if (top + t.height > window.innerHeight - 8) top = Math.max(8, r.top - t.height - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function hideTip() {
  const el = tipNode();
  if (el) el.hidden = true;
}

/** Wire hover/focus tooltips on a d3 selection; partsFor(d) returns [{text, cls}]. */
export function attachTip(selection, partsFor) {
  selection
    .on('mouseenter.tip focus.tip', function onEnter(event, d) { showTip(this, partsFor(d)); })
    .on('mouseleave.tip blur.tip', hideTip);
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
