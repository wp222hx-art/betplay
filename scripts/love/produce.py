# 批量生成《心动回廊》Seedance 2.0 音画一体片段（mini 档，9:16，原生普通话对白）
# 用法：python3 produce.py L_P            → 先验证序章
#      python3 produce.py R_S R_H ...     → 批量（5 路并发，已生成的自动跳过）
import os, subprocess, sys, json, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story import CLIPS, prompt, refs
D = os.path.dirname(os.path.abspath(__file__)); RAW = os.path.join(D, 'raw'); os.makedirs(RAW, exist_ok=True)

def gen(cid):
    out = os.path.join(RAW, f'{cid}.mp4')
    if os.path.exists(out) and os.path.getsize(out) > 100000: return cid, 'skip'
    c = CLIPS[cid]
    for a in range(2):
        r = subprocess.run(['gsk', 'video', '-m', 'fal-ai/bytedance/seedance-2.0', '--tier', 'mini', '-r', '9:16', '-d', str(c['dur']), '-i', *refs(cid),
                            '--reference_mode', 'true', '--audio_enable', 'true', '-o', out, prompt(cid)], capture_output=True, text=True, timeout=1800)
        if os.path.exists(out) and os.path.getsize(out) > 100000: return cid, 'ok'
    return cid, 'fail ' + (r.stdout[-300:] + r.stderr[-200:]).replace('\n', ' ')

if __name__ == '__main__':
    ids = sys.argv[1:] or list(CLIPS)
    with cf.ThreadPoolExecutor(int(os.environ.get('CONC', '5'))) as ex:
        for cid, st in ex.map(gen, ids): print(cid, st, flush=True)
