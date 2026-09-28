#!/usr/bin/env python3
# 烧录字幕擦除：Seedance 偶尔把对白以字幕烧进画面（违反 no subtitles 约束）。
# 流程：先找字幕固定所在的水平带（全片白字像素累计热区）→ 逐帧(24fps)判断该带内是否有“白字+描边” → 合并时间区间 → ffmpeg delogo 仅在对应时间/矩形修补
# 用法：python3 desub.py in.mp4 out.mp4   （检测不到字幕时原样复制）
import subprocess, glob, os, sys
from PIL import Image
import numpy as np
def frames(src, vf, pat):
    for f in glob.glob(pat.replace('%04d', '*')): os.remove(f)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf', vf, pat]); return sorted(glob.glob(pat.replace('%04d', '*')))
def band(src):
    acc = None
    for f in frames(src, 'fps=4', '/tmp/_dsb%04d.png'):
        a = np.asarray(Image.open(f).convert('L')).astype(int); m = (a > 235) & (np.abs(np.diff(a, axis=1, prepend=a[:, :1])) > 70)
        acc = m.sum(1) if acc is None else acc + m.sum(1); os.remove(f)
    h = len(acc); lo = int(h * .5); rows = acc[lo:]
    if rows.max() < 40: return None
    c = lo + int(np.argmax(rows)); return max(0, c - 26), min(h, c + 18), h
def main(src, out, fps=24):
    b = band(src)
    if not b: subprocess.run(['cp', src, out]); print('no subtitles'); return
    ya, yb, h = b; on, xs = [], []
    for f in frames(src, f'fps={fps},crop=iw:{yb - ya}:0:{ya}', '/tmp/_dsf%04d.png'):
        a = np.asarray(Image.open(f).convert('L')).astype(int); m = (a > 228) & (np.abs(np.diff(a, axis=1, prepend=a[:, :1])) > 60)
        cols = np.where(m.sum(0) > 1)[0]; hit = m.sum() > 60 and len(cols) and cols.max() - cols.min() > 30
        on.append(bool(hit)); xs.append((cols.min(), cols.max()) if hit else None); os.remove(f)
    w = Image.open(frames(src, 'select=eq(n\\,0)', '/tmp/_dsw%04d.png')[0]).size[0]
    sm = np.convolve(np.array(on, int), np.ones(9), 'same') >= 3; spans = []; i = 0
    while i < len(sm):
        if sm[i]:
            j = i
            while j < len(sm) and sm[j]: j += 1
            xx = [x for x in xs[i:j] if x]; spans.append((i / fps, j / fps, min(x[0] for x in xx) if xx else w * .2, max(x[1] for x in xx) if xx else w * .8)); i = j
        else: i += 1
    fl = [f"delogo=x={max(1, int(x1) - 16)}:y={ya - 2}:w={min(w - max(1, int(x1) - 16) - 2, int(x2 - x1) + 32)}:h={yb - ya + 4}:enable='between(t,{max(0, t1 - .08):.2f},{t2 + .08:.2f})'" for t1, t2, x1, x2 in spans]
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf', ','.join(fl), '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], check=True)
    print('band', (ya, yb), 'spans', [(round(a, 2), round(b, 2)) for a, b, _, _ in spans])
if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
