# 剧本 V3：解决“断断续续、衔接不上、不知道谁在说”
# - 按剧情树层级顺序改写：每段都带上【上一段的原台词】+【刚做出的选择】，首句直接承接选择结果，末句把悬念递给下一个抉择
# - 每个抉择节点生成 1-2 句“抉择口播”（cue）：由角色在戏里说出两难，押注界面出现时播放，不会冷场
# - 台词里适度称呼对方名字 / 自报身份，让听众靠耳朵也能分辨是谁在说
# - 使用 ElevenLabs v4 表演标签（[sighs][whispers][exhales]…）加呼吸、停顿、语气
import json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_story import llm, BIBLE
D = os.path.dirname(os.path.abspath(__file__))
c = json.load(open(os.path.join(D, 'comic.json')))
old = json.load(open(os.path.join(D, 'dialogue.json')))
OUT = os.path.join(D, 'dialogue_v3.json')
done = json.load(open(OUT)) if os.path.exists(OUT) else {'segments': {}, 'cues': {}}
NODES = {n['id']: n for n in c['nodes']}
AMB = ['rain_roof', 'rain_street', 'city_night', 'interior_hum', 'server_room', 'stairwell', 'boardroom', 'alarm', 'dawn_wind']
SFX = ['none', 'gunshot', 'explosion', 'thunder', 'glass_break', 'footsteps_run', 'elevator_ding', 'door_slam', 'chip_beep', 'heartbeat', 'sniper_bolt', 'crowd_gasp']
EMO = ['neutral', 'sad', 'angry', 'fearful', 'surprised', 'happy', 'disgusted']
TAGS = '[sighs] [exhales] [whispers] [laughs] [crying] [nervously] [desperately] [alarmed] [sarcastic] [deadpan] [frustrated] [pauses] [gulps] [curious] [dramatically] [warmly]'

# 父段落：哪个节点的哪个选项通向该段落；以及段落之后的节点
seg_parent, seg_next, node_prev = {}, {}, {}
for n in c['nodes']:
    for o in n['options']:
        seg_parent[o['id']] = (n['id'], o)
        seg_next[o['id']] = o['next']
        if o['next']: node_prev.setdefault(o['next'], []).append(o['id'])
PRO = c['prologue']
node_prev[c['nodes'][0]['id']] = [PRO[-1]]
for i, sid in enumerate(PRO): seg_next[sid] = PRO[i + 1] if i + 1 < len(PRO) else c['nodes'][0]['id']

def lines_of(sid):
    s = done['segments'].get(sid) or old.get(sid) or {}
    return [f"{l['speaker']}：{l['text']}" for l in s.get('lines', [])]

def path_to(sid, k=6):
    # 回溯前情（节点问题 + 选择）
    out = []; cur = sid
    while cur in seg_parent and len(out) < k:
        nid, o = seg_parent[cur]; out.append(f"〔{NODES[nid]['question']}〕→{o['label']}")
        prev = [p for p in node_prev.get(nid, []) if not p.startswith('T_')] or node_prev.get(nid, [])
        cur = prev[0] if prev else None
    return ' / '.join(reversed(out)) or '序章'

def seg_item(sid):
    s = c['segments'][sid]
    nid, o = seg_parent.get(sid, (None, None))
    nx = seg_next.get(sid)
    prev = []
    if nid: prev = node_prev.get(nid, [])[:1]
    elif sid in PRO and PRO.index(sid) > 0: prev = [PRO[PRO.index(sid) - 1]]
    return {'id': sid, 'path': path_to(sid), 'chosen': (f"{NODES[nid]['question']} → 选择了【{o['label']}】({o['hint']})" + ('【悔棋后出现的隐藏变数】' if o['twist'] else '')) if nid else '序章',
            'prev_lines': lines_of(prev[0]) if prev else [], 'story': s['narration'], 'draft': lines_of(sid), 'title': s['title'], 'image': s['image'],
            'next': (f"接下来的抉择：{NODES[nx]['question']}" if nx in NODES else ('结局：' + (o.get('ending_title') or '') if o and not nx else '序章下一场')) }

RULE = f"""你是顶级广播剧/漫剧编剧。{BIBLE}
目标：让观众【闭上眼只听声音】也能听懂剧情、分清谁在说话，并且段落之间一气呵成，像一整部剧。
写作规则：
1. 每段 4-5 句纯对白，不要旁白。第 1 句必须直接承接 chosen（刚刚做出的选择）和 prev_lines（上一段最后说的话），像镜头无缝切过来；最后 1 句把情绪/悬念递给 next。
2. 让耳朵能分辨说话人：角色之间要自然地互相称呼（“林夏”“陈默”“小雨”“顾衡”“姐”“顾董”等），第一次开口的角色尽量在台词里暴露身份或被对方点名；渡鸦话少、短句、冷；顾衡慢条斯理、笑里藏刀；陈默沉稳沙哑；林小雨急、冲、叫林夏“姐”；林夏克制，但一提到妹妹就会破防。
3. 口语化，有抢话、打断（用“——”结尾表示被打断）、欲言又止（“……”）。每句 ≤ 28 字。
4. 可以在 text 开头或句中插入英文表演标签来加入呼吸、停顿和语气，每句最多 1-2 个，只能用这些：{TAGS}。标签用英文方括号，其余全部是中文。
5. emotion ∈ {EMO}（用于字幕情绪标记），intensity 0-1（情绪强度）。
6. ambience ∈ {AMB}；sfx ∈ {SFX}（最关键的一个音效）；sfx_at：音效在第几句之前触发（从 0 开始）。
7. text 里绝对不要写“林夏：”这类说话人前缀（speaker 字段已经有了）；称呼对方名字要自然地融进台词里。
8. 必须保留 story 中的关键事件和结果，但要用台词演出来。draft 是旧稿，可以参考，但要改得更连贯、更有戏。"""

def do_segments(ids):
    items = [seg_item(s) for s in ids]
    r = llm(RULE + f"\n输入：{json.dumps(items, ensure_ascii=False)}\n输出 JSON：{{\"segments\":{{\"<id>\":{{\"lines\":[{{\"speaker\",\"text\",\"emotion\",\"intensity\"}}],\"ambience\",\"sfx\",\"sfx_at\"}}}}}}", effort='low')
    return r.get('segments', {})

def do_cues(nids):
    items = []
    for nid in nids:
        n = NODES[nid]; prev = node_prev.get(nid, [])
        items.append({'id': nid, 'question': n['question'], 'options': [f"{o['label']}（{o['hint']}）" for o in n['options'] if not o['twist']], 'prev_lines': lines_of(prev[0]) if prev else []})
    r = llm(RULE + f"""
现在为每个【抉择节点】写 1-2 句“抉择口播”：抉择界面出现时播放，由当时在场最合适的角色说出，是紧接 prev_lines 的一句内心挣扎或逼问，把两难摆到观众面前（可以点出选项的方向，但不能暗示结果）。
输入：{json.dumps(items, ensure_ascii=False)}
输出 JSON：{{"cues":{{"<id>":[{{"speaker","text","emotion","intensity"}}]}}}}""", effort='low')
    return r.get('cues', {})

def save(): json.dump(done, open(OUT, 'w'), ensure_ascii=False, indent=1)

# 层级：序章 → depth1 选项 → depth2 → depth3 → depth4（父层先写，子层才能接上父层台词）
levels = [[s] for s in PRO]
for d in range(1, 5):
    levels.append([o['id'] for n in c['nodes'] if n['depth'] == d for o in n['options']])
for lv in levels:
    todo = [s for s in lv if s not in done['segments']]
    if not todo: continue
    chunks = [todo[i:i + 4] for i in range(0, len(todo), 4)]
    with cf.ThreadPoolExecutor(8) as ex:
        for ch, res in zip(chunks, ex.map(do_segments, chunks)):
            for sid in ch:
                if res.get(sid, {}).get('lines'): done['segments'][sid] = res[sid]
    save(); print('level done', len(done['segments']), flush=True)
todo = [n for n in NODES if n not in done['cues']]
chunks = [todo[i:i + 6] for i in range(0, len(todo), 6)]
with cf.ThreadPoolExecutor(6) as ex:
    for ch, res in zip(chunks, ex.map(do_cues, chunks)):
        for nid in ch:
            if res.get(nid): done['cues'][nid] = res[nid]
save()
print('segments', len(done['segments']), '/', len(c['segments']), 'cues', len(done['cues']), '/', len(NODES))
print('missing', [s for s in c['segments'] if s not in done['segments']], [n for n in NODES if n not in done['cues']])
