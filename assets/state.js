// Item data and the evaluator's session: per-sheet item orders, answers and progress.

import { seededShuffle } from './prng.js';

/** Stored with every answer; bump it whenever an answer format changes. */
export const APP_VERSION = '1.0';

export const SHEET_ORDER = ['links', 'pairs', 'groups', 'coverage'];
export const SECONDS_PER_ITEM = { links: 15, pairs: 10, groups: 30, coverage: 20 };

export async function loadItems() {
  const res = await fetch('data/items.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`data/items.json: HTTP ${res.status}`);
  const data = await res.json();
  const byId = new Map(data.sheets.map((s) => [s.id, s]));
  data.sheets = SHEET_ORDER.map((id) => byId.get(id)).filter(Boolean);
  return data;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class Session {
  constructor(data, code, who, answers) {
    this.data = data;
    this.code = code;
    this.name = who.name;
    this.email = who.email;
    this.sheets = data.sheets;
    this.answers = answers; // Map "sheet/item_id" -> {answer, elapsed_ms, client_ts, app_version}
    this.serverCompleted = undefined; // true / false once the server has been asked, else undefined
    this.order = {};
    for (const sheet of this.sheets) {
      // Sort first so the order depends only on the code and the item ids, never on file order.
      this.order[sheet.id] = seededShuffle(sheet.items.slice().sort(byId), `${code}:${sheet.id}`);
    }
    this.total = this.sheets.reduce((n, s) => n + s.items.length, 0);
  }

  key(sheetId, itemId) { return `${sheetId}/${itemId}`; }
  record(sheetId, itemId) { return this.answers.get(this.key(sheetId, itemId)) || null; }
  answeredIn(sheetId) { return this.order[sheetId].reduce((n, it) => n + (this.answers.has(this.key(sheetId, it.id)) ? 1 : 0), 0); }
  totalAnswered() { return this.sheets.reduce((n, s) => n + this.answeredIn(s.id), 0); }

  /** Index of the first unanswered item of sheet number s, or -1 when the sheet is complete. */
  firstUnansweredIn(s) {
    const sheetId = this.sheets[s].id;
    return this.order[sheetId].findIndex((it) => !this.answers.has(this.key(sheetId, it.id)));
  }

  /** {s, i} of the first unanswered item in sheet order, or null when everything is answered. */
  firstUnanswered() {
    for (let s = 0; s < this.sheets.length; s++) {
      const i = this.firstUnansweredIn(s);
      if (i >= 0) return { s, i };
    }
    return null;
  }
}

export function minutesFor(sheet) {
  return (sheet.items.length * (SECONDS_PER_ITEM[sheet.id] || 15)) / 60;
}

/** "about 25 min", "about 1 h 30 min" (rounded to 5 minutes). */
export function formatMinutes(min) {
  const m = Math.max(5, Math.round(min / 5) * 5);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `about ${h} h ${rest} min` : `about ${h} h`;
}

/** Total rounded to the quarter hour: "about 3 hours", "about 2 h 45 min". */
export function formatTotal(min) {
  const q = Math.max(15, Math.round(min / 15) * 15);
  const h = Math.floor(q / 60);
  const rest = q % 60;
  if (!h) return `about ${rest} min`;
  if (!rest) return `about ${h} hour${h === 1 ? '' : 's'}`;
  return `about ${h} h ${rest} min`;
}
