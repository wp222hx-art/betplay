# 配音 V3：ElevenLabs v4（母语级中文 + 表演标签：呼吸 / 叹气 / 耳语 / 停顿）+ 角色声线品牌（cast.json：固定音色 + 固定后期链）
# 并且每段混成一条【连续对白轨】：句间按情绪留出呼吸间隙（被打断“——”时抢话 / 重叠），播放时不会再一句一句断开
# 用法：python3 produce_voice_v3.py [段落ID...]   （不传就全量；可以断点续跑）
import json, os, re, subprocess, sys, concurrent.futures as cf, hashlib
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
RAW = '/tmp/v3raw'; os.makedirs(RAW, exist_ok=True)
LINE = os.path.join(ROOT, 'public/static/comic/v3/line'); TRK = os.path.join(ROOT, 'public/static/comic/v3/track')
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
    c = CAST[sp]; fx = c['fx'] + (',' + c['phone_fx'] if phone and c.get('phone_fx') else '')
    # 去掉首尾静音 → 角色声音链 → 统一响度
    af = f'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse,{fx},loudnorm=I=-17:TP=-1.5:LRA=9'
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
        key = hashlib.md5(f"{sp}|{text}|{CAST[sp].get('custom_voice_id') or CAST[sp]['voice']}".encode()).hexdigest()[:12]
        jobs.append({'i': i, 'speaker': sp, 'text': text, 'shown': shown, 'emotion': l.get('emotion', 'neutral'), 'intensity': l.get('intensity', 0.5), 'key': key, 'phone': phone})
    for j in jobs:
        raw = tts(j['speaker'], j['text'], j['intensity'], j['key'])
        out = os.path.join(LINE, j['key'] + '.mp3')
        j['ok'] = bool(raw) and (os.path.exists(out) or post(j['speaker'], raw, out, j['phone']))
        j['dur'] = round(ffdur(out), 2) if j['ok'] else 0
    jobs = [j for j in jobs if j['ok'] and j['dur'] > 0.2]
    if not jobs: return sid, None
    # 按时间轴混成一条连续对白轨，并且记录每句的起止时间（字幕和立绘都跟着这条时间轴走）
    t = 0.15; cues = []
    for n, j in enumerate(jobs):
        cues.append({'speaker': j['speaker'], 'text': j['shown'], 'emotion': j['emotion'], 'phone': j['phone'], 'start': round(t, 2), 'end': round(t + j['dur'], 2), 'line': f"/static/comic/v3/line/{j['key']}.mp3"})
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
    return sid, {'track': f'/static/comic/v3/track/{kind}_{sid}.mp3', 'dur': total, 'cues': cues}

if __name__ == '__main__':
    OUT = os.path.join(D, 'voice_v3.json')
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
