# 配音 V3：ElevenLabs v4（母语级中文 + 表演标签：呼吸 / 叹气 / 耳语 / 停顿）+ 角色声线品牌（cast.json：固定音色 + 固定后期链）
# 并且每段混成一条【连续对白轨】：句间按情绪留出呼吸间隙（被打断“——”时抢话 / 重叠），播放时不会再一句一句断开
# 用法：python3 produce_voice_v3.py [段落ID...]   （不传就全量；可以断点续跑）
import json, os, re, subprocess, sys, concurrent.futures as cf, hashlib
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
RAW = '/tmp/v3raw'; os.makedirs(RAW, exist_ok=True)
ENGINE = os.environ.get('VOICE_ENGINE', 'qwen')  # qwen（千问 Qwen3-TTS-Instruct，默认）/ el（ElevenLabs v4）
VD = 'v4' if ENGINE == 'qwen' else 'v3'
LINE = os.path.join(ROOT, f'public/static/comic/{VD}/line'); TRK = os.path.join(ROOT, f'public/static/comic/{VD}/track')
os.makedirs(LINE, exist_ok=True); os.makedirs(TRK, exist_ok=True)
CAST = {k: v for k, v in json.load(open(os.path.join(D, 'cast.json'))).items() if not k.startswith('_')}
dlg = json.load(open(os.path.join(D, 'dialogue_v3.json')))
OK_TAGS = {'sighs', 'exhales', 'whispers', 'laughs', 'crying', 'nervously', 'desperately', 'alarmed', 'sarcastic', 'deadpan', 'frustrated', 'pauses', 'gulps', 'curious', 'dramatically', 'warmly', 'sympathetic', 'reassuring', 'questioning', 'mischievously', 'excited'}
MAP = {'breathing': 'exhales', 'whisper': 'whispers', 'sigh': 'sighs', 'pause': 'pauses', 'cries': 'crying', 'laugh': 'laughs', 'coldly': 'deadpan', 'angrily': 'frustrated', 'panicked': 'alarmed'}
PHONE = re.compile(r'电话|耳机|对讲|通讯|频道|屏幕里|广播')

def clean(sp, t):
    t = re.sub(r'^\s*(\[[^\]]+\]\s*)?(林夏|陈默|渡鸦|林小雨|小雨|顾衡)[：:]\s*', r'\1', t)
    t = re.sub(r'(林夏|陈默|渡鸦|林小雨|小雨|顾衡)[：:]\s*', '', t)
    def tag(m):
        k = m.group(1).strip().lower(); k = MAP.get(k, k)
        return f'[{k}] ' if k in OK_TAGS else ''
    t = re.sub(r'\[([^\]]+)\]\s*', tag, t)
    shown = re.sub(r'\[[^\]]+\]\s*', '', t).strip()
    return t.strip(), shown

def ffdur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except: return 0.0

sys.path.insert(0, D)
EMO_ZH = {'sad': '哽咽、声音发颤', 'angry': '压着怒火、咬字加重', 'fearful': '紧张急促、呼吸不稳', 'surprised': '震惊、倒吸一口气', 'happy': '带着笑意', 'disgusted': '冷蔑不屑', 'neutral': '克制'}
TAG_ZH = {'sighs': '先轻叹一口气', 'exhales': '先长出一口气', 'whispers': '压低声音耳语', 'laughs': '带一声冷笑', 'crying': '带哭腔', 'pauses': '中间有明显停顿', 'desperately': '近乎绝望', 'nervously': '紧张', 'deadpan': '毫无情绪', 'sarcastic': '讥讽', 'alarmed': '惊慌', 'frustrated': '烦躁', 'gulps': '先咽一下口水', 'curious': '疑惑', 'dramatically': '戏剧化', 'warmly': '温柔', 'sympathetic': '心疼', 'reassuring': '安抚', 'questioning': '追问', 'excited': '兴奋'}
def qwen_tts(sp, text, emotion, intensity, key, phone=False):
    import time, urllib.request, urllib.error
    raw = os.path.join(RAW, 'q_' + key + '.wav')
    if os.path.exists(raw) and os.path.getsize(raw) > 3000: return raw
    qk = [l.split('=', 1)[1].strip() for l in open(os.path.join(ROOT, '.dev.vars')) if l.startswith('DASHSCOPE_API_KEY=')][0]
    c = CAST[sp]; tags = [TAG_ZH[t] for t in re.findall(r'\[(\w+)\]', text) if t in TAG_ZH]
    lvl = '情绪很强烈' if float(intensity or .5) > .75 else ('情绪克制' if float(intensity or .5) < .35 else '')
    ins = f"{c['qwen_persona']}这一句：{EMO_ZH.get(emotion, '克制')}{'，' + lvl if lvl else ''}{'，' + '，'.join(tags) if tags else ''}{'，是在电话或耳机里说的' if phone else ''}。像影视剧里的真人演员在对戏，自然口语化，有呼吸感，不要播音腔，不要拖长字音。"
    body = {'model': 'qwen3-tts-instruct-flash', 'input': {'text': re.sub(r'\[[^\]]+\]\s*', '', text).strip(), 'voice': c['qwen_voice'], 'language_type': 'Chinese', 'instructions': ins, 'optimize_instructions': True}}
    for a in range(12):
        try:
            req = urllib.request.Request('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + qk, 'Content-Type': 'application/json'})
            url = json.load(urllib.request.urlopen(req, timeout=120))['output']['audio']['url']
            urllib.request.urlretrieve(url, raw); return raw
        except urllib.error.HTTPError as e:
            m = e.read().decode()[:200]
            if 'Throttling' in m or e.code >= 500: time.sleep(2 + a * 2); continue
            print('QWEN ERR', sp, m, flush=True); return None
        except Exception as e: time.sleep(3)
    return None

def tts(sp, text, intensity, key):
    c = CAST[sp]; raw = os.path.join(RAW, key + '.mp3')
    if os.path.exists(raw) and os.path.getsize(raw) > 3000: return raw
    style = round(min(0.95, c['style_base'] + 0.5 * float(intensity or 0.5)), 2)
    stab = round(max(0.25, c['stability'] - 0.15 * float(intensity or 0.5)), 2)
    p = {'stability': stab, 'similarity_boost': 0.8, 'style': style, 'use_speaker_boost': True}
    if c.get('custom_voice_id'): p['custom_voice_id'] = c['custom_voice_id']
    else: p['speaker'] = c['voice']
    for a in range(3):
        subprocess.run(['gsk', 'audio', '-m', 'elevenlabs/v4-tts', '-p', json.dumps(p), '-f', key, '-o', raw, text], capture_output=True, text=True, timeout=240)
        if os.path.exists(raw) and os.path.getsize(raw) > 3000: return raw
        if a == 1: text = re.sub(r'\[[^\]]+\]\s*', '', text)
    return None

def post(sp, raw, out, phone):
    c = CAST[sp]; fx = (c.get('qwen_fx') if ENGINE == 'qwen' and c.get('qwen_fx') else c['fx']) + (',' + c['phone_fx'] if phone and c.get('phone_fx') else '')
    # 去掉首尾静音 → 角色声音链 → 统一响度
    af = ('aresample=24000,' if ENGINE == 'qwen' else '') + f'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse,{fx},loudnorm=I=-17:TP=-1.5:LRA=9'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-af', af, '-ar', '44100', '-ac', '1', '-b:a', '64k', out])
    return os.path.exists(out)

def gap_after(l, nxt):
    # 句间留白：被打断就抢话（负值 = 重叠），换人留一口气，同一个人连说就短一些，情绪沉重的时候留长一些
    if l['shown'].endswith('——'): return -0.28
    g = 0.14 if nxt and nxt['speaker'] != l['speaker'] else 0.1
    if nxt and nxt['shown'].startswith('——'): g = -0.2
    if l['shown'].endswith('……'): g += 0.3
    if l.get('emotion') in ('sad',) and float(l.get('intensity') or 0) > 0.6: g += 0.25
    return g

def build_seg(sid, lines, kind='seg'):
    jobs = []
    for i, l in enumerate(lines):
        sp = l['speaker'] if l['speaker'] in CAST else ('林小雨' if l['speaker'] == '小雨' else '林夏')
        text, shown = clean(sp, l['text'])
        if not shown.strip('…—.。 '): continue
        phone = sp == '林小雨' and bool(PHONE.search(l.get('context', '') + shown))
        vid = CAST[sp]['qwen_voice'] if ENGINE == 'qwen' else (CAST[sp].get('custom_voice_id') or CAST[sp]['voice'])
        key = hashlib.md5(f"{ENGINE}|{sp}|{text}|{vid}|{l.get('emotion')}|{CAST[sp].get('qwen_persona','')}|{CAST[sp].get('qwen_fx','')}".encode()).hexdigest()[:12]
        jobs.append({'i': i, 'speaker': sp, 'text': text, 'shown': shown, 'emotion': l.get('emotion', 'neutral'), 'intensity': l.get('intensity', 0.5), 'key': key, 'phone': phone})
    for j in jobs:
        raw = qwen_tts(j['speaker'], j['text'], j['emotion'], j['intensity'], j['key'], j['phone']) if ENGINE == 'qwen' else tts(j['speaker'], j['text'], j['intensity'], j['key'])
        out = os.path.join(LINE, j['key'] + '.mp3')
        j['ok'] = bool(raw) and (os.path.exists(out) or post(j['speaker'], raw, out, j['phone']))
        j['dur'] = round(ffdur(out), 2) if j['ok'] else 0
    jobs = [j for j in jobs if j['ok'] and j['dur'] > 0.2]
    if not jobs: return sid, None
    # 按时间轴混成一条连续对白轨，并且记录每句的起止时间（字幕和立绘都跟着这条时间轴走）
    t = 0.15; cues = []
    for n, j in enumerate(jobs):
        cues.append({'speaker': j['speaker'], 'text': j['shown'], 'emotion': j['emotion'], 'phone': j['phone'], 'start': round(t, 2), 'end': round(t + j['dur'], 2), 'line': f"/static/comic/{VD}/line/{j['key']}.mp3"})
        t += j['dur'] + gap_after(j, jobs[n + 1] if n + 1 < len(jobs) else None)
    total = round(max(c['end'] for c in cues) + 0.35, 2)
    trk = os.path.join(TRK, f'{kind}_{sid}.mp3')
    inputs, flt = [], []
    for n, cq in enumerate(cues):
        inputs += ['-i', os.path.join(ROOT, 'public' + cq['line'])]
        side = CAST[cq['speaker']].get('side', 'C'); gl, gr = {'L': (1.0, 0.72), 'R': (0.72, 1.0)}.get(side, (1, 1))
        flt.append(f"[{n}]pan=stereo|c0={gl}*c0|c1={gr}*c0,adelay={int(cq['start'] * 1000)}|{int(cq['start'] * 1000)}[a{n}]")
    flt.append(''.join(f'[a{n}]' for n in range(len(cues))) + f"amix=inputs={len(cues)}:normalize=0:dropout_transition=0,apad=whole_dur={total},atrim=0:{total}[o]")
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(flt), '-map', '[o]', '-ar', '44100', '-ac', '2', '-b:a', '96k', trk])
    return sid, {'track': f'/static/comic/{VD}/track/{kind}_{sid}.mp3', 'dur': total, 'cues': cues}

if __name__ == '__main__':
    OUT = os.path.join(D, 'voice_qwen.json' if ENGINE == 'qwen' else 'voice_v3.json')
    res = json.load(open(OUT)) if os.path.exists(OUT) else {'segments': {}, 'cues': {}}
    want = set(sys.argv[1:])
    jobs = [('seg', sid, s['lines']) for sid, s in dlg['segments'].items() if (not want or sid in want)]
    jobs += [('cue', nid, ls) for nid, ls in dlg['cues'].items() if (not want or nid in want)]
    def run(j):
        kind, sid, lines = j
        try: return kind, *build_seg(sid, lines, kind)
        except Exception as e: print('ERR', sid, e, flush=True); return kind, sid, None
    with cf.ThreadPoolExecutor(int(os.environ.get('CONC', '8'))) as ex:
        for n, (kind, sid, r) in enumerate(ex.map(run, jobs)):
            if r: res['segments' if kind == 'seg' else 'cues'][sid] = r
            if n % 10 == 0:
                json.dump(res, open(OUT, 'w'), ensure_ascii=False); print('progress', n, len(jobs), flush=True)
    json.dump(res, open(OUT, 'w'), ensure_ascii=False)
    print('DONE segs', len(res['segments']), 'cues', len(res['cues']), flush=True)
