# 配音 V2：MiniMax Speech 2.8 HD，情感控制 + 角色定制音色；纯对白（去旁白）
import json, os, subprocess, sys, concurrent.futures as cf, hashlib
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
AUD = os.path.join(ROOT, 'public/static/comic/voice'); os.makedirs(AUD, exist_ok=True)
dlg = json.load(open(os.path.join(D, 'dialogue.json')))
CAST = {'林夏': ('Wise_Woman', 0), '陈默': ('Determined_Man', -1), '渡鸦': ('movie_trailer_deep', -2), '顾衡': ('Elegant_Man', -2), '林小雨': ('Lovely_Girl', 1)}
EMO = {'neutral': 'neutral', 'sad': 'sad', 'angry': 'angry', 'fearful': 'fearful', 'surprised': 'surprised', 'happy': 'happy', 'disgusted': 'disgusted',
       'calm': 'neutral', 'cold': 'neutral', 'confident': 'neutral', 'determined': 'angry', 'urgent': 'fearful', 'protective': 'sad', 'relieved': 'happy'}
def dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    try: return round(float(r.stdout.strip()), 2)
    except: return 0
def one(job):
    sid, i, l = job
    name = f'{sid}_{i}.mp3'; out = os.path.join(AUD, name)
    sp = l['speaker'] if l['speaker'] in CAST else '林夏'
    voice, pitch = CAST[sp]
    emo = EMO.get(l.get('emotion', 'neutral'), 'neutral')
    speed = max(0.85, min(1.15, float(l.get('speed') or 1)))
    text = l['text'].strip()
    if not os.path.exists(out) and text.strip('…—.。 '):
        params = {'speaker': voice, 'voice_emotion': emo, 'speed': speed, 'pitch': pitch, 'language_boost': 'Chinese'}
        for a in range(3):
            subprocess.run(['gsk', 'audio', '-m', 'fal-ai/minimax/speech-2.8-hd', '-p', json.dumps(params), '-f', f'{sid}_{i}', '-o', out, text], capture_output=True, text=True, timeout=180)
            if os.path.exists(out) and os.path.getsize(out) > 2000: break
            if a == 1: params.pop('voice_emotion', None)
    ok = os.path.exists(out)
    return sid, i, {'speaker': sp, 'text': text, 'emotion': emo, 'audio': f'/static/comic/voice/{name}' if ok else None, 'dur': dur(out) if ok else 1.2}
jobs = [(sid, i, l) for sid, seg in dlg.items() for i, l in enumerate(seg['lines'])]
res = {}
with cf.ThreadPoolExecutor(int(os.environ.get('CONC', '10'))) as ex:
    for n, (sid, i, line) in enumerate(ex.map(one, jobs)):
        res.setdefault(sid, {})[i] = line
        if n % 20 == 0: print('progress', n, len(jobs), flush=True)
out = {sid: [res[sid][i] for i in sorted(res[sid])] for sid in res}
json.dump(out, open(os.path.join(D, 'voice_v2.json'), 'w'), ensure_ascii=False)
print('DONE', len(jobs), 'missing', sum(1 for v in out.values() for l in v if not l['audio']), flush=True)
