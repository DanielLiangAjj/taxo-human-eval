// Supabase project settings for the rating site.
// Both values are public by design: the anon (publishable) key only lets visitors call the four
// functions in supabase/schema.sql; the tables themselves stay closed to it.
// Leave both empty to run in local-only mode (answers stay in the browser).
// For local testing with other values, create config.local.js (git-ignored) with the same two exports.
export const SUPABASE_URL = 'https://xfpuahqpfndjgzgcgzic.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_3s-0zRRlDynusRjgNUrXCQ_JOeibpAZ';
