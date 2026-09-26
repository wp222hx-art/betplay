# 《心动回廊 ～传说之樱下的约定～》：原创校园恋爱博弈剧（致敬 90 年代恋爱养成游戏：三年高中 · 传说之树 · 好感度 · 炸弹）
# 结构：序章 → 抉择①「命运的红线系向谁」（4 位女主 + 悔棋新变数：神秘转学生·雪）→ 路线片段 → 抉择②「毕业那天，传说之樱下」→ 21 种结局
# 每段都是 Seedance 2.0 音画一体（普通话原声对白 + 口型 + 音效 + 配乐）
SHEET = 'https://www.genspark.ai/api/files/s/s9Y68CAh'   # 角色设定图（诗音 / 阳菜 / 凛 / 莓 / 雪 / 悠真）
TREE = 'https://www.genspark.ai/api/files/s/h7s5gDIk'    # 传说之樱（后山夕阳）

DEF = {
 'Shion': 'Define the elegant girl with very long straight black hair, white satin ribbon, violet eyes and navy sailor uniform in @Image1 as Shion.',
 'Hina': 'Define the sporty tanned girl with short orange-brown hair, hair clip and orange-white track jacket in @Image1 as Hina.',
 'Rin': 'Define the girl with a silver-blue bob, silver-rim glasses and white lab coat over her sailor uniform in @Image1 as Rin.',
 'Ichigo': 'Define the girl with long pink twin-tails, star hair pins, pink cardigan and pink electric guitar in @Image1 as Ichigo.',
 'Yuki': 'Define the ethereal girl with very long flowing white hair, a cherry blossom hair ornament, pale skin and white dress-like uniform in @Image1 as Yuki.',
 'Yuma': 'Define the boy with messy dark brown hair and black gakuran uniform in @Image1 as Yuma.',
}
STYLE = ('Style: luminous high-end Japanese romance anime feature film, 1990s dating-sim nostalgia with modern cinematic cel-shaded animation, fluid character acting, '
         'soft pastel palette, glowing golden light, bloom and lens flare, drifting cherry blossom petals, vertical framing. Dialogue language: Mandarin Chinese (Putonghua).')
END = 'Faces stable and undeformed, consistent hairstyle and costume for every character, natural proportions, no morphing, no subtitles, no on-screen text, no logo, no watermark.'

# env: 'parent' = 接父片段末帧；'tree' = 传说之樱；None = 只用设定图
CLIPS = {
 # ───────── 序章 ─────────
 'L_P': {'parent': None, 'env': 'tree', 'dur': 12, 'cast': ['Yuma', 'Shion', 'Hina', 'Yuki'], 'title': '入学式·樱花雨', 'shots': """
@Image2 is the legendary cherry tree environment reference, used only in Shot 6.
Shot 1: crane down through a storm of cherry blossom petals onto a Japanese high school gate on the first morning of spring, students walking in. <birdsong, gentle wind> (light nostalgic piano and strings)
Shot 2: Yuma runs through the gate and collides with Shion; her books fall; petals burst around them. <soft thud, pages fluttering>
Shot 3: close-up Shion picking up his student card, a small surprised smile, she says in Mandarin Chinese, gentle and elegant: {你是……春日同学？}
Shot 4: Hina runs up behind and slaps Yuma on the back, grinning, she shouts in Mandarin Chinese: {悠真！开学第一天就撞到学生会长？}
Shot 5: close-up Yuma, blushing, scratching his head.
Shot 6: slow push-in toward the giant cherry tree on the hill behind the school as in @Image2; a white-haired girl, Yuki, stands alone beneath it, held, then petals sweep across and she is gone. (music swells softly)"""},
 # ───────── 路线（抉择①的结果）─────────
 'R_S': {'parent': 'L_P', 'env': None, 'dur': 12, 'cast': ['Yuma', 'Shion'], 'title': '学园祭·天台的烟花', 'shots': """
Shot 1: night of the school festival, rooftop, fireworks bloom over the city. <fireworks booming, distant festival crowd>
Shot 2: medium two-shot, Shion and Yuma lean on the railing; the fireworks light her face in pink and gold.
Shot 3: close-up Shion, looking at the sky, she says in Mandarin Chinese, soft: {春日同学……你听说过后山那棵樱花树的传说吗？}
Shot 4: close-up Yuma turning to her, surprised.
Shot 5: close-up Shion, cheeks slightly flushed, she smiles and says in Mandarin Chinese: {毕业那天，在树下告白的人……会永远幸福。}
Shot 6: slow pull-out, the two small silhouettes under a sky full of fireworks, held. (romantic strings)"""},
 'R_H': {'parent': 'L_P', 'env': None, 'dur': 12, 'cast': ['Yuma', 'Hina'], 'title': '运动会·最后一棒', 'shots': """
Shot 1: sports festival relay race, Hina sprints down the track, the crowd cheering. <crowd cheering, running footsteps, starter whistle>
Shot 2: she trips just before the finish line and falls hard onto the track.
Shot 3: Yuma vaults the fence, runs to her, and carries her piggyback across the finish line. <crowd gasps then roars>
Shot 4: close-up Hina on his back, face red, hiding it in his shoulder, she mutters in Mandarin Chinese: {笨蛋……谁让你对我这么好的。}
Shot 5: close-up Yuma smiling, he says in Mandarin Chinese: {因为你是阳菜啊。}
Shot 6: golden sunset over the track, the two of them in the distance, held. (warm upbeat guitar)"""},
 'R_R': {'parent': 'L_P', 'env': None, 'dur': 12, 'cast': ['Yuma', 'Rin'], 'title': '科学部·失控的实验', 'shots': """
Shot 1: science club lab at night, Rin in her lab coat pours a glowing liquid into a flask while Yuma watches. <bubbling liquid, soft hum>
Shot 2: the flask flashes and bursts into a cloud of glowing pink cherry petals that fill the room. <soft pop, sparkling chime>
Shot 3: Rin's glasses slide down her nose, petals in her hair, she stares at Yuma.
Shot 4: close-up Rin, trying to stay calm, pushing up her glasses, she says in Mandarin Chinese, flat but flustered: {根据计算……你对我心率的影响，超出了误差范围。}
Shot 5: close-up Yuma laughing.
Shot 6: close-up Rin turning away, ears bright red, she whispers in Mandarin Chinese: {……不许笑。} (quirky pizzicato strings)"""},
 'R_I': {'parent': 'L_P', 'env': None, 'dur': 12, 'cast': ['Yuma', 'Ichigo'], 'title': '轻音部·只为你的一首歌', 'shots': """
Shot 1: small live house packed with students, stage lights sweep, Ichigo plays her pink electric guitar and sings. <live band, crowd cheering>
Shot 2: she points into the crowd straight at Yuma and pulls him up onto the stage.
Shot 3: close-up Ichigo into the microphone, she says in Mandarin Chinese, playful and loud: {下一首歌——是写给台下某个笨蛋的！}
Shot 4: the crowd roars; Yuma stands frozen, blushing, spotlight on him. <crowd whoops>
Shot 5: close-up Ichigo covering the mic, winking at him, she whispers in Mandarin Chinese: {不许告诉别人哦。}
Shot 6: confetti rains down as she strikes the first chord, held. (bright pop-rock intro)"""},
 'R_Y': {'parent': 'L_P', 'env': 'tree', 'dur': 12, 'cast': ['Yuma', 'Yuki'], 'title': '雨夜·樱花树下的她', 'shots': """
@Image2 is the legendary cherry tree environment reference; this scene is the same hill on a rainy night.
Shot 1: rainy night, Yuma runs up the hill with an umbrella toward the giant cherry tree glowing faintly in the dark. <rain, footsteps on wet grass>
Shot 2: beneath the tree stands Yuki, completely dry, rain passing through glowing petals around her.
Shot 3: close-up Yuki, a gentle sad smile, she says in Mandarin Chinese, soft and echoing: {你终于……又来了。}
Shot 4: close-up Yuma, stunned, he says in Mandarin Chinese: {我们……以前见过吗？}
Shot 5: close-up Yuki's hand reaching out; a single glowing petal lands on his palm. <soft chime>
Shot 6: slow orbit around the two of them as the petals glow brighter than the rain, held. (ethereal music box melody)"""},
}

# ───────── 21 个结局（抉择②的结果）─────────
def E(parent, cast, title, shots, env='tree', dur=10):
    return {'parent': parent, 'env': env, 'dur': dur, 'cast': cast, 'title': title, 'ending': True, 'shots': shots}
TREE_NOTE = '@Image2 is the legendary cherry tree environment reference (graduation day, full bloom).'
CLIPS.update({
 # 诗音
 'E_S1': E('R_S', ['Yuma', 'Shion'], '传说成真', TREE_NOTE + """
Shot 1: graduation day, Shion waits beneath the giant cherry tree as in @Image2, holding her diploma, petals falling. <wind, petals> (tender piano)
Shot 2: Yuma arrives out of breath; she turns, eyes shining.
Shot 3: close-up Shion, tears welling but smiling, she says in Mandarin Chinese: {我喜欢你。从入学那天被你撞到开始……一直都是。}
Shot 4: close-up Yuma, he smiles and answers in Mandarin Chinese: {我也是。}
Shot 5: wide shot, a huge gust lifts a storm of petals around the two of them as the sun flares, held. (music swells)"""),
 'E_S2': E('R_S', ['Yuma', 'Shion'], '优等生的眼泪', """
Shot 1: airport departure hall at dusk, Shion in a coat with a suitcase, Yuma running toward her. <airport announcements, rolling suitcase>
Shot 2: close-up Shion, trying to smile, she says in Mandarin Chinese: {伦敦的大学……我还是决定去了。}
Shot 3: she presses a pressed cherry blossom into his hand.
Shot 4: close-up Shion, a tear falls, she whispers in Mandarin Chinese: {等我回来，树下见。}
Shot 5: through the window a plane rises into the orange sky, Yuma holding the petal, held. (bittersweet strings)""", env=None),
 'E_S3': E('R_S', ['Yuma', 'Shion'], '全校广播的告白', """
Shot 1: student council broadcast room, Shion practices a confession alone into a microphone, not noticing the red ON AIR light is lit. <soft electronic hum>
Shot 2: close-up Shion, eyes closed, she says in Mandarin Chinese: {春日同学，我……我喜欢你！}
Shot 3: IMMEDIATELY, across the whole school, speakers blare; students in hallways freeze and then scream with excitement. <speaker echo, crowd cheering>
Shot 4: close-up Shion noticing the ON AIR light, her face turns bright red.
Shot 5: the door slams open and Yuma stands there grinning, he says in Mandarin Chinese: {我听到了——全校都听到了。} (comedic brass sting)""", env=None),
 'E_S4': E('R_S', ['Yuma', 'Shion'], '大小姐的三年计划', TREE_NOTE + """
Shot 1: beneath the cherry tree as in @Image2, Shion opens an old diary full of plans and photos of Yuma from childhood. <pages turning>
Shot 2: close-up of a faded photo: two small children holding hands under the same tree.
Shot 3: close-up Shion, a mischievous smile, she says in Mandarin Chinese: {入学那天的相撞……是我计划好的。}
Shot 4: close-up Yuma, jaw dropping.
Shot 5: close-up Shion leaning in, she whispers in Mandarin Chinese: {十年前你答应过娶我——想赖账吗？} (playful romantic strings)"""),
 # 阳菜
 'E_H1': E('R_H', ['Yuma', 'Hina'], '终点线的告白', """
Shot 1: final race of the high school championship, Hina crosses the finish line first and does not stop running. <stadium roar>
Shot 2: she runs straight past her teammates to Yuma at the fence.
Shot 3: close-up Hina, breathless, sweat and tears shining, she shouts in Mandarin Chinese: {悠真！我喜欢你！从小就喜欢！}
Shot 4: the whole stadium turns and cheers. <crowd erupts>
Shot 5: Yuma catches her as she jumps into his arms, slow motion, confetti and sun flare. (triumphant rock anthem)""", env=None),
 'E_H2': E('R_H', ['Yuma', 'Hina'], '永远的青梅竹马', """
Shot 1: summer evening riverbank, Hina and Yuma sit on the grass, fireflies around them. <crickets, river>
Shot 2: close-up Hina, hugging her knees, she says in Mandarin Chinese, soft: {我们……就一直这样，好不好？}
Shot 3: she bumps her shoulder against his, grinning to hide her feelings.
Shot 4: close-up Yuma, smiling gently, he says in Mandarin Chinese: {嗯。一直这样。}
Shot 5: slow pull-back, the two silhouettes among the fireflies, held. (gentle acoustic guitar)""", env=None),
 'E_H3': E('R_H', ['Yuma', 'Hina'], '错过的夏天', """
Shot 1: school hallway, Yuma walks up holding a letter, then stops.
Shot 2: through the window he sees Hina laughing with a tall boy from the track team, her face bright.
Shot 3: close-up Yuma lowering the letter.
Shot 4: Hina notices him, freezes, she says in Mandarin Chinese, quiet: {悠真……你一直都没有说。}
Shot 5: the letter slips from his hand and drifts down onto the floor, cicadas buzzing, held. <cicadas> (melancholic piano)""", env=None),
 'E_H4': E('R_H', ['Yuma', 'Hina', 'Shion', 'Rin', 'Ichigo'], '传说之树·修罗场', TREE_NOTE + """
Shot 1: graduation day, Hina runs up to the cherry tree as in @Image2 and stops dead.
Shot 2: Shion, Rin and Ichigo are already standing beneath the tree, all holding love letters, all turning at once. <record-scratch style comedic stop>
Shot 3: close-up Yuma arriving, looking at the four girls, sweating.
Shot 4: close-up Hina, pointing at him, she shouts in Mandarin Chinese: {悠真！你到底——约了几个人？！}
Shot 5: all four girls step toward him at once as he backs away; petals explode around them. (chaotic comedic orchestra)"""),
 # 凛
 'E_R1': E('R_R', ['Yuma', 'Rin'], '心跳方程式', """
Shot 1: empty classroom at sunset, Rin writes a long equation across the whole blackboard, chalk dust glowing. <chalk tapping>
Shot 2: the final line of the equation forms the shape of a heart.
Shot 3: close-up Rin, turning around, glasses flashing, she says in Mandarin Chinese, trying to be logical: {结论只有一个——我，喜欢你。}
Shot 4: close-up Yuma, smiling, he says in Mandarin Chinese: {这道题，我也算出来了。}
Shot 5: she drops the chalk as he takes her hand, golden light fills the room. (warm strings)""", env=None),
 'E_R2': E('R_R', ['Yuma', 'Rin'], '十年后的来信', """
Shot 1: science club lab, a strange machine hums with blue light; Rin stands inside the glowing ring. <electric hum rising>
Shot 2: close-up Rin, determined, she says in Mandarin Chinese: {我去十年后看一眼——看你有没有娶我。}
Shot 3: a flash of white light, she vanishes, leaving a single glowing petal. <thunderous whoosh>
Shot 4: seconds later she reappears, older by ten years, in a wedding dress under her lab coat, smiling.
Shot 5: close-up adult Rin, she says in Mandarin Chinese: {答案是——会的。} (magical sci-fi fanfare)""", env=None),
 'E_R3': E('R_R', ['Yuma', 'Rin'], '恋爱药水事故', """
Shot 1: lab, Rin holds up a pink bubbling potion with a heart-shaped label, eyes gleaming.
Shot 2: she trips, and the potion splashes all over herself. <glass clink, splash>
Shot 3: close-up Rin, pink sparkles around her, her cool expression melts into a dreamy blush.
Shot 4: she clings to Yuma's arm, she says in Mandarin Chinese, sugary sweet: {春日……你今天好帅哦……}
Shot 5: close-up Yuma, panicking, sweating, she nuzzles closer. (silly comedic music)""", env=None),
 'E_R4': E('R_R', ['Yuma', 'Rin'], '实验对象', """
Shot 1: night lab, Yuma finds a wall covered with photos of himself and graphs labeled with hearts. <soft hum>
Shot 2: Rin steps out from the shadows, arms folded.
Shot 3: close-up Rin, calm, she says in Mandarin Chinese: {三年的观察记录。你是我唯一的实验对象。}
Shot 4: she tears up a letter of acceptance from a famous overseas research institute.
Shot 5: close-up Rin, a rare soft smile, she says in Mandarin Chinese: {结论——我选你，不选诺贝尔奖。} (tense then tender strings)""", env=None),
 # 莓
 'E_I1': E('R_I', ['Yuma', 'Ichigo'], '万人面前的告白', """
Shot 1: huge concert arena, tens of thousands of glowing light sticks, Ichigo on stage in a sparkling costume. <massive crowd roar>
Shot 2: she stops the music mid-song and points into the front row at Yuma.
Shot 3: close-up Ichigo, into the mic, voice shaking, she says in Mandarin Chinese: {全世界听好了——我喜欢的人，就在那里！}
Shot 4: the arena erupts; a spotlight falls on Yuma. <crowd explodes>
Shot 5: she jumps off the stage into his arms as pink confetti fills the air, slow motion. (euphoric pop anthem)""", env=None),
 'E_I2': E('R_I', ['Yuma', 'Ichigo'], '出道的代价', """
Shot 1: rainy night, Yuma in his small room watching a TV broadcast of Ichigo's debut concert. <rain on window, TV crowd noise>
Shot 2: on the TV, Ichigo sings a slow ballad alone under a spotlight.
Shot 3: close-up on the TV screen, she looks straight into the camera and says in Mandarin Chinese: {这首歌……送给那个再也见不到的人。}
Shot 4: close-up Yuma, a tear rolls down his cheek.
Shot 5: he touches the screen as she smiles through her own tears, held. (heartbreaking ballad)""", env=None),
 'E_I3': E('R_I', ['Yuma', 'Ichigo'], '两个人的乐队', """
Shot 1: street corner at night under neon, Ichigo plays guitar while Yuma plays a small keyboard, a small crowd gathered. <street busking music, light applause>
Shot 2: close-up Ichigo grinning at him mid-song.
Shot 3: she leans over, she says in Mandarin Chinese: {组合名我想好了——就叫“笨蛋和我”！}
Shot 4: close-up Yuma laughing, he says in Mandarin Chinese: {那我是哪个？}
Shot 5: both burst out laughing and hit the final chord together, the crowd cheers. (cheerful indie pop)""", env=None),
 'E_I4': E('R_I', ['Yuma', 'Ichigo'], '偶像的素颜', """
Shot 1: backstage after a show, Ichigo sits alone before a mirror and slowly pulls off her pink twin-tail wig. <soft rustle>
Shot 2: underneath, short plain black hair; she removes the star pins, looking small and shy.
Shot 3: Yuma appears in the mirror behind her; she freezes.
Shot 4: close-up Ichigo, blushing, voice tiny, she says in Mandarin Chinese: {这样的我……你还会喜欢吗？}
Shot 5: close-up Yuma kneeling beside her, he says in Mandarin Chinese: {我喜欢的，一直是这样的你。} (soft piano)""", env=None),
 # 雪
 'E_Y1': E('R_Y', ['Yuma', 'Yuki'], '千年之约', TREE_NOTE + """
Shot 1: graduation day, Yuki stands beneath the cherry tree as in @Image2, her body faintly transparent and glowing.
Shot 2: close-up Yuki, she says in Mandarin Chinese, soft: {我是这棵树等了一千年的约定。}
Shot 3: Yuma takes both her hands; he says in Mandarin Chinese: {那这一次——换我来守约。}
Shot 4: the entire tree bursts into blinding pink light; her body becomes solid and warm, color flooding into her cheeks. <magical chime swell>
Shot 5: wide shot, the two embrace under a whirlwind of glowing petals at sunset. (grand emotional orchestra)"""),
 'E_Y2': E('R_Y', ['Yuma', 'Yuki'], '樱花散落', TREE_NOTE + """
Shot 1: last petals falling from the cherry tree as in @Image2; Yuki smiles at Yuma.
Shot 2: close-up Yuki, her fingertips dissolving into petals, she says in Mandarin Chinese: {谢谢你……记得我。}
Shot 3: Yuma reaches for her, but his hand passes through a cloud of petals.
Shot 4: close-up Yuma on his knees, holding a single petal. <wind>
Shot 5: crane up, the bare tree and one boy alone, petals rising into the sky. (sorrowful solo violin)"""),
 'E_Y3': E('R_Y', ['Yuma', 'Yuki'], '第一千次入学式', """
Shot 1: Yuma wakes with a gasp in bed; the calendar shows the first day of school again. <alarm clock ringing>
Shot 2: he runs to the school gate; the same petals fall, the same students walk in. <birdsong>
Shot 3: Yuki stands at the gate waiting for him, smiling knowingly.
Shot 4: close-up Yuki, she says in Mandarin Chinese: {这是第一千次了。这一次，你会选我吗？}
Shot 5: close-up Yuma, eyes widening as a clock face superimposes over the sky, single-frame hard cut to white. (eerie music box)""", env=None),
 'E_Y4': E('R_Y', ['Yuma', 'Yuki'], '雪的真身', """
Shot 1: hospital room, soft morning light, a girl with long white hair lies asleep connected to monitors. <heart monitor beeping>
Shot 2: Yuma sits beside the bed holding a cherry blossom; he realizes it is Yuki.
Shot 3: her fingers twitch; the heart monitor beeps faster.
Shot 4: close-up Yuki opening her eyes, weak, she whispers in Mandarin Chinese: {我在梦里……一直在树下等你。}
Shot 5: close-up Yuma crying and smiling, he says in Mandarin Chinese: {我来了。} (hopeful piano)""", env=None),
 'E_Y5': E('R_Y', ['Yuma', 'Yuki', 'Shion', 'Hina', 'Rin', 'Ichigo'], '心动回廊·真结局', TREE_NOTE + """
Shot 1: graduation day, all five girls, Shion, Hina, Rin, Ichigo and Yuki, stand together beneath the cherry tree as in @Image2, smiling at Yuma.
Shot 2: close-up Yuki, she says in Mandarin Chinese: {传说不是只能选一个人——而是让所有人都幸福。}
Shot 3: Hina, Ichigo and Rin throw their graduation caps into the air, laughing. <cheering>
Shot 4: close-up Shion, she says in Mandarin Chinese: {所以——三年后，我们还在这里见！}
Shot 5: wide crane up, everyone together under an explosion of glowing petals and golden light. (grand joyful finale theme)"""),
})
ENDING_ORDER = ['E_S1', 'E_S2', 'E_S3', 'E_S4', 'E_H1', 'E_H2', 'E_H3', 'E_H4', 'E_R1', 'E_R2', 'E_R3', 'E_R4', 'E_I1', 'E_I2', 'E_I3', 'E_I4', 'E_Y1', 'E_Y2', 'E_Y3', 'E_Y4', 'E_Y5']

def prompt(cid, parent_last=None):
    c = CLIPS[cid]
    defs = ' '.join(DEF[x] for x in c['cast'])
    env = ''
    if c['env'] == 'parent' and parent_last: env = '@Image2 is the opening composition reference (continue directly from this moment), never its own shot.\n'
    return f"@Image1 is the character sheet, use appearance only. {defs}\n{env}{STYLE}\n{c['shots'].strip()}\n{END}"

def refs(cid, parent_last=None):
    c = CLIPS[cid]
    if c['env'] == 'tree': return [SHEET, TREE]
    if c['env'] == 'parent' and parent_last: return [SHEET, parent_last]
    return [SHEET]
