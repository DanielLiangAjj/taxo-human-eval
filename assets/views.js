// Screens and flow: welcome, sheet intro, item, pause and finish.
import { h } from './dom.js';
import * as store from './storage.js';
import * as sync from './sync.js';
import * as api from './api.js';
import { renderMarkdown } from './markdown.js';
import { APP_VERSION, Session, minutesFor, formatMinutes, formatTotal } from './state.js';
import { SHEET_UI, buildControls } from './controls.js';
import { hideTip } from './viz-common.js';
import { createLinksViz } from './viz-links.js';
import { createPairsViz } from './viz-pairs.js';
import { createGroupsViz } from './viz-groups.js';
import { createCoverageViz } from './viz-coverage.js';

const VIZ = { links: createLinksViz, pairs: createPairsViz, groups: createGroupsViz, coverage: createCoverageViz };
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PURPOSE = 'We built a taxonomy of clinical trial outcome measures automatically from the outcome titles registered on ClinicalTrials.gov, and we need clinicians to judge how well it is organised. '
  + 'You will rate four kinds of items: links between a child and its parent, pairs of outcome titles, the children of one category, and whether the taxonomy can hold a new title. '
  + 'Every answer is saved as you go, so you can stop at any point and continue later on this or another device.';
const DOT = {
  saved: ['Saved', 'All answers are saved on the server.'],
  saving: ['Saving…', 'Saving your latest answers to the server.'],
  offline: ['Offline', 'The server cannot be reached. Your answers are kept in this browser and will be sent automatically when the connection returns.'],
  local: ['This browser only', 'No server is configured: answers are saved in this browser only.'],
};

let data = null;
let session = null;
let screen = { kind: 'loading' };
let item = null; // the item screen's state while it is mounted
let syncInfo = sync.info();
let downloaded = false;
let bannerSig = '';

const $ = (id) => document.getElementById(id);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const time = (iso) => Date.parse(iso) || 0;

export function initUI(itemsData) {
  data = itemsData;
  sync.onStatus((info) => { syncInfo = info; paintStatus(); });
  document.addEventListener('keydown', onKey);
  document.addEventListener('keydown', hideTip, true); // a focus tooltip must not cover the controls
  window.addEventListener('scroll', hideTip, { passive: true });
  window.addEventListener('resize', hideTip);
}

export function showFatal(message) {
  $('topbar').hidden = true;
  $('main').replaceChildren(h('section', { class: 'panel' }, h('h1', {}, 'Something went wrong'), h('p', {}, message)));
}

// ---- shared pieces --------------------------------------------------------------------------

function siteUrl() { return new URL('.', window.location.href).href; }

function mailtoHref() {
  const subject = 'My code for the outcome taxonomy rating';
  const body = `Your code: ${session.code}\n\nTo continue on any device, open ${siteUrl()} and enter the code under "Resume with a code".\n`;
  const to = String(session.email).replace(/[?&#%\s]/g, encodeURIComponent);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyCode(button) {
  const done = (ok) => {
    button.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, 1600);
  };
  try {
    await navigator.clipboard.writeText(session.code);
    done(true);
  } catch {
    const tmp = h('textarea', { class: 'offscreen', readonly: true });
    tmp.value = session.code;
    document.body.append(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    tmp.remove();
    done(ok);
  }
}

function statusDot() {
  const node = h('span', { class: 'save-dot', role: 'status' });
  paintDot(node);
  return node;
}

function paintDot(node) {
  const [label, tip] = DOT[syncInfo.status] || DOT.saved;
  let text = tip;
  if (syncInfo.pending && (syncInfo.status === 'saving' || syncInfo.status === 'offline')) text += ` ${syncInfo.pending} waiting to be sent.`;
  if (syncInfo.refused) text += ` ${syncInfo.refused} refused by the server; kept in this browser and in the download.`;
  node.dataset.status = syncInfo.status;
  node.title = text;
  node.setAttribute('aria-label', text);
  node.replaceChildren(h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'dot-label', 'aria-hidden': 'true' }, label));
}

function renderTopbar({ sheet = '', count = '', pause = false } = {}) {
  const top = $('topbar');
  if (!session) { top.hidden = true; top.replaceChildren(); return; }
  const done = session.totalAnswered();
  const pct = session.total ? (100 * done) / session.total : 0;
  const copy = h('button', { type: 'button', class: 'btn-link', onclick: () => copyCode(copy) }, 'Copy');
  top.hidden = false;
  top.replaceChildren(
    h('div', { class: 'tb-row' },
      h('div', { class: 'tb-left' },
        h('span', { class: 'brand' }, 'Rating an outcome taxonomy'),
        sheet ? h('span', { class: 'tb-sheet' }, sheet) : null,
        count ? h('span', { class: 'tb-count' }, count) : null),
      h('div', { class: 'tb-right' },
        h('span', { class: 'code-chip', title: 'Your code is how you resume on another device: choose "Resume with a code" there.' },
          h('span', { class: 'code-label' }, 'Your code'), h('code', { class: 'code' }, session.code), copy,
          h('a', { class: 'btn-link', href: mailtoHref() }, 'Email me my code')),
        statusDot(),
        pause ? h('button', { type: 'button', class: 'btn btn-small', onclick: pauseNow }, 'Pause') : null)),
    h('div', {
      class: 'progress', role: 'progressbar', 'aria-label': 'Overall progress',
      'aria-valuemin': 0, 'aria-valuemax': session.total, 'aria-valuenow': done, title: `${done} of ${session.total} items rated`,
    }, h('div', { class: 'progress-fill', style: `width:${pct.toFixed(2)}%` })));
}

function renderBanners() {
  const list = [];
  if (!api.configured()) list.push(['banner banner-local', 'Saving to this browser only (no server configured)']);
  else if (syncInfo.status === 'offline') list.push(['banner banner-offline', "Offline: the server can't be reached right now. Your answers are kept in this browser and will be sent automatically when the connection returns."]);
  if (!store.storageWorks()) list.push(['banner banner-error', 'This browser is not keeping data between visits (private window or storage blocked). Keep this page open, and download your answers before you close it.']);
  const sig = JSON.stringify(list);
  if (sig === bannerSig) return;
  bannerSig = sig;
  $('banners').replaceChildren(...list.map(([cls, text]) => h('div', { class: cls }, text)));
}

function paintStatus() {
  document.querySelectorAll('.save-dot').forEach(paintDot);
  renderBanners();
  paintSavedNote();
}

function paintSavedNote() {
  const note = $('saved-note');
  if (!note || !session) return;
  const { status, pending } = syncInfo;
  let text;
  if (status === 'local') {
    text = screen.kind === 'finish'
      ? (downloaded ? 'Your answers are saved; you can close this page.' : 'Your answers are in this browser only until you download them.')
      : 'Your answers are saved in this browser only (no server is configured). Download a copy if you might switch devices.';
  } else if (status === 'offline') {
    text = `The server can't be reached right now: ${pending || 'your'} answer${pending === 1 ? ' is' : 's are'} kept in this browser and will be sent automatically. Keep this page open if you can, or come back later on this device.`;
  } else if (pending) {
    text = `Saving… ${pending} answer${pending === 1 ? '' : 's'} still to send. Please keep this page open until the dot at the top says Saved.`;
  } else {
    text = screen.kind === 'finish' ? 'Your answers are saved; you can close this page.' : 'Your answers are saved.';
  }
  note.textContent = text;
  note.dataset.status = status;
}

function codeLine() {
  return h('p', { class: 'code-line' },
    'Your code is ', h('code', {}, session.code),
    '. It is how you resume on another device: open this page there and choose “Resume with a code”. ',
    h('a', { href: mailtoHref() }, 'Email me my code'));
}

function guideDetails(summary, md) {
  return h('details', { class: 'guide' }, h('summary', {}, summary), h('div', { class: 'md', html: renderMarkdown(md) }));
}

// ---- welcome --------------------------------------------------------------------------------

export function showWelcome() {
  closeItemScreen();
  hideTip();
  session = null;
  screen = { kind: 'welcome' };
  renderTopbar();
  renderBanners();
  const sheets = data.sheets;
  const totalMin = sheets.reduce((n, s) => n + minutesFor(s), 0);
  const totalItems = sheets.reduce((n, s) => n + s.items.length, 0);
  const table = h('table', { class: 'sheet-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Sheet'), h('th', {}, 'What you judge'), h('th', { class: 'num' }, 'Items'), h('th', { class: 'num' }, 'Time'))),
    h('tbody', {}, sheets.map((s, i) => h('tr', {},
      h('td', {}, `${i + 1}. ${s.title}`), h('td', {}, s.short),
      h('td', { class: 'num' }, s.items.length), h('td', { class: 'num' }, formatMinutes(minutesFor(s)))))),
    h('tfoot', {}, h('tr', {},
      h('td', {}, 'In all'), h('td', {}, 'over as many sittings as you like'),
      h('td', { class: 'num' }, totalItems), h('td', { class: 'num' }, formatTotal(totalMin)))));
  const current = store.getCurrent();
  $('main').replaceChildren(h('section', { class: 'welcome' },
    h('h1', {}, 'Rating an outcome taxonomy'),
    h('p', { class: 'lede' }, PURPOSE),
    guideDetails('What counts as one outcome', data.common_instructions),
    table,
    h('p', { class: 'consent' }, 'Your name and email are stored so we can credit and contact you; nothing else about you is collected.'),
    current && current.code ? continuePanel(current) : [startPanel(), resumePanel()]));
}

function continuePanel(cur) {
  const err = h('p', { class: 'form-error', role: 'alert' });
  const label = `Continue as ${cur.name}`;
  const go = h('button', {
    type: 'button', class: 'btn btn-primary',
    onclick: async () => {
      go.disabled = true;
      go.textContent = 'Loading…';
      const problem = await resume(cur.code);
      if (problem) { err.textContent = problem; go.disabled = false; go.textContent = label; }
    },
  }, label);
  const other = h('button', { type: 'button', class: 'btn-link', onclick: () => { store.clearCurrent(); showWelcome(); } }, 'I am someone else');
  return h('div', { class: 'panel' },
    h('h2', {}, 'Welcome back'),
    h('p', {}, 'This browser remembers you (code ', h('code', {}, cur.code), ').'),
    h('div', { class: 'actions' }, go, other),
    err);
}

function startPanel() {
  const name = h('input', { id: 'f-name', type: 'text', autocomplete: 'name', maxlength: 80, required: true });
  const email = h('input', { id: 'f-email', type: 'email', autocomplete: 'email', maxlength: 254, required: true });
  const err = h('p', { class: 'form-error', role: 'alert' });
  return h('form', {
    class: 'panel', novalidate: true,
    onsubmit: (event) => {
      event.preventDefault();
      const n = name.value.trim().replace(/\s+/g, ' ');
      const m = email.value.trim();
      if (n.length < 2 || n.length > 80) { err.textContent = 'Please enter your full name (2 to 80 characters).'; name.focus(); return; }
      if (m.length > 254 || !EMAIL_RE.test(m)) { err.textContent = 'Please enter a valid email address.'; email.focus(); return; }
      startNew(n, m);
    },
  },
  h('h2', {}, 'Start'),
  h('div', { class: 'fields' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Full name'), name),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Email'), email)),
  err,
  h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Start')));
}

function normalizeCode(text) {
  return String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

function resumePanel() {
  const input = h('input', {
    id: 'f-code', type: 'text', class: 'code-input', autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', maxlength: 20, placeholder: 'for example 7K3QX9M2PA', 'aria-label': 'Your code',
  });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn' }, 'Resume');
  return h('form', {
    class: 'panel resume', novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      const code = normalizeCode(input.value);
      if (!CODE_RE.test(code)) { err.textContent = 'A code has 10 letters and digits, for example 7K3QX9M2PA.'; return; }
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const problem = await resume(code);
      if (problem) { err.textContent = problem; btn.disabled = false; btn.textContent = 'Resume'; }
    },
  },
  h('h2', {}, 'Resume with a code'),
  h('p', { class: 'muted' }, 'Already started, here or on another device? Enter the code you were given.'),
  h('div', { class: 'inline' }, input, btn),
  err);
}

// ---- identity and resume --------------------------------------------------------------------

function newCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('');
}

const registerOp = (code, who) => ({ kind: 'register', code, name: who.name, email: who.email, user_agent: navigator.userAgent.slice(0, 500) });
const ratingOp = (code, sheet, itemId, rec) => ({
  kind: 'rating', code, sheet, item_id: itemId, answer: rec.answer,
  elapsed_ms: rec.elapsed_ms ?? null, client_ts: rec.client_ts, app_version: rec.app_version || APP_VERSION,
});

function startNew(name, email) {
  const code = newCode();
  const who = { name, email };
  store.setIdentity(code, who);
  store.setCurrent({ code, ...who });
  sync.enqueue(registerOp(code, who));
  session = new Session(data, code, who, new Map());
  session.serverCompleted = false;
  downloaded = false;
  showIntro(0);
}

/** Look the code up (server first, then this browser). Returns an error message, or null after moving on. */
async function resume(code) {
  const localWho = store.getIdentity(code);
  const local = store.loadAnswers(code);
  if (!api.configured()) {
    if (!localWho) return 'This code is not known in this browser, and no server is configured to look it up.';
    begin(code, localWho, local, undefined);
    return null;
  }
  let progress;
  try {
    progress = await api.getProgress(code);
  } catch (err) {
    if (localWho) {
      sync.markOffline();
      begin(code, localWho, local, undefined);
      return null;
    }
    if (err && err.retryable === false) return 'The server did not accept this code. Please check it and try again.';
    return "Can't reach the server right now. Check your connection and try again in a minute.";
  }
  if (!progress) {
    if (!localWho) return 'We could not find this code. Check it for typos, or start as a new evaluator.';
    // The server has never seen this code: register it from this browser and send what is stored here.
    sync.enqueue(registerOp(code, localWho));
    for (const [key, rec] of local) {
      const [sheet, itemId] = key.split('/');
      if (!store.isQueued(code, sheet, itemId)) sync.enqueue(ratingOp(code, sheet, itemId, rec));
    }
    begin(code, localWho, local, false);
    return null;
  }
  const who = { name: progress.name, email: progress.email };
  const server = new Map((progress.ratings || []).map((r) => [`${r.sheet}/${r.item_id}`, r]));
  for (const [key, r] of server) {
    const mine = local.get(key);
    if (!mine || time(r.client_ts) > time(mine.client_ts)) {
      const rec = { answer: r.answer, elapsed_ms: null, client_ts: r.client_ts, app_version: null };
      local.set(key, rec);
      const [sheet, itemId] = key.split('/');
      store.saveAnswer(code, sheet, itemId, rec);
    }
  }
  for (const [key, rec] of local) {
    const theirs = server.get(key);
    if (!theirs || time(rec.client_ts) > time(theirs.client_ts)) {
      const [sheet, itemId] = key.split('/');
      if (!store.isQueued(code, sheet, itemId)) sync.enqueue(ratingOp(code, sheet, itemId, rec));
    }
  }
  begin(code, who, local, Boolean(progress.completed_at));
  return null;
}

function begin(code, who, answers, serverCompleted) {
  store.setIdentity(code, who);
  store.setCurrent({ code, ...who });
  session = new Session(data, code, who, answers);
  session.serverCompleted = serverCompleted;
  downloaded = false;
  const next = session.firstUnanswered();
  if (next) showIntro(next.s);
  else showFinish();
}

// ---- sheet intro ----------------------------------------------------------------------------

function showIntro(s, { note = '' } = {}) {
  closeItemScreen();
  hideTip();
  screen = { kind: 'intro', s };
  const sheet = session.sheets[s];
  const n = session.order[sheet.id].length;
  const first = session.firstUnansweredIn(s);
  renderTopbar({ sheet: sheet.title, count: `${session.answeredIn(sheet.id)} of ${n} rated` });
  renderBanners();
  const actions = first < 0
    ? [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => goForward(s + 1) }, 'Go on'),
      h('button', { type: 'button', class: 'btn', onclick: () => showItem(s, 0, 0) }, 'Review from item 1')]
    : [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => showItem(s, first, 0) }, first > 0 ? `Continue at item ${first + 1}` : 'Begin')];
  $('main').replaceChildren(h('section', { class: 'intro' },
    note ? h('p', { class: 'note-done' }, note) : null,
    h('p', { class: 'eyebrow' }, `Sheet ${s + 1} of ${session.sheets.length}`),
    h('h1', {}, sheet.title),
    h('p', { class: 'lede' }, `${capitalize(sheet.short)} · ${n} items · ${formatMinutes(minutesFor(sheet))}`),
    h('div', { class: 'md instructions', html: renderMarkdown(sheet.instructions) }),
    guideDetails('What counts as one outcome', data.common_instructions),
    codeLine(),
    h('div', { class: 'actions' }, actions)));
  actions[0].focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function goForward(from, note = '') {
  for (let t = from; t < session.sheets.length; t++) {
    if (session.firstUnansweredIn(t) >= 0) { showIntro(t, { note }); return; }
  }
  showFinish();
}

// ---- item screen ----------------------------------------------------------------------------

function stopwatch() {
  let total = 0;
  let since = document.hidden ? null : performance.now();
  const onVisibility = () => {
    if (document.hidden) {
      if (since != null) { total += performance.now() - since; since = null; }
    } else if (since == null) {
      since = performance.now();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    ms: () => total + (since != null ? performance.now() - since : 0),
    stop: () => document.removeEventListener('visibilitychange', onVisibility),
  };
}

function buildItemScreen(s) {
  closeItemScreen();
  const sheet = session.sheets[s];
  const ui = SHEET_UI[sheet.id];
  const vizHost = h('div', { class: `viz viz-host-${sheet.id}` });
  const question = h('h2', { class: 'question', tabindex: '-1' }, ui.question);
  const controlsHost = h('div', { class: 'controls-host' });
  const back = h('button', { type: 'button', class: 'btn', onclick: goBack }, 'Back');
  const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: goNext }, 'Next');
  const hint = h('span', { class: 'nav-hint' });
  const root = h('section', { class: `item-screen sheet-${sheet.id}` },
    vizHost, question, controlsHost,
    h('div', { class: 'nav' }, back, hint, next),
    h('div', { class: 'below' },
      h('p', { class: 'keys' }, ui.keys),
      h('details', { class: 'guide' }, h('summary', {}, 'Instructions for this sheet'),
        h('div', { class: 'md', html: renderMarkdown(sheet.instructions) }),
        h('h3', {}, 'What counts as one outcome'),
        h('div', { class: 'md', html: renderMarkdown(data.common_instructions) }))));
  $('main').replaceChildren(root);
  const st = {
    s, i: -1, sheet, it: null, draft: null, stash: null, ctrl: null, watch: null,
    root, vizHost, question, controlsHost, back, next, hint,
    changed: () => refreshItem(),
  };
  st.viz = VIZ[sheet.id](vizHost, sheet, {
    onToggle: (letter) => { if (item === st && st.ctrl && st.ctrl.toggle) st.ctrl.toggle(letter); },
    onSelect: (i) => { if (item === st && st.ctrl && st.ctrl.select) st.ctrl.select(i); },
  });
  item = st;
}

function closeItemScreen() {
  if (!item) return;
  if (item.watch) item.watch.stop();
  item.viz.destroy();
  item = null;
}

function showItem(s, i, dir = 0) {
  hideTip();
  if (!item || item.s !== s || !item.root.isConnected) { buildItemScreen(s); dir = 0; }
  const st = item;
  if (st.watch) st.watch.stop();
  const sheet = st.sheet;
  const ui = SHEET_UI[sheet.id];
  const it = session.order[sheet.id][i];
  screen = { kind: 'item', s, i };
  st.i = i;
  st.it = it;
  st.stash = null;
  const rec = session.record(sheet.id, it.id);
  st.draft = rec ? ui.fromAnswer(rec.answer) : ui.empty();
  st.watch = stopwatch();
  st.viz.show(it, st.draft, dir);
  st.ctrl = buildControls(sheet, it, st);
  st.controlsHost.replaceChildren(st.ctrl.el);
  refreshItem();
  st.back.disabled = s === 0 && i === 0;
  renderTopbar({ sheet: sheet.title, count: `item ${i + 1} of ${session.order[sheet.id].length}`, pause: true });
  renderBanners();
  st.question.focus({ preventScroll: true });
  // If the page was scrolled down (say, to the reason box), bring the picture back below the sticky header.
  const header = $('topbar');
  const headerBottom = header.hidden ? 0 : header.getBoundingClientRect().bottom;
  const vizTop = st.vizHost.getBoundingClientRect().top;
  if (vizTop < headerBottom) window.scrollTo(0, Math.max(0, window.scrollY + vizTop - headerBottom - 12));
}

function refreshItem() {
  if (!item || !item.ctrl) return;
  item.ctrl.refresh();
  item.viz.update(item.draft);
  const v = SHEET_UI[item.sheet.id].validate(item.draft);
  item.next.disabled = !v.ok;
  item.hint.textContent = v.ok ? '' : v.need;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Save the answer on screen if it is valid and new or changed. Returns false when it is not valid. */
function commit() {
  if (!item || !item.it) return false;
  const sheet = item.sheet;
  const ui = SHEET_UI[sheet.id];
  if (!ui.validate(item.draft).ok) return false;
  const answer = ui.finalize(item.draft);
  const prev = session.record(sheet.id, item.it.id);
  if (prev && canonical(prev.answer) === canonical(answer)) return true;
  const elapsed = Math.min(2147483647, Math.round((prev && prev.elapsed_ms ? prev.elapsed_ms : 0) + item.watch.ms()));
  const rec = { answer, elapsed_ms: elapsed, client_ts: new Date().toISOString(), app_version: APP_VERSION };
  session.answers.set(session.key(sheet.id, item.it.id), rec);
  store.saveAnswer(session.code, sheet.id, item.it.id, rec);
  sync.enqueue(ratingOp(session.code, sheet.id, item.it.id, rec));
  return true;
}

function goNext() {
  if (!item || screen.kind !== 'item') return;
  if (!SHEET_UI[item.sheet.id].validate(item.draft).ok) return;
  commit();
  const { s, i, sheet } = item;
  if (i + 1 < session.order[sheet.id].length) showItem(s, i + 1, +1);
  else goForward(s + 1, `${sheet.title} complete: you rated all ${sheet.items.length} items.`);
}

function goBack() {
  if (!item || screen.kind !== 'item') return;
  commit();
  const { s, i } = item;
  if (i > 0) showItem(s, i - 1, -1);
  else if (s > 0) {
    const prev = session.sheets[s - 1];
    showItem(s - 1, session.order[prev.id].length - 1, 0);
  }
}

function onKey(event) {
  if (screen.kind !== 'item' || !item) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  const tag = target ? target.tagName : '';
  const inText = tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(target.type));
  if (event.key === 'Enter') {
    if (event.repeat) return;
    if (!inText && target && target.closest('button, a, summary')) return; // those act on Enter themselves
    event.preventDefault();
    goNext();
    return;
  }
  if (inText) {
    if (event.key === 'Escape') target.blur();
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'b') {
    if (event.repeat) return;
    event.preventDefault();
    goBack();
  } else if (key === '1' || key === '2' || key === '3') {
    event.preventDefault();
    if (item.ctrl && item.ctrl.choose && !item.ctrl.choose(Number(key) - 1) && item.sheet.id === 'coverage') {
      item.hint.textContent = 'Select a candidate in the picture first.';
    }
  } else if (item.sheet.id === 'groups' && (key === 'y' || key === 'n')) {
    event.preventDefault();
    if (item.ctrl && item.ctrl.level) item.ctrl.level(key === 'y' ? 'yes' : 'no');
  }
}

// ---- pause and finish -----------------------------------------------------------------------

function pauseNow() {
  if (screen.kind !== 'item' || !item) return;
  commit();
  showPause({ s: item.s, i: item.i });
}

function showPause(where) {
  closeItemScreen();
  hideTip();
  screen = { kind: 'pause', where };
  renderTopbar({ sheet: 'Paused' });
  renderBanners();
  const local = !api.configured();
  $('main').replaceChildren(h('section', { class: 'panel-page' },
    h('h1', {}, 'Paused'),
    h('p', { class: 'saved-note', id: 'saved-note' }),
    local
      ? h('p', {}, 'To continue later, open this page again in this same browser; it remembers where you stopped.')
      : h('p', {}, 'To continue later, open this page again: this browser remembers you. On another device, open ',
        h('a', { href: siteUrl() }, siteUrl()), ' and enter your code under “Resume with a code”.'),
    h('p', { class: 'code-big' }, h('span', { class: 'muted' }, 'Your code '), h('code', {}, session.code), ' ',
      h('a', { href: mailtoHref() }, 'Email me my code')),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-primary', id: 'continue-rating', onclick: () => showItem(where.s, where.i, 0) }, 'Continue rating'),
      h('button', { type: 'button', class: 'btn', onclick: downloadAnswers }, 'Download my answers (JSON)'))));
  paintSavedNote();
  $('continue-rating').focus({ preventScroll: true });
  sync.kick();
}

function showFinish() {
  closeItemScreen();
  hideTip();
  screen = { kind: 'finish' };
  const code = session.code;
  if (!store.getFinished(code) || session.serverCompleted === false) {
    store.setFinished(code, new Date().toISOString());
    sync.enqueue({ kind: 'finish', code });
    session.serverCompleted = true;
  }
  renderTopbar({ sheet: 'Finished' });
  renderBanners();
  const local = !api.configured();
  const download = h('button', {
    type: 'button', class: local ? 'btn btn-primary' : 'btn',
    onclick: () => { downloadAnswers(); downloaded = true; paintSavedNote(); },
  }, 'Download my answers (JSON)');
  $('main').replaceChildren(h('section', { class: 'panel-page finish' },
    h('h1', {}, `Thank you, ${session.name}.`),
    h('p', { class: 'lede' }, 'You have rated every item.'),
    h('table', { class: 'sheet-table compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Sheet'), h('th', { class: 'num' }, 'Rated'))),
      h('tbody', {}, session.sheets.map((s) => h('tr', {},
        h('td', {}, s.title), h('td', { class: 'num' }, `${session.answeredIn(s.id)} of ${s.items.length}`))))),
    local
      ? h('div', { class: 'warn-box' }, h('strong', {}, 'Please download your answers now. '),
        'No server is configured, so they exist only in this browser. Send the file to the person who invited you.')
      : h('p', {}, 'If you like, keep a copy of your answers as a backup.'),
    h('div', { class: 'actions' }, download),
    h('p', { class: 'saved-note', id: 'saved-note' })));
  paintSavedNote();
  window.scrollTo(0, 0);
}

function downloadAnswers() {
  if (!session) return;
  const answers = [];
  for (const sheet of session.sheets) {
    for (const it of sheet.items.slice().sort(byId)) {
      const rec = session.record(sheet.id, it.id);
      if (rec) {
        answers.push({
          sheet: sheet.id, item_id: it.id, answer: rec.answer,
          elapsed_ms: rec.elapsed_ms ?? null, client_ts: rec.client_ts, app_version: rec.app_version ?? null,
        });
      }
    }
  }
  const payload = {
    what: 'Outcome taxonomy rating: backup of one evaluator’s answers',
    site: siteUrl(),
    items_version: data.version,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    code: session.code,
    name: session.name,
    email: session.email,
    counts: Object.fromEntries(session.sheets.map((s) => [s.id, session.answeredIn(s.id)])),
    answers,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 1)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `taxonomy-ratings-${session.code}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
