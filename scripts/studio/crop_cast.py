# 设定图 → 角色头像
# 1) Hough 找“圆形特写头像”（设定图标准版式），取最大的 n 个、按 x 排序
# 2) 失败 → 按列投影找 n 个人物，取人物顶部头部方块
import sys, numpy as np, cv2
from PIL import Image
def _circles(a, n):
    H, W = a.shape[:2]; g = cv2.medianBlur(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY), 5)
    for p2 in (60, 45, 35, 28):
        c = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1.2, minDist=W / (n + 2), param1=110, param2=p2, minRadius=int(H * 0.09), maxRadius=int(H * 0.3))
        if c is None: continue
        c = sorted(c[0].tolist(), key=lambda t: -t[2])
        pick = []
        for x, y, r in c:  # 去重叠
            if all(abs(x - px) > max(r, pr) for px, py, pr in pick): pick.append((x, y, r))
            if len(pick) == n: break
        if len(pick) == n:
            rs = [r for _, _, r in pick]
            if max(rs) / min(rs) < 1.5: return sorted(pick)
    return None
def _bg(a):
    c = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3), a[-8:, :8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
    return np.median(c, 0)
def _runs(m, k):
    out, s = [], None
    for i, v in enumerate(list(m) + [False]):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s >= k: out.append((s, i))
            s = None
    return out
def boxes(im, n):
    a = np.asarray(im.convert('RGB')); H, W = a.shape[:2]
    cs = _circles(a, n)
    if cs: return [(int(x - r * .92), int(y - r * .92), int(x + r * .92), int(y + r * .92)) for x, y, r in cs], 'circle'
    fg = np.abs(a.astype(int) - _bg(a.astype(int))).sum(2) > 45
    segs = _runs(fg[: int(H * .6)].mean(0) > .03, int(W * .03))
    if len(segs) < n: segs = [(int(W * i / n), int(W * (i + 1) / n)) for i in range(n)]
    segs = sorted(sorted(segs, key=lambda t: t[1] - t[0], reverse=True)[:n])
    res = []
    for x1, x2 in segs:
        rows = np.where(fg[:, x1:x2].mean(1) > .08)[0]; top = int(rows[0]) if len(rows) else int(H * .05)
        cx = (x1 + x2) // 2; s = int(min(x2 - x1, H * .3) * .62); y = max(0, top - int(s * .2))
        res.append((cx - s, y, cx + s, y + 2 * s))
    return res, 'column'
def crop(path, n, size=256):
    im = Image.open(path).convert('RGB'); W, H = im.size; bx, how = boxes(im, n); out = []
    for x1, y1, x2, y2 in bx:
        out.append(im.crop((max(0, x1), max(0, y1), min(W, x2), min(H, y2))).resize((size, size), Image.LANCZOS))
    return out, how
if __name__ == '__main__':
    p, n = sys.argv[1], int(sys.argv[2]); cs, how = crop(p, n)
    strip = Image.new('RGB', (256 * n, 256))
    for i, c in enumerate(cs): strip.paste(c, (i * 256, 0))
    strip.save(sys.argv[3] if len(sys.argv) > 3 else '/tmp/shots/crop.png'); print(how)
