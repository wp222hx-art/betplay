# 批量生成影剧版片段：父片段的最后一帧作为子片段的开场构图（@Image2），保证镜头连续
# 用法：python3 produce_film.py F_A F_B F_T   → 然后 python3 produce_film.py E1 E2 E3 E4 E5
import json, os, re, subprocess, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story import CLIPS, prompt, PROLOGUE_FILE, PROLOGUE_LAST
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, '../..'))
OUT = os.path.join(ROOT, 'public/static/film'); os.makedirs(OUT, exist_ok=True)
META = os.path.join(D, 'clips.json'); meta = json.load(open(META)) if os.path.exists(META) else {}
if 'F_P' not in meta and os.path.exists(PROLOGUE_FILE):
    meta['F_P'] = {'raw': PROLOGUE_FILE, 'last_frame': PROLOGUE_LAST}

def upload(p):
    return re.search(r'https://www\.genspark\.ai/api/files/s/\w+', subprocess.run(['gsk', 'upload', p], capture_output=True, text=True).stdout).group(0)

def last_frame(cid):
    m = meta[cid]
    if m.get('last_frame'): return m['last_frame']
    png = f'/tmp/film/{cid}_last.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-sseof', '-0.15', '-i', m['raw'], '-frames:v', '1', png])
    m['last_frame'] = upload(png); return m['last_frame']

def gen(cid):
    c = CLIPS[cid]; raw = f'/tmp/film/{cid}.mp4'
    if not os.path.exists(raw):
        refs = [c['refs'][0], last_frame(c['parent'])] + c['refs'][2:]
        r = subprocess.run(['gsk', 'video', '-m', 'fal-ai/bytedance/seedance-2.0', '--tier', 'mini', '-r', '9:16', '-d', str(c['dur']), '-i', *refs,
                            '--reference_mode', 'true', '--audio_enable', 'true', '-o', raw, prompt(cid)], capture_output=True, text=True, timeout=1500)
        if not os.path.exists(raw): return cid, 'fail ' + r.stdout[-300:]
    return cid, 'ok'

if __name__ == '__main__':
    ids = sys.argv[1:]
    for cid in ids: last_frame(CLIPS[cid]['parent'])  # 先准备父片段末帧
    json.dump(meta, open(META, 'w'), ensure_ascii=False, indent=1)
    with cf.ThreadPoolExecutor(5) as ex:
        for cid, st in ex.map(gen, ids):
            print(cid, st, flush=True)
            if st == 'ok': meta[cid] = {**meta.get(cid, {}), 'raw': f'/tmp/film/{cid}.mp4'}
    json.dump(meta, open(META, 'w'), ensure_ascii=False, indent=1)
