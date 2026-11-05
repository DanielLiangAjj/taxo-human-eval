// Groups: the category at the top and its children fanned below in one or two rows. Each child card is
// a toggle: click (or Enter/Space) marks it "does not belong" (red dashed border and a strike icon);
// click again to undo. The next group fans in from the category node.
/* global d3 */
import { C, W, measure, wrap, textLines, kindPill, cleanText, reduceMotion, attachTip, hideTip } from './viz-common.js';

const X = W / 2;
const CAT = { max: 520, min: 200, padX: 18, padY: 10, tag: 19, top: 8, rx: 12 };
const CARD = { maxW: 250, gap: 16, margin: 14, pad: 12, r: 12, rx: 10, rowGap: 28 };
const NAME = { size: 16, lh: 20, weight: 500 };
const CTX = { size: 15, lh: 18, lines: 3 };
// Cards are narrow: the visible line drops the boilerplate "Registered description (one trial, NCT…): ";
// the tooltip keeps the full text.
const shortContext = (s) => s.replace(/^Registered description \([^)]*\):\s*/i, '');
const MS = { fan: 460, stagger: 28, fade: 140 };

function layout(item) {
  const cat = wrap(item.category, CAT.max - 2 * CAT.padX, 17, 600);
  const catW = Math.min(CAT.max, Math.max(CAT.min, measure('category', 15) + 2 * CAT.padX,
    ...cat.lines.map((l) => Math.ceil(measure(l, 17, 600)) + 2 * CAT.padX)));
  const catH = 2 * CAT.padY + CAT.tag + cat.lines.length * 22;
  const catBottom = CAT.top + catH;
  const n = item.children.length;
  const perRow = n <= 5 ? Math.max(1, n) : Math.ceil(n / 2);
  const cardW = Math.min(CARD.maxW, (W - 2 * CARD.margin - (perRow - 1) * CARD.gap) / perRow);
  const inner = cardW - 2 * CARD.pad;
  const cards = item.children.map((c, i) => {
    const name = wrap(c.name, inner, NAME.size, NAME.weight, Infinity, inner - (2 * CARD.r + 8));
    const ctxFull = cleanText(c.context);
    const ctx = ctxFull ? wrap(shortContext(ctxFull), inner, CTX.size, 400, CTX.lines) : { lines: [], truncated: false };
    const nameY = CARD.pad + CARD.r + 6; // first baseline, level with the letter badge
    const pillY = nameY + (name.lines.length - 1) * NAME.lh + 12;
    const ctxY = pillY + 22 + 6 + 13;
    const h = (ctx.lines.length ? ctxY + (ctx.lines.length - 1) * CTX.lh + 5 : pillY + 22) + CARD.pad;
    return { i, c, name, ctx, ctxFull, nameY, pillY, ctxY, h, row: i < perRow ? 0 : 1 };
  });
  const rows = [cards.filter((k) => k.row === 0), cards.filter((k) => k.row === 1)].filter((r) => r.length);
  let y = catBottom + 44;
  rows.forEach((row) => {
    const rowH = Math.max(...row.map((k) => k.h));
    const rowW = row.length * cardW + (row.length - 1) * CARD.gap;
    const left = (W - rowW) / 2;
    row.forEach((k, j) => { k.x = left + j * (cardW + CARD.gap); k.y = y; k.rowH = rowH; });
    y += rowH + CARD.rowGap;
  });
  return { cat, catW, catH, catBottom, cardW, cards, rows, H: Math.ceil(y - CARD.rowGap + 10) };
}

// Org-chart routing: a stem from the category to a bus above the first row with a drop to each card.
// A second row hangs from its own bus, reached through the gap between first-row cards nearest the
// middle, so no line ever runs from one child card to another.
function connectorPaths(L) {
  const cx = (k) => k.x + L.cardW / 2;
  const [r1, r2] = L.rows;
  const bus1 = L.catBottom + 20;
  const xs1 = r1.map(cx);
  const paths = [
    `M${X} ${L.catBottom} V${bus1}`,
    `M${Math.min(X, ...xs1)} ${bus1} H${Math.max(X, ...xs1)}`,
    ...r1.map((k) => `M${cx(k)} ${bus1} V${k.y}`),
  ];
  if (r2) {
    const gaps = r1.slice(0, -1).map((k) => k.x + L.cardW + CARD.gap / 2);
    const gx = gaps.reduce((best, g) => (Math.abs(g - X) < Math.abs(best - X) ? g : best), gaps[0]);
    const bus2 = r2[0].y - CARD.rowGap / 2;
    const xs2 = r2.map(cx);
    paths.push(`M${gx} ${bus1} V${bus2}`, `M${Math.min(gx, ...xs2)} ${bus2} H${Math.max(gx, ...xs2)}`,
      ...r2.map((k) => `M${cx(k)} ${bus2} V${k.y}`));
  }
  return paths;
}

export function createGroupsViz(host, sheet, { onToggle } = {}) {
  const svg = d3.select(host).append('svg')
    .attr('class', 'viz-svg viz-groups')
    .attr('role', 'group');
  const layer = svg.append('g');
  let current = null;
  let anim = null;

  function draw(g, item, L) {
    const edges = g.append('g').attr('class', 'edges');
    edges.selectAll('path').data(connectorPaths(L)).join('path')
      .attr('d', (d) => d)
      .attr('fill', 'none').attr('stroke', C.grey).attr('stroke-width', 1.6).attr('stroke-linejoin', 'round');

    const cat = g.append('g').attr('class', 'cat');
    const cx = X - L.catW / 2;
    cat.append('rect').attr('x', cx).attr('y', CAT.top).attr('width', L.catW).attr('height', L.catH).attr('rx', CAT.rx)
      .attr('fill', C.softGrey).attr('stroke', C.boxLine).attr('stroke-width', 1.5);
    cat.append('text').attr('x', cx + CAT.padX).attr('y', CAT.top + CAT.padY + 14).attr('font-size', 15).attr('fill', C.muted).text('category');
    textLines(cat, L.cat.lines, { x: cx + CAT.padX, y: CAT.top + CAT.padY + CAT.tag + 16, size: 17, lh: 22, weight: 600 });

    const cards = g.append('g').attr('class', 'cards').selectAll('g.card').data(L.cards).join('g')
      .attr('class', 'card')
      .attr('transform', (k) => `translate(${k.x},${k.y})`)
      .attr('tabindex', 0)
      .attr('role', 'checkbox')
      .attr('aria-checked', 'false')
      .attr('aria-label', (k) => `(${k.c.letter}) ${k.c.name}, ${k.c.kind}. Mark if it does not belong.`);
    cards.append('rect').attr('class', 'focus-ring').attr('x', -4).attr('y', -4)
      .attr('width', L.cardW + 8).attr('height', (k) => k.rowH + 8).attr('rx', CARD.rx + 3);
    cards.append('rect').attr('class', 'card-bg').attr('width', L.cardW).attr('height', (k) => k.rowH).attr('rx', CARD.rx);
    cards.append('circle').attr('cx', CARD.pad + CARD.r).attr('cy', CARD.pad + CARD.r).attr('r', CARD.r).attr('fill', '#3c4650');
    cards.append('text').attr('x', CARD.pad + CARD.r).attr('y', CARD.pad + CARD.r).attr('dy', '0.35em')
      .attr('text-anchor', 'middle').attr('font-size', 15).attr('font-weight', 700).attr('fill', '#fff')
      .text((k) => k.c.letter);
    cards.each(function drawCard(k) {
      const card = d3.select(this);
      const text = card.append('text').attr('font-size', NAME.size).attr('font-weight', NAME.weight).attr('fill', C.ink).attr('class', 'name');
      k.name.lines.forEach((line, j) => text.append('tspan')
        .attr('x', j === 0 ? CARD.pad + 2 * CARD.r + 8 : CARD.pad)
        .attr('y', k.nameY + j * NAME.lh).text(line));
      kindPill(card, k.c.kind, { x: CARD.pad, y: k.pillY });
      if (k.ctx.lines.length) textLines(card, k.ctx.lines, { x: CARD.pad, y: k.ctxY, size: CTX.size, lh: CTX.lh, fill: C.muted, cls: 'ctx' });
      const strike = card.append('g').attr('class', 'strike').attr('transform', `translate(${L.cardW - 18},18)`);
      strike.append('circle').attr('r', 10).attr('fill', C.red);
      strike.append('path').attr('d', 'M-5 5 L5 -5').attr('stroke', '#fff').attr('stroke-width', 2.6).attr('stroke-linecap', 'round');
    });
    attachTip(cards, (k) => [
      { text: `(${k.c.letter}) ${k.c.name}`, cls: 'tip-title' },
      { text: k.c.kind, cls: 'tip-kind' },
      { text: k.ctxFull, cls: 'tip-ctx' },
    ]);
    cards.on('click', (event, k) => { if (onToggle) onToggle(k.c.letter); });
    cards.on('keydown', (event, k) => {
      if (event.key === ' ') { // like a checkbox: Space toggles, Enter is left to "Next"
        event.preventDefault();
        event.stopPropagation();
        if (onToggle) onToggle(k.c.letter);
      }
    });
    return cards;
  }

  function mark(g, misfits) {
    const set = new Set(misfits || []);
    g.selectAll('g.card')
      .classed('misfit', (k) => set.has(k.c.letter))
      .attr('aria-checked', (k) => String(set.has(k.c.letter)));
  }

  function finishAnim() {
    if (!anim) return;
    const { old, next } = anim;
    anim = null;
    old.interrupt('fade').remove();
    next.selectAll('*').interrupt('fan');
    next.interrupt('fade').attr('opacity', null);
    next.selectAll('g.card').attr('transform', (k) => `translate(${k.x},${k.y})`).attr('opacity', null);
    next.selectAll('g.edges path').attr('opacity', null);
    next.select('g.cat').attr('opacity', null);
  }

  function show(item, draft, dir = 0) {
    finishAnim();
    hideTip();
    const L = layout(item);
    svg.attr('viewBox', `0 0 ${W} ${L.H}`).attr('width', W).attr('height', L.H)
      .attr('aria-label', `Category: ${item.category}, with ${item.children.length} children.`);
    const next = layer.append('g').attr('class', 'group');
    const cards = draw(next, item, L);
    mark(next, draft && draft.misfits);
    const old = current;
    current = next;
    if (!old || !dir) { if (old) old.remove(); return; }
    anim = { old, next };
    const done = () => { if (anim && anim.next === next) { anim = null; old.remove(); } };
    old.attr('pointer-events', 'none');
    if (reduceMotion()) {
      next.attr('opacity', 0).transition('fade').duration(150).attr('opacity', 1);
      old.attr('opacity', 1).transition('fade').duration(150).attr('opacity', 0).on('end', done);
      return;
    }
    old.attr('opacity', 1).transition('fade').duration(MS.fade).attr('opacity', 0).on('end', done);
    const ox = X - L.cardW * 0.1;
    const oy = L.catBottom - 6;
    next.select('g.cat').attr('opacity', 0).transition('fan').duration(MS.fade).attr('opacity', 1);
    next.selectAll('g.edges path').attr('opacity', 0)
      .transition('fan').delay(120).duration(MS.fan).attr('opacity', 1);
    cards.attr('opacity', 0).attr('transform', `translate(${ox},${oy}) scale(0.2)`)
      .transition('fan').delay((k, i) => 60 + i * MS.stagger).duration(MS.fan).ease(d3.easeCubicOut)
      .attr('opacity', 1)
      .attrTween('transform', (k) => {
        const ix = d3.interpolateNumber(ox, k.x);
        const iy = d3.interpolateNumber(oy, k.y);
        const is = d3.interpolateNumber(0.2, 1);
        return (t) => `translate(${ix(t)},${iy(t)}) scale(${is(t)})`;
      });
  }

  function update(draft) {
    if (current) mark(current, draft && draft.misfits);
  }

  function destroy() {
    finishAnim();
    svg.remove();
  }

  return { show, update, destroy };
}
