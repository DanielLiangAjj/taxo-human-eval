#!/usr/bin/env python3
"""Pull the human-evaluation answers from Supabase into the scoring sheets (standard library only).

Reads the two tables through the Supabase REST endpoint with the service-role key, which is read from
--service-key-file at run time and never printed or written anywhere.

  # who has done what so far
  python3 scripts/pull_ratings.py --url https://<ref>.supabase.co --service-key-file ~/.taxo_service_key --progress

  # fill the sheets
  python3 scripts/pull_ratings.py --url https://<ref>.supabase.co --service-key-file ~/.taxo_service_key \
      --kit kit --out results/2026-11-20 [--map CODE1=1 --map CODE2=2]

--kit is the folder of the blank pooled sheets: pooled/rater1_links.tsv, pooled/rater1_pairs.tsv and
pooled/rater1_groups.tsv give the columns and item ids of the output sheets. Only those three files are
read from the kit (never its key files). Coverage items are pooled on the site, so rater<k>_coverage.tsv is
written from data/items.json with the columns id, title, candidate 1..5, rating, note.

Writes into --out: evaluators.csv, ratings.jsonl (raw rows), rater<k>_links.tsv, rater<k>_pairs.tsv,
rater<k>_groups.tsv, rater<k>_coverage.tsv and progress.json. Raters are numbered by sign-up order unless
--map assigns numbers (then only the mapped evaluators get sheets).
"""
import argparse
import csv
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ITEMS = os.path.normpath(os.path.join(HERE, '..', 'data', 'items.json'))
SHEETS = ('links', 'pairs', 'groups', 'coverage')
PAGE = 1000


def fail(message):
    sys.exit(f'pull_ratings: {message}')


def read_key(path):
    try:
        with open(os.path.expanduser(path), encoding='utf-8') as f:
            key = f.read().strip()
    except OSError as e:
        fail(f'cannot read the service key file ({e.strerror})')
    if not key:
        fail('the service key file is empty')
    return key


class Rest:
    """Minimal PostgREST reader with Range paging."""

    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.key = key
        self.bearer = True

    def _get(self, path, start):
        headers = {
            'apikey': self.key,
            'Accept': 'application/json',
            'Range-Unit': 'items',
            'Range': f'{start}-{start + PAGE - 1}',
        }
        if self.bearer:
            headers['Authorization'] = f'Bearer {self.key}'
        req = urllib.request.Request(self.url + path, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def table(self, name, order):
        rows, start = [], 0
        while True:
            try:
                chunk = self._get(f'/rest/v1/{name}?select=*&order={order}', start)
            except urllib.error.HTTPError as e:
                if e.code == 416:  # asked past the last row
                    break
                if e.code == 401 and self.bearer and not self.key.startswith('eyJ'):
                    self.bearer = False  # newer non-JWT secret keys go in the apikey header only
                    continue
                body = e.read().decode('utf-8', 'replace')[:300].replace(self.key, '***')
                fail(f'reading {name} failed: HTTP {e.code} {body}')
            except urllib.error.URLError as e:
                fail(f'reading {name} failed: {e.reason}')
            if not isinstance(chunk, list):
                fail(f'reading {name} returned something unexpected')
            rows.extend(chunk)
            if len(chunk) < PAGE:
                break
            start += PAGE
        return rows


def clean(text):
    """One line of plain text for a TSV cell."""
    return ' '.join(str(text if text is not None else '').split())


def load_items(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    return {s['id']: s for s in data['sheets']}


def assign_raters(evaluators, mapping):
    codes = {e['code'] for e in evaluators}
    if mapping:
        out = {}
        for entry in mapping:
            code, sep, k = entry.partition('=')
            code = code.strip().upper()
            if not sep or not k.strip().isdigit() or int(k) < 1:
                fail(f'--map expects CODE=K with K a positive number, got {entry!r}')
            if code not in codes:
                print(f'warning: --map code {code} is not in the evaluators table', file=sys.stderr)
            out[code] = int(k)
        if len(set(out.values())) != len(out):
            fail('--map gives the same rater number to two codes')
        return out
    ordered = sorted(evaluators, key=lambda e: (e.get('created_at') or '', e['code']))
    return {e['code']: i + 1 for i, e in enumerate(ordered)}


def load_template(kit, sheet, wanted):
    """Header, rows and the indexes of the answer columns of a blank pooled sheet."""
    path = os.path.join(kit, 'pooled', f'rater1_{sheet}.tsv')
    try:
        with open(path, encoding='utf-8', newline='') as f:
            rows = list(csv.reader(f, delimiter='\t'))
    except OSError as e:
        fail(f'cannot read {path} ({e.strerror})')
    if not rows:
        fail(f'{path} is empty')
    header = rows[0]
    body = [r for r in rows[1:] if any(c.strip() for c in r)]
    low = [h.strip().lower() for h in header]
    found = {}
    for role, test in wanted:
        idx = next((i for i, h in enumerate(low) if test(h)), None)
        if idx is not None:
            found[role] = idx
    if len(found) < len(wanted):
        # fall back to the columns that are empty in every row of the blank sheet, in order
        blank = [i for i in range(len(header)) if all(i >= len(r) or not r[i].strip() for r in body)]
        if len(blank) != len(wanted):
            fail(f'cannot find the answer columns in {path}; header: {header}')
        found = {role: blank[n] for n, (role, _) in enumerate(wanted)}
    if 'id' not in low:
        fail(f'{path} has no id column')
    return header, body, low.index('id'), found


def write_tsv(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f, delimiter='\t', lineterminator='\r\n')
        writer.writerow(header)
        writer.writerows(rows)


def fill_from_template(template, answers, cells):
    header, body, id_col, cols = template
    out = []
    for row in body:
        row = list(row) + [''] * (len(header) - len(row))
        answer = answers.get(row[id_col].strip())
        if answer is not None:
            for role, value in cells(answer).items():
                row[cols[role]] = clean(value)
        out.append(row)
    return out


def links_cells(a):
    parts = []
    reason = clean(a.get('reason'))
    if reason:
        parts.append(reason)
    better = clean(a.get('better_parent'))
    if better:
        parts.append(f'better parent: {better}')
    if a.get('unclear') and 'unclear' not in (p.lower() for p in parts):
        parts.insert(0, 'unclear')
    return {'rating': a.get('rating') or '', 'note': '; '.join(parts)}


def pairs_cells(a):
    note = clean(a.get('note'))
    if a.get('unclear') and note.lower() != 'unclear':
        note = f'unclear; {note}' if note else 'unclear'
    return {'rating': a.get('rating') or '', 'note': note}


def groups_cells(a):
    misfits = [str(m) for m in (a.get('misfits') or [])]
    return {'misfits': ' '.join(sorted(misfits)) if misfits else 'none', 'level': a.get('one_level') or '', 'note': clean(a.get('reason'))}


def coverage_note(a):
    note = clean(a.get('note'))
    if a.get('unclear') and note.lower() != 'unclear':
        note = f'unclear; {note}' if note else 'unclear'
    cand = a.get('candidate')
    if isinstance(cand, int) and 0 <= cand <= 4:
        return f'candidate {cand + 1}:' + (f' {note}' if note else '')
    return note


def summarise(evaluators, ratings, raters, items):
    totals = {s: len(items[s]['items']) for s in SHEETS if s in items}
    known = {s: {it['id'] for it in items[s]['items']} for s in totals}
    counts = {}
    for r in ratings:
        sheet = r.get('sheet')
        if sheet in known and r.get('item_id') in known[sheet]:
            counts.setdefault(r['code'], {}).setdefault(sheet, set()).add(r['item_id'])
    people = []
    for e in sorted(evaluators, key=lambda e: (raters.get(e['code'], 10 ** 6), e.get('created_at') or '')):
        answered = {s: len(counts.get(e['code'], {}).get(s, ())) for s in totals}
        people.append({
            'rater': raters.get(e['code']),
            'code': e['code'],
            'name': e.get('name'),
            'created_at': e.get('created_at'),
            'last_seen': e.get('last_seen'),
            'completed_at': e.get('completed_at'),
            'answered': answered,
            'all_answered': all(answered[s] == totals[s] for s in totals),
        })
    return {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'items': totals, 'evaluators': people}


def print_progress(summary):
    totals = summary['items']
    print(f"{'rater':<6}{'code':<12}{'name':<26}" + ''.join(f'{s:>11}' for s in totals) + '  status')
    for p in summary['evaluators']:
        cells = ''.join(f"{p['answered'][s]:>7}/{totals[s]:<3}" for s in totals)
        if p['completed_at']:
            status = f"finished {p['completed_at'][:16]}"
        elif p['all_answered']:
            status = 'all answered, finish not recorded'
        else:
            status = f"in progress (last seen {(p['last_seen'] or '-')[:16]})"
        rater = str(p['rater']) if p['rater'] else '-'
        print(f"{rater:<6}{p['code']:<12}{(p['name'] or '')[:24]:<26}{cells}  {status}")
    if not summary['evaluators']:
        print('(no evaluators yet)')


def main():
    ap = argparse.ArgumentParser(description='Pull ratings from Supabase into the scoring sheets.')
    ap.add_argument('--url', required=True, help='Supabase project URL, https://<ref>.supabase.co')
    ap.add_argument('--service-key-file', required=True, help='file holding the service-role key (read, never printed)')
    ap.add_argument('--kit', help='folder of the blank pooled sheets (pooled/rater1_*.tsv)')
    ap.add_argument('--out', help='output folder, for example results/2026-11-20')
    ap.add_argument('--map', action='append', default=[], metavar='CODE=K', help='rater number for a code (repeatable)')
    ap.add_argument('--progress', action='store_true', help='only print counts per evaluator and sheet')
    ap.add_argument('--items', default=DEFAULT_ITEMS, help=argparse.SUPPRESS)
    a = ap.parse_args()
    if not a.progress and not (a.kit and a.out):
        ap.error('--kit and --out are required unless --progress is given')

    items = load_items(a.items)
    rest = Rest(a.url, read_key(a.service_key_file))
    evaluators = rest.table('evaluators', 'created_at.asc')
    ratings = rest.table('ratings', 'id.asc')
    raters = assign_raters(evaluators, a.map)
    summary = summarise(evaluators, ratings, raters, items)
    if a.progress:
        print_progress(summary)
        return

    templates = {
        'links': load_template(a.kit, 'links', [('rating', lambda h: h.startswith('rating')), ('note', lambda h: h.startswith('note') or h.startswith('reason'))]),
        'pairs': load_template(a.kit, 'pairs', [('rating', lambda h: h.startswith('rating')), ('note', lambda h: h.startswith('note') or h.startswith('reason'))]),
        'groups': load_template(a.kit, 'groups', [('misfits', lambda h: 'not belong' in h or 'misfit' in h), ('level', lambda h: h.startswith('one level')), ('note', lambda h: h.startswith('note') or h.startswith('reason'))]),
    }
    os.makedirs(a.out, exist_ok=True)

    with open(os.path.join(a.out, 'evaluators.csv'), 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        cols = ['code', 'name', 'email', 'created_at', 'last_seen', 'completed_at']
        writer.writerow(cols)
        for e in sorted(evaluators, key=lambda e: (e.get('created_at') or '', e['code'])):
            writer.writerow([e.get(c) if e.get(c) is not None else '' for c in cols])
    with open(os.path.join(a.out, 'ratings.jsonl'), 'w', encoding='utf-8') as f:
        for r in ratings:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

    by_code = {}
    for r in ratings:
        by_code.setdefault(r['code'], {}).setdefault(r['sheet'], {})[r['item_id']] = r['answer']

    coverage_items = sorted(items['coverage']['items'], key=lambda it: it['id'])
    written = []
    for code, k in sorted(raters.items(), key=lambda kv: kv[1]):
        mine = by_code.get(code, {})
        write_tsv(os.path.join(a.out, f'rater{k}_links.tsv'), templates['links'][0],
                  fill_from_template(templates['links'], mine.get('links', {}), links_cells))
        write_tsv(os.path.join(a.out, f'rater{k}_pairs.tsv'), templates['pairs'][0],
                  fill_from_template(templates['pairs'], mine.get('pairs', {}), pairs_cells))
        write_tsv(os.path.join(a.out, f'rater{k}_groups.tsv'), templates['groups'][0],
                  fill_from_template(templates['groups'], mine.get('groups', {}), groups_cells))
        cov = mine.get('coverage', {})
        rows = []
        for it in coverage_items:
            ans = cov.get(it['id'])
            cands = [clean(f"{c['name']} [{c['kind']}]") for c in it['candidates']][:5]
            cands += [''] * (5 - len(cands))
            rows.append([it['id'], clean(it['title']), *cands,
                         clean(ans.get('rating')) if ans else '', clean(coverage_note(ans)) if ans else ''])
        write_tsv(os.path.join(a.out, f'rater{k}_coverage.tsv'),
                  ['id', 'title', 'candidate 1', 'candidate 2', 'candidate 3', 'candidate 4', 'candidate 5', 'rating', 'note'], rows)
        written.append(k)

    with open(os.path.join(a.out, 'progress.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print_progress(summary)
    print(f"wrote {len(evaluators)} evaluators, {len(ratings)} ratings and sheets for rater(s) {', '.join(map(str, written)) or 'none'} to {a.out}")


if __name__ == '__main__':
    main()
