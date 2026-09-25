# 去旁白：把每个分镜段落改写为纯对白（含情绪标注 + 环境音/音效标签）
import json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_story import llm, BIBLE
D = os.path.dirname(os.path.abspath(__file__))
c = json.load(open(os.path.join(D, 'comic.json')))
OUT = os.path.join(D, 'dialogue.json')
done = json.load(open(OUT)) if os.path.exists(OUT) else {}
AMB = ['rain_roof', 'rain_street', 'city_night', 'interior_hum', 'server_room', 'stairwell', 'boardroom', 'alarm', 'dawn_wind']
SFX = ['none', 'gunshot', 'explosion', 'thunder', 'glass_break', 'footsteps_run', 'elevator_ding', 'door_slam', 'chip_beep', 'heartbeat', 'sniper_bolt', 'crowd_gasp']
EMO = ['neutral', 'sad', 'angry', 'fearful', 'surprised', 'happy', 'disgusted']
# 路径上下文：每段落之前发生了什么（便于衔接）
ctx = {}
def walk(nid, prev):
    n = next(x for x in c['nodes'] if x['id'] == nid)
    for o in n['options']:
        ctx[o['id']] = prev + f" →〔{n['question']}〕{o['label']}"
        if o['next'] and not o['twist']: walk(o['next'], ctx[o['id']])
walk(c['nodes'][0]['id'], '序章')
for sid in c['prologue']: ctx[sid] = '序章开场'
def batch(ids):
    items = []
    for sid in ids:
        s = c['segments'][sid]
        items.append({'id': sid, 'path': ctx.get(sid, '')[-160:], 'title': s['title'], 'narration': s['narration'], 'dialogue': s.get('dialogue', []), 'image': s['image']})
    return llm(f"""你是顶级漫剧/广播剧编剧。{BIBLE}
任务：把下面每个分镜段落【去掉旁白】，改写成 3-4 句纯角色对白，让画面信息、动作、转折全部通过人物的台词和语气表达出来（可以用喊话、低语、自言自语、对讲机、电话），节奏紧凑、口语化、有张力，像真人演员在演。
规则：
- speaker 只能是：林夏、陈默、渡鸦、林小雨、顾衡（选画面中/情节中合理出现的人；林小雨不在场时可通过“电话/耳机”说话，text 前不要加标注）
- 每句 text ≤ 26 字，可用“……”“——”“！”“？”表现停顿与情绪，不要写动作描写括号
- emotion ∈ {EMO}（按台词真实情绪选，不要全是 neutral）；speed 0.85-1.15（紧张加快，沉重放慢）
- 必须保留原段落的关键信息与结果（尤其是 path 最后一个选择的结果），与前情衔接
- ambience ∈ {AMB}（该段环境底噪）；sfx ∈ {SFX}（该段最关键的一个音效，没有就 none）；sfx_at：音效在第几句前触发（0 起）
输入：{json.dumps(items, ensure_ascii=False)}
输出 JSON：{{"segments":{{"<id>":{{"lines":[{{"speaker","text","emotion","speed"}}],"ambience","sfx","sfx_at"}}}}}}""", effort='low')
todo = [sid for sid in c['segments'] if sid not in done]
chunks = [todo[i:i + 8] for i in range(0, len(todo), 8)]
print('todo', len(todo), 'chunks', len(chunks), flush=True)
with cf.ThreadPoolExecutor(6) as ex:
    for res in ex.map(lambda ch: (ch, batch(ch)), chunks):
        ch, r = res
        for sid in ch:
            seg = r.get('segments', {}).get(sid)
            if seg and seg.get('lines'): done[sid] = seg
        json.dump(done, open(OUT, 'w'), ensure_ascii=False, indent=1)
        print('ok', len(done), flush=True)
print('missing', [s for s in c['segments'] if s not in done])
