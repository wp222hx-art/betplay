# 《心动回廊》：压制视频 + 逐字转写对齐字幕 + 海报/末帧 → src/love/data.json
# 剧情树：序章 → N1「命运的红线系向谁」（4 常规 + 悔棋新变数·雪）→ 5 个路线片段 → N_x「毕业那天，传说之樱下」（每条 3 常规 + 1 隐藏）→ 21 个结局
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story import CLIPS
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
RAW = os.path.join(D, 'raw'); OUT = os.path.join(ROOT, 'public/static/love'); os.makedirs(OUT, exist_ok=True)
SUBS = os.path.join(D, 'subs.json'); subs = json.load(open(SUBS)) if os.path.exists(SUBS) else {}
from PIL import Image

NAME = {'Shion': '诗音', 'Hina': '阳菜', 'Rin': '凛', 'Ichigo': '莓', 'Yuki': '雪', 'Yuma': '悠真'}
CAST = {
 '诗音': {'color': '#a78bfa', 'img': '/static/love/cast/shion.webp', 'side': 'L', 'brand': '完美的学生会长，高岭之花，其实藏着十年的秘密'},
 '阳菜': {'color': '#fb923c', 'img': '/static/love/cast/hina.webp', 'side': 'L', 'brand': '田径部王牌，从小一起长大的青梅竹马'},
 '凛': {'color': '#67e8f9', 'img': '/static/love/cast/rin.webp', 'side': 'L', 'brand': '科学部天才少女，嘴上理性，心跳不讲道理'},
 '莓': {'color': '#f472b6', 'img': '/static/love/cast/ichigo.webp', 'side': 'L', 'brand': '轻音部主唱，校园偶像，舞台上最闪耀的那颗星'},
 '雪': {'color': '#e2e8f0', 'img': '/static/love/cast/yuki.webp', 'side': 'L', 'brand': '樱花树下的神秘转学生，好像认识你很久了'},
 '悠真': {'color': '#fbbf24', 'img': '/static/love/cast/yuma.webp', 'side': 'R', 'brand': '你。普通的高中二年级生，春日悠真'},
}
# 从设定图裁头像（2048x1152，六人从左到右）
def crop_cast():
    p = '/tmp/love/sheet.png'
    if not os.path.exists(p): return
    im = Image.open(p).convert('RGB'); os.makedirs(os.path.join(OUT, 'cast'), exist_ok=True)
    boxes = {'shion': (95, 70), 'hina': (395, 60), 'rin': (660, 70), 'ichigo': (990, 70), 'yuki': (1275, 90), 'yuma': (1650, 50)}
    for k, (x, y) in boxes.items():
        f = os.path.join(OUT, 'cast', k + '.webp')
        if not os.path.exists(f): im.crop((x, y, x + 280, y + 280)).resize((256, 256), Image.LANCZOS).save(f, 'WEBP', quality=86)

FIX = {'E_R3': {0: '凛'}, 'E_I2': {0: '莓'}, 'E_I3': {0: '莓'}}
def lines_of(cid):
    # 台词 + 说话人：取 “says/shouts/whispers…” 之前最近出现的角色名；若台词前是 “she/he says”，取本镜头第一个出现的角色
    out = []
    for m in re.finditer(r'Shot \d+:([^\n]*)', CLIPS[cid]['shots']):
        seg = m.group(1)
        for mm in re.finditer(r'\{([^}]+)\}', seg):
            head = seg[:mm.start()]
            verb = list(re.finditer(r'\b(says|shouts|whispers|mutters|answers)\b', head))
            cut = head[:verb[-1].start()] if verb else head
            pos = [(cut.rfind(en), zh) for en, zh in NAME.items() if cut.rfind(en) >= 0]
            who = max(pos)[1] if pos else None
            if re.search(r'\b(she|he)\s+(says|shouts|whispers|mutters|answers)', head) and pos:
                first = min((head.find(en), zh) for en, zh in NAME.items() if head.find(en) >= 0); who = first[1]
            out.append((who or '悠真', mm.group(1)))
    for i, w in FIX.get(cid, {}).items(): out[i] = (w, out[i][1])
    return out

def ffdur(p): return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout.strip() or 0)

def transcribe(cid, mp4):
    if cid in subs: return subs[cid]
    wav = f'/tmp/love/{cid}.mp3'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', wav])
    url = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', subprocess.run(['gsk', 'upload', wav], capture_output=True, text=True).stdout).group(0)
    r = subprocess.run(['gsk', 'transcribe', '-i', url, '--prompt', '普通话对白：' + ' '.join(t for _, t in lines_of(cid))], capture_output=True, text=True)
    chars = []
    try:
        d = list(json.loads(r.stdout)['data'].values())[0]
        for ln in (d.get('words') or '').split('\n'):
            m = re.match(r'\S+ ([\d.]+)-([\d.]+): (.*)', ln.strip())
            if not m: continue
            st, en, w = float(m.group(1)), float(m.group(2)), m.group(3)
            hz = [c for c in w if '\u4e00' <= c <= '\u9fff']
            for k, c in enumerate(hz): chars.append([c, st + (en - st) * k / len(hz), st + (en - st) * (k + 1) / len(hz)])
    except Exception as e: print('transcribe fail', cid, e)
    subs[cid] = chars; json.dump(subs, open(SUBS, 'w'), ensure_ascii=False)
    return chars

TIME_FIX = {'E_I4': [(6.9, 8.7), (8.7, 10.1)]}
def align(cid, chars, dur):
    out, pos = [], 0
    for who, t in lines_of(cid):
        hz = [c for c in t if '\u4e00' <= c <= '\u9fff']; hit = []; j = pos
        for c in hz:
            for k in range(j, min(len(chars), j + 12)):
                if chars[k][0] == c: hit.append(k); j = k + 1; break
        if len(hit) >= max(1, len(hz) // 3): st, en = chars[hit[0]][1], chars[hit[-1]][2]; pos = hit[-1] + 1
        else: st = (out[-1]['end'] + 0.3) if out else dur * 0.3; en = st + 0.28 * len(hz)
        st = min(st, dur - 1.0); en = min(max(en + 0.25, st + 0.8), dur)
        out.append({'speaker': who, 'text': t, 'start': round(st, 2), 'end': round(en, 2)})
    for i, (a, b) in enumerate(TIME_FIX.get(cid, [])): out[i]['start'], out[i]['end'] = a, b
    return out

def build_clip(cid):
    raw = os.path.join(RAW, f'{cid}.mp4')
    if not os.path.exists(raw): return None
    mp4, poster, last = (os.path.join(OUT, f'{cid}{s}') for s in ('.mp4', '.webp', '_last.webp'))
    if not os.path.exists(mp4):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-vf', 'scale=576:-2', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4])
    for f, ss in ((poster, ['-ss', '0.8']), (last, ['-sseof', '-0.2'])):
        if not os.path.exists(f):
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *ss, '-i', mp4, '-frames:v', '1', '/tmp/love/_f.png']); Image.open('/tmp/love/_f.png').convert('RGB').save(f, 'WEBP', quality=80)
    dur = round(ffdur(mp4), 2)
    return {'title': CLIPS[cid]['title'], 'mood': '', 'image_url': f'/static/love/{cid}.webp', 'video_url': f'/static/love/{cid}.mp4', 'last_url': f'/static/love/{cid}_last.webp',
            'dur': dur, 'lines': align(cid, transcribe(cid, mp4), dur), 'film': True, 'ambience': None, 'sfx': None, 'sfx_at': 0}

# ───────── 剧情树 ─────────
def opt(i, key, label, hint, w, cat, nxt=None, twist=False): return {'id': i, 'key': key, 'label': label, 'hint': hint, 'weight': w, 'category': cat, 'next': nxt, 'ending_title': None if nxt else CLIPS[i]['title'], 'twist': twist}
NODES = [
 {'id': 'N1', 'depth': 1, 'question': '命运的红线，会系向谁？', 'options': [
   opt('R_S', 'A', '学生会长·诗音', '高岭之花的烟花之夜', 0.28, 'love', 'N_S'), opt('R_H', 'B', '青梅竹马·阳菜', '运动会的最后一棒', 0.28, 'love', 'N_H'),
   opt('R_R', 'C', '天才少女·凛', '失控的恋爱实验', 0.22, 'love', 'N_R'), opt('R_I', 'D', '校园偶像·莓', '只为你的一首歌', 0.22, 'love', 'N_I'),
   opt('R_Y', 'T', '樱花树下的她', '入学那天，树下的白发少女', 0.25, 'risk', 'N_Y', True)]},
 {'id': 'N_S', 'depth': 2, 'question': '毕业那天，诗音会怎么选？', 'options': [
   opt('E_S1', 'A', '传说之樱下', '她在树下等你', 0.42, 'love'), opt('E_S2', 'B', '远方的机场', '伦敦的录取通知书', 0.30, 'sacrifice'),
   opt('E_S3', 'C', '广播室的意外', '红灯亮着……', 0.28, 'risk'), opt('E_S4', 'T', '十年前的约定', '那次相撞，真的是意外吗', 0.25, 'deception', None, True)]},
 {'id': 'N_H', 'depth': 2, 'question': '阳菜的心意，终点在哪里？', 'options': [
   opt('E_H1', 'A', '冠军的冲刺', '她没有停下脚步', 0.40, 'love'), opt('E_H2', 'B', '萤火虫河堤', '就一直这样吧', 0.32, 'trust'),
   opt('E_H3', 'C', '走廊的那封信', '你一直没说出口', 0.28, 'escape'), opt('E_H4', 'T', '传说之树修罗场', '你到底约了几个人？', 0.25, 'risk', None, True)]},
 {'id': 'N_R', 'depth': 2, 'question': '凛的实验，会得出什么结论？', 'options': [
   opt('E_R1', 'A', '黑板上的方程', '最后一行是……', 0.40, 'love'), opt('E_R2', 'B', '时间机器', '去十年后看一眼', 0.30, 'risk'),
   opt('E_R3', 'C', '恋爱药水', '千万别打翻', 0.30, 'deception'), opt('E_R4', 'T', '唯一的实验对象', '墙上全是你的照片', 0.25, 'sacrifice', None, True)]},
 {'id': 'N_I', 'depth': 2, 'question': '莓的舞台，最后一首歌唱给谁？', 'options': [
   opt('E_I1', 'A', '万人演唱会', '全世界听好了', 0.40, 'love'), opt('E_I2', 'B', '出道的代价', '电视里的她', 0.30, 'sacrifice'),
   opt('E_I3', 'C', '街头二人组', '组合名叫什么？', 0.30, 'trust'), opt('E_I4', 'T', '卸下假发的她', '真正的样子', 0.25, 'mercy', None, True)]},
 {'id': 'N_Y', 'depth': 2, 'question': '雪的秘密，你要揭开吗？', 'options': [
   opt('E_Y1', 'A', '千年之约', '换我来守约', 0.28, 'love'), opt('E_Y2', 'B', '樱花散落', '最后一片花瓣', 0.26, 'sacrifice'),
   opt('E_Y3', 'C', '第一千次入学式', '闹钟又响了', 0.24, 'risk'), opt('E_Y4', 'D', '病房里的真身', '她一直在做梦', 0.22, 'mercy'),
   opt('E_Y5', 'T', '心动回廊·真结局', '传说不是只能选一个人', 0.25, 'love', None, True)]},
]
# ⟲ 时间裂隙：在四位女主的毕业抉择上悔棋，可撕开平行时间线 → 播放 K_1 → 进入 N_K（跨路线改写传说）
FORK = {'node': 'N_K', 'seg': 'K_1', 'label': '时间裂隙', 'title': '时间裂隙·你记得一切', 'desc': '不回到原局面——撕开一条平行时间线：雪记得你看过的每一个结局'}
for n in NODES:
    if n['id'] in ('N_S', 'N_H', 'N_R', 'N_I'): n['fork'] = FORK
NODES.append({'id': 'N_K', 'depth': 3, 'question': '平行时间线里，你要改写哪一个传说？', 'fork_of': True, 'options': [
   opt('E_Y5', 'A', '让所有人都幸福', '传说不是只能选一个人', 0.30, 'love'), opt('E_Y1', 'B', '牵起雪的手', '换我来守约', 0.26, 'love'),
   opt('E_H4', 'C', '同时赴约', '五个人都在树下等你', 0.24, 'risk'), opt('E_Y3', 'D', '再来一次', '第一千零一次入学式', 0.20, 'deception')]})

if __name__ == '__main__':
    crop_cast()
    segs = {}
    for cid in CLIPS:
        s = build_clip(cid)
        if s: segs[cid] = s; print(cid, s['dur'], [(l['speaker'], l['text'][:8], l['start']) for l in s['lines']], flush=True)
    data = {'series': {'id': 'love_corridor', 'title': '心动回廊 ～传说之樱下的约定～', 'logline': '三年高中，五位少女，一棵传说之樱。21 种结局，每一次心动都是一场博弈。'},
            'prologue': ['L_P'], 'nodes': NODES, 'segments': segs, 'cast': CAST}
    os.makedirs(os.path.join(ROOT, 'src/love'), exist_ok=True)
    json.dump(data, open(os.path.join(ROOT, 'src/love/data.json'), 'w'), ensure_ascii=False)
    ends = {o['id'] for n in NODES for o in n['options'] if not o['next']}
    print('clips', len(segs), '/', len(CLIPS), 'endings', len(ends))
