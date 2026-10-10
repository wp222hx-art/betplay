#!/usr/bin/env python3
# 致命13 · 真人片生产管线（gsk nano-banana-2.1 定妆 / 场景 / 人数首帧 → Seedance 2.0 → R2 → 媒体清单上架）
# 模块化拍法：每局结果随机，前端按结果实时拼接
#   intro 1 · load_a/b/c 3（黑暗上弹，无脸，任意轮复用）· fire_N 12（N=13..2，灯亮齐射，首帧=人数站位图）
#   death_i 13（第 i 号中枪倒下，不拍血腥）· winner_i 13（第 i 号最后幸存）· void 1（狱警吹哨作废）
# 用法：python3 scripts/thrill/l13_produce.py refs | plates | test | render [--only=a,b] | publish
import json, os, re, subprocess, sys, time, concurrent.futures as cf, urllib.request

ROOT = '/home/user/webapp'
OUT = '/home/user/webapp_media_archive/thrill/l13'
SID = 'l13_deadly13'
MODEL = 'fal-ai/bytedance/seedance-2.0'
RATIO = '1:1'
CONC = int(os.environ.get('THRILL_CONC', '8'))
os.makedirs(OUT, exist_ok=True)

REAL = ('High-contrast black-and-white 35mm film in the style of 13 Tzameti, deep blacks, blown highlights from a single bare bulb. Photorealistic live-action prison film, shot on ARRI Alexa Mini, natural skin texture with visible pores, sweat and grime, no makeup, '
        'no beauty filter, no CGI sheen, no waxy skin, 35mm film grain, harsh single overhead practical light, deep shadows, cold green-grey grade, '
        'handheld documentary realism, unbearable tension. No blood, no gore. Consistent characters exactly as in the reference images.')
UNIFORM = 'faded grey prison uniform with a sewn white chest patch printed with the number {n} in black'
SET = ('An underground prison basement at night: bare stained concrete walls, rusty overhead pipes, a floor drain, a large white circle painted on the '
       'concrete floor, a single caged industrial bulb hanging low in the centre on a chain, everything beyond the light falls into darkness')
PRISONERS = [
    ('老鬼', 'Chinese man, 62, gaunt, deep wrinkles, grey stubble, sunken eyes, shaved grey head'),
    ('刀疤', 'Chinese man, 44, muscular, shaved head, a long pale scar across his left cheek, hard stare'),
    ('眼镜', 'Chinese man, 33, thin, black-rimmed glasses with one lens cracked and taped, nervous eyes'),
    ('小四', 'Chinese man, 19, skinny, buzz cut, acne on cheeks, frightened boyish face'),
    ('和尚', 'Chinese man, 46, heavy-set, completely bald, calm half-closed eyes, prayer-bead tattoo around his wrist'),
    ('阿彪', 'Chinese man, 35, bodybuilder build, crew cut, a tiger tattoo on the side of his neck'),
    ('哑巴', 'Chinese man, 37, lean, an old burn scar across his throat, hollow silent stare'),
    ('老K', 'Chinese man, 55, grey hair slicked back, one gold front tooth, cunning narrow eyes'),
    ('黑皮', 'Chinese man, 31, very dark sun-tanned skin, broken crooked nose, labourer hands'),
    ('书生', 'Chinese man, 28, pale, delicate features, neat side-parted hair, scholarly look'),
    ('二愣', 'Chinese man, 25, big round face, large ears, slightly crossed eyes, simple expression'),
    ('胖虎', 'Chinese man, 41, obese, double chin, buzz cut, sweating heavily'),
    ('阿森', 'Chinese man, 22, poor young migrant construction worker, thin, short messy black hair, plaster dust on his hands, frightened innocent eyes'),
]
GUARD = 'Chinese man, 55, master of ceremonies, dark three-piece suit, slicked-back grey hair, holding a black walking cane, cold flat face'

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(*a, timeout=1800, cwd=None): return subprocess.run(a, capture_output=True, text=True, timeout=timeout, cwd=cwd)
def url_of(out): m = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', out or ''); return m.group(0) if m else None
def upload(path): return url_of(sh('gsk', 'upload', path).stdout)
REFS_F = f'{OUT}/refs.json'
def refs(): return json.load(open(REFS_F)) if os.path.exists(REFS_F) else {}
def save_ref(k, u): r = refs(); r[k] = u; json.dump(r, open(REFS_F, 'w'), indent=1)

def img(key, prompt, ratio='3:4', ref_urls=None):
    out = f'{OUT}/{key}.png'
    if os.path.exists(out) and refs().get(key): return key, 'skip'
    args = ['gsk', 'img', '-m', 'nano-banana-2.1', '-r', ratio, '-o', out, prompt]
    if ref_urls: args += ['-i', *ref_urls]
    o = sh(*args, timeout=600)
    if not os.path.exists(out): return key, 'FAIL ' + ((re.search(r'"(?:failure_reason|message|error_code)"\s*:\s*"([^"]+)"', o.stdout or '') or [None, (o.stderr or o.stdout)[-200:]])[1])
    save_ref(key, upload(out)); return key, 'ok'

def portrait(n, name, look):
    return (f'Candid photograph, real person, not a model. {look}, wearing a {UNIFORM.format(n=n)}. Standing against a stained concrete prison wall '
            f'under a single harsh overhead bulb, looking at camera, exhausted guarded expression. Shot on Fujifilm X-T4 35mm f/2, ISO 3200 grain, '
            f'unretouched documentary photo, true-to-life skin with pores, scars and blemishes, no beauty filter, no CGI.')

def phase_refs():
    jobs = [(f'p{i + 1}', portrait(i + 1, n, l)) for i, (n, l) in enumerate(PRISONERS)]
    jobs.append(('guard', f'Candid photograph, real person. {GUARD}. Standing in a dim concrete prison corridor under a caged bulb, looking at camera. Shot on Fujifilm X-T4, ISO 3200 grain, unretouched, no CGI.'))
    with cf.ThreadPoolExecutor(6) as ex:
        for k, st in ex.map(lambda j: img(j[0], j[1]), jobs): log('ref', k, st)
    log('set', *img('set', f'Unretouched documentary photograph, no people. {SET}. Shot from a high corner angle, Fujifilm X-T4 16mm, ISO 3200 grain, realistic, no CGI.', '1:1'))

def plate_prompt(n):
    return (f'High-angle cinematic film still from a Chinese prison thriller. {SET}. Exactly {n} Chinese prisoners (East Asian men of different ages, '
            f'shaved or buzz-cut heads) in faded grey prison uniforms with white numbered chest patches stand evenly spaced around the white circle, all facing clockwise, '
            f'each holding an old black revolver raised at shoulder height aimed forward at the man ahead of him, tense frozen silence, faces half in shadow. '
            f'Photorealistic, 35mm film grain, cold green-grey grade, no blood.')
def phase_plates():
    r = refs()
    with cf.ThreadPoolExecutor(6) as ex:
        for k, st in ex.map(lambda n: img(f'plate{n}', plate_prompt(n), '1:1', [r['set']]), range(13, 1, -1)): log('plate', k, st)

# ─────────── 视频清单 ───────────
def clips():
    C = {}
    C['intro'] = dict(dur=8, refs=['guard', 'plate13', 'set'], text=(
        '@Image1 is the prison guard, @Image2 shows the thirteen prisoners standing in the ring, @Image3 is the basement. Slow handheld push-in: '
        'the guard walks slowly around the outside of the silent circle of thirteen prisoners, each holding a revolver raised and aimed at the man ahead of him. '
        'He stops under the swinging caged bulb and speaks in a low flat voice in Mandarin Chinese: "规矩只有一条——最后站着的人，明天出去。" '
        'Drip of water, distant metal door, a heartbeat building.'))
    for v, d in (('a', 'Extreme close-up: trembling dirty fingers push a single brass bullet into an empty chamber of a revolver cylinder, then snap the cylinder shut.'),
                 ('b', 'Extreme close-up: a revolver cylinder is spun hard by a thumb, ratcheting whir, it slows and stops; then a hammer is pulled back with a sharp click.'),
                 ('c', 'Slow pan along a dark ring of silhouetted hands each gripping a raised revolver; sweat drips; all hammers are cocked in perfect unison — one collective click.')):
        C[f'load_{v}'] = dict(dur=5, refs=['set'], text=f'@Image1 is the basement, now pitch black except a thin red emergency glow. {d} Heavy breathing, a fast heartbeat, no dialogue.')
    for n in range(13, 1, -1):
        C[f'fire{n}'] = dict(dur=4, first=f'plate{n}', text=(
            f'The caged bulb slams on to full harsh brightness. The {n} prisoners standing in the ring all pull their triggers at the same instant: '
            'bright muzzle flashes on some revolvers, empty clicks on others, deafening overlapping gunshots, the camera jolts, gun smoke bursts. '
            'Hard cut on the flash. No blood, no gore.'))
    for i, (name, look) in enumerate(PRISONERS):
        n = i + 1
        C[f'death{n}'] = dict(dur=4, refs=[f'p{n}', 'set'], text=(
            f'@Image1 is prisoner number {n}, @Image2 is the basement. Tight close-up of him in the ring under the harsh caged bulb, eyes squeezed shut, '
            'sweat on his temple, the out-of-focus man behind him holds a raised revolver. A blinding flash and a gunshot from behind — '
            'his body goes limp and drops straight down out of frame. The camera holds on the empty space and drifting gun smoke. No blood, no wound, no gore.'))
        C[f'winner{n}'] = dict(dur=6, refs=[f'p{n}', 'set'], text=(
            f'@Image1 is prisoner number {n}, @Image2 is the basement. He is the last man standing on the painted white ring; around him motionless figures in grey '
            'uniforms lie in deep shadow on the concrete (no blood). The smoking revolver trembles in his hand, the caged bulb swings slowly overhead. '
            'He slowly drops to his knees, breathing raggedly, a broken laugh turns into a sob. Ringing silence.'))
    C['duel_intro'] = dict(dur=6, refs=['guard', 'set'], text=(
        '@Image1 is the master of ceremonies, @Image2 is the basement. Two men in grey uniforms stand face to face in the white circle under the single bulb, '
        'each holding a revolver aimed at the other\'s chest, arms trembling. The master of ceremonies steps between them and says in Mandarin Chinese: "决斗。" '
        'Then steps back into darkness. Silence, dripping water.'))
    C['duel_load'] = dict(dur=4, refs=['set'], text='@Image1 is the basement in darkness. Extreme close-up: two revolver cylinders spun side by side, two hammers cocked at the same instant. Ragged breathing, heartbeat.')
    C['duel_fire'] = dict(dur=4, refs=['set'], text='@Image1 is the basement. Wide shot: the bulb snaps on, two men face to face in the white circle fire at the same instant; one flash, one deafening shot; one man drops out of frame, the other stays standing, frozen. No blood.')
    C['duel_dry'] = dict(dur=4, refs=['set'], text='@Image1 is the basement. Wide shot: the bulb snaps on, two men face to face in the white circle pull their triggers — two dry metallic clicks, nothing happens. Both still standing, shaking, sweat pouring.')
    C['void'] = dict(dur=5, refs=['guard', 'plate6', 'set'], text=(
        '@Image1 is the prison guard, @Image2 shows prisoners in the ring, @Image3 is the basement. Just as the prisoners tense to fire, the guard steps into the light '
        'and strikes his cane on the concrete floor. Everyone freezes. He says coldly in Mandarin Chinese: "作废。重来。" The bulb cuts to black.'))
    return C

def render(key, c, force=False):
    mp4 = f'{OUT}/{key}.mp4'
    if os.path.exists(mp4) and os.path.getsize(mp4) > 100000 and not force: return key, 'skip'
    r = refs()
    args = ['gsk', 'video', f"{c['text']} {REAL}", '-m', MODEL, '--tier', 'standard', '-r', RATIO, '-d', str(c['dur']), '--audio_enable', 'true', '--video_size', '720p', '-o', mp4]
    if c.get('first'): args += ['-i', r[c['first']]]
    else: args += ['-i', *[r[k] for k in c['refs']], '--reference_mode', 'true']
    err = ''
    for attempt in range(2):
        t0 = time.time(); o = sh(*args, timeout=2400)
        open(f'{OUT}/{key}.log', 'w').write(' '.join(args[:3])[:3000] + '\n---\n' + (o.stdout or '')[-3000:] + '\n---\n' + (o.stderr or '')[-800:])
        if os.path.exists(mp4) and os.path.getsize(mp4) > 100000: log(key, 'OK', f'{time.time() - t0:.0f}s'); return key, 'ok'
        err = (re.search(r'"(?:failure_reason|error_code|message)"\s*:\s*"([^"]{3,200})"', o.stdout or '') or [None, (o.stderr or o.stdout or '')[-200:]])[1]
        if re.search(r'"status"\s*:\s*"(PENDING|PROCESSING|RUNNING)"', o.stdout or ''): log(key, 'pending on server — not resubmitting'); return key, 'pending'
        log(key, 'FAIL', attempt, err); time.sleep(20)
    return key, 'fail: ' + str(err)

def phase_render(only=None, force=False):
    C = clips(); keys = [k for k in C if not only or k in only]
    log('render', len(keys), 'clips, concurrency', CONC)
    res = {}
    with cf.ThreadPoolExecutor(CONC) as ex:
        for k, st in ex.map(lambda k: render(k, C[k], force), keys): res[k] = st
    bad = {k: v for k, v in res.items() if v not in ('ok', 'skip')}
    log('render done', len(res), 'bad', bad); json.dump(res, open(f'{OUT}/last_run.json', 'w'), indent=1, ensure_ascii=False)

def r2put(key, path, ctype):
    o = sh('npx', 'wrangler', 'r2', 'object', 'put', f'webapp-media/{key}', '--file', path, '--content-type', ctype, '--local', cwd=ROOT, timeout=300)
    if o.returncode: raise RuntimeError('r2 put failed ' + key + (o.stderr or '')[-200:])

def phase_publish():
    C = clips(); man = {}
    for k in C:
        mp4 = f'{OUT}/{k}.mp4'
        if not os.path.exists(mp4): log('missing', k); continue
        r2put(f'{SID}/{k}.mp4', mp4, 'video/mp4')
        man[k] = float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4).stdout.strip() or C[k]['dur'])
    for i in range(1, 14):
        p = f'{OUT}/p{i}.png'
        if os.path.exists(p):
            w = f'{OUT}/p{i}.webp'; sh('ffmpeg', '-loglevel', 'error', '-y', '-i', p, '-vf', 'crop=iw:iw*0.9:0:0,scale=200:-2', '-q:v', '82', w)
            r2put(f'{SID}/img/p{i}.webp', w, 'image/webp')
    if os.path.exists(f'{OUT}/plate13.png'):
        sh('ffmpeg', '-loglevel', 'error', '-y', '-i', f'{OUT}/plate13.png', '-vf', 'scale=720:-2', '-q:v', '80', f'{OUT}/cover.webp'); r2put(f'{SID}/img/cover.webp', f'{OUT}/cover.webp', 'image/webp')
    body = json.dumps({'clips': man}).encode()
    req = urllib.request.Request('http://localhost:3000/api/admin/l13/media', data=body, headers={'content-type': 'application/json'})
    log('PUBLISHED', urllib.request.urlopen(req, timeout=60).read().decode()[:300])

if __name__ == '__main__':
    ph = sys.argv[1]
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    if ph == 'refs': phase_refs()
    elif ph == 'plates': phase_plates()
    elif ph == 'test': phase_render(only or ['fire13', 'death4'], '--force' in sys.argv)
    elif ph == 'render': phase_render(only, '--force' in sys.argv)
    elif ph == 'publish': phase_publish()
