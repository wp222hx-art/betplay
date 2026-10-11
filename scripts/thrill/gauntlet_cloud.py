#!/usr/bin/env python3
"""逐个揭晓淘汰赛 · 云端发布：压缩 → gsk hosted r2_put（≤5MiB base64）→ D1 媒体清单行 <sid>_media
用法：python3 scripts/thrill/gauntlet_cloud.py <sid ...> [--only=r2|d1] [--force]
注：r2_put 成功的返回里也可能含 "error" 字样，以 "Wrote" 判定成功。"""
import base64, concurrent.futures as cf, json, os, subprocess, sys, tempfile, time
ARCH = '/home/user/webapp_media_archive/gauntlet'
sys.path.insert(0, os.path.dirname(__file__))
MAXB = 3_700_000

def sh(*a, timeout=600): return subprocess.run(a, capture_output=True, text=True, timeout=timeout)
def dur(p): return float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p).stdout.strip() or 4)

def small(mp4):
    if os.path.getsize(mp4) <= MAXB: return mp4
    out = mp4.replace('.mp4', '.c.mp4')
    if os.path.exists(out) and os.path.getsize(out) <= MAXB: return out
    for crf in (26, 29, 32, 35):
        sh('ffmpeg', '-v', 'error', '-y', '-i', mp4, '-c:v', 'libx264', '-preset', 'medium', '-crf', str(crf), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out, timeout=900)
        if os.path.exists(out) and os.path.getsize(out) <= MAXB: return out
    return out

def put(key, path, ctype):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump({'key': key, 'content_base64': base64.b64encode(open(path, 'rb').read()).decode(), 'content_type': ctype}, f); fn = f.name
    try:
        for t in range(3):
            o = sh('gsk', 'hosted', 'r2_put', '--args-file', fn, timeout=300)
            if 'Wrote' in (o.stdout + o.stderr) or '"ok": true' in o.stdout or '"success": true' in o.stdout: return key, 'ok'
            time.sleep(5 + t * 10)
        return key, 'FAIL ' + (o.stdout + o.stderr)[-200:]
    finally: os.remove(fn)

def r2(sid, force=False):
    import gauntlet_produce as GP
    D = f'{ARCH}/{sid}'; J = []; man = {}
    for k in GP.clips(sid):
        p = f'{D}/{k}.mp4'
        if not os.path.exists(p): print(sid, 'missing', k); continue
        man[k] = round(dur(p), 2); J.append((f'{sid}/{k}.mp4', p, 'video/mp4'))
    for i in range(1, 9):
        w = f'{D}/p{i}.webp'
        if not os.path.exists(w): sh('ffmpeg', '-loglevel', 'error', '-y', '-i', f'{D}/p{i}.png', '-vf', 'crop=iw:iw:0:0,scale=200:-2', '-q:v', '82', w)
        J.append((f'{sid}/img/p{i}.webp', w, 'image/webp'))
    cov = f'{D}/cover.webp'
    if not os.path.exists(cov): sh('ffmpeg', '-loglevel', 'error', '-y', '-i', f'{D}/intro0.png', '-vf', 'scale=720:-2', '-q:v', '80', cov)
    J.append((f'{sid}/img/cover.webp', cov, 'image/webp'))
    done_f = f'{D}/.cloud_done.json'; done = set(json.load(open(done_f))) if os.path.exists(done_f) and not force else set()
    J = [j for j in J if j[0] not in done]
    J = [(k, small(p) if ct == 'video/mp4' else p, ct) for k, p, ct in J]
    with cf.ThreadPoolExecutor(3) as ex:
        for k, st in ex.map(lambda j: put(*j), J):
            print(sid, k, st)
            if st == 'ok': done.add(k); json.dump(sorted(done), open(done_f, 'w'))
    json.dump(man, open(f'{D}/.manifest.json', 'w'))
    return man

def d1(sid):
    man = json.load(open(f'{ARCH}/{sid}/.manifest.json'))
    data = json.dumps({'clips': man}, ensure_ascii=False).replace("'", "''")
    import gauntlet_produce as GP  # noqa
    t = int(time.time() * 1000)
    sql = f"INSERT INTO thrill_series (id,title,logline,tension,cover,data,version,status,created_at,updated_at) VALUES ('{sid}_media','{sid}·媒体清单','',3,NULL,'{data}',1,'offline',{t},{t}) ON CONFLICT(id) DO UPDATE SET data=excluded.data, version=thrill_series.version+1, updated_at=excluded.updated_at"
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f: json.dump({'sql': sql}, f); fn = f.name
    o = sh('gsk', 'hosted', 'd1_execute', '--args-file', fn); os.remove(fn); print(sid, 'D1', (o.stdout + o.stderr)[-300:])

if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]; only = next((x[7:] for x in sys.argv if x.startswith('--only=')), None); force = '--force' in sys.argv
    for sid in a:
        if only in (None, 'r2'): r2(sid, force)
        if only in (None, 'd1'): d1(sid)
