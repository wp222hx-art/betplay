#!/usr/bin/env python3
# 逐个揭晓 · 淘汰赛 · 通用生产管线（6 部剧共用）
#   refs   : 每部 8 人定妆照 + 场景图
#   stills : 每人 A（判定前）/ B（出局后）同机位首尾帧；开场 / 每轮仪式 / 胜者首帧
#   render : out{i}（A→B 首尾帧）· safe{i}（A→A）· intro · ritual · win{i}
#   publish: 本地 R2 + 媒体清单 /api/admin/gauntlet/:sid/media
# 用法：python3 scripts/thrill/gauntlet_produce.py <sid|all> refs|stills|render|publish [--only=a,b] [--force]
import json, os, re, subprocess, sys, time, concurrent.futures as cf, urllib.request

ROOT = '/home/user/webapp'
ARCH = '/home/user/webapp_media_archive/gauntlet'
MODEL = 'fal-ai/bytedance/seedance-2.0'
CONC = int(os.environ.get('G_CONC', '8'))

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(*a, timeout=1800, cwd=None): return subprocess.run(a, capture_output=True, text=True, timeout=timeout, cwd=cwd)
def url_of(out): m = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', out or ''); return m.group(0) if m else None
def upload(path): return url_of(sh('gsk', 'upload', path).stdout)

DARK = ('Photorealistic live-action thriller film still, shot on ARRI Alexa Mini, natural skin texture with pores and sweat, no makeup look, no beauty filter, no CGI, '
        'harsh motivated practical light, deep shadows, desaturated cold grade, 35mm film grain, East Asian cast, unbearable tension. ')
BRIGHT = ('Photorealistic live-action Chinese comedy film still, bright warm sitcom lighting, shot on ARRI Alexa 35mm, natural skin texture with pores, no beauty filter, no CGI, no cartoon, '
          'grounded realistic acting, East Asian cast. ')
PORTRAIT = 'Candid waist-up photograph of a real person, not a model, looking at camera, plain neutral background, soft daylight, Fujifilm X-T4 35mm, unretouched, true-to-life skin. Original character, not a celebrity. '
LOCK = 'Locked-off camera, no camera movement, no zoom. Every person keeps exactly the same face, hair and clothes throughout; nobody new enters the frame; no text, no subtitles. '
NOGORE = 'No blood, no injury, no gore. '

# ─────────── 6 部剧的制作配置 ───────────
# look：8 人外形；set：场景；A/B：判定前 / 出局后（同机位）；out/safe：动作；ritual：每轮仪式；intro / win
P = {}
P['g_elevator'] = dict(style=DARK, looks=[
    'Chinese woman, 28, tired office worker, low ponytail with loose strands, white shirt, charcoal blazer, blue ID lanyard',
    'Chinese man, 58, building security guard, grey crew cut, navy uniform, walkie-talkie on belt',
    'Chinese man, 30, delivery rider, yellow delivery jacket, helmet hooked on his arm',
    'Chinese woman, 24, young intern, round glasses, beige cardigan, holding a takeaway coffee',
    'Chinese man, 35, thin programmer, black-rimmed glasses, grey hoodie, laptop bag',
    'Chinese man, 42, heavy-set salesman, loosened red tie, sweaty white shirt',
    'Chinese woman, 55, office cleaning lady, blue cleaner uniform, rubber gloves, hair in a hairnet',
    'Chinese man, 35, lean, faded black baseball cap pulled low, dark grey work jacket, thin scar through left eyebrow'],
  set='A large old freight elevator car at night: scratched brushed-steel walls, a steel handrail running along the back wall at waist height, a red digital floor indicator above the closed doors, a flickering fluorescent ceiling panel, dim red emergency light.',
  A='Medium-wide shot inside the elevator, camera at chest height, locked off. In the centre of the frame: the person from image 1, exactly their face, full figure from head to shoes, standing with both hands gripping the steel handrail, braced, terrified, looking up. The steel floor fills the lower third of the frame. Red emergency light. One person in focus; the dark shoulders of others at the frame edges.',
  B='Exactly the same image, same camera, same light. Change only this: the person has been thrown off their feet and now lies sprawled on the steel floor along the bottom of the frame, dazed, one hand still reaching up toward the handrail, face visible. ' + NOGORE,
  out='The elevator suddenly drops and slams to a violent stop: the whole frame jolts hard, sparks flicker outside the door gap. The person loses their grip on the handrail, is thrown off their feet and lands sprawled on the steel floor along the bottom of the frame, and stays there, dazed. ' + NOGORE,
  safe='The elevator suddenly drops and slams to a violent stop: the whole frame jolts hard, sparks flicker outside the door gap. The person is jerked violently but clings to the handrail with both hands, knees buckling, and stays on their feet, panting, eyes wide.',
  ritual='Close-up of the red digital floor indicator above the elevator doors: the number flickers and drops one floor; the steel cable screams, sparks fly past the door gap, the fluorescent light stutters. Deep metallic groaning, a heartbeat.',
  intro='Wide shot inside the elevator: eight exhausted office workers stand packed in, the doors close, the floor indicator reads 23. A deafening bang of a snapping steel cable — the car lurches, everyone grabs the handrail, the light switches to red emergency light.',
  win='Medium shot: the person from image 1 alone, still gripping the handrail in the stopped elevator; the doors are forced open behind them and a firefighter\'s flashlight beam floods in. The person sinks down, shaking with relief.')
P['g_hostage'] = dict(style=DARK, looks=[
    'Chinese woman, 24, bank teller, dark blue bank uniform vest with name badge, hair in a loose bun, tear-streaked',
    'Chinese man, 50, wealthy businessman, expensive navy suit, gold watch, sweating',
    'Chinese woman, 30, pregnant, loose floral maternity dress, hand on her belly',
    'Chinese man, 26, delivery rider, blue delivery jacket, helmet strap around his neck',
    'Chinese woman, 20, university student, denim jacket, backpack, ponytail',
    'Chinese man, 45, bank security guard, black uniform, empty holster',
    'Chinese woman, 72, elderly lady, knitted grey cardigan, white permed hair',
    'Chinese man, 32, programmer, plaid shirt, black-rimmed glasses'],
  set='Inside a small bank lobby during a robbery: marble floor, a long service counter, overturned queue stanchions, harsh fluorescent light, blinds closed, a black cloth bag held up by a masked robber in a dark hoodie.',
  A='Medium shot in the bank lobby, camera at chest height, locked off. The person from image 1, exactly their face, kneels in the centre of the frame on the marble floor, reaching one trembling hand up into a black cloth bag held out by a masked robber in a dark hoodie whose face is never visible (only his gloved hand and the bag at the frame edge). Fluorescent light.',
  B='Exactly the same image, same camera, same light, same robber\'s gloved hand at the frame edge. Change only this: the person holds up a small black ball in their open palm, staring at it in horror, shoulders collapsing.',
  out='The person slowly draws their hand out of the black cloth bag and opens their fingers: a small black ball. Their face drains, they stare at it in horror; the robber\'s gloved hand points sharply to the wall.',
  safe='The person slowly draws their hand out of the black cloth bag and opens their fingers: a small white ball. They gasp, squeeze their eyes shut, and clutch the white ball to their chest, trembling with relief.',
  ritual='Insert close-up: a gloved hand drops one more small black ball into the black cloth bag and shakes it; the balls clack together inside. Ticking wall clock, a distant police siren.',
  intro='Wide shot of the bank lobby: eight hostages kneel in a line on the marble floor; a masked robber in a dark hoodie walks along them holding up a black cloth bag and shakes it — balls clack inside. Police lights flash through the closed blinds.',
  win='Medium shot: the person from image 1 walks out through the bank\'s glass doors into flashing police lights, hands raised, and is pulled into the arms of an officer.')
P['g_lasthand'] = dict(style=DARK, looks=[
    'Chinese man, 46, indebted gambler, rumpled sweat-stained white shirt, receding hairline, nervous eyes',
    'Chinese man, 52, loan shark, shaved head, scar across right cheek, gold chain over black silk shirt',
    'Chinese man, 28, flashy young gambler, bleached hair, leather jacket',
    'Chinese woman, 40, mahjong-parlour boss lady, red qipao-style blouse, heavy gold bracelets',
    'Chinese man, 55, old-timer gambler, slicked grey hair, gold front tooth',
    'Chinese man, 20, broke college student, hoodie, dark circles',
    'Chinese man, 38, fat businessman, tight striped shirt, sweating heavily',
    'Chinese man, 25, dealer\'s younger brother, thin, black vest, slicked hair'],
  set='An underground card room: one hanging lamp over a green felt table, cigarette smoke, chips stacked, darkness beyond the light, a dealer\'s hands with a deck.',
  A='Medium shot across the green felt table, camera at chest height, locked off. The person from image 1, exactly their face, sits in the centre of the frame under the hanging lamp, one hand resting on a face-down playing card in front of them, a stack of chips beside it. Cigarette smoke.',
  B='Exactly the same image, same camera, same light. Change only this: the person\'s card is face up showing a low card, their chair is pushed back, they stand up stiffly from the table with both hands raised, defeated; their chips are gone.',
  out='The person flips their card face up: a low card. A beat of silence. Their face falls; a dealer\'s hand sweeps their chips away; they push back their chair and stand up from the table, hands raised, defeated.',
  safe='The person flips their card face up: a high card. They exhale hard, slap the table once, and pull their chips closer, staying in their seat, sweating.',
  ritual='Insert close-up from above: the dealer\'s precise hands flip one threshold card face up in the centre of the green felt under the lamp; the card is higher than the last one. Cigar smoke drifts.',
  intro='Wide top-down then low angle: eight gamblers sit around a green felt table under a single hanging lamp; the dealer fans a deck and deals one face-down card to each of them with crisp flicks.',
  win='Medium shot: the person from image 1 alone at the table under the lamp, pulling an enormous pile of chips toward themselves, laughing and crying at the same time.')
P['g_slacker'] = dict(style=BRIGHT, looks=[
    'Chinese man, 27, office worker, white shirt, lanyard, messy hair',
    'Chinese woman, 25, office worker, pink sweater, hair clip',
    'Chinese man, 45, veteran employee, balding, cardigan over shirt',
    'Chinese woman, 21, intern, oversized hoodie, earbuds',
    'Chinese man, 33, big guy, polo shirt, snacks on desk',
    'Chinese woman, 38, finance lady, glasses on a chain, neat blouse',
    'Chinese man, 29, programmer, plaid shirt, headphones around neck',
    'Chinese woman, 23, receptionist, neat uniform, bright lipstick'],
  set='A bright open-plan office on a Friday afternoon: rows of white desks with monitors, potted plants, glass meeting room, a strict middle-aged boss in a dark suit holding a thermos cup.',
  A='Medium shot at an office desk, camera at desk height, locked off. The person from image 1, exactly their face, sits in the centre of the frame grinning at their phone held under the desk, a computer monitor beside them; in the background a strict middle-aged boss in a dark suit holding a thermos cup approaches along the aisle. Bright office light.',
  B='Exactly the same image, same camera, same light. Change only this: the strict boss now stands right beside the desk glaring down, holding the person\'s phone up between two fingers; the person sits frozen, mortified, hands up.',
  out='The boss walks up behind them; the person is too slow — the phone slips from their hands and clatters on the desk, a loud game sound plays. They freeze, mortified, as the boss picks up the phone and glares down.',
  safe='The boss walks up behind them; at the last second the person slides the phone away and is suddenly typing furiously at the keyboard with a serious face. The boss looks, nods, and walks past. The person exhales.',
  ritual='Close-up of polished leather shoes and a thermos cup: the strict boss starts another lap down the office aisle, walking faster than before; a clock on the wall ticks to 4:30.',
  intro='Wide shot of the open-plan office: eight employees all secretly slacking — phones under desks, online shopping, napping; the strict boss steps out of his glass office with a thermos cup and begins to patrol.',
  win='Medium shot: the person from image 1 still at their desk as the office clock hits 6:00; they stretch, grin, and switch off the monitor while everyone else\'s desk is empty.')
P['g_parking'] = dict(style=BRIGHT, looks=[
    'Chinese man, 35, tall lanky, rubbery expressive face, neat side-parted hair, slightly too-small grey tweed suit, thin red tie',
    'Chinese man, 50, overconfident dad, rimless glasses, light blue polo shirt',
    'Chinese woman, 23, nervous new driver, ponytail, "new driver" sticker energy, pink cardigan',
    'Chinese man, 48, taxi driver, short-sleeve white shirt, toothpick, sunglasses',
    'Chinese man, 30, arrogant CEO, slicked hair, black three-piece suit',
    'Chinese woman, 58, square-dancing auntie, bright red tracksuit, sun visor',
    'Chinese man, 26, food delivery rider, yellow jacket, helmet',
    'Chinese man, 40, designated driver, black vest, folding scooter'],
  set='A bright underground shopping-mall car park: one very tight empty parking bay between a thick concrete pillar and a glossy black sedan, orange traffic cones, a security guard waving.',
  A='Medium-wide shot in the car park, camera at chest height, locked off. A small car is reversing into the tight parking bay between the concrete pillar and the glossy black sedan; the person from image 1, exactly their face, leans out of the open driver window looking back, concentrating hard. The floor is visible.',
  B='Exactly the same image, same camera, same light. Change only this: the car\'s rear corner is touching the concrete pillar, a little puff of dust, and the person in the driver window has both hands over their face in despair.',
  out='The car reverses slowly into the bay; the person concentrates — then crunch, the rear corner kisses the concrete pillar. A puff of dust. The person freezes, then slowly covers their face with both hands.',
  safe='The car reverses slowly into the bay with millimetres to spare on both sides and stops perfectly. The person leans back in the seat, exhales, and gives a tiny proud fist pump.',
  ritual='Close-up: a security guard\'s hand moves an orange traffic cone ten centimetres closer into the parking bay, making it even narrower; he looks into the camera and shrugs.',
  intro='Wide shot of the car park: eight different cars queue in a line in front of one very tight empty bay between a pillar and a black sedan; the security guard blows his whistle and waves the first car in.',
  win='Medium shot: the person from image 1 steps out of their perfectly parked car, straightens their clothes and bows to the applauding queue of other drivers.')
P['g_ceo'] = dict(style=BRIGHT, looks=[
    'Chinese woman, 26, glamorous heiress, white designer dress, pearl necklace',
    'Chinese woman, 62, loud auntie, flowery blouse, permed hair',
    'Chinese man, 25, food delivery rider still in yellow jacket, holding a bouquet',
    'Chinese woman, 33, his ex-wife, sharp black suit, arms crossed',
    'Chinese man, 30, muscular fitness coach, tight black T-shirt',
    'Chinese woman, 28, executive secretary, glasses, tablet',
    'Chinese woman, 55, hotel cleaning lady, uniform, mop',
    'Chinese man, 50, neighbour Old Wang, vest and slippers'],
  set='A glamorous rooftop banquet hall at night: chandeliers, rose petals on the floor, city skyline, a handsome arrogant CEO in a black tuxedo holding a ring box.',
  A='Medium shot in the banquet hall, camera at chest height, locked off. The person from image 1, exactly their face, kneels on one knee in the centre of the frame on rose petals, looking up hopefully and holding out a small ring box; at the frame edge only the arm and black tuxedo sleeve of a CEO standing over them. Warm chandelier light.',
  B='Exactly the same image, same camera, same light, same tuxedo sleeve at the edge. Change only this: the person has slumped down sitting on the rose petals, the ring box closed in their lap, sulking dramatically.',
  out='The CEO\'s hand rises in a cold little "next" gesture. The person\'s hopeful smile collapses; they slump down onto the rose petals, sulking dramatically, closing the ring box.',
  safe='The CEO\'s hand takes the ring box and gives a curt nod. The person beams, clasps their hands to their chest and stays kneeling, glowing with joy.',
  ritual='Close-up: the CEO opens a ring box, frowns, and swaps it for an even smaller ring box; a string quartet plays a tense note.',
  intro='Wide shot of the rooftop banquet hall: eight very different suitors kneel in a row on rose petals; the arrogant CEO in a black tuxedo strides in and starts walking along the line.',
  win='Medium shot: the person from image 1 alone on the rose petals as the CEO kneels down in front of them with the last ring; confetti falls, the person laughs in disbelief.')

GAMES = list(P.keys())
def d(sid): p = f'{ARCH}/{sid}'; os.makedirs(p, exist_ok=True); return p
def refs(sid): f = f'{d(sid)}/refs.json'; return json.load(open(f)) if os.path.exists(f) else {}
def save_ref(sid, k, u):
    f = f'{d(sid)}/refs.json'; r = refs(sid); r[k] = u; json.dump(r, open(f, 'w'), indent=1)
def img(sid, key, prompt, ratio='1:1', ref_keys=None, force=False):
    out = f'{d(sid)}/{key}.png'
    if os.path.exists(out) and refs(sid).get(key) and not force: return key, 'skip'
    if force and os.path.exists(out): os.remove(out)
    args = ['gsk', 'img', '-m', 'nano-banana-2.1', '-r', ratio, '-o', out, prompt]
    if ref_keys: args += ['-i', *[refs(sid)[k] for k in ref_keys]]
    o = sh(*args, timeout=600)
    if not os.path.exists(out): return key, 'FAIL ' + ((re.search(r'"(?:failure_reason|message|error_code)"\s*:\s*"([^"]+)"', o.stdout or '') or [None, (o.stderr or o.stdout)[-200:]])[1])
    save_ref(sid, key, upload(out)); return key, 'ok'

def jobs_refs(sid):
    c = P[sid]; J = [(f'p{i + 1}', PORTRAIT + l + '.', '3:4', None) for i, l in enumerate(c['looks'])]
    J.append(('set', 'Unretouched wide photograph, no people. ' + c['set'] + ' Realistic, no CGI.', '1:1', None)); return J
def jobs_stills_A(sid):
    c = P[sid]; J = [(f'a{i}', c['style'] + c['A'] + ' The person is image 1; the location is image 2.', '1:1', [f'p{i}', 'set']) for i in range(1, 9)]
    J.append(('intro0', c['style'] + c['intro'] + ' The eight people are the people from images 1 to 8, one each, exactly their faces; the location is image 9.', '1:1', [f'p{i}' for i in range(1, 9)] + ['set']))
    J.append(('rit0', c['style'] + c['ritual'] + ' The location is image 1. No faces.', '1:1', ['set']))
    return J
def jobs_stills_B(sid):
    c = P[sid]; J = [(f'b{i}', c['style'] + c['B'], '1:1', [f'a{i}']) for i in range(1, 9)]
    J += [(f'w{i}', c['style'] + c['win'] + ' The person is image 1, exactly their face; the location is image 2.', '1:1', [f'p{i}', 'set']) for i in range(1, 9)]
    return J
def run_img(sid, J, force=False):
    with cf.ThreadPoolExecutor(6) as ex:
        for k, st in ex.map(lambda j: img(sid, j[0], j[1], j[2], j[3], force), J): log(sid, k, st)

def clips(sid):
    c = P[sid]; C = {}
    for i in range(1, 9):
        C[f'out{i}'] = dict(dur=4, frames=[f'a{i}', f'b{i}'], text=LOCK + c['out'])
        C[f'safe{i}'] = dict(dur=4, frames=[f'a{i}', f'a{i}'], text=LOCK + c['safe'])
        C[f'win{i}'] = dict(dur=5, frames=[f'w{i}'], text=LOCK.replace('Locked-off camera, no camera movement, no zoom', 'Slow push-in') + c['win'])
    C['intro'] = dict(dur=8, frames=['intro0'], text='Keep every person exactly as in the first frame. ' + c['intro'])
    C['ritual'] = dict(dur=5, frames=['rit0'], text=LOCK + c['ritual'])
    return C
def render(sid, key, cl, force=False):
    mp4 = f'{d(sid)}/{key}.mp4'
    if os.path.exists(mp4) and os.path.getsize(mp4) > 100000 and not force: return key, 'skip'
    r = refs(sid)
    if any(f not in r for f in cl['frames']): return key, 'missing frame'
    args = ['gsk', 'video', cl['text'] + ' ' + P[sid]['style'] + 'No dialogue.', '-m', MODEL, '--tier', 'standard', '-r', '1:1', '-d', str(cl['dur']), '--audio_enable', 'true', '--video_size', '720p', '-o', mp4, '-i', *[r[f] for f in cl['frames']]]
    err = ''
    for attempt in range(2):
        t0 = time.time(); o = sh(*args, timeout=2400)
        open(f'{d(sid)}/{key}.log', 'w').write((o.stdout or '')[-2000:] + '\n---\n' + (o.stderr or '')[-500:])
        if os.path.exists(mp4) and os.path.getsize(mp4) > 100000: log(sid, key, 'OK', f'{time.time() - t0:.0f}s'); return key, 'ok'
        err = (re.search(r'"(?:failure_reason|error_code|message)"\s*:\s*"([^"]{3,200})"', o.stdout or '') or [None, (o.stderr or o.stdout or '')[-200:]])[1]
        log(sid, key, 'FAIL', attempt, err); time.sleep(15)
    return key, 'fail: ' + str(err)
def phase_render(sids, only=None, force=False):
    J = [(s, k, cl) for s in sids for k, cl in clips(s).items() if not only or k in only]
    log('render', len(J), 'clips, conc', CONC); bad = {}
    with cf.ThreadPoolExecutor(CONC) as ex:
        for (s, k, _), (kk, st) in zip(J, ex.map(lambda j: render(j[0], j[1], j[2], force), J)):
            if st not in ('ok', 'skip'): bad[f'{s}:{k}'] = st
    log('render done bad', bad)

def r2put(key, path, ctype):
    o = sh('npx', 'wrangler', 'r2', 'object', 'put', f'webapp-media/{key}', '--file', path, '--content-type', ctype, '--local', cwd=ROOT, timeout=300)
    if o.returncode: raise RuntimeError('r2 put failed ' + key)
def phase_publish(sid):
    man = {}
    for k in clips(sid):
        mp4 = f'{d(sid)}/{k}.mp4'
        if not os.path.exists(mp4): log(sid, 'missing', k); continue
        r2put(f'{sid}/{k}.mp4', mp4, 'video/mp4')
        man[k] = float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4).stdout.strip() or 4)
    for i in range(1, 9):
        p = f'{d(sid)}/p{i}.png'
        if os.path.exists(p): w = f'{d(sid)}/p{i}.webp'; sh('ffmpeg', '-loglevel', 'error', '-y', '-i', p, '-vf', 'crop=iw:iw:0:0,scale=200:-2', '-q:v', '82', w); r2put(f'{sid}/img/p{i}.webp', w, 'image/webp')
    cov = f'{d(sid)}/intro0.png'
    if os.path.exists(cov): sh('ffmpeg', '-loglevel', 'error', '-y', '-i', cov, '-vf', 'scale=720:-2', '-q:v', '80', f'{d(sid)}/cover.webp'); r2put(f'{sid}/img/cover.webp', f'{d(sid)}/cover.webp', 'image/webp')
    req = urllib.request.Request(f'http://localhost:3000/api/admin/gauntlet/{sid}/media', data=json.dumps({'clips': man}).encode(), headers={'content-type': 'application/json'})
    log(sid, 'PUBLISHED', urllib.request.urlopen(req, timeout=60).read().decode()[:200])

if __name__ == '__main__':
    tgt, ph = sys.argv[1], sys.argv[2]
    sids = GAMES if tgt == 'all' else tgt.split(',')
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    force = '--force' in sys.argv
    if ph == 'render': phase_render(sids, only, force); sys.exit()
    with cf.ThreadPoolExecutor(len(sids)) as ex:
        def one(s):
            if ph == 'refs': run_img(s, [j for j in jobs_refs(s) if not only or j[0] in only], force)
            elif ph == 'stillsA': run_img(s, [j for j in jobs_stills_A(s) if not only or j[0] in only], force)
            elif ph == 'stillsB': run_img(s, [j for j in jobs_stills_B(s) if not only or j[0] in only], force)
            elif ph == 'publish': phase_publish(s)
        list(ex.map(one, sids))
