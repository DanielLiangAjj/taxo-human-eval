// The save queue: every server operation is stored in localStorage first, then sent in order.
// Retries back off 1 s, 4 s, 15 s, then every 60 s; a refused operation is set aside, not retried.

import * as api from './api.js';
import * as store from './storage.js';

const DELAYS = [1000, 4000, 15000, 60000];
let timer = null;
let running = false;
let failures = 0;
let status = 'saved';
const listeners = new Set();

export const newQid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function info() {
  return { status: api.configured() ? status : 'local', pending: store.queue().length, refused: store.failed().length };
}

/** Subscribe to status changes ('saved' | 'saving' | 'offline' | 'local'); returns an unsubscribe function. */
export function onStatus(fn) {
  listeners.add(fn);
  fn(info());
  return () => listeners.delete(fn);
}

function emit(next) {
  status = next;
  const now = info();
  for (const fn of listeners) fn(now);
}

export const hasPending = () => api.configured() && store.queue().length > 0;

export function enqueue(op) {
  if (!api.configured()) return;
  store.queueAdd({ qid: newQid(), ...op });
  schedule(0);
}

export function start() {
  window.addEventListener('online', () => { failures = 0; schedule(0); });
  window.addEventListener('beforeunload', (event) => {
    if (!hasPending()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  if (!api.configured()) { emit('local'); return; }
  schedule(0);
}

/** Show "offline" until the next successful call (used when resuming could not reach the server). */
export function markOffline() {
  if (api.configured()) emit('offline');
}

/** Try again right away (for example after the person presses Continue). */
export const kick = () => { if (api.configured()) schedule(0); };

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(drain, ms);
}

function send(op) {
  switch (op.kind) {
    case 'register':
      return api.registerEvaluator({ code: op.code, name: op.name, email: op.email, userAgent: op.user_agent });
    case 'rating':
      return api.saveRating({
        code: op.code, sheet: op.sheet, itemId: op.item_id, answer: op.answer,
        elapsedMs: op.elapsed_ms, clientTs: op.client_ts, appVersion: op.app_version,
      });
    case 'finish':
      return api.finishEvaluation(op.code);
    default:
      return Promise.resolve(null);
  }
}

async function drain() {
  if (running) return;
  if (!api.configured()) { emit('local'); return; }
  running = true;
  try {
    for (;;) {
      const q = store.queue();
      if (!q.length) { failures = 0; emit('saved'); return; }
      const op = q[0];
      emit('saving');
      try {
        await send(op);
        store.queueRemove(op.qid);
        failures = 0;
      } catch (err) {
        if (err && err.retryable === false) {
          // The server does not know this code (for example the database was reset): register it again once.
          const who = store.getIdentity(op.code);
          if (/unknown evaluator/i.test(err.message) && op.kind !== 'register' && !op.reregistered && who) {
            store.queuePatch(op.qid, { reregistered: true });
            store.queueFront({ qid: newQid(), kind: 'register', code: op.code, name: who.name, email: who.email, user_agent: navigator.userAgent });
            continue;
          }
          store.queueRemove(op.qid);
          store.failedAdd({ ...op, error: String(err.message).slice(0, 300), status: err.status, at: new Date().toISOString() });
          continue;
        }
        const wait = DELAYS[Math.min(failures, DELAYS.length - 1)];
        failures += 1;
        emit('offline');
        schedule(wait);
        return;
      }
    }
  } finally {
    running = false;
  }
}
