# 《穹顶之下 · 影剧版》：9 段 Seedance 2.0 音画一体片段（原生普通话对白 + 口型 + 音效 + 配乐），3 个抉择点，5 种结局
# 结构：
#   F_P 序章 ─▶ N1「星核交还是不交？」
#        ├─ A 如约交出 ─▶ F_A ─▶ N_A「枪口转向，谁先动？」
#        │     ├─ 林夏扑向渡鸦 ─▶ E1 以身换命（悲）
#        │     ├─ 陈默开枪     ─▶ E2 黎明同盟（暖）
#        │     └─ ✦小雨的直播（悔棋新变数）─▶ E3 全城曝光
#        ├─ B 暗中调包 ─▶ F_B ─▶ N_B「枪口对准了你，怎么办？」
#        │     ├─ 启动直播 ─▶ E3 全城曝光（燃）
#        │     ├─ 纵身跃下 ─▶ E4 坠落（暗）
#        │     └─ ✦与顾衡谈判（悔棋新变数）─▶ E5 天穹之主（隐藏结局）
#        └─ ✦小雨闯入（悔棋新变数）─▶ F_T ─▶ N_B
REF = 'https://www.genspark.ai/api/files/s/fW8VVeh3'          # 角色设定图
ROOF = 'https://www.genspark.ai/api/files/s/GQ4hHJbS'         # 天台环境（P1 分镜）
BOARD = 'https://www.genspark.ai/api/files/s/zHILEUeY'        # 董事会（P3 分镜）

CAST = """@Image1 is the character sheet, use appearance only. Define the woman with a sharp black bob, long black trench coat and glowing blue wrist port in @Image1 as LinXia. Define the man with messy black hair, stubble, grey detective overcoat and revolver in @Image1 as ChenMo. Define the hooded assassin with black feather cloak, white beak mask and single glowing red eye in @Image1 as Raven. Define the young woman in a yellow raincoat with ponytail and camera in @Image1 as XiaoYu. Define the older man with slicked-back silver hair and white suit in @Image1 as GuHeng."""
STYLE = "Style: high-end Chinese anime feature film, cinematic cel-shaded 2D animation with fluid character motion, volumetric rain, teal and magenta neon rim light, CineStill 800T look, vertical framing. Dialogue language: Mandarin Chinese (Putonghua)."
END = "Face stable and undeformed, consistent costume and hairstyle for every character, natural body proportions, no morphing, no subtitles, no on-screen text, no logo, no watermark."

CLIPS = {
 'F_A': {'parent': 'F_P', 'dur': 12, 'refs': [REF, ROOF], 'shots': """
Shot 1: medium shot, LinXia walks slowly across the wet rooftop toward Raven, holding out the small glowing blue chip. <footsteps on wet concrete, heavy rain>
Shot 2: close-up, Raven takes the chip with a gloved hand; his red eye scans it with a thin red light.
Shot 3: close-up LinXia, rain on her face, she says in Mandarin Chinese, voice tight and urgent: {芯片给你了，我妹妹呢？}
Shot 4: close-up of Raven's beak mask, he says in Mandarin Chinese, low and cold: {在顾先生手里。}
Shot 5: IMMEDIATELY, the rooftop stair door bursts open, ChenMo steps out aiming his revolver, he shouts in Mandarin Chinese: {林夏，趴下！} <door slams open>
Shot 6: low angle, Raven swings his long rifle toward ChenMo, held, tension. (tense low strings rise)"""},
 'F_B': {'parent': 'F_P', 'dur': 12, 'refs': [REF, ROOF], 'shots': """
Shot 1: extreme close-up of LinXia's hand in the rain: the glowing blue chip slides into her sleeve and an identical dull chip slides out, sleight of hand. <soft metallic click>
Shot 2: medium shot, she tosses the chip to Raven, who catches it.
Shot 3: close-up, Raven's red eye scans the chip, the red light flickers and turns to static; he says in Mandarin Chinese, slow and cold: {……这是假的。}
Shot 4: close-up LinXia, a faint dangerous smirk, she says in Mandarin Chinese: {真的那枚，早就不在我身上了。}
Shot 5: low angle, Raven slowly raises his long sniper rifle straight at LinXia, red eye glowing brighter. <sniper rifle bolt racks> (heartbeat-like bass pulse)"""},
 'F_T': {'parent': 'F_P', 'dur': 10, 'refs': [REF, ROOF], 'shots': """
Shot 1: IMMEDIATELY, the rooftop stair door bursts open and XiaoYu runs out in her yellow raincoat, camera raised, flash firing. <door bangs, camera shutter and flash>
Shot 2: close-up XiaoYu, soaked, breathless and excited, she shouts in Mandarin Chinese: {姐！我全拍到了！}
Shot 3: close-up LinXia, eyes wide with fear, she shouts in Mandarin Chinese: {小雨，快走！}
Shot 4: low angle, Raven turns his long rifle from LinXia toward XiaoYu, red eye locking on. <rifle clicks> (music stops, only rain)"""},
 'E1': {'parent': 'F_A', 'dur': 12, 'ending': True, 'refs': [REF, ROOF], 'shots': """
Shot 1: LinXia lunges forward and grabs Raven's rifle barrel with both hands, they struggle in the rain. <grunts, rain>
Shot 2: extreme close-up of the rifle muzzle flash. <single loud gunshot echoing across the city>
Shot 3: slow motion, LinXia falls backward onto the wet rooftop, the blue chip rolls from Raven's hand into a puddle.
Shot 4: ChenMo runs and kneels, cradling LinXia's head, his face breaking; he says in Mandarin Chinese, hoarse: {林夏！撑住！}
Shot 5: close-up LinXia, pale, faint smile, she whispers in Mandarin Chinese: {告诉小雨……别等我了。}
Shot 6: crane up and away from the two figures on the rooftop into the pouring neon rain. (sad solo piano)"""},
 'E2': {'parent': 'F_A', 'dur': 12, 'ending': True, 'refs': [REF, ROOF], 'shots': """
Shot 1: close-up, ChenMo fires his revolver. <revolver gunshot>
Shot 2: Raven's white beak mask cracks; he staggers back, drops the glowing blue chip, and leaps off into the dark. <glass-like crack, cloak flapping>
Shot 3: LinXia picks up the chip from a puddle; the rain slowly stops.
Shot 4: two-shot, ChenMo lowers his gun and says in Mandarin Chinese, tired but warm: {三年前你救我一命，今天还你。}
Shot 5: close-up LinXia, a small relieved smile, she says in Mandarin Chinese: {走吧，去接小雨。}
Shot 6: wide shot, golden dawn light breaks over the skyline behind the two of them standing side by side. (warm hopeful strings swell)"""},
 'E3': {'parent': 'F_B', 'dur': 12, 'ending': True, 'refs': [REF, ROOF, BOARD], 'shots': """
@Image3 is the boardroom environment reference, used only in Shot 4.
Shot 1: close-up, LinXia presses her glowing blue wrist port; blue data light races up her arm. <digital charging whoosh>
Shot 2: aerial wide shot, every giant billboard across the neon city switches to the same glowing blue evidence files at once. <city-wide electric hum>
Shot 3: street level, crowds in the rain look up at the screens, gasping. <crowd gasps and murmurs>
Shot 4: in the boardroom as in @Image3, GuHeng stares at a screen, the wine glass in his hand shatters; he says in Mandarin Chinese, stunned: {……不可能。} <glass shatters>
Shot 5: close-up LinXia on the rooftop, neon reflected in her eyes, she says in Mandarin Chinese, calm and triumphant: {新港，都看清楚了。}
Shot 6: Raven slowly lowers his rifle. (epic rising orchestral hit)"""},
 'E4': {'parent': 'F_B', 'dur': 12, 'ending': True, 'refs': [REF, ROOF], 'shots': """
Shot 1: LinXia turns and sprints toward the rooftop edge. <running footsteps splashing>
Shot 2: slow motion, she leaps off the edge into the neon abyss, trench coat flaring like wings. <wind roar>
Shot 3: Raven walks to the edge and looks down; he says in Mandarin Chinese, flat: {……可惜了。}
Shot 4: falling POV shot of the glowing city rushing past.
Shot 5: close-up LinXia mid-fall, eyes closed, she whispers in Mandarin Chinese: {小雨，对不起。}
Shot 6: her wrist port suddenly blazes blue as she vanishes into the neon below, single-frame hard cut to black. (low dark synth, then silence)"""},
 'E5': {'parent': 'F_B', 'dur': 12, 'ending': True, 'refs': [REF, ROOF], 'shots': """
Shot 1: the rooftop elevator doors slide open; GuHeng steps out under an umbrella, slowly clapping. <elevator ding, slow applause>
Shot 2: medium shot GuHeng, smiling, says in Mandarin Chinese, smooth and cunning: {林小姐，你比渡鸦更适合这个位置。}
Shot 3: close-up LinXia, studying him, rain on her face, silent, jaw tightening.
Shot 4: Raven slowly lowers his rifle and offers it to LinXia with both hands.
Shot 5: LinXia takes the rifle; low angle hero shot, she says in Mandarin Chinese, cold and commanding: {那从今晚起，天穹听我的。}
Shot 6: slow orbit around LinXia holding the rifle, GuHeng and Raven behind her, the red neon dome glowing over the city. (ominous choir)"""},
}
PROLOGUE_FILE = '/tmp/film/P_test.mp4'  # 序章已生成（验证片段）
PROLOGUE_LAST = 'https://www.genspark.ai/api/files/s/ab7muYH1'

def prompt(cid):
    c = CLIPS[cid]
    return f"{CAST}\n@Image2 is the opening composition and environment reference (continue directly from this moment), never its own shot.\n{STYLE}\n{c['shots'].strip()}\n{END}"
