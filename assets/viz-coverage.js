// Coverage: the new title in a highlighted card with a "new title" tag, and the five candidate nodes in
// a column below it, each with its kind. Clicking a candidate selects it (blue border); the rating
// buttons sit under the picture. The next item's candidates slide up into place.
/* global d3 */
import { C, W, wrap, textLines, pill, pillWidth, kindPill, cleanText, reduceMotion, attachTip, hideTip } from './viz-common.js';

const COL = { x: 110, w: 540 };
const RAIL_X = 84;
const TITLE = { top: 36, pad: 14, size: 17, lh: 22, weight: 600, rx: 12 };
const CTX = { size: 15, lh: 18, lines: 3 };
const CAND = { pad: 12, size: 16, lh: 21, gap: 10, minH: 46, rx: 10 };
const MS = { slide: 380, stagger: 45, fade: 120 };

function layout(item) {
  const title = wrap(item.title, COL.w - 2 * TITLE.pad, TITLE.size, TITLE.weight);
  const ctxFull = cleanText(item.context);
  const ctx = ctxFull ? wrap(ctxFull, COL.w - 2 * TITLE.pad, CTX.size, 400, CTX.lines) : { lines: [], truncated: false };
  const titleTextBottom = TITLE.pad + (title.lines.length - 1) * TITLE.lh + TITLE.size + 4;
  const ctxY = titleTextBottom + 8 + 13;
  const titleH = (ctx.lines.length ? ctxY + (ctx.lines.length - 1) * CTX.lh + 5 : titleTextBottom) + TITLE.pad;
  let y = TITLE.top + titleH + 26;
  const cands = item.candidates.map((c, i) => {
    const pw = pillWidth(c.kind);
    const name = wrap(c.name, COL.w - 2 * CAND.pad - pw - 12, CAND.size);
    const h = Math.max(CAND.minH, 2 * CAND.pad + (name.lines.length - 1) * CAND.lh + CAND.size + 4);
    const k = { i, c, name, pw, h, y };
    y += h + CAND.gap;
    return k;
  });
  return { title, ctx, ctxFull, ctxY, titleH, cands, H: Math.ceil(y - CAND.gap + 10) };
}

export function createCoverageViz(host, sheet, { onSelect } = {}) {
  const svg = d3.select(host).append('svg')
    .attr('class', 'viz-svg viz-coverage')
    .attr('role', 'radiogroup');
  const layer = svg.append('g');
  let current = null;
  let anim = null;
  let disabled = false;

  function draw(g, item, L) {
    const head = g.append('g').attr('class', 'head');
    pill(head, 'new title', { x: COL.x, y: 8, h: 22, size: 15, weight: 600, fill: C.blue, color: '#fff' });
    head.append('rect').attr('x', COL.x).attr('y', TITLE.top).attr('width', COL.w).attr('height', L.titleH).attr('rx', TITLE.rx)
      .attr('fill', C.softBlue).attr('stroke', C.blue).attr('stroke-width', 2);
    textLines(head, L.title.lines, { x: COL.x + TITLE.pad, y: TITLE.top + TITLE.pad + 16, size: TITLE.size, lh: TITLE.lh, weight: TITLE.weight });
    if (L.ctx.lines.length) {
      const t = textLines(head, L.ctx.lines, { x: COL.x + TITLE.pad, y: TITLE.top + L.ctxY, size: CTX.size, lh: CTX.lh, fill: C.muted, cls: 'ctx' });
      if (L.ctx.truncated) { t.attr('tabindex', 0).attr('class', 'ctx has-tip'); attachTip(t, () => [{ text: L.ctxFull, cls: 'tip-ctx' }]); }
    }
    const last = L.cands[L.cands.length - 1];
    const titleMid = TITLE.top + L.titleH / 2;
    const rail = g.append('g').attr('class', 'rail').attr('stroke', C.grey).attr('stroke-width', 1.6).attr('fill', 'none');
    rail.append('path').attr('d', `M${COL.x} ${titleMid} H${RAIL_X} V${last.y + last.h / 2}`);
    rail.selectAll('line').data(L.cands).join('line')
      .attr('x1', RAIL_X).attr('x2', COL.x).attr('y1', (k) => k.y + k.h / 2).attr('y2', (k) => k.y + k.h / 2);

    const cands = g.append('g').attr('class', 'cands').selectAll('g.cand').data(L.cands).join('g')
      .attr('class', 'card cand')
      .attr('transform', (k) => `translate(${COL.x},${k.y})`)
      .attr('tabindex', 0)
      .attr('role', 'radio')
      .attr('aria-checked', 'false')
      .attr('aria-label', (k) => `Candidate ${k.i + 1}: ${k.c.name}, ${k.c.kind}.`);
    cands.append('rect').attr('class', 'focus-ring').attr('x', -4).attr('y', -4).attr('width', COL.w + 8).attr('height', (k) => k.h + 8).attr('rx', CAND.rx + 3);
    cands.append('rect').attr('class', 'card-bg').attr('width', COL.w).attr('height', (k) => k.h).attr('rx', CAND.rx);
    cands.each(function drawCand(k) {
      const cand = d3.select(this);
      textLines(cand, k.name.lines, { x: CAND.pad, y: CAND.pad + 16, size: CAND.size, lh: CAND.lh, cls: 'name' });
      kindPill(cand, k.c.kind, { x: COL.w - CAND.pad - k.pw, y: CAND.pad - 1 });
    });
    attachTip(cands, (k) => [{ text: k.c.name, cls: 'tip-title' }, { text: k.c.kind, cls: 'tip-kind' }]);
    cands.on('click', (event, k) => { if (!disabled && onSelect) onSelect(k.i); });
    cands.on('keydown', (event, k) => {
      if (event.key === ' ') { // like a radio button: Space selects, Enter is left to "Next"
        event.preventDefault();
        event.stopPropagation();
        if (!disabled && onSelect) onSelect(k.i);
      }
    });
    return { head, rail, cands };
  }

  function mark(g, draft) {
    const sel = draft && draft.candidate != null ? draft.candidate : -1;
    disabled = Boolean(draft && draft.unclear);
    svg.classed('disabled', disabled);
    g.selectAll('g.cand')
      .classed('selected', (k) => k.i === sel)
      .attr('aria-checked', (k) => String(k.i === sel))
      .attr('aria-disabled', disabled ? 'true' : null);
  }

  function finishAnim() {
    if (!anim) return;
    const { old, next } = anim;
    anim = null;
    old.interrupt('fade').remove();
    next.interrupt('fade').attr('opacity', null);
    next.selectAll('*').interrupt('slide');
    next.selectAll('g.cand').attr('transform', (k) => `translate(${COL.x},${k.y})`).attr('opacity', null);
    next.selectAll('g.head, g.rail').attr('opacity', null);
  }

  function show(item, draft, dir = 0) {
    finishAnim();
    hideTip();
    const L = layout(item);
    svg.attr('viewBox', `0 0 ${W} ${L.H}`).attr('width', W).attr('height', L.H)
      .attr('aria-label', `New title: ${item.title}. Five candidate nodes.`);
    const next = layer.append('g').attr('class', 'item');
    const parts = draw(next, item, L);
    mark(next, draft);
    const old = current;
    current = next;
    if (!old || !dir) { if (old) old.remove(); return; }
    anim = { old, next };
    old.attr('pointer-events', 'none');
    const done = () => { if (anim && anim.next === next) { anim = null; old.remove(); } };
    if (reduceMotion()) {
      next.attr('opacity', 0).transition('fade').duration(150).attr('opacity', 1).on('end', () => next.attr('opacity', null));
      old.attr('opacity', 1).transition('fade').duration(150).attr('opacity', 0).on('end', done);
      return;
    }
    old.attr('opacity', 1).transition('fade').duration(MS.fade).attr('opacity', 0).on('end', done);
    parts.head.attr('opacity', 0).transition('slide').duration(MS.slide).attr('opacity', 1);
    parts.rail.attr('opacity', 0).transition('slide').delay(120).duration(MS.slide).attr('opacity', 1);
    const off = dir > 0 ? 28 : -28;
    parts.cands.attr('opacity', 0).attr('transform', (k) => `translate(${COL.x},${k.y + off})`)
      .transition('slide').delay((k, i) => 60 + i * MS.stagger).duration(MS.slide).ease(d3.easeCubicOut)
      .attr('opacity', 1).attr('transform', (k) => `translate(${COL.x},${k.y})`);
  }

  function update(draft) {
    if (current) mark(current, draft);
  }

  function destroy() {
    finishAnim();
    svg.remove();
  }

  return { show, update, destroy };
}
