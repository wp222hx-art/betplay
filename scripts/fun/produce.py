#!/usr/bin/env python3
# 开心1分钟 · 三部恶搞真人短片生产管线（9:16 竖屏）
# 流程：定妆 refs → 每条片段的首帧 stills（多参考合成，锁脸锁站位）→ Seedance 2.0 图生视频 → R2 → 媒体清单
# 用法：python3 scripts/fun/produce.py <game|all> refs|stills|render|publish [--only=a,b] [--force]
import json, os, re, subprocess, sys, time, concurrent.futures as cf, urllib.request
ROOT = '/home/user/webapp'
ARCH = '/home/user/webapp_media_archive/fun'
MODEL = 'fal-ai/bytedance/seedance-2.0'
RATIO = '9:16'
CONC = int(os.environ.get('FUN_CONC', '10'))

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(*a, timeout=1800, cwd=None): return subprocess.run(a, capture_output=True, text=True, timeout=timeout, cwd=cwd)
def url_of(out): m = re.search(r'https://www\.genspark\.ai/api/files/s/\w+', out or ''); return m.group(0) if m else None
def upload(path): return url_of(sh('gsk', 'upload', path).stdout)

SITCOM = ('Photorealistic live-action Chinese comedy short film, bright warm sitcom lighting, shot on ARRI Alexa 35mm, natural skin texture with pores, no beauty filter, no CGI, no cartoon, '
          'vertical 9:16 composition, crisp comedic timing, big readable facial expressions. ')
PORTRAIT = 'Candid full-body-to-waist photograph of a real person, not a model, looking at camera, plain light grey studio wall, soft daylight, Fujifilm X-T4 35mm, unretouched, true-to-life skin. '
KEEP = 'Keep every person exactly as in the first frame: same face, hair, clothes; nobody changes identity; no extra people appear unless described; no text overlays. '

# ───────────────────────── ① 老爸倒车 ─────────────────────────
PARK = dict(sid='fun_parking', refs={
  'dad': PORTRAIT + 'Chinese man, 48, slightly chubby, short black hair, rimless glasses, light blue polo shirt, khaki trousers, overconfident smug grin.',
  'mom': PORTRAIT + 'Chinese woman, 46, short neat bob haircut, beige trench coat, sunglasses pushed up on her head, arms crossed, deadpan unimpressed face.',
  'son': PORTRAIT + 'Chinese teenage boy, 16, messy hair, oversized grey hoodie, holding a smartphone up as if livestreaming, cheeky smirk.',
  'girl': PORTRAIT + 'Chinese girl, 7, two pigtails with red hair ties, yellow raincoat-style jacket, holding a crayon, big curious eyes.',
  'guard': PORTRAIT + 'Chinese man, 60, mall parking security guard in a navy uniform and peaked cap, reflective vest, warm grandfatherly smile.',
}, sets={
  'garage': 'Unretouched photo, no people. Underground shopping-mall parking garage, bright fluorescent lights, painted parking lines, one single empty tight parking space between a thick concrete pillar and a shiny black luxury sedan, '
            'a green plastic wheelie trash bin standing right behind the empty space, a white family SUV waiting in the lane in front of it. Vertical 9:16 photo.',
}, clips={
  'intro': dict(dur=6, refs=['dad', 'mom', 'son', 'girl', 'garage'], still='Inside the white SUV from the last image, view through the windshield: the man from image 1 driving, the woman from image 2 in the passenger seat, the boy from image 3 and the girl from image 4 in the back seat. The empty parking space visible ahead.',
                text='The dad cracks his knuckles and says proudly in Mandarin Chinese: "这个位置，小意思。" The mom opens her mouth: "要不……" He cuts her off: "我自己来！" The son lifts his phone and whispers: "家人们，名场面要来了。"'),
  'try1': dict(dur=5, refs=['dad', 'son', 'garage'], still='Inside the SUV: the man from image 1 twisted around in the driver seat, one arm on the passenger headrest, looking backwards through the rear window with intense concentration, the boy from image 2 in the back filming him with a phone.',
                text='Slow push-in on the dad\'s focused sweating face as he reverses; the parking sensor beeps get faster: 嘀……嘀……嘀嘀嘀嘀. He mutters in Mandarin Chinese: "稳住……稳住……" Tense comedic music.'),
  'try2': dict(dur=5, refs=['dad', 'mom', 'garage'], still='Inside the SUV: the man from image 1 gripping the steering wheel with both hands, glasses fogged, a bead of sweat running down his temple, the woman from image 2 beside him with arms crossed staring at him.',
                text='Extreme slow comedic tension: he takes a deep breath, the parking sensor beeps speed up 嘀嘀嘀嘀嘀, the mom slowly turns her head to look at him without blinking. He says in Mandarin Chinese: "这次肯定行。"'),
  'ok': dict(dur=5, refs=['dad', 'garage'], still='Exterior wide shot of the garage from the image: the white SUV halfway reversed into the empty space, perfectly straight.',
                text='The SUV glides smoothly and perfectly into the space and stops dead centre between the lines. The driver door opens, the dad steps out, pushes up his glasses and says smugly in Mandarin Chinese: "看见没！" Applause from inside the car.'),
  'skew': dict(dur=5, refs=['dad', 'garage'], still='Exterior wide shot of the garage: the white SUV entering the space at a noticeably wrong angle.',
                text='The SUV stops completely crooked, diagonally across two parking spaces, one wheel on the line. Hold. The driver window rolls down, the dad leans out, looks at the lines, and says in Mandarin Chinese with fake calm: "我再调一下。"'),
  'bin': dict(dur=5, refs=['dad', 'garage'], still='Low exterior shot in the garage from the image, nobody standing outside: the rear of the white SUV with reverse lights on is very close to the green wheelie trash bin standing in the parking space, the driver from image 1 visible leaning out of the driver window looking back.',
                text='The SUV rear bumper bumps the green trash bin with a hollow "哐" — the bin wobbles, spins half a turn and gets a big dent; a banana peel flies out. The dad sticks his head out of the window and shouts in Mandarin Chinese: "谁把垃圾桶放这儿的！"'),
  'mom': dict(dur=5, refs=['dad', 'mom', 'garage'], still='Inside the SUV: the woman from image 2 in the passenger seat, sunglasses now down over her eyes, unbuckling her seatbelt, the man from image 1 at the wheel looking guilty.',
                text='The mom says flatly in Mandarin Chinese: "下车，我来。" The dad opens his mouth to protest, she just lowers her sunglasses and stares. He silently gets out. Comedic defeated music sting.'),
  'roast1': dict(dur=4, refs=['son', 'garage'], still='Back seat of the SUV: the boy from image 1 holding his phone in selfie mode close to his face, grinning, the driver seat out of focus in front.',
                text='The son whispers to his phone camera in Mandarin Chinese: "爸，你行不行啊。" then turns the phone toward the front seat, giggling.'),
  'roast2': dict(dur=4, refs=['son', 'girl', 'garage'], still='Back seat of the SUV: the boy from image 1 holding his phone up, the girl from image 2 next to him holding up three fingers.',
                text='The little girl holds up three fingers and says innocently in Mandarin Chinese: "爸爸，这是第三次了。" The son bursts out laughing into his phone: "家人们，记下来。"'),
  'honk': dict(dur=4, refs=['garage'], still='Inside the parking garage from the image: a small old red hatchback car waiting in the driving lane, seen from the front; behind its windscreen an elderly Chinese grandpa with white hair and a flat cap, one hand on the steering wheel, impatient face.',
                text='The old man presses the horn long and hard: "嘀————" and shouts in Mandarin Chinese with a Beijing accent: "师傅，快点儿嘿！" then shakes his head and sips from a thermos.'),
  'mom_ok': dict(dur=5, refs=['mom', 'dad', 'garage'], still='Exterior wide shot: the woman from image 1 in the driver seat of the white SUV, one hand casually on the wheel, the man from image 2 standing outside next to the pillar watching.',
                text='With one effortless spin of the wheel and without even looking, the mom reverses the SUV perfectly into the space in one smooth move. The dad, standing by the pillar, slowly takes off his glasses, jaw dropping. She steps out, flips her sunglasses up.'),
  'guard': dict(dur=5, refs=['guard', 'mom', 'garage'], still='Exterior: the white SUV stuck crooked in front of the space, the woman from image 2 at the wheel looking frustrated, and the security guard from image 1 jogging toward the car waving one hand.',
                text='The security guard jogs up, taps on the window and says cheerfully in Mandarin Chinese: "师傅，我来！" He hops into the driver seat; a second later the SUV is perfectly parked. Everyone stares in silence.'),
  'end_dad': dict(dur=6, refs=['dad', 'mom', 'girl', 'garage'], still='Next to the parked white SUV: the man from image 1 standing proudly, the girl from image 3 reaching up to stick a handwritten paper sticker on his chest, the woman from image 2 next to them with arms crossed.',
                text='The little girl sticks a crayon-written "车神" sticker on her dad\'s chest. He beams and says seriously in Mandarin Chinese: "下次……还是我来。" The mom, without looking at him: "闭嘴。" Warm laugh, freeze frame.'),
  'end_mom': dict(dur=6, refs=['mom', 'dad', 'girl', 'garage'], still='Next to the parked white SUV: the woman from image 1 standing coolly, the girl from image 3 sticking a handwritten paper sticker on her coat, the man from image 2 behind them sulking.',
                text='The little girl sticks a crayon-written "车神" sticker on her mom. The dad, sulking, mutters in Mandarin Chinese: "下次……还是我来。" The mom: "闭嘴。" The girl giggles. Warm freeze frame.'),
  'end_guard': dict(dur=6, refs=['guard', 'dad', 'girl', 'garage'], still='Next to the parked white SUV in the garage from the last image: the security guard from image 1 smiling and holding a vanilla ice-cream cone, the little girl from image 3 standing beside him pointing at a paper sticker on his vest, the man from image 2 standing behind them scratching his head.',
                text='The girl sticks a crayon-written "车神" sticker on the security guard, who gives a thumbs-up and licks his ice cream. The dad mutters in Mandarin Chinese: "下次……还是我来。" An off-screen woman\'s voice: "闭嘴。" Everyone laughs.'),
})

# ───────────────────────── ② 霸总求婚 ─────────────────────────
CEO = dict(sid='fun_ceo', refs={
  'gu': PORTRAIT + 'Chinese man, 30, slicked-back glossy hair, black sunglasses, razor-sharp black three-piece suit, one hand in pocket, extremely serious cold expression, overacting CEO pose.',
  'lin': PORTRAIT + 'Chinese woman, 25, ponytail, plain white office blouse and black skirt, holding a blue paper résumé folder, confused polite expression.',
  'wang': PORTRAIT + 'Chinese man, 22, restaurant waiter in white shirt, black waistcoat and bow tie, thick glasses, nervous clumsy grin.',
  'dama': PORTRAIT + 'Chinese woman, 62, tight curly perm, bright red floral blouse, gold necklace, holding a handful of sunflower seeds, nosy delighted grin.',
  'zhu': PORTRAIT + 'Chinese man, 35, executive assistant in grey suit, earpiece with coiled wire, holding a tablet, deadly serious.',
}, sets={
  'resto': 'Unretouched photo, no people. An empty upscale Western restaurant booked out for a proposal: one round table in the centre with white tablecloth and candles, red rose petals on the floor, a big crystal chandelier above, '
           'and one small ordinary table by the window with a plate of sunflower seeds and a cup of tea. Vertical 9:16 photo.',
}, clips={
  'intro': dict(dur=6, refs=['gu', 'zhu', 'wang', 'resto'], still='The man from image 1 standing at the restaurant entrance in slow motion pose, the man from image 2 behind him holding a small electric fan pointed at his hair, the waiter from image 3 standing nearby holding a menu.',
                text='Slow-motion entrance, dramatic music. The assistant\'s fan blows the CEO\'s hair. The CEO says coldly in Mandarin Chinese: "这个餐厅，我包了。" The waiter, holding the menu, says: "先生……人均三十八。" The CEO does not react at all.'),
  'glasses': dict(dur=4, refs=['gu', 'resto'], still='Extreme close-up of the man from image 1 at the restaurant, fingertips touching the frame of his black sunglasses.',
                text='He slowly, dramatically lowers his sunglasses; a cheesy dramatic sound sting "噔噔噔"; wind blows from nowhere; his eyes narrow. Then he slides the sunglasses back up.'),
  't1': dict(dur=5, refs=['gu', 'lin', 'wang', 'resto'], still='The woman from image 2 seated at the candlelit table, the man from image 1 seated opposite with sunglasses on, the waiter from image 3 carrying a tall white cream cake toward them.',
                text='The CEO leans back and says in Mandarin Chinese: "女人，你成功引起了我的注意。" The woman blinks, confused. The waiter carries the cake closer, wobbling.'),
  's1_ok': dict(dur=5, refs=['lin', 'gu', 'resto'], still='The woman from image 1 cutting into a tall white cream cake on the table, the man from image 2 watching smugly.',
                text='She cuts the cake and finds a shining diamond ring inside. She covers her mouth in shock. The CEO nods slowly, satisfied. Soft romantic piano.'),
  's1_a': dict(dur=5, refs=['wang', 'gu', 'resto'], still='The waiter from image 1 mid-stumble, the tall cream cake tilting in his hands, right next to the seated man from image 2.',
                text='The waiter trips and the whole cream cake smashes into the CEO\'s face. The CEO stays perfectly still, sunglasses still on, cream dripping. After a beat he says calmly in Mandarin Chinese: "没事。" The waiter: "对不起对不起！"'),
  's1_b': dict(dur=5, refs=['dama', 'resto'], still='The woman from image 1 at her small window table, happily holding a big slice of white cream cake on a plate, about to take a bite.',
                text='The auntie takes a huge bite, chews, then stops, spits out a diamond ring into her palm and shouts in Mandarin Chinese: "哎哟！谁家蛋糕里有石头！" She squints at it, then slips it on her finger.'),
  's1_c': dict(dur=5, refs=['lin', 'gu', 'resto'], still='The woman from image 1 at the candlelit table, pushing a cream cake plate away with one hand, the man from image 2 opposite her frozen.',
                text='She politely pushes the cake away and says in Mandarin Chinese: "不好意思，我减肥，不吃蛋糕。" The CEO freezes; slowly turns his head toward the assistant off-screen. Cricket sound.'),
  't2': dict(dur=5, refs=['zhu', 'gu', 'resto'], still='The assistant from image 1 holding a drone remote, a small white drone with a bouquet of red roses hanging beneath it hovering in the air, the man from image 2 seated at the table in the background.',
                text='The assistant touches his earpiece and says in Mandarin Chinese: "顾总，第二步准备就绪。" The drone with the bouquet rises with a buzzing sound and flies toward the table.'),
  's2_ok': dict(dur=5, refs=['lin', 'resto'], still='The woman from image 1 seated at the candlelit table looking up, a small white drone hovering above her.',
                text='The drone opens and thousands of red rose petals rain down over her in slow motion. She looks up, amazed, petals in her hair. Romantic violin.'),
  's2_a': dict(dur=5, refs=['gu', 'zhu', 'resto'], still='A small white drone with a rose bouquet tangled in the big crystal chandelier, the man from image 1 and the man from image 2 below looking up.',
                text='The drone is stuck in the chandelier, spinning in circles with a whining sound, the chandelier swaying, rose petals stuck in the crystals. The CEO and the assistant slowly turn their heads round and round following it.'),
  's2_b': dict(dur=5, refs=['dama', 'resto'], still='The woman from image 1 at her window table looking up with surprise, a small white drone with a rose bouquet hovering right above her.',
                text='The drone releases the bouquet straight into the auntie\'s arms. She clutches it, blushes, fixes her perm and says shyly in Mandarin Chinese: "哎呀，这多不好意思。"'),
  's2_c': dict(dur=5, refs=['zhu', 'resto'], still='The assistant from image 1 frantically pressing a drone remote, a small white drone with a bouquet heading toward the open restaurant window, a food delivery scooter visible outside.',
                text='The drone flies out of the open window and follows a food delivery rider on a yellow scooter down the street. The assistant runs to the window and shouts in Mandarin Chinese: "回来！回来！"'),
  't3': dict(dur=5, refs=['gu', 'lin', 'resto'], still='The man from image 1 beginning to kneel on one knee in front of the seated woman from image 2, opening a small red ring box.',
                text='Dramatic slow motion: the CEO drops onto one knee, opens the ring box and says in Mandarin Chinese: "女人，嫁给我。" Swelling orchestral music.'),
  's3_ok': dict(dur=5, refs=['lin', 'gu', 'resto'], still='The woman from image 1 seated, hands over her mouth, eyes tearing up, the man from image 2 kneeling before her with an open ring box.',
                text='She nods with tears in her eyes and says in Mandarin Chinese: "我愿意！" The CEO finally smiles, still wearing sunglasses. Confetti cannon pops.'),
  's3_a': dict(dur=5, refs=['gu', 'dama', 'resto'], still='The man from image 1 kneeling on one knee with an open ring box, seen from the side, the woman from image 2 at her window table in the background watching.',
                text='As he kneels a loud "嘶啦" ripping sound: the back seam of his suit trousers splits. He freezes mid-pose, face unmoving. In the background the auntie spits out a sunflower seed shell in shock. Long silence.'),
  's3_b': dict(dur=5, refs=['lin', 'gu', 'resto'], still='The woman from image 1 seated, awkwardly holding up her blue résumé folder, the man from image 2 kneeling before her with an open ring box.',
                text='She holds up her résumé and says awkwardly in Mandarin Chinese: "顾总……我是来面试保洁的。" The CEO stays kneeling, completely still. A single rose petal falls on his head.'),
  's3_c': dict(dur=5, refs=['gu', 'resto'], still='The man from image 1 kneeling on one knee with an open ring box, turning his head toward the restaurant door, where a Chinese woman in a red coat holding a toddler has just burst in.',
                text='The woman in the red coat holding the toddler shouts in Mandarin Chinese: "孩子他爸！" The toddler waves: "爸爸！" The CEO slowly lowers his sunglasses, sweating.'),
  'end_lin': dict(dur=6, refs=['gu', 'lin', 'wang', 'resto'], still='The man from image 1 and the woman from image 2 hugging under falling petals at the candlelit table, the waiter from image 3 in the background holding a napkin.',
                text='They hug under petals. In the background the waiter sobs dramatically into a napkin and says in Mandarin Chinese: "我的青春……结束了。" Freeze frame.'),
  'end_wang': dict(dur=6, refs=['lin', 'wang', 'gu', 'resto'], still='The woman from image 1 holding hands with the waiter from image 2 walking toward the restaurant exit, the man from image 3 standing alone by the table in the background.',
                text='She walks out holding the waiter\'s hand; the waiter turns back and says shyly in Mandarin Chinese: "顾总，人均三十八，记得结账。" The CEO stands alone; a gust of wind blows a single napkin past him.'),
  'end_dama': dict(dur=6, refs=['dama', 'gu', 'resto'], still='The woman from image 1 wearing a diamond ring and holding a rose bouquet, grabbing both hands of the man from image 2, who looks stunned.',
                text='The auntie squeezes his hands and declares loudly in Mandarin Chinese: "小伙子，阿姨答应你了！" The CEO slowly turns to the camera with a horrified face. Wedding march music starts playing.'),
  'end_zhu': dict(dur=6, refs=['gu', 'zhu', 'resto'], still='The man from image 1 and the assistant from image 2 hugging each other tightly in the empty restaurant, both with eyes closed.',
                text='The CEO and his assistant hug and cry. The CEO sobs in Mandarin Chinese: "这个世界上，只有你懂我。" The assistant pats his back: "顾总，下个月还有。" Sad violin, freeze frame.'),
})

# ───────────────────────── ③ 动物世界·打工人篇 ─────────────────────────
NAR = 'A deep, calm, solemn male nature-documentary narrator voice-over in Mandarin Chinese says: '
DOC = 'Shot like a wildlife documentary: long telephoto lens, slight handheld drift, shallow depth of field, natural office light. '
SP = {'yin': '银背', 'zai': '幼崽', 'liang': '囤粮者', 'que': '雄孔雀', 'ni': '拟态大师'}
OFFICE = dict(sid='fun_office', refs={
  'yin': PORTRAIT + 'Chinese man, 52, balding on top with grey side hair, beige cardigan over a checked shirt, holding a big thermos cup, weary veteran office worker.',
  'zai': PORTRAIT + 'Chinese young man, 22, fresh-faced, neat hair, wearing a lanyard staff badge, white shirt, school backpack, wide innocent eyes, intern.',
  'liang': PORTRAIT + 'Chinese woman, 45, permed shoulder-length hair, knitted cardigan, carrying a canvas tote bag stacked with three lunch boxes, sharp eyes.',
  'que': PORTRAIT + 'Chinese man, 28, gym bro, very muscular, tight black T-shirt, holding a protein shaker bottle, flexing proudly.',
  'ni': PORTRAIT + 'Chinese man, 33, dark eye circles, grey hoodie, big headphones around neck, half-asleep expressionless face.',
  'boss': PORTRAIT + 'Chinese man, 50, navy suit, slicked hair, holding a thick folder, a too-friendly smile.',
}, sets={
  'office': 'Unretouched photo, no people. A modern open-plan Chinese office floor: rows of desks with monitors and potted plants, an elevator lobby with steel doors at the side, a small pantry corner with one microwave, a wall clock and a fingerprint time-clock machine near the exit. Vertical 9:16 photo.',
}, clips={})
C = OFFICE['clips']
ALL5 = ['yin', 'zai', 'liang', 'que', 'ni']
C['intro'] = dict(dur=6, refs=ALL5 + ['office'], still='Telephoto documentary shot through potted plant leaves: the five people from images 1-5 at their desks in the office from the last image, each doing their own thing.',
                  text=DOC + NAR + '"清晨七点五十九分。写字楼里的生灵们，开始了一天的迁徙。" The workers move slowly; the intern looks around nervously; the gym bro flexes at his monitor.')
C['mimic'] = dict(dur=4, refs=['ni', 'office'], still='Close telephoto shot of the man from image 1 sitting at his desk, eyes closed, one finger resting on the keyboard.',
                  text=DOC + 'He sleeps sitting upright, but one finger keeps pressing the keyboard rhythmically. ' + NAR + '"注意看，拟态大师已经进入休眠，却依然保持着打字的姿态。"')
C['t1'] = dict(dur=5, refs=ALL5 + ['office'], still='Elevator lobby of the office: the steel elevator doors half open, the five people from images 1-5 lined up tense, eyeing the closing doors.',
               text=DOC + 'The elevator doors begin to close; all five crouch slightly, ready to sprint. ' + NAR + '"最后一部电梯即将关闭。只有一个物种，能挤进去。"')
R1 = {'yin': 'The balding veteran simply takes one calm step in — he was standing at the perfect spot all along. ' + NAR + '"银背凭借二十年的经验，早就站在了门口。"',
      'zai': 'The intern is pushed in by the crowd by accident and the doors close on him alone; he waves awkwardly. ' + NAR + '"幼崽被族群意外推进了电梯。这是它第一次领先。"',
      'liang': 'The auntie thrusts her tote bag of lunch boxes between the doors; they reopen and she walks in. ' + NAR + '"囤粮者用饭盒卡住了门。食物，就是力量。"',
      'que': 'The gym bro does a dramatic dive roll through the gap just before the doors shut, then flexes inside. ' + NAR + '"雄孔雀发起冲刺。它成功了，但没有雌性看到。"',
      'ni': 'The doors close — revealing the hoodie guy was already inside the elevator all along, asleep against the wall. ' + NAR + '"没有人发现，拟态大师一直都在电梯里。"'}
C['t2'] = dict(dur=5, refs=ALL5 + ['office'], still='The small office pantry with one microwave: the five people from images 1-5 each holding a lunch box, standing in a tense standoff circle around the microwave.',
               text=DOC + 'Long silent standoff around the microwave, eyes darting, like animals at a waterhole. ' + NAR + '"正午。整片栖息地，只有一个热源。"')
R2 = {'yin': 'The veteran calmly places his thermos-sized lunch box in first and presses start; nobody dares challenge him. ' + NAR + '"银背只用了一个眼神。"',
      'zai': 'The others start arguing with each other; the intern quietly slips his lunch box in and presses start. ' + NAR + '"当强者内斗，幼崽悄悄获得了食物。"',
      'liang': 'The auntie stacks all three of her lunch boxes into the microwave at once and guards it with her arms crossed. ' + NAR + '"囤粮者一次加热了三天的口粮。"',
      'que': 'The gym bro puts in his chicken breast and flexes at the others while it spins. ' + NAR + '"雄孔雀的鸡胸肉，今天第五顿。"',
      'ni': 'Nobody noticed: the hoodie guy\'s lunch is already spinning inside; he is asleep standing beside it. ' + NAR + '"拟态大师早在十一点就占据了热源。"'}
C['t3'] = dict(dur=5, refs=ALL5 + ['office'], still='Near the office exit by the wall clock showing 17:59 and the fingerprint time-clock: the five people from images 1-5 standing with bags packed, staring at the clock.',
               text=DOC + 'Everyone stares at the clock\'s second hand, fingers hovering near the fingerprint scanner. ' + NAR + '"距离下班，还有最后一分钟。"')
R3 = {'yin': 'The clock hits 18:00; the veteran presses his finger on the scanner first: "谢谢". ' + NAR + '"银背第一个完成了归巢。"',
      'zai': 'The clock hits 18:00; the intern clocks out and runs out happily with his backpack. ' + NAR + '"幼崽不需要加班。这是它最大的优势。"',
      'liang': 'The clock hits 18:00; the auntie clocks out first and leaves carrying her empty lunch boxes. ' + NAR + '"囤粮者，满载而归。"',
      'que': 'The clock hits 18:00; the gym bro slaps the scanner and sprints down the corridor; the handheld camera whip-pans and chases right behind him, keeping him in frame the whole time until he bursts through the exit door. ' + NAR + '"雄孔雀奔向了它的第二个栖息地——健身房。"',
      'ni': 'The clock hits 18:00; the hoodie guy clocks out first — he had been standing by the scanner asleep. ' + NAR + '"拟态大师，梦游下班。"'}
for k, rnd, t, d in (('1', R1, 't1', 'the elevator lobby'), ('2', R2, 't2', 'the pantry with the microwave'), ('3', R3, 't3', 'the office exit by the time clock')):
    for s, txt in rnd.items():
        C[f'r{k}_{s}'] = dict(dur=5, refs=[s, 'office'], still=f'Telephoto documentary shot in {d} of the office: the person from image 1 in the foreground, others blurred behind.', text=DOC + txt)
C['r3_boss'] = dict(dur=6, refs=['boss', 'yin', 'zai', 'office'], still='The office exit by the clock showing 18:00: the man from image 1 with his thick folder stepping out of an office door smiling, the man from image 2 and the young man from image 3 frozen mid-step with their bags.',
                    text=DOC + 'The boss says cheerfully in Mandarin Chinese: "大家先别走，开个短会。" Instantly everyone freezes and slowly collapses onto the nearest desks pretending to be dead. ' + NAR + '"这，就是自然界最古老的生存智慧——装死。"')
ENDS = {'yin': '"今年的适者，是银背。他已经二十年没有升职，但他从未被淘汰。"', 'zai': '"今年的适者，是幼崽。它还不知道什么叫周报，这就是它的力量。"',
        'liang': '"今年的适者，是囤粮者。在这片丛林里，吃饱的，才能活下去。"', 'que': '"今年的适者，是雄孔雀。虽然，依然没有雌性在看。"', 'ni': '"今年的适者，是拟态大师。没有人知道，他是什么时候赢的。"'}
for s, line in ENDS.items():
    C[f'end_{s}'] = dict(dur=6, refs=[s, 'office'], still='The person from image 1 standing alone in the middle of the office from image 2 under a warm spotlight, holding a cheap gold plastic trophy, other desks dark.',
                         text=DOC + 'Slow push-in; the colleagues clap politely in the dark. ' + NAR + line + ' Epic documentary music swells.')


# ───────────────────────── ④ 阿木停车（原创默剧主角 · 三元素组合结局） ─────────────────────────
SILENT = ('Silent physical comedy in the tradition of classic slapstick: absolutely no dialogue, no speech, no words, no subtitles, no on-screen text; '
          'only grunts, hums, sighs, footsteps, crisp sound effects and a playful bouncy clarinet-and-pizzicato comedy score. '
          'The lead man is deadpan and extremely serious about everything; the comedy comes from precise physical actions, timing and escalation. ')
AMU_LOOK = 'the man from image 1 (tall lanky Chinese man, rubbery expressive face, thick eyebrows, neat side-parted hair, slightly too-small grey tweed suit, thin red tie)'
AMU = dict(sid='fun_amu_park', refs={
  'amu': PORTRAIT + 'Chinese man, 35, tall and lanky, long rubbery very expressive face, thick dark eyebrows, neatly combed side-parted black hair, slightly too-small grey tweed suit with sleeves a bit short showing his wrists, white shirt, thin red tie, holding a battered brown leather briefcase, raising one eyebrow with total seriousness. Original character, not a celebrity.',
  'owner': PORTRAIT + 'Chinese woman, 40, glamorous rich businesswoman, sleek black bob haircut, cream designer wool coat, gold earrings, big designer handbag, sunglasses pushed up on her head, impatient arched eyebrow.',
  'guard': PORTRAIT + 'Chinese man, 55, chubby parking security guard, navy uniform and peaked cap, orange reflective vest, walkie-talkie on his belt, whistle around his neck, sleepy droopy face.',
  'uncle': PORTRAIT + 'Chinese man, 68, retired know-it-all grandpa, white undershirt under an open short-sleeve checked shirt, grey trousers, plastic sandals, holding a round palm-leaf fan, eagerly pointing one finger.',
  'auntie': PORTRAIT + 'Chinese woman, 58, cheerful auntie in a bright pink tracksuit and white sun visor, holding a red leash attached to a fat fluffy orange-and-white corgi dog sitting at her feet.',
}, sets={
  'car': 'Unretouched photo, no people. A tiny old two-door bright red city car (very small boxy hatchback with a small glass sunroof, round headlights, a little dent on the front bumper) standing in an underground parking garage, three-quarter side view, vertical 9:16.',
  'garage': 'Unretouched wide photo, no people. Bright underground shopping-mall parking garage, fluorescent tube lights, painted white parking lines. In the centre one very tight empty parking space between a thick grey concrete pillar on the left and a glossy black luxury sedan on the right. '
            'Clearly visible around it: a small glass security booth at the far end, a row of metal shopping trolleys, a balloon stand with a big bunch of colourful helium balloons tied to it, an elevator lobby with steel doors, and a yellow ride-on floor-scrubber cleaning machine parked by the wall. Vertical 9:16.',
}, clips={
  'intro': dict(dur=8, refs=['amu', 'car', 'owner', 'guard', 'uncle', 'auntie', 'garage'], still=f'Wide shot of the garage from the last image: the tiny red car from image 2 just arriving in the driving lane in front of the tight empty space, {AMU_LOOK} at the wheel. In the background: the woman from image 3 waiting at the elevator, the security guard from image 4 dozing in the glass booth, the grandpa from image 5 sitting on a folding stool fanning himself, the auntie from image 6 walking her corgi past the balloon stand.',
                text='The tiny red car putters in and stops. The camera pans slowly across the whole garage showing every prop one by one: the balloon stand, the row of shopping trolleys, the yellow floor scrubber, the guard dozing in his booth, the rich woman at the elevator, the grandpa fanning himself, the auntie with her fat corgi. Back on the driver: he stares at the tiny space, cracks his knuckles one by one, smooths his hair in the rear-view mirror and nods to himself with enormous seriousness.'),
  'sA': dict(dur=6, refs=['amu', 'car', 'garage'], still=f'Medium shot through the open side window: {AMU_LOOK} in the driver seat of the tiny red car from image 2, stopped in front of the tight empty space next to the pillar, both hands gripping the wheel, tongue poking out in concentration.',
                text='He grips the wheel, looks at the space, looks at the pillar, licks a finger and holds it up to test the wind, adjusts his tie, rolls up his sleeves with great ceremony. A ticking clock and a slowly building drum roll.'),
  'a_rev': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'Rear three-quarter view in the parking garage: the small red car from image 2 backing slowly toward the empty parking bay beside a grey pillar; through its rear window we see {AMU_LOOK} looking back over his shoulder.',
                text='He throws one arm over the passenger seat and reverses at full speed with total confidence. The car zig-zags, the wing mirror folds flat against the pillar with a clack, the car jerks forward and back five times in quick succession and ends up wedged in perfectly straight. He nods once, very proudly, and unfolds the mirror with one finger.'),
  'a_push': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'In the parking garage, {AMU_LOOK} stands behind the small red car from image 2 with both hands flat on its rear hatch, leaning forward as if to push it into the empty bay.',
                text='Locked-off wide shot, the camera never moves closer. He pushes the tiny car by hand, face going red, polished shoes sliding on the floor; it creeps in inch by inch. He turns round and pushes with his back, then with his bottom, grunting rhythmically. Finally it rolls in and he falls flat on his face. He stands up slowly and dusts himself off with great dignity, still in the wide shot. Same man, same thin red tie throughout.'),
  'a_jack': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} crouching beside the tiny red car from image 2, cranking a small car jack under its side sill, the car already tilted a little.',
                text='He jacks one side of the car up, then waddles the whole car sideways bit by bit, hopping from front to back like a crab and cranking the jack each time; the car shuffles sideways into the space centimetre by centimetre. He wipes his brow with the end of his red tie.'),
  'a_guide': dict(dur=8, refs=['amu', 'car', 'uncle', 'garage'], still=f'Wide shot in the underground parking garage: the elderly man from image 3 stands behind the small red car from image 2, cheerfully waving both hands like a parking attendant; {AMU_LOOK} leans his head out of the open driver window looking back at him. No mirrors in close-up.',
                text='The grandpa waves enthusiastically, hands flapping "back, back, back"; the driver obeys every gesture exactly. The car goes left, right, left; the grandpa spins round in a full circle and waves even faster; the car follows and slots in perfectly. The grandpa gives a big thumbs up; the driver answers with a tiny, very serious salute.'),
  'sB': dict(dur=6, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} squeezing sideways out of the half-open driver door of the tiny red car from image 2, now parked tightly in the space between the pillar and the black sedan, sucking in his stomach, briefcase first.',
                text='The door bumps the pillar; he sucks in his stomach and squeezes out sideways inch by inch, briefcase first, then one long leg, then the other. Somewhere off-screen a strange rumble begins. He freezes, one eyebrow rising, and slowly turns his head. Suspense music builds.'),
  'b_cart': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} standing next to the parked tiny red car from image 2, turning in alarm toward a runaway metal shopping trolley rolling fast toward him down the lane.',
                text='The runaway shopping trolley rattles straight at him. He sidesteps like a bullfighter with a flourish of his jacket; the trolley clangs off the black sedan, spins round and comes back; he catches it at the last second, parks it neatly beside his car, then glances at the camera.'),
  'b_balloon': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'Underground parking garage like image 3, concrete pillar and fluorescent lights: {AMU_LOOK} beside the small red car from image 2, gazing upward with raised eyebrows at a cluster of colourful party balloons hovering near the ceiling above him',
                text='The loose bunch of balloons drifts over and its strings tangle round his briefcase handle and his tie. His heels lift off the ground; he goes up on tiptoe, then floats a few centimetres up, legs paddling in the air like a swimmer, and grabs the edge of the car sunroof with one hand to stay down. He looks at the camera, still floating.'),
  'b_dog': dict(dur=8, refs=['amu', 'car', 'auntie', 'garage'], still=f'{AMU_LOOK} standing next to the parked tiny red car from image 2, a fat corgi dog trailing a red leash sprinting toward him, the auntie from image 3 running after it in the background.',
                text='The fat corgi escapes and charges at him, grabs his trouser leg and tugs; he hops round in circles on one foot while the auntie chases them both. The corgi lets go, snatches his briefcase instead and waddles under the car with it. He lies flat on the floor and negotiates silently with the dog.'),
  'b_scrub': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} standing next to the parked tiny red car from image 2, the yellow ride-on floor scrubber machine with nobody on it rolling toward him and spraying soapy foam.',
                text='The empty yellow floor scrubber has started by itself and chases him in slow circles round his car, spraying foam. He leaps on board, cannot find the brake, and ends up riding it standing up like a surfer, arms out for balance, spinning slowly in a cloud of foam. He glances at the camera.'),
  'sC': dict(dur=6, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} standing proudly next to the tiny red car from image 2 parked in the tight space, straightening his tie with a satisfied little smile.',
                text='He straightens his tie, admires his parking from three angles and takes a small bow to nobody. Footsteps echo; the elevator dings; someone is coming. He freezes mid-bow, eyes sliding sideways. Suspense build.'),
  'c_amu': dict(dur=8, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} stepping backwards away from the parked tiny red car with his arms spread proudly, a banana peel on the floor right behind his heel.',
                text='He steps back to admire his work, treads on the banana peel, slides across the floor on his back, and lands sitting upright in a shopping trolley that rolls away with him. He crosses his arms and legs as if nothing happened and rolls out of frame with total dignity.'),
  'c_owner': dict(dur=8, refs=['owner', 'amu', 'car', 'garage'], still='The rich woman from image 1 standing between the glossy black sedan and the tiny red car from image 3, staring in disbelief at the ten-centimetre gap by her driver door; the man from image 2 standing nearby.',
                text='She tries her driver door: it opens two centimetres and hits the tiny red car. She tries the other side: blocked by the pillar. She opens the boot and climbs in through it in her high heels, handbag first, legs kicking in the air. He watches, raises one eyebrow and gives her a small polite wave.'),
  'c_guard': dict(dur=8, refs=['guard', 'amu', 'car', 'garage'], still='In the parking garage, the security guard from image 1 stands sideways in the narrow gap between the small red car from image 3 and a black sedan, holding a ticket notebook, looking puzzled; the man from image 2 stands beside the cars watching.',
                text='The guard squeezed into the gap to write a ticket and is stuck fast. He blows his whistle helplessly, cheeks squashed. The man takes his arm and pulls; he pops out like a cork and they both tumble backwards onto the floor. The ticket floats down and lands on the man\'s face.'),
  'c_uncle': dict(dur=8, refs=['uncle', 'amu', 'car', 'garage'], still='The grandpa from image 1 leaning back against the tiny red car from image 3, fan in hand, pointing at the man from image 2 as if lecturing him.',
                text='The grandpa lectures silently, wagging his fan, and leans back on the tiny car to demonstrate. The car rolls; he windmills his arms and topples backwards straight into the open sunroof, sandals sticking out and kicking. The man looks at the sandals, then at the camera.'),
  'outro': dict(dur=5, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} walking away from the parked tiny red car toward the elevator, briefcase in hand, mid-step.',
                text='He picks up his briefcase, brushes his lapels and walks off toward the elevator with a little skip. He stops, turns, looks straight into the camera and slowly raises one eyebrow. Music button.'),
  'tw_tow': dict(dur=6, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} next to the parked tiny red car from image 2, a yellow tow truck reversing toward it with its hook lowered; a large blue wheelchair accessibility symbol painted on the floor of the parking space.',
                text='Twist. He notices the wheelchair symbol under his car a second too late. The tow truck hooks the tiny car and drags it away; he clings to the rear bumper, shoes skidding along the floor behind it, briefcase flapping, until they both disappear round the corner.'),
  'tw_wrong': dict(dur=6, refs=['amu', 'car', 'garage'], still=f'{AMU_LOOK} holding up a car key remote next to the tiny red car from image 2; in the far background an identical tiny red car with its headlights flashing.',
                text='Twist. He proudly presses the key remote: the car beside him does nothing. Across the garage an identical tiny red car beeps and flashes its lights. He looks at the car he just parked, at the other one, back again, then slowly at the camera.'),
})

GAMES = {'park': PARK, 'ceo': CEO, 'office': OFFICE, 'amu': AMU}

# ───────────────────────── 管线 ─────────────────────────
def out_dir(g): d = f"{ARCH}/{GAMES[g]['sid']}"; os.makedirs(d, exist_ok=True); return d
def refs_f(g): return f'{out_dir(g)}/refs.json'
def refs(g): return json.load(open(refs_f(g))) if os.path.exists(refs_f(g)) else {}
def save_ref(g, k, u):
    r = refs(g); r[k] = u; json.dump(r, open(refs_f(g), 'w'), indent=1)
def img(g, key, prompt, ratio, ref_urls=None, force=False):
    out = f'{out_dir(g)}/{key}.png'
    if os.path.exists(out) and refs(g).get(key) and not force: return key, 'skip'
    if force and os.path.exists(out): os.remove(out)
    args = ['gsk', 'img', '-m', 'nano-banana-2.1', '-r', ratio, '-o', out, prompt]
    if ref_urls: args += ['-i', *ref_urls]
    o = sh(*args, timeout=600)
    if not os.path.exists(out): return key, 'FAIL ' + ((re.search(r'"(?:failure_reason|message|error_code)"\s*:\s*"([^"]+)"', o.stdout or '') or [None, (o.stderr or o.stdout)[-200:]])[1])
    save_ref(g, key, upload(out)); return key, 'ok'

def phase_refs(g, only=None, force=False):
    G = GAMES[g]; jobs = [(k, p, '3:4') for k, p in G['refs'].items()] + [(k, p, '9:16') for k, p in G['sets'].items()]
    jobs = [j for j in jobs if not only or j[0] in only]
    with cf.ThreadPoolExecutor(8) as ex:
        for k, st in ex.map(lambda j: img(g, j[0], j[1], j[2], None, force), jobs): log(g, 'ref', k, st)

def still_prompt(c): return SITCOM + c['still'] + ' ' + 'Exactly the people described, each matching their reference image exactly (same face, hair, clothes). Vertical 9:16 film still.'
def phase_stills(g, only=None, force=False):
    G = GAMES[g]; r = refs(g)
    keys = [k for k in G['clips'] if not only or k in only]
    def go(k): c = G['clips'][k]; return img(g, 's_' + k, still_prompt(c), '9:16', [r[x] for x in c['refs']], force)
    with cf.ThreadPoolExecutor(8) as ex:
        for k, st in ex.map(go, keys): log(g, 'still', k, st)

def render(g, key, force=False):
    c = GAMES[g]['clips'][key]; mp4 = f'{out_dir(g)}/{key}.mp4'
    if os.path.exists(mp4) and os.path.getsize(mp4) > 100000 and not force: return key, 'skip'
    first = refs(g).get('s_' + key)
    if not first: return key, 'no still'
    args = ['gsk', 'video', KEEP + (SILENT if g == 'amu' else '') + c['text'] + ' ' + SITCOM, '-m', MODEL, '--tier', 'standard', '-r', RATIO, '-d', str(c['dur']), '--audio_enable', 'true', '--video_size', '720p', '-o', mp4, '-i', first]
    err = ''
    for attempt in range(2):
        t0 = time.time(); o = sh(*args, timeout=2400)
        open(f'{out_dir(g)}/{key}.log', 'w').write((o.stdout or '')[-3000:] + '\n---\n' + (o.stderr or '')[-800:])
        if os.path.exists(mp4) and os.path.getsize(mp4) > 100000: log(g, key, 'OK', f'{time.time() - t0:.0f}s'); return key, 'ok'
        err = (re.search(r'"(?:failure_reason|error_code|message)"\s*:\s*"([^"]{3,200})"', o.stdout or '') or [None, (o.stderr or o.stdout or '')[-200:]])[1]
        if re.search(r'"status"\s*:\s*"(PENDING|PROCESSING|RUNNING)"', o.stdout or ''): log(g, key, 'pending — not resubmitting'); return key, 'pending'
        log(g, key, 'FAIL', attempt, err); time.sleep(20)
    return key, 'fail: ' + str(err)

def phase_render(games, only=None, force=False):
    jobs = [(g, k) for g in games for k in GAMES[g]['clips'] if not only or k in only or f'{g}:{k}' in only]
    log('render', len(jobs), 'clips, concurrency', CONC); res = {}
    with cf.ThreadPoolExecutor(CONC) as ex:
        for (g, k), st in zip(jobs, ex.map(lambda j: render(j[0], j[1], force), jobs)): res[f'{g}:{k}'] = st
    bad = {k: v for k, v in res.items() if v not in ('ok', 'skip')}
    log('render done', len(res), 'bad', bad); json.dump(res, open(f'{ARCH}/last_run.json', 'w'), indent=1)

def r2put(key, path, ctype):
    o = sh('npx', 'wrangler', 'r2', 'object', 'put', f'webapp-media/{key}', '--file', path, '--content-type', ctype, '--local', cwd=ROOT, timeout=300)
    if o.returncode: raise RuntimeError('r2 put failed ' + key + (o.stderr or '')[-200:])
def phase_publish(g):
    G = GAMES[g]; sid = G['sid']; d = out_dir(g); man = {}
    for k, c in G['clips'].items():
        mp4 = f'{d}/{k}.mp4'
        if not os.path.exists(mp4): log(g, 'missing', k); continue
        r2put(f'{sid}/{k}.mp4', mp4, 'video/mp4')
        man[k] = float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4).stdout.strip() or c['dur'])
    for k in G['refs']:
        p = f'{d}/{k}.png'
        if os.path.exists(p):
            w = f'{d}/{k}.webp'; sh('ffmpeg', '-loglevel', 'error', '-y', '-i', p, '-vf', 'crop=iw:iw:0:0,scale=220:-2', '-q:v', '82', w); r2put(f'{sid}/img/{k}.webp', w, 'image/webp')
    cov = f'{d}/s_intro.png'
    if os.path.exists(cov):
        sh('ffmpeg', '-loglevel', 'error', '-y', '-i', cov, '-vf', 'scale=540:-2', '-q:v', '80', f'{d}/cover.webp'); r2put(f'{sid}/img/cover.webp', f'{d}/cover.webp', 'image/webp')
    ep = 'combo' if g == 'amu' else 'fun'
    req = urllib.request.Request(f'http://localhost:3000/api/admin/{ep}/{sid}/media', data=json.dumps({'clips': man}).encode(), headers={'content-type': 'application/json'})
    log(g, 'PUBLISHED', urllib.request.urlopen(req, timeout=60).read().decode()[:200])

if __name__ == '__main__':
    g, ph = sys.argv[1], sys.argv[2]
    games = list(GAMES) if g == 'all' else [g]
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    force = '--force' in sys.argv
    if ph == 'count': print({x: len(GAMES[x]['clips']) for x in games}); sys.exit()
    if ph == 'render': phase_render(games, only, force); sys.exit()
    for x in games:
        if ph == 'refs': phase_refs(x, only, force)
        elif ph == 'stills': phase_stills(x, only, force)
        elif ph == 'publish': phase_publish(x)
