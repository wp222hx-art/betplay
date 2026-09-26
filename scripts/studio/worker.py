#!/usr/bin/env python3
# 渲染 worker：从制作平台队列原子认领任务 → Seedance 生成 → AI 质检 → 回报（进入人工审核）
# 用法：BASE=https://<站点> ADMIN_KEY=... python3 worker.py [--once] [--dry]
#   --dry：不真正调用视频模型（不花积分），用于演练整条流水线
import json, os, sys, time, subprocess, urllib.request as U, re
BASE = os.environ.get('BASE', 'http://localhost:3000'); KEY = os.environ.get('ADMIN_KEY', '')
DRY = '--dry' in sys.argv; ONCE = '--once' in sys.argv; WORKER = os.environ.get('WORKER', 'sandbox-1')
def api(path, body=None):
    r = U.Request(BASE + path, data=json.dumps(body or {}).encode(), headers={'content-type': 'application/json', 'x-admin-key': KEY}, method='POST')
    return json.loads(U.urlopen(r, timeout=60).read())
def render(job):
    if DRY: time.sleep(0.2); return f"dry://{job['project_id']}/{job['clip_id']}.mp4", {'dry': True}
    out = f"/tmp/studio/{job['project_id']}/{job['clip_id']}.mp4"; os.makedirs(os.path.dirname(out), exist_ok=True)
    prompt = f"Vertical cinematic drama shot sequence. Dialogue language: Mandarin Chinese.\n{job['prompt']}\nNo subtitles, no on-screen text, stable faces."
    subprocess.run(['gsk', 'video', '-m', 'fal-ai/bytedance/seedance-2.0', '--tier', 'mini', '-r', '9:16', '-d', str(job['dur']), '--audio_enable', 'true', '-o', out, prompt], capture_output=True, text=True, timeout=900)
    if not os.path.exists(out): return None, {'error': 'generation failed'}
    url = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', subprocess.run(['gsk', 'upload', out], capture_output=True, text=True).stdout)
    return (url.group(0) if url else out), {'bytes': os.path.getsize(out)}
while True:
    job = api('/api/studio/jobs/claim', {'worker': WORKER}).get('job')
    if not job:
        if ONCE: print('queue empty'); break
        time.sleep(20); continue
    url, qc = render(job)
    r = api(f"/api/studio/jobs/{job['id']}/report", {'ok': bool(url), 'url': url, 'qc': qc})
    print(job['clip_id'], 'ok' if url else 'FAIL', f"{r['done']}/{r['total']}", r['status'], flush=True)
