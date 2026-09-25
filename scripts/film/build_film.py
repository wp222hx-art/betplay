# 影剧版：压制视频（Web 友好的 H.264 + AAC 原声）+ 用 Whisper 转写原声生成时间轴字幕 + 截取海报，最后产出 src/film/data.json
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story import CLIPS
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
OUT = os.path.join(ROOT, 'public/static/film'); os.makedirs(OUT, exist_ok=True)
meta = json.load(open(os.path.join(D, 'clips.json')))
SUBS = os.path.join(D, 'subs.json'); subs = json.load(open(SUBS)) if os.path.exists(SUBS) else {}
SPK = {'F_P': ['渡鸦', '林夏', '渡鸦'], 'F_A': ['林夏', '渡鸦', '陈默'], 'F_B': ['渡鸦', '林夏'], 'F_T': ['林小雨', '林夏'],
       'E1': ['陈默', '林夏'], 'E2': ['陈默', '林夏'], 'E3': ['顾衡', '林夏'], 'E4': ['渡鸦', '林夏'], 'E5': ['顾衡', '林夏']}
# 剧本台词（作为转写纠错参照：按顺序对齐到 whisper 的时间戳上）
def script_lines(cid):
    if cid == 'F_P': return ['星核，交出来。', '先放了我妹妹。', '你没有资格谈条件。']
    return re.findall(r'\{([^}]+)\}', CLIPS[cid]['shots'])

def ffdur(p):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout.strip() or 0)

def transcribe(cid, mp4):
    # 返回逐字时间戳 [(char, start, end)]
    if cid in subs: return subs[cid]
    wav = f'/tmp/film/{cid}.mp3'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', wav])
    url = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', subprocess.run(['gsk', 'upload', wav], capture_output=True, text=True).stdout).group(0)
    r = subprocess.run(['gsk', 'transcribe', '-i', url, '--prompt', '普通话对白：' + ' '.join(script_lines(cid))], capture_output=True, text=True)
    chars = []
    try:
        d = list(json.loads(r.stdout)['data'].values())[0]
        for ln in (d.get('words') or '').split('\n'):
            m = re.match(r'\S+ ([\d.]+)-([\d.]+): (.*)', ln.strip())
            if not m: continue
            st, en, w = float(m.group(1)), float(m.group(2)), m.group(3)
            hz = [c for c in w if '\u4e00' <= c <= '\u9fff']
            for k, c in enumerate(hz): chars.append([c, st + (en - st) * k / len(hz), st + (en - st) * (k + 1) / len(hz)])
    except Exception as e: print('transcribe parse fail', cid, e, r.stdout[:300])
    subs[cid] = chars; json.dump(subs, open(SUBS, 'w'), ensure_ascii=False)
    return chars

def align(cid, chars, dur):
    # 剧本台词（字形准确）按顺序贪心匹配逐字时间戳：每句取匹配到的首尾字时间
    lines, spk = script_lines(cid), SPK.get(cid, [])
    out, pos = [], 0
    for i, t in enumerate(lines):
        hz = [c for c in t if '\u4e00' <= c <= '\u9fff']
        hit = []
        j = pos
        for c in hz:
            for k in range(j, min(len(chars), j + 12)):
                if chars[k][0] == c: hit.append(k); j = k + 1; break
        if len(hit) >= max(1, len(hz) // 3):
            st, en = chars[hit[0]][1], chars[hit[-1]][2]; pos = hit[-1] + 1
        else:
            st = (out[-1]['end'] + 0.3) if out else dur * 0.3; en = st + 0.28 * len(hz)
        out.append({'speaker': spk[i] if i < len(spk) else '', 'text': t, 'start': round(st, 2), 'end': round(max(en + 0.25, st + 0.8), 2)})
    return out

clips = {}
for cid in ['F_P'] + list(CLIPS):
    m = meta.get(cid)
    if not m or not os.path.exists(m['raw']): print('skip', cid); continue
    mp4 = os.path.join(OUT, f'{cid}.mp4'); poster = os.path.join(OUT, f'{cid}.webp')
    if not os.path.exists(mp4):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', m['raw'], '-vf', 'scale=576:-2', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4])
    if not os.path.exists(poster):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', '0.6', '-i', mp4, '-frames:v', '1', '-vf', 'scale=576:-2', '/tmp/film/_p.png'])
        from PIL import Image; Image.open('/tmp/film/_p.png').convert('RGB').save(poster, 'WEBP', quality=78)
    last = os.path.join(OUT, f'{cid}_last.webp')
    if not os.path.exists(last):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-sseof', '-0.2', '-i', mp4, '-frames:v', '1', '-vf', 'scale=576:-2', '/tmp/film/_l.png'])
        from PIL import Image; Image.open('/tmp/film/_l.png').convert('RGB').save(last, 'WEBP', quality=78)
    dur = round(ffdur(mp4), 2)
    clips[cid] = {'video': f'/static/film/{cid}.mp4', 'poster': f'/static/film/{cid}.webp', 'last': f'/static/film/{cid}_last.webp', 'dur': dur, 'subs': align(cid, transcribe(cid, mp4), dur)}
    print(cid, dur, len(clips[cid]['subs']), flush=True)

T = {'F_P': '雨夜天台', 'F_A': '如约交付', 'F_B': '指间调包', 'F_T': '闯入者', 'E1': '以身换命', 'E2': '黎明同盟', 'E3': '全城曝光', 'E4': '坠落', 'E5': '天穹之主'}
seg = lambda cid: {'title': T[cid], 'mood': '', 'image_url': clips.get(cid, {}).get('poster'), 'video_url': clips.get(cid, {}).get('video'), 'last_url': clips.get(cid, {}).get('last'),
                   'dur': clips.get(cid, {}).get('dur', 0), 'lines': clips.get(cid, {}).get('subs', []), 'film': True, 'ambience': 'rain_roof', 'sfx': None, 'sfx_at': 0}
data = {
 'series': {'id': 'dome_film', 'title': '穹顶之下 · 影剧版', 'logline': '9 段电影级音画一体片段 · 3 个抉择 · 5 种结局'},
 'prologue': ['F_P'],
 'nodes': [
  {'id': 'N1', 'depth': 1, 'question': '星核，交还是不交？', 'options': [
    {'id': 'F_A', 'key': 'A', 'label': '如约交出', 'hint': '换妹妹平安', 'weight': 0.5, 'category': 'trust', 'next': 'N_A', 'ending_title': None, 'twist': False},
    {'id': 'F_B', 'key': 'B', 'label': '暗中调包', 'hint': '以假乱真', 'weight': 0.5, 'category': 'deception', 'next': 'N_B', 'ending_title': None, 'twist': False},
    {'id': 'F_T', 'key': 'T', 'label': '小雨闯入', 'hint': '谁也没算到她', 'weight': 0.25, 'category': 'risk', 'next': 'N_B', 'ending_title': None, 'twist': True}]},
  {'id': 'N_A', 'depth': 2, 'question': '枪口转向，谁先动？', 'options': [
    {'id': 'E1', 'key': 'A', 'label': '林夏扑枪', 'hint': '用自己换时间', 'weight': 0.45, 'category': 'sacrifice', 'next': None, 'ending_title': '以身换命', 'twist': False},
    {'id': 'E2', 'key': 'B', 'label': '陈默开火', 'hint': '三年前的那条命', 'weight': 0.55, 'category': 'love', 'next': None, 'ending_title': '黎明同盟', 'twist': False},
    {'id': 'E3', 'key': 'T', 'label': '小雨的直播', 'hint': '镜头一直开着', 'weight': 0.25, 'category': 'justice', 'next': None, 'ending_title': '全城曝光', 'twist': True}]},
  {'id': 'N_B', 'depth': 2, 'question': '枪口对准了你，怎么办？', 'options': [
    {'id': 'E3', 'key': 'A', 'label': '启动直播', 'hint': '让全城一起看', 'weight': 0.55, 'category': 'justice', 'next': None, 'ending_title': '全城曝光', 'twist': False},
    {'id': 'E4', 'key': 'B', 'label': '纵身跃下', 'hint': '向下，才是出口', 'weight': 0.45, 'category': 'escape', 'next': None, 'ending_title': '坠落', 'twist': False},
    {'id': 'E5', 'key': 'T', 'label': '与顾衡谈判', 'hint': '另一种赢法', 'weight': 0.25, 'category': 'betray', 'next': None, 'ending_title': '天穹之主', 'twist': True}]}],
 'segments': {cid: seg(cid) for cid in T},
 'cast': json.load(open(os.path.join(ROOT, 'src/comic/data.json'))).get('cast', {}),
}
os.makedirs(os.path.join(ROOT, 'src/film'), exist_ok=True)
json.dump(data, open(os.path.join(ROOT, 'src/film/data.json'), 'w'), ensure_ascii=False)
print('film clips', len(clips), '/ 9')
