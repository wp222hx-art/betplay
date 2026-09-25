# 规范化剧情树 → comic.json（统一 ID、权重、悔棋隐藏分支、合流）
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from gen_story import llm, BIBLE, SEG, RULES
D = os.path.dirname(__file__)
t = json.load(open(os.path.join(D, 'story.json')))
strip = lambda s: re.sub(r'^悔棋[：:·\s]*', '', s or '').strip()

def norm_weights(opts):
    ws = [max(0.15, min(0.6, float(o.get('weight') or 0.3))) for o in opts]
    s = sum(ws); ws = [round(w / s, 2) for w in ws]; ws[-1] = round(1 - sum(ws[:-1]), 2)
    for o, w in zip(opts, ws): o['weight'] = w

need = []  # (node, path, is_final)
def fix(node, path, depth):
    opts = node['outcomes']
    # 把误放在 outcomes 里的“悔棋”选项转为 twist
    rs = [o for o in opts if (o.get('weight') or 0) == 0 or str(o.get('label', '')).startswith('悔棋') or o.get('key') == 'r']
    for r in rs:
        opts.remove(r)
        if not node.get('twist'): node['twist'] = r
    norm_weights(opts)
    node['_path'] = path; node['_depth'] = depth
    final = all('node' not in o for o in opts)
    node['_final'] = final
    if node.get('twist'):
        tw = node['twist']; tw['label'] = strip(tw['label'])[:10]
        keys = [o['key'] for o in opts]
        if not final and tw.get('merge_into') not in keys:
            tw['merge_into'] = max(opts, key=lambda o: o['weight'])['key']
        if final and not tw.get('ending_title'): tw['ending_title'] = tw['label'][:8]
    else:
        need.append((node, path, final))
    for o in opts:
        if 'node' in o: fix(o['node'], path + o['key'], depth + 1)
fix(t['root'], 'R', 1)
print('need twists:', [n[1] for n in need], file=sys.stderr)

if need:
    desc = []
    for node, path, final in need:
        desc.append({'path': path, 'question': node['question'], 'final': final,
                     'options': [{'key': o['key'], 'label': o['label'], 'story': o['segment']['narration']} for o in node['outcomes']]})
    res = llm(f"""你是顶级漫剧编剧。{BIBLE}
以下抉择节点缺少“悔棋隐藏选项”（玩家悔棋后才会出现的第三条路，要出人意料但合乎人物）。请逐个补写：
{json.dumps(desc, ensure_ascii=False)}
非 final 节点：twist 需给 merge_into（之后并入哪个已有选项 key 的剧情线）；final 节点：twist 就是一个隐藏结局，需给 ending_title。
输出 {{"twists":{{"<path>":{{"label","hint","category","merge_into?","ending_title?","segment":{SEG}}}}}}}
{RULES}""")
    for node, path, final in need:
        tw = res['twists'].get(path)
        if not tw: continue
        tw['label'] = strip(tw['label'])[:10]
        if not final and tw.get('merge_into') not in [o['key'] for o in node['outcomes']]:
            tw['merge_into'] = max(node['outcomes'], key=lambda o: o['weight'])['key']
        if final and not tw.get('ending_title'): tw['ending_title'] = tw['label'][:8]
        node['twist'] = tw

# 扁平化
out = {'series': {'id': 'dome', 'title': '穹顶之下', 'logline': '一枚星核，一夜抉择——34 个押注点，75 条常规分支，悔棋还会多出隐藏选项。'},
       'prologue': [], 'nodes': [], 'segments': {}}
for i, s in enumerate(t['prologue']):
    sid = f'P{i+1}'; out['segments'][sid] = s; out['prologue'].append(sid)
def flat(node):
    nid = 'N_' + node['_path']
    opts = []
    for o in node['outcomes']:
        oid = 'O_' + node['_path'] + o['key']
        out['segments'][oid] = o['segment']
        opts.append({'id': oid, 'key': o['key'], 'label': o['label'][:10], 'hint': (o.get('hint') or '')[:16], 'weight': o['weight'],
                     'category': o.get('category', 'risk'), 'next': ('N_' + o['node']['_path']) if 'node' in o else None,
                     'ending_title': o.get('ending_title') if 'node' not in o else None, 'twist': False})
    tw = node.get('twist')
    if tw:
        oid = 'T_' + node['_path']
        out['segments'][oid] = tw['segment']
        merge = next((x for x in opts if x['key'] == tw.get('merge_into')), None)
        opts.append({'id': oid, 'key': 'T', 'label': tw['label'], 'hint': (tw.get('hint') or '')[:16], 'weight': 0.25, 'category': tw.get('category', 'risk'),
                     'next': merge['next'] if merge else None, 'ending_title': tw.get('ending_title') if not (merge and merge['next']) else None, 'twist': True})
    out['nodes'].append({'id': nid, 'depth': node['_depth'], 'question': node['question'][:24], 'options': opts})
    for o in node['outcomes']:
        if 'node' in o: flat(o['node'])
flat(t['root'])
json.dump(out, open(os.path.join(D, 'comic.json'), 'w'), ensure_ascii=False, indent=1)
reg = sum(1 for n in out['nodes'] for o in n['options'] if not o['twist'])
tw = sum(1 for n in out['nodes'] for o in n['options'] if o['twist'])
ends = sum(1 for n in out['nodes'] for o in n['options'] if not o['next'])
print(f"nodes={len(out['nodes'])} regular_branches={reg} twist_branches={tw} endings={ends} segments={len(out['segments'])}")
