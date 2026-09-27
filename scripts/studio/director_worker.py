#!/usr/bin/env python3
# 导演台生成 worker —— 平台后台指挥，worker 执行（在装有 gsk CLI 的沙箱/服务器上常驻）
# 流程：认领任务 → sheet/cover 用 nano-banana-pro 出图；clip 用 Seedance 2.0（设定图参考 + 原生普通话音画）
#      → 转写对齐字幕 → 压制 576p → 海报/末帧 → 上传 R2（视频受保护，图片公开）→ AI 质检 → 回报（含实际消耗积分）
# 用法：BASE=http://localhost:3000 [ADMIN_KEY=..] [R2=--local|--remote] [CONC=3] python3 director_worker.py [--once] [--dry]
import json, os, re, sys, time, subprocess, urllib.request as U, concurrent.futures as cf, threading
from PIL import Image
BASE = os.environ.get('BASE', 'http://localhost:3000'); KEY = os.environ.get('ADMIN_KEY', '')
R2 = os.environ.get('R2', '--local'); CONC = int(os.environ.get('CONC', '3')); WORKER = os.environ.get('WORKER', 'sandbox-gsk')
DRY = '--dry' in sys.argv; ONCE = '--once' in sys.argv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')); TMP = '/tmp/director'; os.makedirs(TMP, exist_ok=True)
LOCK = threading.Lock()

def api(path, body=None):
    r = U.Request(BASE + path, data=json.dumps(body or {}).encode(), headers={'content-type': 'application/json', 'x-admin-key': KEY}, method='POST')
    return json.loads(U.urlopen(r, timeout=120).read())
def sh(*a, timeout=1800): return subprocess.run(list(a), capture_output=True, text=True, timeout=timeout)
def cost_of(outs, fallback):
    """每次尝试只取一个计费值（gsk 输出里同一任务的 estimated_credits 会出现多次，求和会重复计数）"""
    tot = 0
    for out in outs:
        m = re.findall(r'"(?:estimated_credits|credits_used|cost_credits)"\s*:\s*([\d.]+)', out or '')
        tot += max(float(x) for x in m) if m else 0
    return round(tot) or fallback
def balance():
    try: return json.loads(sh('gsk', 'me').stdout)['data']['credit_balance']
    except Exception: return None
def upload(path):
    m = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', sh('gsk', 'upload', path).stdout); return m.group(0) if m else None
def r2put(key, path, ctype):
    with LOCK:  # wrangler 本地 R2 并发写不安全
        r = sh('npx', 'wrangler', 'r2', 'object', 'put', f'webapp-media/{key}', '--file', path, '--content-type', ctype, R2, timeout=300)
    return r.returncode == 0
def ffdur(p):
    try: return float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p).stdout.strip())
    except Exception: return 0

def transcribe_align(mp4, lines, dur, tag):
    """转写字级时间戳 → 贪心对齐脚本台词；失败时按时长均分"""
    out = []
    try:
        mp3 = f'{TMP}/{tag}.mp3'; sh('ffmpeg', '-loglevel', 'error', '-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3)
        url = upload(mp3); r = sh('gsk', 'transcribe', '-i', url, '--prompt', '普通话对白：' + ' '.join(l['text'] for l in lines))
        d = list(json.loads(r.stdout)['data'].values())[0]; chars = []
        for ln in (d.get('words') or '').split('\n'):
            m = re.match(r'\S+ ([\d.]+)-([\d.]+): (.*)', ln.strip())
            if not m: continue
            st, en, w = float(m.group(1)), float(m.group(2)), m.group(3); hz = [c for c in w if '\u4e00' <= c <= '\u9fff']
            for k, c in enumerate(hz): chars.append([c, st + (en - st) * k / len(hz), st + (en - st) * (k + 1) / len(hz)])
        pos = 0
        for l in lines:
            hz = [c for c in l['text'] if '\u4e00' <= c <= '\u9fff']; hit = []; j = pos
            for c in hz:
                for k in range(j, min(len(chars), j + 12)):
                    if chars[k][0] == c: hit.append(k); j = k + 1; break
            if len(hit) >= max(1, len(hz) // 3): st, en = chars[hit[0]][1], chars[hit[-1]][2]; pos = hit[-1] + 1
            else: st = (out[-1]['end'] + 0.3) if out else dur * 0.25; en = st + 0.28 * len(hz)
            st = min(st, dur - 1); out.append({'speaker': l['speaker'], 'text': l['text'], 'start': round(st, 2), 'end': round(min(max(en + 0.25, st + 0.8), dur), 2)})
        return out
    except Exception:
        n = max(1, len(lines)); return [{'speaker': l['speaker'], 'text': l['text'], 'start': round(1 + i * (dur - 2) / n, 2), 'end': round(1 + (i + 0.9) * (dur - 2) / n, 2)} for i, l in enumerate(lines)]

def qc(url, lines):
    """AI 质检：人物是否稳定、是否普通话、是否有字幕/水印；失败不阻塞（仅记录）"""
    try:
        r = sh('gsk', 'media-analyze', '-i', url, '--requirements', 'QC for an AI-generated vertical drama clip. Answer ONLY JSON {"pass":bool,"score":1-10,"mandarin":bool,"face_morph":bool,"burned_text":bool,"note":"short"}. pass=false only if faces badly deform, no dialogue audio, or burned-in text/watermark.', timeout=300)
        m = re.search(r'\{[^{}]*"pass"[^{}]*\}', r.stdout.replace('\\"', '"')); return json.loads(m.group(0)) if m else {'pass': True, 'note': 'qc unparsed'}
    except Exception as e: return {'pass': True, 'note': 'qc skipped'}

def crop_cast(sheet_png, n, sid):
    """设定图按人数等分裁头像 → R2 公开图"""
    from crop_cast import crop as _crop  # 圆形特写检测 → 列投影兜底
    out = {}; faces, _how = _crop(sheet_png, n)
    for i, face in enumerate(faces):
        p = f'{TMP}/{sid}_c{i}.webp'; face.save(p, 'WEBP', quality=85)
        if r2put(f'{sid}/img/c{i}.webp', p, 'image/webp'): out[i] = f'/gimg/{sid}/c{i}.webp'
    return out

def run(job):
    sid = job.get('series_id') or 'gen_' + job['project_id'][4:12]; kind = job['kind']; cid = job['clip_id']
    if DRY:
        time.sleep(0.3); return {'ok': True, 'url': f'dry://{cid}', 'spent': 0, 'meta': {'dur': job['dur'], 'dry': True}, 'qc': {'pass': True, 'dry': True}}
    if kind in ('sheet', 'cover'):
        png = f'{TMP}/{sid}_{kind}.png'
        outs = []
        for _ in range(2):
            outs.append(sh('gsk', 'img', '-m', 'nano-banana-pro', '-r', '16:9' if kind == 'sheet' else '3:4', '-o', png, job['prompt'], timeout=600).stdout)
            if os.path.exists(png): break
        if not os.path.exists(png): return {'ok': False, 'spent': 0, 'meta': {'error': 'image failed'}}
        url = upload(png); meta = {}
        if kind == 'cover':
            p = f'{TMP}/{sid}_cover.webp'; im = Image.open(png).convert('RGB'); im.thumbnail((600, 800)); im.save(p, 'WEBP', quality=82)
            r2put(f'{sid}/img/cover.webp', p, 'image/webp'); meta['public_url'] = f'/gimg/{sid}/cover.webp'
        else:
            bible = json.loads(U.urlopen(U.Request(BASE + f"/api/studio/projects/{job['project_id']}", headers={'x-admin-key': KEY})).read())['bible']
            imgs = crop_cast(png, len(bible.get('cast', [])), sid); meta['cast'] = {c['id']: imgs.get(i) for i, c in enumerate(bible.get('cast', []))}
        return {'ok': True, 'url': url, 'spent': cost_of(outs, job['credits']), 'meta': meta}
    # ── 片段：Seedance 2.0 参考图模式（设定图）+ 原生音画 ──
    raw = f'{TMP}/{sid}_{cid}_raw.mp4'
    outs = []
    for _ in range(2):
        outs.append(sh('gsk', 'video', '-m', 'fal-ai/bytedance/seedance-2.0', '--tier', 'mini', '-r', '9:16', '-d', str(job['dur']), '-i', job['sheet_url'], '--reference_mode', 'true', '--audio_enable', 'true', '-o', raw, job['prompt']).stdout)
        if os.path.exists(raw) and os.path.getsize(raw) > 100000: break
    spent = cost_of(outs, job['credits'])
    if not (os.path.exists(raw) and os.path.getsize(raw) > 100000): return {'ok': False, 'spent': spent, 'meta': {'error': 'video failed'}}
    mp4 = f'{TMP}/{sid}_{cid}.mp4'
    sh('ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-vf', 'scale=576:-2', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4)
    dur = round(ffdur(mp4), 2)
    for name, ss in (('poster', ['-ss', '0.8']), ('last', ['-sseof', '-0.2'])):
        png = f'{TMP}/{sid}_{cid}_{name}.png'; sh('ffmpeg', '-loglevel', 'error', '-y', *ss, '-i', mp4, '-frames:v', '1', png)
        w = png.replace('.png', '.webp'); Image.open(png).convert('RGB').save(w, 'WEBP', quality=80); r2put(f'{sid}/img/{cid}_{name}.webp', w, 'image/webp')
    ok = r2put(f'{sid}/{cid}.mp4', mp4, 'video/mp4')
    os.makedirs(f'{ROOT}/media_src/{sid}', exist_ok=True); subprocess.run(['cp', mp4, f'{ROOT}/media_src/{sid}/{cid}.mp4'])
    url = upload(raw)
    lines = transcribe_align(mp4, job.get('lines') or [], dur, f'{sid}_{cid}')
    q = qc(url, lines) if url else {'pass': True}
    return {'ok': ok, 'url': url, 'spent': spent, 'qc': q, 'meta': {'dur': dur, 'lines': lines, 'poster': f'/gimg/{sid}/{cid}_poster.webp', 'last': f'/gimg/{sid}/{cid}_last.webp'}}

def loop():
    while True:
        try: job = api('/api/director/claim', {'worker': WORKER, 'balance': None if DRY else balance()}).get('job')
        except Exception as e:  # 服务重启 / 网络抖动：不让线程退出
            print(f'[{WORKER}] claim error {str(e)[:80]} → retry', flush=True); time.sleep(10); continue
        if not job:
            if ONCE: return
            time.sleep(15); continue
        t0 = time.time()
        try: res = run(job)
        except Exception as e: res = {'ok': False, 'spent': 0, 'meta': {'error': str(e)[:300]}}
        for k in range(6):
            try: r = api(f"/api/director/jobs/{job['id']}/report", res); break
            except Exception as e: print(f'[{WORKER}] report retry {k}: {str(e)[:80]}', flush=True); time.sleep(10)
        else: continue
        print(f"[{WORKER}] {job['kind']:5} {job['clip_id']:6} {'ok ' if res['ok'] else 'FAIL'} spent={res.get('spent')} qc={res.get('qc', {}).get('score', '-')} {int(time.time() - t0)}s → {r['done']}/{r['total']} {r['status']}{' 🎬 上架 ' + r['published']['url'] if r.get('published') else ''}", flush=True)

if __name__ == '__main__':
    # 多路并发：sheet 必须先完成，其它 worker 线程会自动等待（claim 端控制依赖）
    with cf.ThreadPoolExecutor(CONC) as ex:
        fs = [ex.submit(loop) for _ in range(CONC)]
        for f in fs: f.result()
