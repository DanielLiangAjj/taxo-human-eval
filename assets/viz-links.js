// Links: the rated parent and child inside a fixed schematic tree.
// The root, the two placeholder nodes above the parent and the placeholder siblings are identical on
// every item; they only say "there is a tree around this pair". Next plays the move animation:
// the badge settles, the scene zooms out, the rated pair shrinks into one placeholder and the next pair
// grows out of another. Back plays it in reverse. Reduced motion: a short cross-fade.
/* global d3 */
import { C, W, LABEL_COLOR, measure, wrap, textLines, cleanText, reduceMotion, attachTip, hideTip, lerp, smoothstep } from './viz-common.js';

const X = W / 2;
const ROOT = { y: 22, h: 30, label: 'clinical trial outcome measures' };
const CHAIN = [{ x: X, y: 60 }, { x: X, y: 92 }];
const PARENT_BOTTOM = 196;
const CHILD_TOP = 256;
const BADGE = { x: X, y: (PARENT_BOTTOM + CHILD_TOP) / 2 };
const PARENT_SIBS = [{ x: 78, y: 166 }, { x: W - 78, y: 166 }];
const CHILD_SIBS = [{ x: 78, y: 286 }, { x: W - 78, y: 286 }];
const R = 9;
const BOX = { max: 460, min: 180, padX: 18, padY: 10, tag: 19, rx: 10 };
const NAME = { size: 17, lh: 22, weight: 600 };
const CTX = { size: 15, lh: 19, width: 700, lines: 3 };
const SHRINK = 0.06;
const MS = { settle: 200, move: 700, fade: 150 };
const ICON = {
  right: 'M-6.5 0.5 L-2 5 L6.5 -5',
  'too broad': 'M0 7 V-6 M-5.5 -0.5 L0 -6 L5.5 -0.5',
  wrong: 'M-5 -5 L5 5 M5 -5 L-5 5',
};

function layout(item) {
  const inner = BOX.max - 2 * BOX.padX;
  const parent = wrap(item.parent, inner, NAME.size, NAME.weight);
  const child = wrap(item.child, inner, NAME.size, NAME.weight);
  const ctxFull = cleanText(item.child_context);
  const ctx = ctxFull ? wrap(ctxFull, CTX.width, CTX.size, 400, CTX.lines) : { lines: [], truncated: false };
  const boxW = (lines, tag) => Math.min(BOX.max, Math.max(BOX.min, measure(tag, 15) + 2 * BOX.padX,
    ...lines.map((l) => Math.ceil(measure(l, NAME.size, NAME.weight)) + 2 * BOX.padX)));
  const pH = 2 * BOX.padY + BOX.tag + parent.lines.length * NAME.lh;
  const cH = 2 * BOX.padY + BOX.tag + child.lines.length * NAME.lh;
  const ctxTop = CHILD_TOP + cH + 12;
  const bottom = ctx.lines.length ? ctxTop + 14 + (ctx.lines.length - 1) * CTX.lh + 6 : CHILD_TOP + cH;
  return { parent, child, ctx, ctxFull, pW: boxW(parent.lines, 'parent'), pH, cW: boxW(child.lines, 'child'), cH, ctxTop, bottom };
}

const moveTo = (p, k) => `translate(${p.x},${p.y}) scale(${k}) translate(${-BADGE.x},${-BADGE.y})`;
const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export function createLinksViz(host, sheet) {
  const layouts = new Map(sheet.items.map((it) => [it.id, layout(it)]));
  const H = Math.ceil(Math.max(CHILD_SIBS[0].y + 40, ...[...layouts.values()].map((l) => l.bottom)) + 12);
  const CX = X;
  const CY = H / 2;

  const svg = d3.select(host).append('svg')
    .attr('class', 'viz-svg viz-links')
    .attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)
    .attr('role', 'img');
  const world = svg.append('g').attr('class', 'world');

  // ---- the fixed schematic -------------------------------------------------------------------
  const sch = world.append('g').attr('class', 'schematic');
  const link = d3.linkVertical().x((d) => d.x).y((d) => d.y);
  const top = (p) => ({ x: p.x, y: p.y - R });
  const edges = [
    { source: { x: X, y: ROOT.y + ROOT.h / 2 }, target: top(CHAIN[0]) },
    { source: { x: X, y: CHAIN[0].y + R }, target: top(CHAIN[1]) },
    { source: { x: X, y: CHAIN[1].y + R }, target: { x: X, y: PARENT_BOTTOM - 12 } },
    { source: { x: X, y: CHAIN[1].y + R }, target: top(PARENT_SIBS[0]) },
    { source: { x: X, y: CHAIN[1].y + R }, target: top(PARENT_SIBS[1]) },
    { source: { x: X, y: PARENT_BOTTOM }, target: top(CHILD_SIBS[0]) },
    { source: { x: X, y: PARENT_BOTTOM }, target: top(CHILD_SIBS[1]) },
  ];
  sch.selectAll('path.edge').data(edges).join('path')
    .attr('class', 'edge').attr('d', link).attr('fill', 'none').attr('stroke', C.grey).attr('stroke-width', 1.6);
  const rootW = measure(ROOT.label, 15, 500) + 28;
  sch.append('rect').attr('x', X - rootW / 2).attr('y', ROOT.y - ROOT.h / 2).attr('width', rootW).attr('height', ROOT.h)
    .attr('rx', ROOT.h / 2).attr('fill', C.softGrey).attr('stroke', C.grey).attr('stroke-width', 1.4);
  sch.append('text').attr('x', X).attr('y', ROOT.y).attr('dy', '0.35em').attr('text-anchor', 'middle')
    .attr('font-size', 15).attr('font-weight', 500).attr('fill', C.muted).text(ROOT.label);
  sch.selectAll('circle.placeholder').data([...CHAIN, ...PARENT_SIBS, ...CHILD_SIBS]).join('circle')
    .attr('class', 'placeholder').attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', R)
    .attr('fill', '#fff').attr('stroke', C.grey).attr('stroke-width', 2)
    .attr('stroke-dasharray', '1.5 3.2').attr('stroke-linecap', 'round');

  const layer = world.append('g').attr('class', 'pairs');
  let current = null;
  let currentLabel = null;
  let anim = null;

  function box(g, x, y, w, h, tag, lines) {
    g.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('rx', BOX.rx)
      .attr('fill', '#fff').attr('stroke', C.boxLine).attr('stroke-width', 1.5);
    g.append('text').attr('x', x + BOX.padX).attr('y', y + BOX.padY + 14)
      .attr('font-size', 15).attr('fill', C.muted).text(tag);
    textLines(g, lines, { x: x + BOX.padX, y: y + BOX.padY + BOX.tag + 16, size: NAME.size, lh: NAME.lh, weight: NAME.weight });
  }

  function drawPair(g, L) {
    g.append('line').attr('class', 'pc-edge')
      .attr('x1', X).attr('y1', PARENT_BOTTOM).attr('x2', X).attr('y2', CHILD_TOP)
      .attr('stroke', C.blue).attr('stroke-width', 5).attr('stroke-linecap', 'round');
    box(g, X - L.pW / 2, PARENT_BOTTOM - L.pH, L.pW, L.pH, 'parent', L.parent.lines);
    box(g, X - L.cW / 2, CHILD_TOP, L.cW, L.cH, 'child', L.child.lines);
    if (L.ctx.lines.length) {
      const t = textLines(g, L.ctx.lines, { x: X, y: L.ctxTop + 14, size: CTX.size, lh: CTX.lh, fill: C.muted, anchor: 'middle', cls: 'ctx' });
      if (L.ctx.truncated) {
        t.attr('tabindex', 0).attr('class', 'ctx has-tip');
        attachTip(t, () => [{ text: L.ctxFull, cls: 'tip-ctx' }]);
      }
    }
    g.append('g').attr('class', 'badge').attr('transform', `translate(${BADGE.x},${BADGE.y})`);
  }

  function setBadge(g, label, pop) {
    const b = g.select('g.badge');
    b.selectAll('*').remove();
    if (!label || !LABEL_COLOR[label]) {
      b.append('circle').attr('r', 15).attr('fill', '#fff').attr('stroke', C.blue).attr('stroke-width', 2.5);
      b.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', 18).attr('font-weight', 700).attr('fill', C.blue).text('?');
    } else {
      b.append('circle').attr('r', 15).attr('fill', LABEL_COLOR[label]);
      b.append('path').attr('d', ICON[label]).attr('fill', 'none').attr('stroke', '#fff')
        .attr('stroke-width', 3).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    }
    if (pop && label && !reduceMotion()) {
      b.interrupt('pop').transition('pop').duration(180).ease(d3.easeBackOut)
        .attrTween('transform', () => (t) => `translate(${BADGE.x},${BADGE.y}) scale(${lerp(0.6, 1, t)})`);
    }
  }

  function finishAnim() {
    if (!anim) return;
    const { old, next } = anim;
    anim = null;
    world.interrupt('cam').attr('transform', null);
    old.interrupt('move').interrupt('fade').remove();
    next.interrupt('move').interrupt('fade').attr('transform', null).attr('opacity', null);
  }

  function show(item, draft, dir = 0) {
    finishAnim();
    hideTip();
    const L = layouts.get(item.id) || layout(item);
    const next = layer.append('g').attr('class', 'pair');
    drawPair(next, L);
    currentLabel = (draft && draft.rating) || null;
    setBadge(next, currentLabel, false);
    svg.attr('aria-label', `Parent: ${item.parent}. Child: ${item.child}.`);
    const old = current;
    current = next;
    if (!old || !dir) { if (old) old.remove(); return; }

    anim = { old, next };
    const done = () => {
      if (!anim || anim.next !== next) return;
      anim = null;
      old.remove();
      world.attr('transform', null);
      next.attr('transform', null).attr('opacity', null);
    };
    if (reduceMotion()) {
      old.attr('opacity', 1).transition('fade').duration(MS.fade).attr('opacity', 0);
      next.attr('opacity', 0).transition('fade').duration(MS.fade).attr('opacity', 1).on('end', done);
      return;
    }
    const outTo = dir > 0 ? CHILD_SIBS[0] : PARENT_SIBS[1];
    const inFrom = dir > 0 ? PARENT_SIBS[1] : CHILD_SIBS[0];
    const delay = dir > 0 ? MS.settle : 0;
    if (dir > 0) {
      old.select('g.badge').transition('settle').duration(MS.settle).ease(d3.easeQuadInOut)
        .attrTween('transform', () => (t) => `translate(${BADGE.x},${BADGE.y}) scale(${1 + 0.22 * Math.sin(Math.PI * t)})`);
    }
    next.attr('opacity', 0).attr('transform', moveTo(inFrom, SHRINK));
    old.transition('move').delay(delay).duration(MS.move).ease(d3.easeCubicInOut)
      .attrTween('transform', () => (t) => moveTo(lerpPt(BADGE, outTo, t), lerp(1, SHRINK, t)))
      .attrTween('opacity', () => (t) => String(1 - smoothstep(0.45, 1, t)));
    next.transition('move').delay(delay).duration(MS.move).ease(d3.easeCubicInOut)
      .attrTween('transform', () => (t) => moveTo(lerpPt(inFrom, BADGE, t), lerp(SHRINK, 1, t)))
      .attrTween('opacity', () => (t) => String(smoothstep(0, 0.45, t)));
    world.transition('cam').delay(delay).duration(MS.move).ease(d3.easeCubicInOut)
      .attrTween('transform', () => (t) => {
        const s = Math.sin(Math.PI * t);
        const k = 1 - 0.12 * s;
        const px = -dir * 22 * s;
        return `translate(${CX + px},${CY}) scale(${k}) translate(${-CX},${-CY})`;
      })
      .on('end', done); // scheduled last, so this runs after the final tick of every other tween
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
    svg.selectAll('*').interrupt();
    svg.remove();
  }

  return { show, update, destroy };
}
