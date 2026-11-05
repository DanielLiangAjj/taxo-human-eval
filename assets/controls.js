// Answer controls for each sheet: the buttons and text boxes under the picture, when an answer is
// valid, and the exact answer JSON that is saved (scripts/pull_ratings.py depends on these keys).
import { h } from './dom.js';
import { LABEL_COLOR } from './viz-common.js';

const OK = { ok: true, need: '' };
const need = (text) => ({ ok: false, need: text });
const filled = (s, n = 3) => String(s || '').trim().length >= n;

export const SHEET_UI = {
  links: {
    question: 'Is the parent a correct, reasonably specific broader category of the child?',
    keys: 'Keys: 1 2 3 choose · Enter next · B back',
    empty: () => ({ rating: null, reason: '', better_parent: '', unclear: false }),
    fromAnswer: (a) => ({ rating: a.rating ?? null, reason: a.reason ?? '', better_parent: a.better_parent ?? '', unclear: Boolean(a.unclear) }),
    validate(d) {
      if (d.unclear) return OK;
      if (!d.rating) return need('Choose right, too broad or wrong.');
      if (d.rating !== 'right' && !filled(d.reason)) return need('Add a reason (at least 3 characters).');
      return OK;
    },
    finalize: (d) => (d.unclear
      ? { rating: 'wrong', reason: 'unclear', better_parent: '', unclear: true }
      : { rating: d.rating, reason: d.reason.trim(), better_parent: d.better_parent.trim(), unclear: false }),
  },
  pairs: {
    question: 'Do the two titles name the same measurement, the same domain, or neither?',
    keys: 'Keys: 1 2 3 choose · Enter next · B back',
    empty: () => ({ rating: null, note: '', unclear: false }),
    fromAnswer: (a) => ({ rating: a.rating ?? null, note: a.note ?? '', unclear: Boolean(a.unclear) }),
    validate(d) {
      if (d.unclear) return OK;
      if (!d.rating) return need('Choose same measurement, same domain or neither.');
      return OK;
    },
    finalize: (d) => (d.unclear
      ? { rating: 'neither', note: 'unclear', unclear: true }
      : { rating: d.rating, note: d.note.trim(), unclear: false }),
  },
  groups: {
    question: 'Mark every child that is not a kind of the category (click it in the picture), then say whether the children sit at one level of detail.',
    keys: 'Keys: Y / N one level of detail · Enter next · B back',
    empty: () => ({ misfits: [], one_level: null, reason: '' }),
    fromAnswer: (a) => ({ misfits: Array.isArray(a.misfits) ? a.misfits.slice() : [], one_level: a.one_level ?? null, reason: a.reason ?? '' }),
    validate(d) {
      if (!d.one_level) return need('Answer "one level of detail" (yes or no).');
      if ((d.misfits.length || d.one_level === 'no') && !filled(d.reason)) return need('Add a reason (at least 3 characters).');
      return OK;
    },
    finalize: (d) => ({ misfits: d.misfits.slice().sort(), one_level: d.one_level, reason: d.reason.trim() }),
  },
  coverage: {
    question: 'Could the taxonomy hold this new title? Select the candidate that matches it, then rate.',
    keys: 'Keys: 1 2 3 choose · Enter next · B back',
    empty: () => ({ rating: null, candidate: null, note: '', unclear: false }),
    fromAnswer: (a) => ({ rating: a.rating ?? null, candidate: Number.isInteger(a.candidate) ? a.candidate : null, note: a.note ?? '', unclear: Boolean(a.unclear) }),
    validate(d) {
      if (d.unclear) return OK;
      if (!d.rating) {
        return need(d.candidate == null
          ? 'Select a candidate in the picture and rate it, or choose not covered.'
          : 'Choose exact node, category only or not covered.');
      }
      if (d.rating !== 'not covered' && d.candidate == null) return need('Select the matching candidate in the picture.');
      return OK;
    },
    finalize: (d) => (d.unclear
      ? { rating: 'not covered', candidate: null, note: 'unclear', unclear: true }
      : { rating: d.rating, candidate: d.rating === 'not covered' ? null : d.candidate, note: d.note.trim(), unclear: false }),
  },
};

// ---- small building blocks ------------------------------------------------------------------

function choiceRow(labels, onPick, keys = ['1', '2', '3']) {
  const buttons = labels.map((label, i) => h('button', {
    type: 'button', class: 'choice', 'data-label': label, 'aria-pressed': 'false', onclick: () => onPick(label),
  }, keys[i] ? h('kbd', {}, keys[i]) : null, h('span', {}, label)));
  return {
    el: h('div', { class: 'choices', role: 'group' }, buttons),
    set(selected, isDisabled = () => false) {
      for (const b of buttons) {
        const label = b.dataset.label;
        const on = label === selected;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
        b.style.setProperty('--sel', LABEL_COLOR[label] || 'var(--blue)');
        b.disabled = isDisabled(label);
      }
    },
    pick(i) {
      const b = buttons[i];
      if (b && !b.disabled) { b.click(); return true; }
      return false;
    },
  };
}

function textField(label, maxLength, onInput) {
  const input = h('input', { type: 'text', maxlength: String(maxLength), autocomplete: 'off' });
  input.addEventListener('input', () => onInput(input.value));
  const hint = h('span', { class: 'field-hint' });
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, ' ', hint), input);
  return {
    el,
    set(value, disabled = false) {
      if (input.value !== value) input.value = value;
      input.disabled = disabled;
    },
    hint(text, required = false) {
      hint.textContent = text;
      el.classList.toggle('required', required);
    },
  };
}

function checkField(label, onToggle) {
  const box = h('input', { type: 'checkbox' });
  box.addEventListener('change', () => onToggle(box.checked));
  return { el: h('label', { class: 'check' }, box, h('span', {}, label)), set(on) { box.checked = on; } };
}

/** Unclear: replace the draft with the guide's convention, and give the earlier draft back when unticked. */
function toggleUnclear(st, on, convention, empty) {
  if (on) {
    st.stash = { ...st.draft };
    st.draft = { ...st.draft, ...convention, unclear: true };
  } else {
    st.draft = st.stash ? { ...st.stash, unclear: false } : empty();
    st.stash = null;
  }
}

// ---- per sheet ------------------------------------------------------------------------------

function linksControls(sheet, item, st) {
  const choices = choiceRow(sheet.labels, (label) => { st.draft.rating = label; st.changed(); });
  const reason = textField('Reason', 1000, (v) => { st.draft.reason = v; st.changed(); });
  const better = textField('If you can, name a better parent', 200, (v) => { st.draft.better_parent = v; st.changed(); });
  const unclear = checkField('Unreadable or unclear', (on) => {
    toggleUnclear(st, on, { rating: 'wrong', reason: 'unclear', better_parent: '' }, SHEET_UI.links.empty);
    st.changed();
  });
  better.hint('(optional)');
  return {
    el: h('div', { class: 'controls' }, choices.el, h('div', { class: 'fields' }, reason.el, better.el), unclear.el),
    refresh() {
      const d = st.draft;
      choices.set(d.rating, () => d.unclear);
      reason.set(d.reason, d.unclear);
      const required = !d.unclear && d.rating && d.rating !== 'right';
      reason.hint(d.unclear ? '' : !d.rating ? '(required unless right)' : required ? '(required)' : '(optional)', Boolean(required));
      better.set(d.better_parent, d.unclear);
      unclear.set(d.unclear);
    },
    choose: (i) => choices.pick(i),
  };
}

function pairsControls(sheet, item, st) {
  const choices = choiceRow(sheet.labels, (label) => { st.draft.rating = label; st.changed(); });
  const note = textField('Note', 1000, (v) => { st.draft.note = v; st.changed(); });
  const unclear = checkField('Unreadable or unclear', (on) => {
    toggleUnclear(st, on, { rating: 'neither', note: 'unclear' }, SHEET_UI.pairs.empty);
    st.changed();
  });
  note.hint('(optional)');
  return {
    el: h('div', { class: 'controls' }, choices.el, h('div', { class: 'fields' }, note.el), unclear.el),
    refresh() {
      const d = st.draft;
      choices.set(d.rating, () => d.unclear);
      note.set(d.note, d.unclear);
      unclear.set(d.unclear);
    },
    choose: (i) => choices.pick(i),
  };
}

function groupsControls(sheet, item, st) {
  const summary = h('span', { class: 'summary' });
  const clear = h('button', { type: 'button', class: 'btn-link', onclick: () => { st.draft.misfits = []; st.changed(); } }, 'Clear marks');
  const level = choiceRow(['yes', 'no'], (v) => { st.draft.one_level = v; st.changed(); }, ['Y', 'N']);
  const reason = textField('Reason', 1000, (v) => { st.draft.reason = v; st.changed(); });
  return {
    el: h('div', { class: 'controls' },
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'Children that do not belong:'), summary, clear),
      h('div', { class: 'row-line' }, h('span', { class: 'q-label' }, 'One level of detail:'), level.el),
      h('div', { class: 'fields' }, reason.el)),
    refresh() {
      const d = st.draft;
      summary.textContent = d.misfits.length
        ? d.misfits.map((l) => `(${l})`).join(' ')
        : 'none (click a child in the picture to mark it)';
      summary.classList.toggle('muted', !d.misfits.length);
      clear.hidden = !d.misfits.length;
      level.set(d.one_level);
      const required = d.misfits.length > 0 || d.one_level === 'no';
      reason.set(d.reason);
      reason.hint(required ? '(required)' : '(required when a child does not belong or the answer is no)', required);
    },
    toggle(letter) {
      const set = new Set(st.draft.misfits);
      if (set.has(letter)) set.delete(letter); else set.add(letter);
      st.draft.misfits = [...set].sort();
      st.changed();
    },
    level(v) { st.draft.one_level = v; st.changed(); },
  };
}

function coverageControls(sheet, item, st) {
  const choices = choiceRow(sheet.labels, (label) => {
    st.draft.rating = label;
    if (label === 'not covered') st.draft.candidate = null;
    st.changed();
  });
  const summary = h('p', { class: 'summary-line' });
  const note = textField('Note', 1000, (v) => { st.draft.note = v; st.changed(); });
  const unclear = checkField('Unreadable or unclear', (on) => {
    toggleUnclear(st, on, { rating: 'not covered', candidate: null, note: 'unclear' }, SHEET_UI.coverage.empty);
    st.changed();
  });
  note.hint('(optional)');
  return {
    el: h('div', { class: 'controls' }, choices.el, summary, h('div', { class: 'fields' }, note.el), unclear.el),
    refresh() {
      const d = st.draft;
      choices.set(d.rating, (label) => d.unclear || (label !== 'not covered' && d.candidate == null));
      const cand = d.candidate != null ? item.candidates[d.candidate] : null;
      summary.textContent = cand
        ? `Selected candidate: ${cand.name} [${cand.kind}]`
        : 'Exact node and category only need a selected candidate: click it in the picture.';
      summary.classList.toggle('muted', !cand);
      note.set(d.note, d.unclear);
      unclear.set(d.unclear);
    },
    choose: (i) => choices.pick(i),
    select(i) {
      const d = st.draft;
      if (d.unclear) return;
      if (d.candidate === i) {
        d.candidate = null;
        if (d.rating && d.rating !== 'not covered') d.rating = null;
      } else {
        d.candidate = i;
        if (d.rating === 'not covered') d.rating = null;
      }
      st.changed();
    },
  };
}

const BUILDERS = { links: linksControls, pairs: pairsControls, groups: groupsControls, coverage: coverageControls };

/** st: {draft, stash, changed()}; the builder reads st.draft each time because "unclear" replaces it. */
export function buildControls(sheet, item, st) {
  return BUILDERS[sheet.id](sheet, item, st);
}
