# Supabase setup (once, about ten minutes)

The rating site saves every answer to a free Supabase project (a hosted Postgres database). Until the
two values in `config.js` are filled in, the site runs in local-only mode: everything works, but answers
stay in each evaluator's browser and a yellow banner says so.

## The five steps

1. **Create the project.** Go to <https://supabase.com>, sign in with GitHub, and create a new project
   on the free plan (any name, for example `taxo-human-eval`; pick a region near the evaluators and
   keep the database password somewhere safe; the site never needs it).
2. **Open the SQL editor.** In the project dashboard, choose *SQL Editor* and start a new query.
3. **Paste and run the schema.** Paste the whole of `supabase/schema.sql` and press *Run*. It creates
   the two tables (`evaluators`, `ratings`), switches on row-level security with no policies, and adds
   the four functions the site calls (`register_evaluator`, `save_rating`, `get_progress`,
   `finish_evaluation`). It should finish with "Success. No rows returned".
4. **Copy the URL and the anon key into `config.js`.** In *Settings > API* copy the *Project URL*
   (`https://<project-ref>.supabase.co`) and the *anon public* key, and paste them into
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`. (Newer dashboards split this page: the URL is
   under *Settings > Data API*, the key under *Settings > API Keys*; use the `anon` `public` key from the
   legacy tab, or the publishable key.)
5. **Commit and push.** `git add config.js && git commit -m "Connect the rating site to Supabase" && git push`.
   GitHub Pages redeploys within a minute or two; the yellow banner disappears and the dot in the
   header turns green after the first saved answer.

## Is it safe to publish the anon key?

Yes. The anon key is designed to be public: it is shipped to every visitor's browser anyway, and it
only identifies the project. What it can do is decided by the database. Here row-level security is on
for both tables with no policies, and the table privileges are revoked from `anon`, so the key cannot
read or write any row directly. The four `security definer` functions in `schema.sql` are the only
door: they accept one evaluator's code, check every input (code format, sheet name, item id length,
answer size, name and email length), and `get_progress` returns only the rows of the code it is given.
A code is 10 random characters (about 50 bits), so codes cannot be guessed.

Never put the **service role** key (or a secret key) in this repository. It bypasses row-level
security. Keep it in a file outside the repository (for example `chmod 600 ~/.taxo_service_key`) and
pass that path to `scripts/pull_ratings.py --service-key-file`.

## Checking that it works

- Open the site, start as a test evaluator, rate one item, and look at *Table Editor > ratings* in the
  dashboard: the row should be there. Delete test rows afterwards (Table Editor, or
  `delete from ratings where code = '...'; delete from evaluators where code = '...';` in the SQL editor).
- `python3 scripts/pull_ratings.py --url https://<project-ref>.supabase.co --service-key-file ~/.taxo_service_key --progress`
  prints each evaluator's counts per sheet.

## Good to know

- Free projects are paused after about a week without any requests. If the dot in the header stays on
  "Offline", open the dashboard and restore the project; answers waiting in the evaluators' browsers
  are sent automatically once it is back.
- The answer formats are listed in the main `README.md`. Every row also carries `elapsed_ms` (time on
  screen before Next), `client_ts` (the browser's clock) and `app_version`.
