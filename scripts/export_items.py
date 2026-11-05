#!/usr/bin/env python3
"""Build data/items.json for the human-evaluation site from the blind kit (pilot6_build/e2r/annotation_human). Nothing that names an arm
leaves the kit: the site gets pooled ids, names, kinds, the registered description of a bottom node, and the rating guide's text.
Coverage items from the two trees are pooled here (identical candidate lists rated once); the mapping back to arms is written to
<kit>/coverage/coverage_pool_key.json, beside the links/pairs key (pooled/pooled_key.json) and the groups key (groups_key.json).
Usage: export_items.py --kit <kit dir> --context <context.json: bottom node -> description line> --guide ANNOTATION_GUIDE_FINAL.md --out data/items.json"""
import csv, json, re, os, argparse, datetime, glob
ap = argparse.ArgumentParser(); ap.add_argument('--kit', required=True); ap.add_argument('--context', required=True); ap.add_argument('--guide', required=True); ap.add_argument('--out', required=True)
a = ap.parse_args(); P = lambda *x: os.path.join(a.kit, *x)
def norm(s): return re.sub(r'\s+', ' ', str(s).strip().lower())
ctx = {norm(k): v for k, v in json.load(open(a.context, encoding='utf-8')).items()}
def context_for(name): return ctx.get(norm(name))
def rows(p): return list(csv.DictReader(open(p, encoding='utf-8'), delimiter='\t'))
def nk(s):
    w = re.sub(r'[^a-z0-9 ]', ' ', str(s).lower()).split()
    return ' '.join(t[:-1] if (t.endswith('s') and len(t) > 4 and not t.endswith('ss') and not t.endswith('us') and not t.endswith('is')) else t for t in w)
GLOSS = {os.path.basename(p)[len('glosses_'):-len('.json')]: {nk(k): v.get('definition', '') for k, v in json.load(open(p, encoding='utf-8')).items()} for p in glob.glob(P('glosses_*.json'))}
def gloss_for(name, arms):
    for arm in list(arms) + [a_ for a_ in GLOSS if a_ not in arms]:
        g = GLOSS.get(arm, {}).get(nk(name))
        if g: return g
    return None

# guide sections
guide = open(a.guide, encoding='utf-8').read(); sec = {}; cur = 'intro'; buf = []
for line in guide.splitlines():
    if line.startswith('## '):
        sec[cur] = '\n'.join(buf).strip(); cur = line[3:].strip(); buf = []
    else: buf.append(line)
sec[cur] = '\n'.join(buf).strip()
def section(prefix): return next((v for k, v in sec.items() if k.lower().startswith(prefix.lower())), '')
# links
pk = json.load(open(P('pooled', 'pooled_key.json'), encoding='utf-8')); links = []
for r in rows(P('pooled', 'rater1_links.tsv')):
    kinds = ' '.join(v.get('child_kind', '') for v in pk['links'][r['id']]['arms'].values()); kind = 'category' if 'categor' in kinds else 'bottom node'
    arms = list(pk['links'][r['id']]['arms'])
    links.append({'id': r['id'], 'child': r['child'], 'parent': r['parent'], 'child_kind': kind, 'child_context': context_for(r['child']) if kind == 'bottom node' else None,
                  'parent_gloss': gloss_for(r['parent'], arms), 'child_gloss': gloss_for(r['child'], arms) if kind == 'category' else None})
pairs = [{'id': r['id'], 'a': r['title A'], 'b': r['title B']} for r in rows(P('pooled', 'rater1_pairs.tsv'))]
gk = json.load(open(P('groups_key.json'), encoding='utf-8')); groups = []
for pid, g in gk['groups'].items():
    groups.append({'id': pid, 'category': g['category'], 'category_gloss': gloss_for(g['category'], list(g['arms'])), 'children': [{'letter': 'abcdefghijklmnop'[i], 'name': n, 'kind': k, 'context': context_for(n) if k == 'bottom node' else None} for i, (n, k) in enumerate(zip(g['children'], g['kinds']))]})
# coverage: pool the arms' draws on the same titles
cov_keys = {os.path.basename(os.path.dirname(p)): json.load(open(p, encoding='utf-8'))['items'] for p in sorted(glob.glob(P('coverage', '*', 'coverage_key.json')))}
by_title = {}
for arm, items in cov_keys.items():
    for cid, it in items.items():
        sig = tuple(c['name'] for c in it['candidates']); by_title.setdefault(it['title'], {}).setdefault(sig, {'candidates': [{'name': c['name'], 'kind': c['kind']} for c in it['candidates']], 'arms': {}})['arms'][arm] = cid
coverage, cov_pool = [], {}
n = 0
for title in sorted(by_title):
    for sig, v in by_title[title].items():
        n += 1; pid = f'C{n:04d}'; coverage.append({'id': pid, 'title': title, 'context': context_for(title), 'candidates': [dict(c, gloss=gloss_for(c['name'], list(v['arms'])) if c['kind'] == 'category' else None) for c in v['candidates']]}); cov_pool[pid] = {'title': title, 'arms': v['arms'], 'candidates': [c['name'] for c in v['candidates']]}
json.dump({'tags': sorted(cov_keys), 'items': cov_pool}, open(P('coverage', 'coverage_pool_key.json'), 'w', encoding='utf-8'), indent=1)
out = {'version': datetime.date.today().isoformat(), 'common_instructions': section('What counts as one outcome'),
       'sheets': [
  {'id': 'links', 'title': 'Links', 'short': 'child under parent', 'labels': ['right', 'too broad', 'wrong'], 'reason_required_unless': 'right', 'instructions': section('Sheet 1'), 'items': links},
  {'id': 'pairs', 'title': 'Pairs', 'short': 'two outcome titles', 'labels': ['same measurement', 'same domain', 'neither'], 'reason_required_unless': None, 'instructions': section('Sheet 2'), 'items': pairs},
  {'id': 'groups', 'title': 'Groups', 'short': 'the children of one category', 'labels': None, 'reason_required_unless': None, 'instructions': section('Sheet 4'), 'items': groups},
  {'id': 'coverage', 'title': 'Coverage', 'short': 'can the taxonomy encode a new title?', 'labels': ['exact node', 'category only', 'not covered'], 'reason_required_unless': None, 'instructions': section('Sheet 3'), 'items': coverage}]}
json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('glosses:', {a_: len(g) for a_, g in GLOSS.items()}, '| links with a parent gloss:', sum(1 for l in links if l['parent_gloss']), 'of', len(links), '| category children with a gloss:', sum(1 for l in links if l['child_gloss']), 'of', sum(1 for l in links if l['child_kind'] == 'category'), '| groups with a gloss:', sum(1 for g in groups if g['category_gloss']), 'of', len(groups))
print('items.json:', {s['id']: len(s['items']) for s in out['sheets']}, '| coverage pooled from', {arm: len(v) for arm, v in cov_keys.items()}, '| bottom-node links with a description:', sum(1 for l in links if l['child_context']), 'of', sum(1 for l in links if l['child_kind'] == 'bottom node'))
