# 导演台剧本质检：3 形态 × 真实 LLM 生成 → 结构 / 博弈决策 / 分镜提示词 / 可玩性（模拟跑局）
import json, sys, time, re, random, urllib.request as U
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
def req(p, body=None, t=200):
    r = U.Request(B + p, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None, headers={'content-type': 'application/json'}, method='POST' if body is not None else 'GET')
    try: return json.loads(U.urlopen(r, timeout=t).read())
    except U.HTTPError as e: return json.loads(e.read())
CASES = [
 ('anime', '', '病弱师尊其实是魔尊，全宗门只有我知道，揭穿他还是陪他演'),
 ('live', 'suspense', '午夜出租车，后视镜里的红裙乘客没有倒影，她说要去13号公墓'),
 ('abstract', '', '前任变成了楼下的自动售货机，投一枚硬币说一句真心话'),
]
PLACEHOLDER = re.compile(r'中文|英文|待补|第一抉择的|每条路线|\.\.\.|TODO|placeholder', re.I)
CJK = re.compile(r'[\u4e00-\u9fff]')
def audit(cat, genre, theme):
    t0 = time.time(); b = req('/api/director/brief', {'theme': theme, 'cat': cat, 'genre': genre or None, 'scale': 'standard', 'auto': False}, 420)
    dt = time.time() - t0
    if 'id' not in b: return {'cat': cat, 'fail': b}
    d = req('/api/studio/projects/' + b['id']); tree = d['tree']; N = tree['nodes']; C = tree['clips']
    issues = []
    # ① 结构
    v = b['validation']
    if not v['ok']: issues.append('结构错误: ' + '；'.join(v['errors']))
    # ② 博弈决策质量
    labels, dup = [], 0
    for n in N:
        if PLACEHOLDER.search(n['question']): issues.append(f"{n['id']} 问题是占位文字: {n['question']}")
        if not n['question'].rstrip().endswith(('？', '?')): issues.append(f"{n['id']} 问题不是问句: {n['question'][:20]}")
        if re.search(r'你(会|要|想|该|选|打算|决定)|要不要|是否|还是继续', n['question']): issues.append(f"{n['id']} 是玩家行动题而非竞猜题: {n['question']}")
        if re.search(r'[A-Za-z]{2,}', n['question']): issues.append(f"{n['id']} 题面泄漏英文 id: {n['question']}")
        ls = [o['label'] for o in n['options']]
        if len(set(ls)) < len(ls): issues.append(f"{n['id']} 选项重复 {ls}")
        for o in n['options']:
            if PLACEHOLDER.search(o['label']) or o['label'] in ('意想不到的第三条路', '隐藏分支'): issues.append(f"{o['id']} 选项占位: {o['label']}")
            if len(o['label']) > 10: issues.append(f"{o['id']} 选项过长({len(o['label'])}字)")
            if not o.get('hint'): issues.append(f"{o['id']} 缺少钩子提示")
        tw = [o for o in n['options'] if o.get('twist')]
        if not tw: issues.append(f"{n['id']} 无隐藏支")
        w = sum(o.get('weight', 0) for o in n['options'] if not o.get('twist'))
        if abs(w - 1) > 0.05: issues.append(f"{n['id']} 常规权重和={w:.2f}")
    # ③ 分镜 / 提示词
    no_line = [k for k, c in C.items() if len(c.get('lines') or []) < 2]
    stub = [k for k, c in C.items() if '待补分镜' in (c.get('shots') or '')]
    no_cjk_line = [k for k, c in C.items() if any(not CJK.search(l['text']) for l in (c.get('lines') or []))]
    long_line = [k for k, c in C.items() if any(len(l['text']) > 26 for l in (c.get('lines') or []))]
    ph_title = [k for k, c in C.items() if PLACEHOLDER.search(c.get('title') or '')]
    shots_n = {k: len(re.findall(r'Shot \d+:', c.get('shots') or '')) for k, c in C.items()}
    thin = [k for k, n in shots_n.items() if n < 3]
    cast = json.loads(d['bible']).get('cast', []) if isinstance(d.get('bible'), str) else d.get('bible', {}).get('cast', [])
    cast_cjk_look = [c['name'] for c in cast if CJK.search(c.get('look', ''))]
    for k, lab in ((stub, '占位分镜'), (no_line, '台词<2'), (no_cjk_line, '台词非中文'), (long_line, '台词>26字'), (ph_title, '标题占位'), (thin, '镜头<3')):
        if k: issues.append(f"{lab}: {k}")
    if cast_cjk_look: issues.append(f"角色外貌不是英文(影响一致性): {cast_cjk_look}")
    if v['forks'] < 1: issues.append('standard 规模缺少时间裂隙（fork 被截断/丢失）')
    bonus = [k for k in C if k.startswith('BONUS_')]
    if len(bonus) < 3: issues.append(f'彩蛋不足 {bonus}')
    # ④ 可玩性：模拟 2000 局随机路径（常规 + 悔棋新变数），统计结局覆盖
    byId = {n['id']: n for n in N}; root = next(n for n in N if n['depth'] == 1); ends = {}
    for _ in range(2000):
        n = root; path = 0
        while n and path < 8:
            opts = n['options'] if random.random() < .25 else [o for o in n['options'] if not o.get('twist')]
            if n.get('fork') and random.random() < .15: n = byId.get(n['fork']['node']); path += 1; continue
            o = random.choices(opts, [max(.01, o.get('weight', .25)) for o in opts])[0]
            if o.get('next'): n = byId.get(o['next']); path += 1
            else: ends[o['id']] = ends.get(o['id'], 0) + 1; break
    reach = len(ends); unreachable = v['endings'] - reach
    if unreachable > 0: issues.append(f'{unreachable} 个结局 2000 局未触达')
    return dict(cat=cat, title=b['title'], model=b['model'], secs=round(dt), fixes=b.get('fixes', []), lint=b.get('lint', []), nodes=v['nodes'], endings=v['endings'], forks=v['forks'], clips=v['clips'], credits=b['estimate']['credits'],
                cast=[(c['name'], c['role'][:14]) for c in cast], q=[(n['id'], n['question'], [(o['label'], o.get('hint', ''), '★' if o.get('twist') else '') for o in n['options']]) for n in N],
                sample_lines={k: [l['text'] for l in C[k].get('lines', [])][:3] for k in list(C)[:3]}, issues=issues, project=b['id'])
if __name__ == '__main__':
    only = sys.argv[2] if len(sys.argv) > 2 else None
    out = []
    for c in CASES:
        if only and c[0] != only: continue
        r = audit(*c); out.append(r)
        print(json.dumps(r, ensure_ascii=False, indent=1), flush=True)
    json.dump(out, open('/tmp/director_audit.json', 'w'), ensure_ascii=False, indent=1)
