#!/usr/bin/env python3
# 惊心 1 分钟 · 批量生产管线（gsk nano-banana-2.1 定妆/场景 → gsk Seedance 2.0 参考模式出片 → R2 → 上架）
# 用法：python3 scripts/thrill/produce.py thr_elevator thr_hostage thr_lasthand   [--only e_m0,e_c1a] [--force] [--publish-only]
# 一致性：每个片段都以「该段出场演员定妆照 + 场景图」作为参考图（reference_mode），并统一写实风格后缀
# 幂等：已存在的 mp4 跳过；失败自动重试 1 次；全部成功后写 R2 + 上架 live
import json, os, re, subprocess, sys, time, concurrent.futures as cf, urllib.request

ROOT = '/home/user/webapp'
OUT = '/home/user/webapp_media_archive/thrill'
MODEL = 'fal-ai/bytedance/seedance-2.0'
TIER = os.environ.get('THRILL_TIER', 'standard')
CONC = int(os.environ.get('THRILL_CONC', '8'))
REAL = ('Photorealistic live-action film, shot on ARRI Alexa Mini with anamorphic lens, natural skin texture with visible pores and slight imperfections, '
        'no makeup look, no beauty filter, no CGI sheen, no plastic or waxy skin, subtle 35mm film grain, practical motivated lighting, muted desaturated color grade, '
        'handheld documentary realism, tense atmosphere, consistent characters exactly as in the reference images.')
PORTRAIT = ('Candid photograph, real person, not a model. {look}. {where}. Looking at camera, neutral guarded expression. Shot on Fujifilm X-T4 35mm f/2, '
            'ISO 3200 grain, unretouched documentary photo, true-to-life skin texture with pores and blemishes, no beauty filter, no airbrushing, no CGI.')
VOICE = {'对讲', '电话', '耳机', '门外', '广播', '消防员'}

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(*a, timeout=1800, cwd=None): return subprocess.run(a, capture_output=True, text=True, timeout=timeout, cwd=cwd)
def gsk_url(out): m = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', out or ''); return m.group(0) if m else None
def upload(path): return gsk_url(sh('gsk', 'upload', path).stdout)

def script(sid): return json.loads(sh('npx', 'tsx', 'scripts/thrill/export.ts', sid, cwd=ROOT).stdout)

def ensure_refs(d, sdir):
    """定妆照 + 场景图：已有就复用（保证同一部剧所有片段用同一组参考）"""
    refs_f = f'{sdir}/refs.json'
    refs = json.load(open(refs_f)) if os.path.exists(refs_f) else {}
    legacy = f'{sdir}/refs.txt'
    if os.path.exists(legacy):
        for ln in open(legacy):
            k, u = ln.split()
            refs.setdefault(k.replace('cast_', '').replace('set_elevator', 'set'), u)
    jobs = []
    for k, c in d['cast'].items():
        if k not in refs: jobs.append((k, PORTRAIT.format(look=c['look'], where='Standing in a dim interior under cold practical light'), '3:4'))
    if 'set' not in refs:
        jobs.append(('set', f"Unretouched documentary photograph of an empty location, no people: {d['set']} Shot on Fujifilm X-T4 23mm, ISO 3200 grain, realistic practical light, no CGI.", '9:16'))
    for k, prompt, ratio in jobs:
        out = f'{sdir}/ref_{k}.png'
        log(d['series']['id'], 'ref', k)
        o = sh('gsk', 'img', '-m', 'nano-banana-2.1', '-r', ratio, '-o', out, prompt, timeout=600)
        if not os.path.exists(out): raise RuntimeError('ref failed ' + k + ' ' + (o.stdout or o.stderr)[-300:])
        refs[k] = upload(out)
        json.dump(refs, open(refs_f, 'w'), indent=1)
    return refs

def dialogue(d, lines):
    names = {c['name']: c for c in d['cast'].values()}
    out = []
    for ln in lines:
        m = re.match(r'^([^：（(]+)(?:[（(][^）)]*[）)])?：(.+)$', ln)
        if not m or m.group(1).startswith('字幕'): continue
        who, text = m.group(1).strip(), m.group(2).strip()
        if who in names: out.append(f'{who} says quietly in Mandarin Chinese: "{text}"')
        elif who in VOICE: out.append(f'An off-screen voice ({who}) says in Mandarin Chinese: "{text}"')
    return ' '.join(out)

def prompt_for(d, seg, refs):
    cast = seg['cast'] or list(d['cast'].keys())
    urls, intro = [], []
    for k in cast:
        if refs.get(k):
            urls.append(refs[k]); intro.append(f"@Image{len(urls)} is {d['cast'][k]['name']} ({d['cast'][k]['look'].split(',')[0]})")
    urls.append(refs['set']); intro.append(f'@Image{len(urls)} is the location')
    dl = dialogue(d, seg['lines'])
    no_speech = '' if dl else ' No dialogue, only ambient sound and breathing.'
    text = f"{'; '.join(intro)}. Camera: {seg['shot']}. {seg['prompt']} {dl}{no_speech} {REAL}"
    return text, urls

def render(d, sid, segid, seg, refs, sdir, force=False):
    mp4 = f'{sdir}/{segid}.mp4'
    if os.path.exists(mp4) and os.path.getsize(mp4) > 100000 and not force: return segid, 'skip', 0
    text, urls = prompt_for(d, seg, refs)
    dur = max(4, min(10, int(seg.get('dur', 6))))
    err = ''
    for attempt in range(2):
        t0 = time.time()
        o = sh('gsk', 'video', text, '-m', MODEL, '--tier', TIER, '-r', '9:16', '-d', str(dur), '--audio_enable', 'true', '--video_size', '720p',
               '-o', mp4, '-i', *urls, '--reference_mode', 'true', timeout=2400)
        open(f'{sdir}/{segid}.log', 'w').write(text + '\n---\n' + (o.stdout or '')[-3000:] + '\n---\n' + (o.stderr or '')[-1000:])
        if os.path.exists(mp4) and os.path.getsize(mp4) > 100000:
            log(sid, segid, 'OK', f'{time.time() - t0:.0f}s')
            return segid, 'ok', dur
        err = (re.search(r'"(?:failure_reason|error_code|message)"\s*:\s*"([^"]{3,200})"', o.stdout or '') or [None, (o.stderr or o.stdout or '')[-200:]])[1]
        if re.search(r'"status"\s*:\s*"(PENDING|PROCESSING|RUNNING)"', o.stdout or ''):
            log(sid, segid, 'still pending on server — not resubmitting'); return segid, 'pending', 0
        log(sid, segid, 'FAIL', attempt, err)
        time.sleep(20)
    return segid, 'fail:' + str(err), 0

def frames(sdir, segid):
    mp4 = f'{sdir}/{segid}.mp4'
    for name, args in ((f'{segid}.webp', ['-ss', '0.3']), (f'{segid}_last.webp', ['-sseof', '-0.15'])):
        p = f'{sdir}/{name}'
        if not os.path.exists(p): sh('ffmpeg', '-loglevel', 'error', '-y', *args, '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '80', p)

def r2put(key, path, ctype):
    o = sh('npx', 'wrangler', 'r2', 'object', 'put', f'webapp-media/{key}', '--file', path, '--content-type', ctype, '--local', cwd=ROOT, timeout=300)
    if o.returncode: raise RuntimeError('r2 put failed ' + key + (o.stderr or '')[-200:])

def publish(d, sid, sdir):
    for segid, seg in d['segments'].items():
        frames(sdir, segid)
        r2put(f'{sid}/{segid}.mp4', f'{sdir}/{segid}.mp4', 'video/mp4')
        r2put(f'{sid}/img/{segid}.webp', f'{sdir}/{segid}.webp', 'image/webp')
        seg['video_url'] = f'/m/{sid}/{segid}.mp4'
        seg['poster'] = f'/gimg/{sid}/{segid}.webp'
        seg['dur'] = float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{sdir}/{segid}.mp4').stdout.strip() or seg['dur'])
    body = json.dumps({'data': d, 'status': 'live', 'cover': f"/gimg/{sid}/{d['main'][0]}.webp"}).encode()
    req = urllib.request.Request('http://localhost:3000/api/admin/thrill/series', data=body, headers={'content-type': 'application/json'})
    log(sid, 'PUBLISHED', urllib.request.urlopen(req, timeout=60).read().decode()[:200])

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    force, pub_only = '--force' in sys.argv, '--publish-only' in sys.argv
    plan = []
    for sid in args:
        d = script(sid); sdir = f'{OUT}/{sid}'; os.makedirs(sdir, exist_ok=True)
        refs = ensure_refs(d, sdir)
        plan.append((d, sid, sdir, refs))
    if not pub_only:
        jobs = [(d, sid, k, s, refs, sdir) for d, sid, sdir, refs in plan for k, s in d['segments'].items() if not only or k in only]
        log('render', len(jobs), 'segments, concurrency', CONC)
        res = {}
        with cf.ThreadPoolExecutor(CONC) as ex:
            for f in cf.as_completed([ex.submit(render, d, sid, k, s, refs, sdir, force) for d, sid, k, s, refs, sdir in jobs]):
                k, st, dur = f.result(); res[k] = st
        bad = {k: v for k, v in res.items() if v not in ('ok', 'skip')}
        log('render done', len(res), 'bad', bad)
        json.dump(res, open(f'{OUT}/last_run.json', 'w'), indent=1, ensure_ascii=False)
    if only: return
    for d, sid, sdir, refs in plan:
        missing = [k for k in d['segments'] if not os.path.exists(f'{sdir}/{k}.mp4')]
        if missing: log(sid, 'NOT PUBLISHED, missing', missing); continue
        publish(d, sid, sdir)

if __name__ == '__main__': main()
