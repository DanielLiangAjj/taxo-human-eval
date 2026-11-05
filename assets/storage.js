// Browser persistence (localStorage, with an in-memory mirror if the browser refuses to store).
// Keys:
//   taxo:current                      {code, name, email} of the person using this browser now
//   taxo:id:<code>                    {name, email} for every code used in this browser
//   taxo:a:<code>:<sheet>:<item_id>   {answer, elapsed_ms, client_ts, app_version}
//   taxo:queue                        operations still to send to the server, oldest first
//   taxo:failed                       operations the server refused (kept for the record)
//   taxo:done:<code>                  ISO time the evaluator reached the finish screen

const P = 'taxo:';
const mem = new Map();
let persistent = true;

try {
  localStorage.setItem(`${P}probe`, '1');
  localStorage.removeItem(`${P}probe`);
} catch {
  persistent = false;
}

/** False when the browser does not keep data (private mode, storage full, blocked). */
export const storageWorks = () => persistent;

function getRaw(key) {
  if (mem.has(key)) return mem.get(key);
  if (!persistent) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function setRaw(key, value) {
  mem.set(key, value);
  if (!persistent) return;
  try { localStorage.setItem(key, value); } catch { persistent = false; }
}

function delRaw(key) {
  mem.delete(key);
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function keysWithPrefix(prefix) {
  const out = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.add(k);
    }
  } catch { /* storage unavailable */ }
  for (const k of mem.keys()) if (k.startsWith(prefix)) out.add(k);
  return [...out];
}

function getJSON(key, fallback = null) {
  const raw = getRaw(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
const setJSON = (key, value) => setRaw(key, JSON.stringify(value));

// ---- identity -------------------------------------------------------------------------------
export const getCurrent = () => getJSON(`${P}current`);
export const setCurrent = (who) => setJSON(`${P}current`, { code: who.code, name: who.name, email: who.email });
export const clearCurrent = () => delRaw(`${P}current`);
export const getIdentity = (code) => getJSON(`${P}id:${code}`);
export const setIdentity = (code, who) => setJSON(`${P}id:${code}`, { name: who.name, email: who.email });

// ---- answers --------------------------------------------------------------------------------
const answerKey = (code, sheet, itemId) => `${P}a:${code}:${sheet}:${itemId}`;

export function saveAnswer(code, sheet, itemId, record) {
  setJSON(answerKey(code, sheet, itemId), record);
}

/** All answers stored for a code, as a Map "sheet/item_id" -> record. */
export function loadAnswers(code) {
  const prefix = `${P}a:${code}:`;
  const out = new Map();
  for (const key of keysWithPrefix(prefix)) {
    const [sheet, itemId] = key.slice(prefix.length).split(':');
    const record = getJSON(key);
    if (sheet && itemId && record && record.answer) out.set(`${sheet}/${itemId}`, record);
  }
  return out;
}

// ---- server queue ---------------------------------------------------------------------------
export const queue = () => getJSON(`${P}queue`, []);
const setQueue = (q) => setJSON(`${P}queue`, q);

const sameRating = (a, b) => a.kind === 'rating' && b.kind === 'rating'
  && a.code === b.code && a.sheet === b.sheet && a.item_id === b.item_id;

/** Append an operation; a newer rating for the same item replaces the queued older one. */
export function queueAdd(op) {
  const q = queue().filter((o) => !sameRating(o, op));
  q.push(op);
  setQueue(q);
}
export function queueFront(op) { const q = queue(); q.unshift(op); setQueue(q); }
export function queueRemove(qid) { setQueue(queue().filter((o) => o.qid !== qid)); }
export function queuePatch(qid, patch) { setQueue(queue().map((o) => (o.qid === qid ? { ...o, ...patch } : o))); }
export const isQueued = (code, sheet, itemId) => queue().some((o) => sameRating(o, { kind: 'rating', code, sheet, item_id: itemId }));

export const failed = () => getJSON(`${P}failed`, []);
export function failedAdd(op) { setJSON(`${P}failed`, [...failed(), op].slice(-500)); }

// ---- finish flag ----------------------------------------------------------------------------
export const getFinished = (code) => getRaw(`${P}done:${code}`);
export const setFinished = (code, iso) => setRaw(`${P}done:${code}`, iso);
