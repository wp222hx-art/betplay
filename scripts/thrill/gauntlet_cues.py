#!/usr/bin/env python3
"""逐个揭晓淘汰赛 · 自动测 cue 点 → public/static/sfx/g_cues.json
out{i}：画面相对首帧的差异达到「最终差异」50% 的时刻（= 被甩倒 / 摸到黑球 / 翻牌 / 被抓 / 刮蹭 / 下一位）
safe{i}：1.0~3.2s 内帧间运动峰值（= 抓稳 / 白球 / 过关的那一下）
用法：python3 scripts/thrill/gauntlet_cues.py [sid ...]"""
import json, os, subprocess, sys
import numpy as np
ARCH = '/home/user/webapp_media_archive/gauntlet'
OUT = '/home/user/webapp/public/static/sfx/g_cues.json'
FPS, W = 12, 96

def frames(mp4):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', mp4, '-vf', f'fps={FPS},scale={W}:{W},format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, W, W).astype(np.float32)

def cue_out(f):
    d = np.abs(f - f[0]).mean(axis=(1, 2)); fin = d[-FPS // 2:].mean()
    if fin < 2: return None
    i = int(np.argmax(d >= fin * 0.5)); return round(max(0.8, min(i / FPS, 3.4)), 2)

def cue_safe(f):
    m = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2)); lo, hi = int(1.0 * FPS), int(3.2 * FPS)
    if len(m) <= lo: return None
    i = lo + int(np.argmax(m[lo:hi])); return round(i / FPS, 2)

def main(sids):
    allc = json.load(open(OUT)) if os.path.exists(OUT) else {}
    for sid in sids:
        D = f'{ARCH}/{sid}'; c = allc.get(sid, {})
        for i in range(1, 9):
            for k, fn in ((f'out{i}', cue_out), (f'safe{i}', cue_safe)):
                p = f'{D}/{k}.mp4'
                if not os.path.exists(p): continue
                t = fn(frames(p))
                if t: c[k] = t
        outs = [v for k, v in c.items() if k.startswith('out')]; safes = [v for k, v in c.items() if k.startswith('safe')]
        if outs: c['*out'] = round(float(np.median(outs)), 2)
        if safes: c['*safe'] = round(float(np.median(safes)), 2)
        allc[sid] = c; print(sid, c)
    json.dump(allc, open(OUT, 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main(sys.argv[1:] or sorted(os.listdir(ARCH)))
