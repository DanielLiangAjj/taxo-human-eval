# Outcome taxonomy, human evaluation site

A static site (GitHub Pages) where two evaluators rate items drawn blind from two automatically built
taxonomies of ClinicalTrials.gov outcome measures: child-under-parent links, pairs of outcome titles,
the children of one category, and coverage of unseen titles. Each evaluator rates every item, in an
order seeded by their personal code, over as many sittings as they like (about 3 hours in all), and can
resume on any device with the code. Answers are saved on every Next to a Supabase project and pulled
into the scoring sheets with `scripts/pull_ratings.py`. The site never shows which taxonomy an item
came from.

Live: <https://danielliangajj.github.io/taxo-human-eval/>. See `SPEC.md` for the design.

## Run it locally

```
cd taxo-human-eval
python3 -m http.server 8000
```

Open <http://localhost:8000/>. With the empty values in `config.js` the site runs in **local-only
mode**: everything works, answers stay in the browser's localStorage, a yellow banner says so, and the
finish screen insists on downloading the answers as JSON.

To test against a real project without touching `config.js`, create `config.local.js` (git-ignored)
next to it with the same two exports; it overrides `config.js` everywhere except on GitHub Pages:

```js
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon public key>';
```

To start over as a tester, clear the site's storage in the browser (all keys start with `taxo:`).

## Configure Supabase

One-time setup, described step by step in `supabase/README.md`: create a free project, paste
`supabase/schema.sql` into the SQL editor and run it, copy the Project URL and the anon public key into
`config.js`, commit and push. The anon key is public by design; the tables are closed to it and the
four functions in `schema.sql` are the only way in.

## Pull the results

```
# counts per evaluator and sheet, with completion status
python3 scripts/pull_ratings.py --url https://<project-ref>.supabase.co --service-key-file ~/.taxo_service_key --progress

# fill the scoring sheets
python3 scripts/pull_ratings.py --url https://<project-ref>.supabase.co --service-key-file ~/.taxo_service_key \
    --kit kit --out results/2026-11-20 --map <CODE1>=1 --map <CODE2>=2
```

The service-role key is read from the file at run time and never printed or written; keep that file
outside the repository. `--kit` is the folder holding the blank pooled sheets
(`pooled/rater1_links.tsv`, `pooled/rater1_pairs.tsv`, `pooled/rater1_groups.tsv`); only those are read.
The script writes `evaluators.csv`, `ratings.jsonl` (raw rows), `rater<k>_links.tsv`,
`rater<k>_pairs.tsv`, `rater<k>_groups.tsv` (the blank sheets' columns and item ids, with the answer
columns filled), `rater<k>_coverage.tsv` (`id, title, candidate 1..5, rating, note`) and
`progress.json`. Without `--map`, raters are numbered in sign-up order. `results/` and `kit/` are
git-ignored.

## Answer formats

Every answer is stored per evaluator, sheet and item (`ratings.answer`, jsonb), with `elapsed_ms` (time
on screen before Next, summed over visits), `client_ts` (browser time, ISO) and `app_version`
(`APP_VERSION` in `assets/state.js`; bump it when a format changes). When the same item is saved twice,
the copy with the later `client_ts` wins, both on the server and when merging on resume.

| Sheet | `answer` | Valid when |
|---|---|---|
| links | `{"rating": "right" \| "too broad" \| "wrong", "reason": "...", "better_parent": "..." or "", "unclear": false}` | a rating is chosen; reason of 3+ characters unless the rating is right |
| pairs | `{"rating": "same measurement" \| "same domain" \| "neither", "note": "..." or "", "unclear": false}` | a rating is chosen |
| groups | `{"misfits": ["a", "c"], "one_level": "yes" \| "no", "reason": "..."}` | one_level answered; reason of 3+ characters when misfits is non-empty or one_level is no |
| coverage | `{"rating": "exact node" \| "category only" \| "not covered", "candidate": 0..4 or null, "note": "..." or "", "unclear": false}` | a rating is chosen; a candidate (0-based) for exact node and category only, null for not covered |

"Unreadable or unclear" applies the guide's convention: links `{"rating": "wrong", "reason": "unclear",
"unclear": true}`, pairs `{"rating": "neither", "note": "unclear", "unclear": true}`, coverage
`{"rating": "not covered", "candidate": null, "note": "unclear", "unclear": true}`.

`data/items.json` holds the items (built by `scripts/export_items.py` from the blind kit; do not edit
it by hand). Its shape is described in `SPEC.md`, section 2.

## Files

```
index.html, 404.html, config.js        page shell, deep-link redirect, Supabase settings (public)
assets/app.js                          entry: settings, items, first screen
assets/views.js                        screens and item flow (welcome, intro, item, pause, finish)
assets/controls.js                     answer controls, validity and answer JSON per sheet
assets/viz-links.js, viz-pairs.js,     the four SVG pictures (D3 7.9.0 from cdnjs)
  viz-groups.js, viz-coverage.js,
  viz-common.js
assets/state.js, storage.js,           session and item order, localStorage, save queue with retries,
  sync.js, api.js, prng.js,            Supabase RPC calls, seeded shuffle, guide markdown
  markdown.js, dom.js
assets/style.css
data/items.json                        the items (generated)
supabase/schema.sql, supabase/README.md
scripts/export_items.py, scripts/pull_ratings.py
```
