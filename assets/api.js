// Supabase calls. The site talks to four Postgres functions through PostgREST
// (POST {SUPABASE_URL}/rest/v1/rpc/<function>); there is no Supabase JS library.
// Each call below is a plain async function, so it can be exercised on its own, e.g. in the console:
//   const api = await import('./assets/api.js'); api.configure(url, key); await api.getProgress('ABCDEFGHJK');

let baseUrl = '';
let apiKey = '';
let sendBearer = true;

export function configure(url, key) {
  baseUrl = String(url || '').trim().replace(/\/+$/, '');
  apiKey = String(key || '').trim();
  sendBearer = true;
}

/** True when both the project URL and the anon key are set (otherwise the app runs local-only). */
export const configured = () => Boolean(baseUrl && apiKey);

export class ApiError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.name = 'ApiError';
    this.status = status;       // HTTP status, 0 for network failures
    this.retryable = retryable; // false when the server refused the request itself
  }
}

async function post(fn, params, timeoutMs) {
  const headers = { apikey: apiKey, 'Content-Type': 'application/json' };
  if (sendBearer) headers.Authorization = `Bearer ${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers, body: JSON.stringify(params), signal: ctrl.signal, cache: 'no-store',
    });
  } catch {
    throw new ApiError('The server could not be reached.', 0, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function rpc(fn, params, { timeoutMs = 15000 } = {}) {
  if (!configured()) throw new ApiError('No server is configured.', 0, false);
  let res = await post(fn, params, timeoutMs);
  // Newer non-JWT keys (sb_publishable_...) may be refused as a bearer token: retry once without it.
  if (res.status === 401 && sendBearer && !apiKey.startsWith('eyJ')) {
    sendBearer = false;
    res = await post(fn, params, timeoutMs);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let message = text;
    try { const body = JSON.parse(text); message = body.message || body.hint || text; } catch { /* plain text */ }
    // 400/409/413/422 mean the server looked at the request and refused it; retrying will not help.
    const retryable = ![400, 409, 413, 422].includes(res.status);
    throw new ApiError(message || `HTTP ${res.status}`, res.status, retryable);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerEvaluator({ code, name, email, userAgent }) {
  return rpc('register_evaluator', { p_code: code, p_name: name, p_email: email, p_user_agent: userAgent || null });
}

export function saveRating({ code, sheet, itemId, answer, elapsedMs, clientTs, appVersion }) {
  return rpc('save_rating', {
    p_code: code, p_sheet: sheet, p_item_id: itemId, p_answer: answer,
    p_elapsed_ms: elapsedMs ?? null, p_client_ts: clientTs, p_app_version: appVersion,
  });
}

/** {name, email, completed_at, ratings: [{sheet, item_id, answer, client_ts}]} or null for an unknown code. */
export function getProgress(code) {
  return rpc('get_progress', { p_code: code });
}

export function finishEvaluation(code) {
  return rpc('finish_evaluation', { p_code: code });
}
