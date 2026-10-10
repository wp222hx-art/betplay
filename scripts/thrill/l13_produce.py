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
        'no beauty filter, no CGI sheen, no waxy skin, 35mm film grain, harsh single overhead practical light, deep shadows, monochrome silver-gelatin look, '
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
    return (f'High-angle high-contrast black-and-white film still from a 1970s crime drama. {SET}. Exactly {n} East Asian men of different ages '
            f'in faded grey work uniforms with white numbered chest patches stand in single file around the white circle, each turned sideways in profile, '
            f'each man\'s right arm extended forward holding an old revolver, so the line of arms and pistols makes one continuous ring. '
            f'Tense stillness, faces half in shadow, deep blacks, film grain, photorealistic.')
def phase_plates():
    r = refs()
    with cf.ThreadPoolExecutor(6) as ex:
        for k, st in ex.map(lambda n: img(f'plate{n}', plate_prompt(n), '1:1', [r['set']]), range(13, 1, -1)): log('plate', k, st)

# ─────────── v3：一致性首帧（每条视频都从「多参考定妆合成的首帧」起，杜绝换脸 / 重复脸 / 枪支幻觉） ───────────
BW = 'High-contrast black-and-white film still from a 1970s crime drama, deep blacks, single caged bulb, film grain, photorealistic, natural skin texture, no CGI. '
ONEGUN = 'Each man holds exactly one old revolver in his right hand only; no extra hands, no extra guns, no floating objects. '
FACE_ORDER = [13, 1, 5, 2, 8, 4, 11, 3, 9, 6, 12, 7, 10]
def plate_faces(n): return sorted(FACE_ORDER[:n])
def stills():
    S = {}
    for n in range(13, 1, -1):
        f = plate_faces(n)
        S[f'plate{n}'] = ([f'p{i}' for i in f] + ['set'], BW + f'High angle, in the basement of the last reference image. Exactly {n} men — the {n} different men from the first {n} reference images, one each, no duplicates, no look-alikes — '
            f'in faded grey work uniforms with small blank white chest patches stand in single file around the white circle, each turned sideways in profile, each man\'s right arm extended forward holding an old revolver, '
            f'so the line of arms and pistols makes one continuous ring. {ONEGUN}Tense stillness, faces half in shadow.')
    for i in range(1, 14):
        j = (i - 2) % 13 + 1  # 链上站在他身后的人（开枪者）
        S[f'ds{i}'] = ([f'p{i}', f'p{j}', 'set'], BW + 'Side-on profile close-up in a dark concrete basement. In the foreground, sharp focus: the man from image 1, exactly his face, in profile facing right, eyes squeezed shut, sweat on his temple, '
            'his right arm extended forward holding an old revolver. Behind him in soft focus: the man from image 2, a clearly different person, also in profile facing right, right arm extended forward holding an old revolver. '
            'Exactly two men. ' + ONEGUN)
        S[f'ws{i}'] = ([f'p{i}', 'set'], BW + f'The man from image 1, exactly his face, wearing his grey uniform with one single white chest patch printed {i}, stands alone inside the white circle painted on the floor of the basement from image 2, '
            'an old revolver hanging loosely in his right hand, exhausted and trembling. Around the circle several figures in grey uniforms lie motionless on the floor in deep shadow, faces turned away and not visible, no blood. '
            'He is the only person standing.')
    S['introS'] = (['guard', 'plate13', 'set'], BW + 'High angle. The man from image 1 — the master of ceremonies in a dark three-piece suit with a black walking cane — stands just outside the ring of men from image 2, '
        'who stand in single file in profile around the white circle, right arms extended forward holding revolvers. Keep every man in image 2 exactly as he is. ' + ONEGUN)
    S['voidS'] = (['guard', 'plate6', 'set'], BW + 'The master of ceremonies from image 1, in his three-piece suit, steps into the light at the edge of the white circle and raises his black cane, about to strike the floor. '
        'Behind him the men from image 2 stand frozen in single file in profile, right arms extended holding revolvers. ' + ONEGUN)
    S['duelS'] = (['set'], BW + 'Wide side view of the basement from the reference. Two men in grey work uniforms stand inside the white circle facing each other in profile at arm\'s length, '
        'each with his right arm extended toward the other holding one old revolver. Both are backlit by the single bulb between them, their faces fall into deep shadow — anonymous silhouettes. ' + ONEGUN)
    S['duelI'] = (['guard', 'duelS', 'set'], BW + 'Same scene as image 2, but the master of ceremonies from image 1 stands between the two silhouetted men, under the bulb, both hands on his black cane, looking at the camera. ' + ONEGUN)
    return S
def phase_stills(only=None):
    S = {k: v for k, v in stills().items() if not only or k in only}
    order = [k for k in S if not k.startswith('duelI')] + [k for k in S if k.startswith('duelI')]
    for k in order:  # plate13/duelS 先于依赖它们的合成
        pass
    first = [k for k in order if k not in ('introS', 'voidS', 'duelI')]
    def go(k): rr = refs(); return img(k, S[k][1], '1:1', [rr[x] for x in S[k][0]])
    with cf.ThreadPoolExecutor(6) as ex:
        for k, st in ex.map(go, first): log('still', k, st)
    for k in [k for k in ('introS', 'voidS', 'duelI') if k in S]: log('still', *go(k))

KEEP = ('Locked-off camera. Every person keeps exactly the same face, body and position throughout; nobody new enters the frame; ' + 'each man holds exactly one revolver in his right hand, no extra arms or guns appear. ')
def clips():
    C = {}
    C['intro'] = dict(dur=8, first='introS', text=KEEP.replace('Locked-off camera', 'Very slow push-in') + 'The master of ceremonies walks slowly along the outside of the ring, his cane tapping on the concrete, while the men stay frozen. '
        'He stops under the caged bulb and says in a low flat voice in Mandarin Chinese: "规矩只有一条——最后站着的人，明天出去。" Dripping water, a heartbeat building.')
    for v, d in (('a', 'Extreme close-up: trembling dirty fingers push a single brass bullet into an empty chamber of a revolver cylinder, then snap the cylinder shut.'),
                 ('b', 'Extreme close-up: a revolver cylinder is spun hard by a thumb, ratcheting whir, it slows and stops; then a hammer is pulled back with a sharp click.'),
                 ('c', 'Slow side-on dolly along a dark chain of silhouetted men in profile, each right arm extended forward holding a revolver, arm after arm in one line; sweat drips; all hammers are cocked in perfect unison — one collective click.')):
        C[f'load_{v}'] = dict(dur=5, refs=['set'], text=f'@Image1 is the basement, now pitch black except a thin red emergency glow. {d} Heavy breathing, a fast heartbeat, no dialogue.')
    for n in range(13, 1, -1):
        C[f'fire{n}'] = dict(dur=4, first=f'plate{n}', text=KEEP + f'The caged bulb flares to full harsh brightness. All {n} men pull their triggers at the same instant: bright muzzle flashes from some revolvers, dry clicks from others, '
            'deafening overlapping gunshots, gun smoke bursts, the camera jolts once. Hard cut on the flash. No blood, no gore.')
    for i in range(1, 14):
        C[f'death{i}'] = dict(dur=4, first=f'ds{i}', text=KEEP + 'Side-on close-up, the man in the foreground keeps his eyes shut, breathing hard. A blinding flash and a gunshot — his body goes limp and drops straight down out of frame; '
            'the man behind him stays in place; the camera holds on the empty space and drifting gun smoke. No blood, no wound, no gore.')
        C[f'winner{i}'] = dict(dur=6, first=f'ws{i}', text=KEEP.replace('Locked-off camera', 'Slow push-in') + 'He is the only one standing. His revolver slips from his fingers and clatters on the concrete; he sinks to his knees, ragged breathing, '
            'a broken laugh turns into a sob. The figures on the floor stay completely still, faces hidden. The bulb swings slowly. Ringing silence.')
    C['duel_intro'] = dict(dur=6, first='duelI', text=KEEP + 'The master of ceremonies says in Mandarin Chinese: "决斗。" then steps back out of the light into darkness, leaving the two silhouetted men facing each other, arms trembling. Dripping water.')
    C['duel_load'] = dict(dur=4, refs=['set'], text='@Image1 is the basement in darkness. Extreme close-up: two revolver cylinders spun side by side, two hammers cocked at the same instant. Ragged breathing, heartbeat.')
    C['duel_fire'] = dict(dur=4, first='duelS', text=KEEP + 'The bulb flares; both men pull their triggers at the same instant: one flash, one deafening shot; the man on the left goes limp and drops to the floor, the man on the right stays standing, frozen. No blood.')
    C['duel_dry'] = dict(dur=4, first='duelS', text=KEEP + 'The bulb flares; both men pull their triggers — two dry metallic clicks, nothing happens. Both remain standing, shaking, sweat pouring.')
    C['void'] = dict(dur=5, first='voidS', text=KEEP + 'He strikes his cane hard on the concrete floor — a sharp crack. Everyone freezes. He says coldly in Mandarin Chinese: "作废。重来。" The bulb cuts to black.')
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
    elif ph == 'stills': phase_stills(only)
    elif ph == 'test': phase_render(only or ['fire13', 'death4'], '--force' in sys.argv)
    elif ph == 'render': phase_render(only, '--force' in sys.argv)
    elif ph == 'publish': phase_publish()
