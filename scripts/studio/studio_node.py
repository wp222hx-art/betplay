#!/usr/bin/env python3
# MoMo Studio 执行节点 —— 常驻在有 ffmpeg 的机器上（本沙箱 / 自己的服务器 / 装了即梦 CLI 的电脑）
#   令牌鉴权（后台「执行节点」里创建，只显示一次）；心跳 + 领取 + 回报；素材直接 PUT 到后台 R2
#   能力（KINDS，逗号分隔）：
#     post        后处理：压制 576p、首帧/尾帧/海报、烧录字幕检测、音轨检测
#     seam        （随 post）一致性检测：上一段尾帧 ↔ 本段首帧 衔接分；关键帧 + 设定图缩略供视觉 Agent
#     mock_image / mock_video   离线占位素材（尾帧接力可视化，联调不花钱）
#     gsk         Genspark gsk CLI：nano-banana-pro 设定图、Seedance 2.0 视频（参考图 / 首帧）
#     jimeng_cli  即梦 dreamina CLI：text2image、multimodal2video（全能参考）、image2video（首帧接力）
# 用法：STUDIO=http://localhost:3001 NODE_TOKEN=msn_xxx KINDS=post,mock_image,mock_video python3 studio_node.py [--once]
import json, os, re, sys, time, glob, shutil, subprocess, urllib.request as U, urllib.error, urllib.parse, concurrent.futures as cf, threading
BASE = os.environ.get('STUDIO', 'http://localhost:3001').rstrip('/'); TOKEN = os.environ.get('NODE_TOKEN', '')
KINDS = [k.strip() for k in os.environ.get('KINDS', 'post,mock_image,mock_video').split(',') if k.strip()]
CONC = int(os.environ.get('CONC', '2')); ONCE = '--once' in sys.argv; VERSION = 'node-1.0'
TMP = os.environ.get('NODE_TMP', '/tmp/studio_node'); os.makedirs(TMP, exist_ok=True)
DREAMINA = shutil.which('dreamina') or os.path.expanduser('~/.local/bin/dreamina')

def req(method, path, body=None, data=None, ctype='application/json', timeout=120):
    h = {'Authorization': 'Bearer ' + TOKEN}
    if data is None and body is not None: data = json.dumps(body).encode()
    if data is not None: h['Content-Type'] = ctype
    r = U.Request(BASE + path, data=data, headers=h, method=method)
    try: return json.loads(U.urlopen(r, timeout=timeout).read() or b'{}')
    except urllib.error.HTTPError as e: raise RuntimeError(f'HTTP {e.code} {e.read()[:200]!r}')
def put_file(job, path, name, ctype): 
    with open(path, 'rb') as f: return req('PUT', f"/node/jobs/{job['id']}/files/{name}", data=f.read(), ctype=ctype, timeout=600)['key']
def get_media(key, path):
    r = U.Request(BASE + '/node/media/' + key, headers={'Authorization': 'Bearer ' + TOKEN})
    with open(path, 'wb') as f: f.write(U.urlopen(r, timeout=300).read())
    return path
def sh(*a, timeout=1800): return subprocess.run([str(x) for x in a], capture_output=True, text=True, timeout=timeout)
def ffdur(p):
    try: return float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p).stdout.strip())
    except Exception: return 0.0
def has_audio(p): return bool(sh('ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', p).stdout.strip())

# ─────────── 图像指标（纯 numpy，无需 OpenCV）───────────
def load_gray(p, w=96):
    from PIL import Image; import numpy as np
    im = Image.open(p).convert('RGB'); h = max(1, int(im.height * w / im.width)); im = im.resize((w, h))
    return np.asarray(im).astype('float32') / 255.0
def seam_score(a_png, b_png):
    """尾帧 ↔ 首帧 衔接分 0~1：结构（归一化互相关）× 0.6 + 颜色直方图交集 × 0.4"""
    import numpy as np
    A, B = load_gray(a_png), load_gray(b_png)
    h = min(A.shape[0], B.shape[0]); A, B = A[:h], B[:h]
    ga, gb = A.mean(2), B.mean(2); da, db = ga - ga.mean(), gb - gb.mean()
    sa, sb = float(da.std()), float(db.std())
    if sa < 0.02 or sb < 0.02:  # 纹理太少（纯色 / 黑场）→ 互相关无意义，改用像素差
        ncc = max(0.0, 1.0 - float(np.abs(A - B).mean()) * 4)
    else:
        ncc = max(0.0, float((da * db).sum() / (np.sqrt((da ** 2).sum() * (db ** 2).sum()) + 1e-6)))
    hist = 0.0
    for c in range(3):
        ha, _ = np.histogram(A[..., c], bins=16, range=(0, 1)); hb, _ = np.histogram(B[..., c], bins=16, range=(0, 1))
        hist += np.minimum(ha / ha.sum(), hb / hb.sum()).sum() / 3
    return round(0.6 * ncc + 0.4 * float(hist), 4)
def burned_subs(mp4):
    """烧录字幕：2fps 抽帧，统计下 1/3 出现“白字 + 强横向边缘”文字带的帧比例"""
    try:
        import numpy as np; from PIL import Image
        pat = f'{TMP}/_sub_{os.getpid()}_{threading.get_ident()}_%03d.png'
        sh('ffmpeg', '-loglevel', 'error', '-y', '-i', mp4, '-vf', 'fps=2,scale=288:-1', pat)
        fs = sorted(glob.glob(pat.replace('%03d', '*'))); hits = 0
        for f in fs:
            a = np.asarray(Image.open(f).convert('L')).astype(int); h = a.shape[0]; band = a[int(h * .62):int(h * .9)]
            rows = (band > 225).sum(1); edge = (np.abs(np.diff(band, axis=1)) > 90).sum(1); run = best = 0
            for r, e in zip(rows, edge):
                run = run + 1 if (0.03 < r / band.shape[1] < 0.35 and e > 12) else 0; best = max(best, run)
            hits += 5 <= best <= 40; os.remove(f)
        return round(hits / len(fs), 3) if fs else None
    except Exception: return None
def thumb(src, dst, w=384, q=80):
    from PIL import Image
    im = Image.open(src).convert('RGB'); im.thumbnail((w, w * 2)); im.save(dst, 'JPEG', quality=q); return dst

# ─────────── 生成：模拟 ───────────
PALETTE = ['#ff5c9f', '#8b8fff', '#38bdf8', '#f5a524', '#3ddc97', '#c084fc', '#ff8a5d']
def color_of(s): return PALETTE[sum(map(ord, s)) % len(PALETTE)]
def mock_image(job):
    from PIL import Image, ImageDraw
    q = job['req']; w, h = (1536, 864) if q.get('ratio') == '16:9' else (900, 1200)
    im = Image.new('RGB', (w, h), color_of(job['slot'])); d = ImageDraw.Draw(im)
    for i in range(3): x = w * (i + 1) // 4; d.ellipse([x - h // 8, h // 4, x + h // 8, h // 4 + h // 4], fill='#fbeef5'); d.rectangle([x - h // 7, h // 2, x + h // 7, h - h // 8], fill='#2a1828')
    out = f"{TMP}/{job['id']}.png"; im.save(out); return {'media_key': put_file(job, out, 'image.png', 'image/png'), 'cost': 0}
def mock_video(job):
    """占位视频：首帧 = 上一段尾帧（尾帧接力时），逐渐过渡到本段颜色；尾帧导出供下一段接力"""
    q = job['req']; dur = int(q.get('duration') or 5); raw = f"{TMP}/{job['id']}_raw.mp4"; col = color_of(job['slot'])
    first = None
    if q.get('first_frame_key'):
        first = get_media(q['first_frame_key'], f"{TMP}/{job['id']}_first.png")
    if first:
        if True:
            sh('ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-t', dur, '-i', first, '-f', 'lavfi', '-t', dur, '-i', f'color=c={col}:s=576x1024:r=24', '-f', 'lavfi', '-t', dur, '-i', 'sine=frequency=330:sample_rate=44100',
               '-filter_complex', f"[0]scale=576:1024,setsar=1,fps=24[a];[1]format=rgba,fade=in:st=1:d={max(1, dur - 2)}:alpha=1[b];[a][b]overlay,format=yuv420p[v]", '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', raw)
    else:
        sh('ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-t', dur, '-i', f'color=c={col}:s=576x1024:r=24', '-f', 'lavfi', '-t', dur, '-i', 'sine=frequency=440:sample_rate=44100',
           '-vf', "drawbox=x=188:y=300:w=200:h=420:color=#fbeef5@0.85:t=fill", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', raw)
    if not os.path.exists(raw): raise RuntimeError('mock ffmpeg failed')
    return {'media_key': put_file(job, raw, 'raw.mp4', 'video/mp4'), 'cost': 0}

# ─────────── 生成：gsk ───────────
def gsk_cost(out):
    m = re.findall(r'"(?:estimated_credits|credits_used|cost_credits)"\s*:\s*([\d.]+)', out or ''); return max(map(float, m)) if m else 0
def gsk_upload(path):
    m = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', sh('gsk', 'upload', path).stdout); return m.group(0) if m else None
def gsk_image(job):
    q = job['req']; out = f"{TMP}/{job['id']}.png"
    o = sh('gsk', 'img', '-m', job.get('model') if job.get('model') not in (None, '', 'mock') else 'nano-banana-pro', '-r', q.get('ratio', '16:9'), '-o', out, q['prompt'], timeout=900)
    if not os.path.exists(out): raise RuntimeError('gsk img failed: ' + (re.search(r'"error[^"]*"\s*:\s*"([^"]+)"', o.stdout or '') or [None, (o.stderr or o.stdout)[-200:]])[1])
    return {'media_key': put_file(job, out, 'image.png', 'image/png'), 'cost': gsk_cost(o.stdout)}
def gsk_video(job):
    q = job['req']; raw = f"{TMP}/{job['id']}_raw.mp4"; model = job.get('model') if job.get('model') not in (None, '', 'mock') else 'fal-ai/bytedance/seedance-2.0'
    # 注意：-i 是可变长参数（图片数组），提示词必须放在 -i 之前，否则会被当成图片路径吞掉
    args = ['gsk', 'video', q['prompt'], '-m', model, '--tier', q.get('params', {}).get('tier', 'mini'), '-r', q.get('ratio', '9:16'), '-d', str(q.get('duration', 8)), '--audio_enable', 'true', '-o', raw]
    if q.get('first_frame_key'):
        url = gsk_upload(get_media(q['first_frame_key'], f"{TMP}/{job['id']}_first.png")); args += ['-i', url]
    elif q.get('reference_keys'):
        urls = [gsk_upload(get_media(k, f"{TMP}/{job['id']}_ref{i}.png")) for i, k in enumerate(q['reference_keys'][:4])]
        args += ['-i', *[u for u in urls if u], '--reference_mode', 'true']
    for tries in range(2):  # gsk 偶发「结果里没有文件 URL」（上游瞬时失败）→ 节点内重试一次，不消耗槽位 attempt
        o = sh(*args, timeout=1800)
        if os.path.exists(raw) and os.path.getsize(raw) > 100000: break
        os.makedirs("/tmp/gsklogs", exist_ok=True); open(f"/tmp/gsklogs/{job['id']}_{tries}.log", "w").write((o.stdout or '') + '\n---stderr---\n' + (o.stderr or ''))
        if 'Could not find a file URL' not in (o.stdout or '') + (o.stderr or ''): break
        # 服务端仍在排队/渲染（PENDING）：gsk 明确要求不要重复提交，否则会重复排队、重复扣费
        if re.search(r'"status"\s*:\s*"(PENDING|PROCESSING|RUNNING)"', o.stdout or ''):
            qp = re.search(r'"queue_position"\s*:\s*(\d+)', o.stdout or '')
            raise RuntimeError(f"gsk 视频仍在服务端排队（队列位置 {qp.group(1) if qp else '?'}），15 分钟未出片；未重复提交")
        print(f"[node] gsk video 无文件返回，重试 {tries + 1}", flush=True); time.sleep(15)
    if not (os.path.exists(raw) and os.path.getsize(raw) > 100000):
        tail = (o.stdout or '')[-600:]
        m2 = re.search(r'"(?:message|error)"\s*:\s*"([^"]{4,200})"', tail)
        if m2 and not re.search(r'"error_code"', tail): raise RuntimeError('gsk video: ' + m2.group(1))
        m = re.search(r'"error_code"\s*:\s*"([^"]+)"', o.stdout or ''); raise RuntimeError(m.group(1) if m else (o.stderr or o.stdout or 'video failed')[-240:])
    # gsk 视频输出不带积分字段 → 按实测费率估算（seedance-2.0 mini+音频 ≈ 385 积分/秒，可用 GSK_VIDEO_RATE 覆盖）
    cost = gsk_cost(o.stdout) or round(float(q.get('duration', 8)) * float(os.environ.get('GSK_VIDEO_RATE', 385)))
    return {'media_key': put_file(job, raw, 'raw.mp4', 'video/mp4'), 'cost': cost}

# ─────────── 生成：即梦 dreamina CLI ───────────
def dreamina(*args, timeout=1800):
    o = sh(DREAMINA, *args, timeout=timeout)
    if 'login' in (o.stdout + o.stderr) and ('未检测到有效登录' in (o.stdout + o.stderr) or 'not logged' in (o.stdout + o.stderr).lower()): raise RuntimeError('即梦 CLI 未登录：请在节点机器上执行 dreamina login')
    return o
def dreamina_wait(submit_out, outdir, timeout=1500):
    m = re.search(r'submit_id["\s:=]+([\w-]+)', submit_out)
    if not m: raise RuntimeError('即梦提交失败：' + submit_out[-240:])
    sid, t0 = m.group(1), time.time()
    while time.time() - t0 < timeout:
        o = dreamina('query_result', f'--submit_id={sid}', f'--download_dir={outdir}', timeout=300)
        fs = [f for f in glob.glob(outdir + '/*') if re.search(r'\.(mp4|png|jpe?g|webp)$', f)]
        if fs: return fs[0], o.stdout
        if re.search(r'"?(status|gen_status)"?\s*[:=]\s*"?(fail|failed|error)', o.stdout, re.I): raise RuntimeError('即梦任务失败：' + o.stdout[-240:])
        time.sleep(10)
    raise RuntimeError('即梦任务超时')
def jimeng_image(job):
    q = job['req']; d = f"{TMP}/{job['id']}_dl"; os.makedirs(d, exist_ok=True)
    o = dreamina('text2image', f"--prompt={q['prompt']}", f"--ratio={q.get('ratio', '16:9')}", '--resolution_type=2k', *([f"--model_version={job['model']}"] if job.get('model') not in (None, '', 'mock') else []))
    f, _ = dreamina_wait(o.stdout + o.stderr, d)
    return {'media_key': put_file(job, f, 'image' + os.path.splitext(f)[1], 'image/png' if f.endswith('png') else 'image/jpeg'), 'cost': 0}
def jimeng_video(job):
    q = job['req']; d = f"{TMP}/{job['id']}_dl"; os.makedirs(d, exist_ok=True); model = job.get('model') if job.get('model') not in (None, '', 'mock') else 'seedance2.0'
    common = [f"--prompt={q['prompt']}", f"--duration={int(q.get('duration', 8))}", '--video_resolution=720p', f'--model_version={model}']
    if q.get('first_frame_key'):
        img = get_media(q['first_frame_key'], f"{TMP}/{job['id']}_first.png"); o = dreamina('image2video', f'--image={img}', *common, f"--ratio={q.get('ratio', '9:16')}")
    else:
        imgs = [get_media(k, f"{TMP}/{job['id']}_ref{i}.png") for i, k in enumerate((q.get('reference_keys') or [])[:4])]
        o = dreamina('multimodal2video', *sum([['--image', p] for p in imgs], []), *common, f"--ratio={q.get('ratio', '9:16')}")
    f, _ = dreamina_wait(o.stdout + o.stderr, d)
    return {'media_key': put_file(job, f, 'raw.mp4', 'video/mp4'), 'cost': 0}

# ─────────── 后处理 + 一致性检测 ───────────
def post(job):
    q = job['req']; raw = get_media(q['raw_key'], f"{TMP}/{job['id']}_in.mp4"); mp4 = f"{TMP}/{job['id']}.mp4"
    sh('ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-vf', 'scale=576:-2', '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4)
    if not os.path.exists(mp4) or os.path.getsize(mp4) < 1000: raise RuntimeError('压制失败（原始视频可能损坏）')
    dur = round(ffdur(mp4), 2); keys = {'media_key': put_file(job, mp4, 'clip.mp4', 'video/mp4')}
    for name, ss in (('first', ['-ss', '0']), ('poster', ['-ss', str(min(1.0, dur / 3))]), ('last', ['-sseof', '-0.08'])):
        png = f"{TMP}/{job['id']}_{name}.png"; sh('ffmpeg', '-loglevel', 'error', '-y', *ss, '-i', mp4, '-frames:v', '1', png)
        if not os.path.exists(png) and name == 'last': sh('ffmpeg', '-loglevel', 'error', '-y', '-ss', str(max(0, dur - 0.15)), '-i', mp4, '-frames:v', '1', png)
        if name == 'poster': keys['poster_key'] = put_file(job, thumb(png, png.replace('.png', '.jpg'), 480), 'poster.jpg', 'image/jpeg')
        else: keys[f'{name}_key'] = put_file(job, png, f'{name}.png', 'image/png')
    return {**keys, 'duration': dur, 'subs': burned_subs(mp4), 'audio': has_audio(mp4)}
def contact_sheet(job, clip_key, h=360):
    """关键帧拼图：25% / 55% / 85% 三帧横排（插入镜头不再被单帧误判）"""
    if not clip_key: return None
    try:
        from PIL import Image
        mp4 = get_media(clip_key, f"{TMP}/{job['id']}_clip.mp4"); dur = ffdur(mp4) or 8; ims = []
        for k, t in enumerate((0.25, 0.55, 0.85)):
            png = f"{TMP}/{job['id']}_cs{k}.png"; sh('ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{dur * t:.2f}', '-i', mp4, '-frames:v', '1', png)
            if os.path.exists(png): im = Image.open(png).convert('RGB'); im.thumbnail((h * 2, h)); ims.append(im)
        if not ims: return None
        W = sum(i.width for i in ims) + 6 * (len(ims) - 1); S = Image.new('RGB', (W, max(i.height for i in ims)), (0, 0, 0)); x = 0
        for i in ims: S.paste(i, (x, 0)); x += i.width + 6
        dst = f"{TMP}/{job['id']}_sheet.jpg"; S.save(dst, 'JPEG', quality=75); return dst
    except Exception as e:
        print('[node] contact sheet failed', e, flush=True); return None
def seam(job):
    q = job['req']; out = {'seam': None, 'subs': q.get('subs')}
    first = get_media(q['first_key'], f"{TMP}/{job['id']}_first.png")
    if q.get('prev_last_key'): out['seam'] = seam_score(get_media(q['prev_last_key'], f"{TMP}/{job['id']}_prev.png"), first)
    # 供视觉 Agent：关键帧 + 设定图缩略（小图，节省 token 与 Worker 内存）
    if q.get('poster_key'):
        fr = get_media(q['poster_key'], f"{TMP}/{job['id']}_frame.jpg"); sheet = contact_sheet(job, q.get('clip_key'))
        out['frame_key'] = put_file(job, sheet or thumb(fr, fr, 384, 72), 'qc_frame.jpg', 'image/jpeg')
        refs = []
        for r in (q.get('refs') or [])[:3]:
            p = get_media(r['key'], f"{TMP}/{job['id']}_ref_{r['id']}.png"); refs.append({'id': r['id'], 'key': put_file(job, thumb(p, p.replace('.png', '.jpg'), 384, 72), f"qc_ref_{r['id']}.jpg", 'image/jpeg')})
        out['ref_keys'] = refs
    return out

# ─────────── 第 10 步打包：拼接片段 → 玩家端媒体路径 ───────────
def put_out(job, path, key, ctype):
    with open(path, 'rb') as f: return req('PUT', f"/node/jobs/{job['id']}/out?key=" + urllib.parse.quote(key, safe=''), data=f.read(), ctype=ctype, timeout=900)['key']
def webp(src, dst, w=480, q=78):
    from PIL import Image
    im = Image.open(src).convert('RGB'); im.thumbnail((w, w * 2)); im.save(dst, 'WEBP', quality=q); return dst
def face_crop(src, dst, size=256):
    """设定图 → 圆形头像：OpenCV 人脸检测取最大的一张脸；失败则取画面左 1/3 上部（三视图的正面视图）"""
    import cv2
    from PIL import Image
    im = Image.open(src).convert('RGB'); W, H = im.size
    try:
        import numpy as np
        g = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY)
        det = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        fs = sorted(det.detectMultiScale(g, 1.1, 5, minSize=(int(H * 0.06), int(H * 0.06))), key=lambda f: -f[2] * f[3])
    except Exception: fs = []
    if len(fs):
        x, y, w, h = fs[0]; cx, cy, r = x + w / 2, y + h / 2, max(w, h) * 0.95
    else:
        cx, cy, r = W / 6, H * 0.28, min(W / 6, H * 0.22)
    box = (int(max(0, cx - r)), int(max(0, cy - r)), int(min(W, cx + r)), int(min(H, cy + r)))
    im.crop(box).resize((size, size), Image.LANCZOS).save(dst, 'WEBP', quality=85); return dst
def pack(job):
    """按编译计划拼接：每个片段 = 若干节点视频顺接（统一 576p/24fps/AAC 立体声重编码，保证播放器无缝）"""
    q = job['req']; out = {'segments': {}, 'cast': {}}; total = 0; cache = {}
    def clip(key):
        if key not in cache: cache[key] = get_media(key, f"{TMP}/{job['id']}_src{len(cache)}.mp4")
        return cache[key]
    for s in q['segments']:
        srcs = [clip(p['key']) for p in s['parts']]; durs = [round(ffdur(x), 2) for x in srcs]
        mp4 = f"{TMP}/{job['id']}_{s['id']}.mp4"
        args = []
        for x in srcs: args += ['-i', x]
        norm = ''.join(f"[{i}:v]scale=576:1024:force_original_aspect_ratio=decrease,pad=576:1024:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v{i}];" + (f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo[a{i}];" if has_audio(x) else f"anullsrc=r=44100:cl=stereo,atrim=0:{durs[i]}[a{i}];") for i, x in enumerate(srcs))
        cat = ''.join(f"[v{i}][a{i}]" for i in range(len(srcs))) + f"concat=n={len(srcs)}:v=1:a=1[v][a]"
        o = sh('ffmpeg', '-loglevel', 'error', '-y', *args, '-filter_complex', norm + cat, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4, timeout=1200)
        if not os.path.exists(mp4) or os.path.getsize(mp4) < 1000: raise RuntimeError(f"拼接失败 {s['id']}: {(o.stderr or '')[-200:]}")
        dur = round(ffdur(mp4), 2); total += os.path.getsize(mp4)
        img_base = s['out'].replace('/', '/img/', 1)
        pp, lp = f"{TMP}/{job['id']}_{s['id']}_p.png", f"{TMP}/{job['id']}_{s['id']}_l.png"
        sh('ffmpeg', '-loglevel', 'error', '-y', '-ss', str(min(1.0, dur / 3)), '-i', mp4, '-frames:v', '1', pp)
        sh('ffmpeg', '-loglevel', 'error', '-y', '-sseof', '-0.1', '-i', mp4, '-frames:v', '1', lp)
        if not os.path.exists(lp): sh('ffmpeg', '-loglevel', 'error', '-y', '-ss', str(max(0, dur - 0.2)), '-i', mp4, '-frames:v', '1', lp)
        out['segments'][s['id']] = {'key': put_out(job, mp4, s['out'] + '.mp4', 'video/mp4'), 'poster': put_out(job, webp(pp, pp + '.webp'), img_base + '_poster.webp', 'image/webp'),
                                    'last': put_out(job, webp(lp, lp + '.webp'), img_base + '_last.webp', 'image/webp'), 'dur': dur, 'durs': durs}
        os.remove(mp4)
    for c in q.get('cast') or []:
        if not c.get('key'): continue
        src = get_media(c['key'], f"{TMP}/{job['id']}_cast{c['idx']}.png")
        out['cast'][c['id']] = put_out(job, face_crop(src, src + '.webp'), c['out'], 'image/webp')
    cv = get_media(q['cover']['key'], f"{TMP}/{job['id']}_cover.png")
    out['cover'] = put_out(job, webp(cv, cv + '.webp', 720, 82), q['cover']['out'], 'image/webp')
    out['bytes'] = total
    return out

def run(job):
    ph, kind, img = job['phase'], job.get('kind'), job['step'] == 6
    if ph == 'post': return post(job)
    if ph == 'seam': return seam(job)
    if ph == 'pack': return pack(job)
    if kind == 'mock_image' or (kind == 'mock_video' and img): return mock_image(job)
    if kind == 'mock_video': return mock_video(job)
    if kind == 'gsk': return gsk_image(job) if img else gsk_video(job)
    if kind == 'jimeng_cli': return jimeng_image(job) if img else jimeng_video(job)
    raise RuntimeError(f'节点不支持 {kind}')

def info():
    i = {'running': None}
    if 'gsk' in KINDS:
        try: i['balance'] = json.loads(sh('gsk', 'me', timeout=30).stdout)['data']['credit_balance']
        except Exception: pass
    if 'jimeng_cli' in KINDS:
        try: i['jimeng'] = (sh(DREAMINA, 'user_credit', timeout=30).stdout or '')[-160:]
        except Exception: pass
    return i

def worker(n):
    idle = 0
    while True:
        try: job = req('POST', '/node/claim', {'kinds': KINDS, 'version': VERSION, 'info': info() if n == 0 and idle % 20 == 0 else {}}).get('job')
        except Exception as e: print(f'[node#{n}] claim error {str(e)[:120]} → retry', flush=True); time.sleep(10); continue
        if not job:
            if ONCE: return
            idle += 1; time.sleep(3 if idle < 10 else 8); continue
        idle = 0; t0 = time.time()
        try: res = {'ok': True, **run(job)}
        except Exception as e: res = {'ok': False, 'error': str(e)[:400]}
        for k in range(5):
            try: req('POST', f"/node/jobs/{job['id']}/report", res); break
            except Exception as e: print(f'[node#{n}] report retry {k}: {str(e)[:100]}', flush=True); time.sleep(5)
        print(f"[node#{n}] {job['phase']:4} {job.get('kind') or '-':10} {job['slot']:14} {'ok ' if res['ok'] else 'FAIL ' + res.get('error', '')[:80]} {int(time.time() - t0)}s", flush=True)
        for f in glob.glob(f"{TMP}/{job['id']}*"):
            try: shutil.rmtree(f) if os.path.isdir(f) else os.remove(f)
            except Exception: pass

if __name__ == '__main__':
    if not TOKEN: sys.exit('缺少 NODE_TOKEN（后台 → 执行节点 → 新建）')
    print(f'MoMo Studio 执行节点 {VERSION} → {BASE} 能力={KINDS} 并发={CONC}', flush=True)
    with cf.ThreadPoolExecutor(CONC) as ex: list(ex.map(worker, range(CONC)))
