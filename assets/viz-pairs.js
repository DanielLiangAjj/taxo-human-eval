// Pairs: two title cards side by side, joined by a line with a "?" badge. The chosen label replaces
// the badge with a word (same, domain, neither) in the label's colour. The next pair slides in from
// the right (Back: from the left). Reduced motion: a short cross-fade.
/* global d3 */
import { C, W, LABEL_COLOR, wrap, textLines, pill, reduceMotion, hideTip } from './viz-common.js';

const X = W / 2;
const CARD = { w: 296, pad: 16, rx: 12 };
const AX = 16;
const BX = W - 16 - CARD.w;
const TOP = 30;
const NAME = { size: 17, lh: 23 };
const WORD = { 'same measurement': 'same', 'same domain': 'domain', neither: 'neither' };
const MS = { slide: 420, fade: 150 };

function layout(item) {
  const inner = CARD.w - 2 * CARD.pad;
  const a = wrap(item.a, inner, NAME.size);
  const b = wrap(item.b, inner, NAME.size);
  const n = Math.max(a.lines.length, b.lines.length);
  const h = 2 * CARD.pad + (n - 1) * NAME.lh + NAME.size + 4;
  return { a, b, h };
}

export function createPairsViz(host, sheet) {
  const layouts = new Map(sheet.items.map((it) => [it.id, layout(it)]));
  const maxH = Math.max(...[...layouts.values()].map((l) => l.h));
  const H = Math.ceil(TOP + maxH + 10);
  const svg = d3.select(host).append('svg')
    .attr('class', 'viz-svg viz-pairs')
    .attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)
    .attr('role', 'img');
  const layer = svg.append('g');
  let current = null;
  let currentLabel = null;
  let anim = null;

  function card(g, x, top, tag, lines, h) {
    g.append('text').attr('x', x + 2).attr('y', top - 9).attr('font-size', 15).attr('fill', C.muted).text(tag);
    g.append('rect').attr('x', x).attr('y', top).attr('width', CARD.w).attr('height', h).attr('rx', CARD.rx)
      .attr('fill', '#fff').attr('stroke', C.boxLine).attr('stroke-width', 1.5);
    textLines(g, lines, { x: x + CARD.pad, y: top + CARD.pad + 16, size: NAME.size, lh: NAME.lh });
  }

  function drawPair(g, L) {
    const top = TOP + Math.round((maxH - L.h) / 2); // cards sit in the middle of the fixed-height picture
    const cy = top + L.h / 2;
    g.append('line').attr('class', 'join').attr('x1', AX + CARD.w).attr('x2', BX).attr('y1', cy).attr('y2', cy)
      .attr('stroke', C.grey).attr('stroke-width', 3).attr('stroke-linecap', 'round');
    card(g, AX, top, 'title A', L.a.lines, L.h);
    card(g, BX, top, 'title B', L.b.lines, L.h);
    g.append('g').attr('class', 'badge').attr('transform', `translate(${X},${cy})`);
  }

  function setBadge(g, label, pop) {
    const b = g.select('g.badge');
    b.selectAll('*').remove();
    const color = label && LABEL_COLOR[label];
    g.select('line.join').attr('stroke', color || C.grey);
    if (!color) {
      b.append('circle').attr('r', 17).attr('fill', '#fff').attr('stroke', C.blue).attr('stroke-width', 2.5);
      b.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', 18).attr('font-weight', 700).attr('fill', C.blue).text('?');
    } else {
      pill(b, WORD[label], { x: 0, y: -13, h: 26, size: 15, weight: 700, padX: 12, fill: color, color: '#fff', anchor: 'middle' });
    }
    if (pop && color && !reduceMotion()) {
      const at = b.attr('transform');
      b.interrupt('pop').transition('pop').duration(180).ease(d3.easeBackOut)
        .attrTween('transform', () => (t) => `${at} scale(${0.6 + 0.4 * t})`)
        .on('end interrupt', () => b.attr('transform', at));
    }
  }

  function finishAnim() {
    if (!anim) return;
    const { old, next } = anim;
    anim = null;
    old.interrupt('slide').remove();
    next.interrupt('slide').attr('transform', null).attr('opacity', null);
  }

  function show(item, draft, dir = 0) {
    finishAnim();
    hideTip();
    const L = layouts.get(item.id) || layout(item);
    const next = layer.append('g').attr('class', 'pair');
    drawPair(next, L);
    currentLabel = (draft && draft.rating) || null;
    setBadge(next, currentLabel, false);
    svg.attr('aria-label', `Title A: ${item.a}. Title B: ${item.b}.`);
    const old = current;
    current = next;
    if (!old || !dir) { if (old) old.remove(); return; }
    anim = { old, next };
    const done = () => {
      if (!anim || anim.next !== next) return;
      anim = null;
      old.remove();
      next.attr('transform', null).attr('opacity', null);
    };
    if (reduceMotion()) {
      old.attr('opacity', 1).transition('slide').duration(MS.fade).attr('opacity', 0);
      next.attr('opacity', 0).transition('slide').duration(MS.fade).attr('opacity', 1).on('end', done);
      return;
    }
    const shift = W * 0.7;
    old.attr('opacity', 1).transition('slide').duration(MS.slide).ease(d3.easeCubicInOut)
      .attr('transform', `translate(${-dir * shift},0)`).attr('opacity', 0);
    next.attr('opacity', 0).attr('transform', `translate(${dir * shift},0)`)
      .transition('slide').duration(MS.slide).ease(d3.easeCubicInOut)
      .attr('transform', 'translate(0,0)').attr('opacity', 1)
      .on('end', done);
  }

  function update(draft) {
    if (!current) return;
    const label = (draft && draft.rating) || null;
    if (label === currentLabel) return;
    currentLabel = label;
    setBadge(current, label, true);
  }

  function destroy() {
    finishAnim();
    svg.remove();
  }

  return { show, update, destroy };
}
