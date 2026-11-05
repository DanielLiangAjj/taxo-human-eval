# Human evaluation site for the outcome taxonomy: specification

Written 5 November 2026 for the implementing agent. Read all of it before writing code. Where this file is silent, choose the simplest option that keeps the ratings blind and the answers safe.

## 1. What this is

Two human evaluators (clinical colleagues) rate items drawn blind from two automatically built taxonomies of ClinicalTrials.gov outcome measures. They never learn which taxonomy an item came from. Each evaluator rates every item, in their own random order, over several sittings (about 3 hours in all), and must be able to stop and pick up where they left off from any device. Answers are saved on every click to a Supabase project (free Postgres) and later pulled into tab-separated sheets that the existing scoring scripts read.

The site is static, hosted on GitHub Pages from this repository's root, served under a sub-path (`https://danielliangajj.github.io/taxo-human-eval/`). Use relative URLs everywhere. No build step, no bundler, no framework: plain HTML, CSS and JavaScript ES modules. The only external resource allowed is D3 v7 from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js`). Everything else is inline or in this repo. The repo is public, so nothing secret may be committed: `config.js` holds the Supabase URL and the public anon key only (placeholders until Daniel fills them), and `results/`, `kit/` and `config.local.js` are git-ignored.

Dropbox syncs this folder: keep the tree small, no `node_modules`.

## 2. Data: `data/items.json` (already built; do not regenerate, do not edit)

```
{ "version": "2026-11-05",
  "common_instructions": "<markdown: what counts as one outcome>",
  "sheets": [
    {"id":"links","title":"Links","short":"child under parent","labels":["right","too broad","wrong"],"reason_required_unless":"right","instructions":"<markdown>",
     "items":[{"id":"L0307","child":"superoxide dismutase","parent":"oxidative stress","child_kind":"bottom node"|"category","child_context":"Registered description ..."|null}]},
    {"id":"pairs","title":"Pairs","short":"two outcome titles","labels":["same measurement","same domain","neither"],"reason_required_unless":null,"instructions":"<markdown>",
     "items":[{"id":"P0035","a":"<title A>","b":"<title B>"}]},
    {"id":"groups","title":"Groups","short":"the children of one category","labels":null,"reason_required_unless":null,"instructions":"<markdown>",
     "items":[{"id":"G0001","category":"eating behaviour measures","children":[{"letter":"a","name":"...","kind":"bottom node"|"category","context":"..."|null}, ...]}]},
    {"id":"coverage","title":"Coverage","short":"can the taxonomy encode a new title?","labels":["exact node","category only","not covered"],"reason_required_unless":null,"instructions":"<markdown>",
     "items":[{"id":"C0001","title":"<new outcome title>","context":"..."|null,"candidates":[{"name":"...","kind":"bottom node"|"category"}, x5]}]}
  ]}
```

Counts: 359 links, 158 pairs, 99 groups, 49 coverage items. Sheet order in the site is fixed: links, pairs, groups, coverage. Within a sheet, the item order is a deterministic shuffle seeded by the evaluator's code (use a small seeded PRNG such as mulberry32 over a hash of the code), so two evaluators get different orders and a returning evaluator always gets the same order. The markdown in the instructions uses only paragraphs, `**bold**`, and `- ` bullet lists: write a 30-line renderer for exactly that, no library.

A "bottom node" is a registered outcome measure; a "category" is a node above the bottom nodes. `child_context` and `context` are the trial's registered description or conditions for a bottom node; show them as a quieter line under the name (and as a tooltip in groups and coverage), never as the main text.

## 3. Identity, codes, resume

- Welcome screen: title ("Rating an outcome taxonomy"), three sentences of purpose, a collapsible "What counts as one outcome" (the `common_instructions` markdown), the four sheets with their item counts and a time estimate (links about 15 s each, pairs 10 s, groups 30 s, coverage 20 s; show the total rounded to the quarter hour), one line of consent ("Your name and email are stored so we can credit and contact you; nothing else about you is collected."), then a form: full name (required, 2 to 80 characters) and email (required, simple format check), and a **Start** button. Below it, a **Resume with a code** field.
- On Start: generate a 10-character code from `crypto.getRandomValues` using the Crockford base32 alphabet (no I, L, O, U), register the evaluator (name, email, code, user agent) on the server, save `{code, name, email}` in localStorage, and go to the first sheet's intro. Show the code in the header on every later screen with a copy button and a `mailto:` link that puts the code and the site URL in a message to the evaluator's own address ("Email me my code"); explain in one line that the code is how they resume on another device.
- On Resume: validate the code's shape, fetch the evaluator's progress from the server, merge it with any answers in localStorage for that code (an answer with the later `client_ts` wins), and continue at the first unanswered item in sheet order. If the server is unreachable but localStorage has the code, continue from local data and show the offline banner.
- On any later visit from the same browser, localStorage has the code: skip the form and offer "Continue as <name>" plus "I am someone else".

## 4. Server: Supabase (`supabase/schema.sql`, `supabase/README.md`)

Write `schema.sql` so Daniel can paste it once into the Supabase SQL editor. Contents:

- `evaluators(code text primary key, name text not null, email text not null, user_agent text, created_at timestamptz default now(), last_seen timestamptz, completed_at timestamptz)`
- `ratings(id bigserial primary key, code text not null references evaluators(code), sheet text not null, item_id text not null, answer jsonb not null, elapsed_ms integer, client_ts timestamptz, app_version text, created_at timestamptz default now(), updated_at timestamptz default now(), unique(code, sheet, item_id))`
- Row-level security ON for both tables, with NO policies for `anon` or `authenticated`: visitors can never read or write the tables directly.
- Four `security definer` functions, `grant execute ... to anon`, each validating its inputs (code matches `^[0-9A-HJKMNP-TV-Z]{10}$`, sheet in the four ids, item_id up to 10 characters, `pg_column_size(answer) < 4096`, name and email lengths):
  - `register_evaluator(p_code, p_name, p_email, p_user_agent)`: insert or update name/email/last_seen.
  - `save_rating(p_code, p_sheet, p_item_id, p_answer jsonb, p_elapsed_ms, p_client_ts, p_app_version)`: upsert on (code, sheet, item_id), keep the row with the later client_ts, set updated_at and the evaluator's last_seen.
  - `get_progress(p_code)` returns jsonb `{name, email, completed_at, ratings:[{sheet,item_id,answer,client_ts}]}` for that code only, or null when unknown.
  - `finish_evaluation(p_code)`: sets completed_at.
- The client calls them with `fetch` on `${SUPABASE_URL}/rest/v1/rpc/<fn>` with headers `apikey`, `Authorization: Bearer <anon key>`, `Content-Type: application/json`, body = the parameters as JSON. No Supabase JS library.
- `supabase/README.md`: the five steps for Daniel (create a free project with GitHub login, open SQL editor, paste schema.sql and run, copy Project URL and anon public key from Settings > API into `config.js`, commit and push). State plainly that the anon key is designed to be public and that the functions are the only door.

`config.js` exports `SUPABASE_URL` and `SUPABASE_ANON_KEY` as empty strings. When either is empty the app runs in **local-only mode**: everything works, answers live in localStorage, a yellow banner says "Saving to this browser only (no server configured)", and the finish screen insists on the download. Also support `config.local.js` (git-ignored) overriding `config.js` if present, for local testing with real keys: load it with a dynamic `import()` in a try/catch.

## 5. Saving

- Every answer is written to localStorage immediately (keyed by code, sheet, item) and queued for the server. The queue is drained in order with retries (1 s, 4 s, 15 s, then every 60 s); a small status dot in the header shows saved / saving / offline with a plain-words tooltip. `beforeunload` warns only while the queue is non-empty.
- Each saved answer carries `elapsed_ms` (time the item was on screen before Next), `client_ts` (ISO), and `app_version` (from a constant in the code; bump it when you change answer formats).
- Going **Back** re-opens the previous item with its answer filled in; changing it saves again (upsert).

## 6. Screens and item flow

1. Welcome (section 3).
2. Sheet intro: sheet title, the sheet's `instructions` markdown, item count and time, a **Begin** button. Shown again when returning mid-sheet, with "Continue at item n".
3. Item screen: top bar with sheet name, "item n of N", an overall progress bar across all sheets, the code, the save dot, a **Pause** button (returns to a screen that says the answers are saved and how to resume). Then the visualization (section 7), the question, the answer controls, the reason box, **Back** and **Next**. Next is disabled until the answer is valid. Keyboard: 1, 2, 3 choose the labels in order, Enter = Next when valid, B = Back; show the hints discreetly.
4. Sheet complete: one line, then the next sheet's intro. After the last sheet: the finish screen (thanks by name, counts per sheet, **Download my answers (JSON)** as a backup, the sentence "Your answers are saved; you can close this page."). Call `finish_evaluation`.

Answer validity and JSON per sheet (these exact keys and values; the pull script depends on them):

- links: `{"rating":"right"|"too broad"|"wrong","reason":"<text>","better_parent":"<text or empty>","unclear":false}`. Reason required (at least 3 characters) unless rating is right. Optional field "If you can, name a better parent". An **Unreadable or unclear** checkbox applies the guide's convention: rating wrong, reason "unclear", `unclear:true`.
- pairs: `{"rating":"same measurement"|"same domain"|"neither","note":"<text or empty>","unclear":false}` (unclear: neither + note unclear).
- groups: `{"misfits":["a","c"],"one_level":"yes"|"no","reason":"<text>"}`. Reason required when misfits is non-empty or one_level is no.
- coverage: `{"rating":"exact node"|"category only"|"not covered","candidate":0..4|null,"note":"<text or empty>","unclear":false}`. A candidate must be selected for exact node and category only (clicking a candidate selects it; the two ratings become available; not covered clears it). Unclear: not covered + note unclear.

Wording on screen comes from the guide's instructions; keep button labels exactly the label strings above.

## 7. Visualization and the move animation (D3, SVG)

The picture must never reveal more than the sheet shows on paper, and must look the same for every item of a sheet apart from the names. Build one SVG component per sheet type:

- **Links: pair in a schematic tree.** A fixed schematic: a root node at the top labeled "clinical trial outcome measures" (the root name is shared by both taxonomies), two unlabeled placeholder nodes in a chain below it (dotted grey circles, no text, identical on every item), then the **parent** as a rounded rectangle with its name (wrap long names), then the **child** below it as a rounded rectangle, with two unlabeled placeholder siblings beside the child and two beside the parent. The parent-child edge is thick and highlighted and carries a "?" badge until the evaluator answers; the badge becomes a green check (right), an amber up-arrow (too broad) or a red cross (wrong) when a label is chosen. The child's context line sits under the child's box in smaller type. The placeholders must not change position, count or style between items: they are decoration that says "there is a tree around this pair", nothing more.
- **Move animation on Next (links):** the badge settles (200 ms), then the whole schematic pans and zooms out so the rated pair shrinks toward one placeholder position, and the next pair grows in from a different placeholder position while the schematic re-centres (about 700 ms in total, ease-in-out). It must never block input for more than 900 ms, and under `prefers-reduced-motion` it is a 150 ms cross-fade. Back plays the reverse.
- **Pairs:** two title cards side by side joined by a line with a "?" badge; the chosen label replaces the badge with a word (same, domain, neither) in the sheet's colours; the next pair slides in from the right.
- **Groups:** the category as a node at the top, its children fanned below in one or two rows (up to ten), each a clickable card with its letter, name and a kind badge; clicking toggles "does not belong" (red dashed border and a strike icon; click again to undo). A two-option control under the picture: "One level of detail: yes / no". The next group fans in from the parent node.
- **Coverage:** the new title in a highlighted card at the top with a "new title" tag, the five candidates in a column below with kind badges; a selected candidate gets a blue border; the labels sit under the column. The next item's candidates slide up into place.

Colours: right/same measurement/exact node green `1B7F3B`; too broad/same domain/category only amber `B26B00`; wrong/neither/not covered red `B3261E`; selection blue `1F5FBF`; placeholders grey `BFC5CC`. Minimum text size 16 px on controls, 15 px in the SVG. Layout works from 768 px up; the SVG scales with `viewBox`.

## 8. Pull script: `scripts/pull_ratings.py`

Python 3, standard library only (urllib). Arguments: `--url`, `--service-key-file <path>` (the service role key read from that file at run time; never print it, never write it), `--kit <kit dir>` (the folder holding the blank pooled sheets: `pooled/rater1_links.tsv`, `pooled/rater1_pairs.tsv`, `pooled/rater1_groups.tsv`, and `coverage/<arm>/coverage_items.tsv`), `--out results/<date>/`, optional `--map CODE=1 --map CODE=2` to assign rater numbers (default: sign-up order), and `--progress` to only print per-evaluator counts per sheet with completion status.

It reads both tables through the REST endpoint (`/rest/v1/evaluators?select=*`, `/rest/v1/ratings?select=*`, with the service key as `apikey` and bearer token, paging with `Range` headers in chunks of 1000) and writes:

- `evaluators.csv` (code, name, email, created_at, last_seen, completed_at) and `ratings.jsonl` (raw rows).
- For each evaluator k: `rater<k>_links.tsv`, `rater<k>_pairs.tsv`, `rater<k>_groups.tsv` with exactly the blank sheets' columns and item ids, the rating column filled with the label text and the note column with the reason/note (append "better parent: ..." when given; "unclear" when flagged); groups: the misfit letters joined by spaces or `none`, then `yes`/`no`, then the reason. And `rater<k>_coverage.tsv` with columns `id, title, candidate 1..5, rating, note`, where the note starts with `candidate <n>:` when one was chosen.
- `progress.json` summarising counts.

Copy nothing else from the kit, and never write arm names (the kit's key files are not read by this script).

## 9. Repository and publishing

- Files at the root: `index.html`, `config.js`, `assets/app.js` (entry), `assets/` modules (state, storage, api, views, viz per sheet, markdown, prng), `assets/style.css`, `data/items.json`, `supabase/schema.sql`, `supabase/README.md`, `scripts/export_items.py` (exists), `scripts/pull_ratings.py`, `README.md` (what the site is, how to run locally with `python3 -m http.server 8000`, how to configure Supabase, how to pull results, the item JSON formats), `.gitignore` (exists), `SPEC.md` (this file).
- `git init` here if not a repository; commit under the user's existing git identity with plain messages and **no AI attribution lines of any kind** (no Co-Authored-By, no tool names in messages). Then `gh repo create DanielLiangAjj/taxo-human-eval --public --source . --push` and enable Pages on branch `main`, root folder, through `gh api -X POST repos/DanielLiangAjj/taxo-human-eval/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'` (fall back to `PUT` if it already exists). Report the Pages URL and whether it answered 200 within a few minutes.
- Add a `404.html` that redirects to `index.html` so a stale deep link still loads.

## 10. Testing before you report

- `node --check` on every JS file; load the site from `python3 -m http.server 8000` and walk, in a real browser if the Chrome tools are available to you (open a new tab, never reuse the user's tabs), otherwise with a small Node script using `jsdom` only if it is already installed (do not install packages): start, rate three items of each sheet, pause, reload, resume with the code, go back and change an answer, finish, download. Check the browser console is clean and that localStorage holds the answers in the formats of section 6.
- In local-only mode the whole flow must work. With `config.local.js` absent there is no server to test against; write the API module so that its three calls are isolated and easy to exercise later.
- Validate `supabase/schema.sql` by reading it twice for syntax; it will be run once by Daniel and must not need edits.

## 11. Report back

A short report: the files, the Pages URL, what was tested and how, anything in this spec you could not do and why, and the exact five steps Daniel must do next (Supabase project, paste SQL, fill config.js, commit, push). No secrets in the report.
