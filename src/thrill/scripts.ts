// 惊心 1 分钟 · 首批 3 部剧本（v2 结构：线性主线 + 硬币猜卡 + 无限加时卡）
// 设计铁律：
//  ① 主线一条线演到底：人物 / 服装 / 场景 / 时间连续，不分叉 → 一致性有保障
//  ② 猜卡只猜「瞬间」：两面揭晓片段（4 秒）都必须自然接回下一段主线，任何一面都不改变剧情事实
//  ③ 决策点清晰：每张卡只有 A / B，画面一眼可判，问题一句话说完
//  ④ 加时卡 = 同一世界里的氛围微瞬间，可无限运营扩充
// 制作字段（cast / look / set / prompt / shot）供生产管线使用，引擎忽略
const STYLE = 'Photorealistic live-action film still, shot on ARRI Alexa Mini with 35mm anamorphic lens, natural skin texture with visible pores and slight imperfections, no makeup look, no beauty filter, no CGI sheen, subtle film grain, practical motivated lighting, muted desaturated color grade, shallow depth of field, handheld documentary realism, East Asian cast'

type Seg = { title: string; dur: number; lines: string[]; shot: string; prompt: string; video_url?: string | null; poster?: string | null; cast: string[] }
const S = (title: string, dur: number, cast: string[], shot: string, prompt: string, lines: string[] = []): Seg => ({ title, dur, cast, shot, prompt, lines, video_url: null, poster: null })

// ───────────────────────── ① 坠梯 ─────────────────────────
const ELEVATOR = {
  v: 2,
  series: { id: 'thr_elevator', title: '坠梯', tension: 5, logline: '23:40，写字楼 17 层。加班的林夏走进电梯，角落里站着一个压低帽檐的男人。钢缆一声巨响——', gated: true },
  style: STYLE,
  set: 'Inside a small old office-building elevator at night: brushed stainless-steel walls with scratches and fingerprints, a dented handrail, a red digital floor indicator above the door, a cold flickering fluorescent ceiling panel, a small emergency intercom button panel. Claustrophobic, 2m x 1.5m.',
  cast: {
    linxia: { name: '林夏', look: 'Chinese woman, 28, tired office worker, oval face, natural thin eyebrows, low ponytail with loose strands, white button-up shirt, charcoal grey blazer, blue ID lanyard, small silver stud earrings, slightly dark under-eye circles' },
    man: { name: '帽檐男人', look: 'Chinese man, 35, lean, faded black baseball cap pulled low, dark grey worn work jacket, three-day stubble, a thin vertical scar through his left eyebrow, quiet hollow eyes, slightly pale skin' }
  },
  main: ['e_m0', 'e_m1', 'e_m2', 'e_m3', 'e_m4', 'e_m5'],
  cards: [
    { id: 'e_c1', at: 0, q: '他会抬头看她吗？', a: { label: '抬头盯着她', seg: 'e_c1a' }, b: { label: '始终低着头', seg: 'e_c1b' } },
    { id: 'e_c2', at: 1, q: '紧急呼叫，有人应答吗？', a: { label: '有人声', seg: 'e_c2a' }, b: { label: '只有电流声', seg: 'e_c2b' } },
    { id: 'e_c3', at: 2, q: '他从外套里掏出的是？', a: { label: '一把折叠刀', seg: 'e_c3a' }, b: { label: '一部手机', seg: 'e_c3b' } },
    { id: 'e_c4', at: 3, q: '电梯再次下坠——他会？', a: { label: '扑过来护住她', seg: 'e_c4a' }, b: { label: '一把把她拽到身边', seg: 'e_c4b' } },
    { id: 'e_c5', at: 4, q: '门缝里先伸进来的是？', a: { label: '一只戴手套的手', seg: 'e_c5a' }, b: { label: '液压钳的钳口', seg: 'e_c5b' } },
    { id: 'e_x1', q: '监控回放里，他的脸——', a: { label: '看向镜头', seg: 'e_x1a' }, b: { label: '背对镜头', seg: 'e_x1b' } },
    { id: 'e_x2', q: '黑帽子里掉出来的是？', a: { label: '一张旧工牌', seg: 'e_x2a' }, b: { label: '一张她的照片', seg: 'e_x2b' } },
    { id: 'e_x3', q: '空电梯的楼层灯最后停在？', a: { label: '13', seg: 'e_x3a' }, b: { label: '17', seg: 'e_x3b' } }
  ],
  segments: {
    e_m0: S('23:40 · 17 层', 6, ['linxia', 'man'], 'medium wide from inside the elevator facing the doors', 'The elevator doors slide open; exhausted Lin Xia steps in holding her phone, presses a button and leans on the wall. In the back corner the man in the black cap stands motionless, head down. The doors close. Red floor indicator reads 17.', ['林夏（看表）：……又是最后一个。']),
    e_c1a: S('他抬头了', 4, ['linxia', 'man'], 'close-up over Lin Xia shoulder', 'The man slowly lifts his head and stares straight at Lin Xia from under the cap brim, unblinking. She freezes.', []),
    e_c1b: S('他没抬头', 4, ['linxia', 'man'], 'close-up profile of the man', 'The man keeps his head down, cap brim hiding his eyes; only his jaw tightens. Lin Xia glances at him and quickly looks away.', []),
    e_m1: S('钢缆', 6, ['linxia', 'man'], 'handheld medium shot, violent camera shake', 'A deafening metallic bang. The elevator drops sharply and slams to a halt. The fluorescent light dies and a dim red emergency light comes on. Lin Xia is thrown against the steel wall, gasping. The floor indicator flickers between 12 and 13.', ['林夏：啊——！']),
    e_c2a: S('有人应答', 4, ['linxia'], 'close-up of Lin Xia at the intercom panel under red light', 'Lin Xia jabs the emergency call button; a crackling voice answers through the speaker. Relief floods her face.', ['对讲：……坚持住，我们马上到。']),
    e_c2b: S('无人应答', 4, ['linxia'], 'close-up of Lin Xia at the intercom panel under red light', 'Lin Xia jabs the emergency call button again and again; only harsh static hisses from the speaker. Her breathing quickens.', ['（刺啦——刺啦——）']),
    e_m2: S('疤', 6, ['linxia', 'man'], 'slow push-in on the man under red emergency light', 'In the red light the man slowly takes off his black cap, revealing the thin scar through his left eyebrow. He takes one step toward Lin Xia. She presses her back against the wall.', ['男人：别怕。']),
    e_c3a: S('折叠刀', 4, ['man'], 'insert close-up of his hand', 'The man pulls a small folding knife from inside his jacket; the blade flicks open and catches the red light.', []),
    e_c3b: S('手机', 4, ['man'], 'insert close-up of his hand', 'The man pulls an old cracked phone from inside his jacket; the screen lights his face with a pale glow.', []),
    e_m3: S('你先走', 6, ['linxia', 'man'], 'two-shot, tight, red light', 'The man presses the object into Lin Xia\'s trembling hands and closes her fingers around it. He looks her in the eye, calm and sad.', ['男人：门一开，你先走。别回头。']),
    e_c4a: S('护住', 4, ['linxia', 'man'], 'handheld, violent shake', 'The elevator lurches and drops again; the man lunges and shields Lin Xia\'s head against his chest as they hit the floor.', []),
    e_c4b: S('拽住', 4, ['linxia', 'man'], 'handheld, violent shake', 'The elevator lurches and drops again; the man grabs the handrail with one hand and yanks Lin Xia to his side with the other.', []),
    e_m4: S('门缝', 6, ['linxia', 'man'], 'low angle toward the doors', 'Grinding metal sounds outside. A thin blade of white light cuts through the gap of the elevator doors. Behind Lin Xia the man silently steps back into the darkest corner.', ['门外：里面有人吗？！']),
    e_c5a: S('一只手', 4, ['linxia'], 'close-up on the door gap', 'A firefighter\'s gloved hand pushes through the door gap and gropes forward.', []),
    e_c5b: S('液压钳', 4, ['linxia'], 'close-up on the door gap', 'The steel jaws of a hydraulic spreader push into the door gap and force it wider with a screech.', []),
    e_m5: S('只有她', 8, ['linxia'], 'medium shot, then she turns, rack focus to the empty corner', 'The doors are forced open, flashlight beams flood in, a firefighter pulls Lin Xia out. She turns back toward the corner: it is empty. Only the black cap lies on the elevator floor.', ['消防员：就你一个人？', '字幕：17 楼监控——她进电梯时，电梯里只有她一个人。']),
    e_x1a: S('看向镜头', 4, [], 'grainy black-and-white CCTV footage, top corner angle', 'Grainy CCTV footage of the elevator: Lin Xia alone, and for one frame a faint figure in a black cap in the corner lifts his face straight into the camera.', []),
    e_x1b: S('背对镜头', 4, [], 'grainy black-and-white CCTV footage, top corner angle', 'Grainy CCTV footage of the elevator: Lin Xia alone, and for one frame a faint figure in a black cap stands in the corner with his back to the camera.', []),
    e_x2a: S('旧工牌', 4, [], 'insert close-up on elevator floor', 'A hand lifts the black cap from the elevator floor; a faded old staff ID badge slips out, the photo shows the scarred man, dated 2016.', []),
    e_x2b: S('她的照片', 4, [], 'insert close-up on elevator floor', 'A hand lifts the black cap from the elevator floor; a small worn photo slips out: Lin Xia as a little girl, smiling.', []),
    e_x3a: S('13', 4, [], 'static shot of empty elevator, doors open', 'The empty elevator stands open in a dark corridor; the red floor indicator flickers and settles on 13.', []),
    e_x3b: S('17', 4, [], 'static shot of empty elevator, doors open', 'The empty elevator stands open in a dark corridor; the red floor indicator flickers and settles on 17.', [])
  }
}

// ───────────────────────── ② 人质谈判 ─────────────────────────
const HOSTAGE = {
  v: 2,
  series: { id: 'thr_hostage', title: '人质谈判', tension: 5, logline: '银行劫案第 3 小时。劫匪的枪顶着柜员的太阳穴，对走进来的谈判专家只说了一句：「给你一分钟。」', gated: true },
  style: STYLE,
  set: 'A small neighbourhood bank branch hall in daytime, blinds half drawn, red and blue police lights pulsing through the slats, scattered deposit slips on the grey tile floor, a teller counter with glass partition, overturned chair, dusty fluorescent light.',
  cast: {
    shen: { name: '沈默', look: 'Chinese woman, 36, police hostage negotiator, short practical black bob haircut, navy blue suit with white shirt, small black earpiece in right ear, calm sharp eyes, faint fine lines, no jewelry' },
    robber: { name: '劫匪', look: 'Chinese man, 42, desperate father, unshaven with grey stubble, sweat-soaked dark green hoodie, bloodshot eyes, holding a black pistol, trembling hands' },
    teller: { name: '小周', look: 'Chinese woman, 24, bank teller, dark blue bank uniform vest with name badge, hair in a neat bun coming loose, tear-streaked face' }
  },
  main: ['h_m0', 'h_m1', 'h_m2', 'h_m3', 'h_m4', 'h_m5'],
  cards: [
    { id: 'h_c1', at: 0, q: '他会让她靠近吗？', a: { label: '喝令站住', seg: 'h_c1a' }, b: { label: '示意再走两步', seg: 'h_c1b' } },
    { id: 'h_c2', at: 1, q: '他会捡起手机吗？', a: { label: '弯腰捡起', seg: 'h_c2a' }, b: { label: '一脚踢开', seg: 'h_c2b' } },
    { id: 'h_c3', at: 2, q: '狙击手报告「有角度」——她会？', a: { label: '轻轻摇头', seg: 'h_c3a' }, b: { label: '抬手示意等', seg: 'h_c3b' } },
    { id: 'h_c4', at: 3, q: '枪口转向了谁？', a: { label: '柜员小周', seg: 'h_c4a' }, b: { label: '谈判专家沈默', seg: 'h_c4b' } },
    { id: 'h_c5', at: 4, q: '枪响了吗？', a: { label: '响了——打中天花板', seg: 'h_c5a' }, b: { label: '没响——他松开了手指', seg: 'h_c5b' } },
    { id: 'h_x1', q: '第一个冲进门的特警——', a: { label: '举着防爆盾', seg: 'h_x1a' }, b: { label: '端着步枪', seg: 'h_x1b' } },
    { id: 'h_x2', q: '他被押走时回头看的是？', a: { label: '沈默', seg: 'h_x2a' }, b: { label: '小周', seg: 'h_x2b' } },
    { id: 'h_x3', q: '沈默走出银行，她的手——', a: { label: '在发抖', seg: 'h_x3a' }, b: { label: '稳如磐石', seg: 'h_x3b' } }
  ],
  segments: {
    h_m0: S('一分钟', 6, ['shen', 'robber', 'teller'], 'wide shot from behind the robber toward the entrance', 'The glass door opens; negotiator Shen Mo walks in slowly with both hands raised. Behind the teller counter the robber jams a pistol against the temple of the crying teller.', ['劫匪：站那儿！……给你一分钟。']),
    h_c1a: S('站住', 4, ['shen', 'robber'], 'medium shot on robber', 'The robber jerks the gun toward Shen Mo and screams at her to stop; she freezes mid-step, hands still raised.', ['劫匪：再动一步试试！']),
    h_c1b: S('再走两步', 4, ['shen', 'robber'], 'medium shot on Shen Mo walking', 'The robber flicks the gun, signalling her closer; Shen Mo takes two careful steps forward, eyes locked on him.', []),
    h_m1: S('线上', 6, ['shen', 'robber'], 'low angle along the floor', 'Shen Mo crouches slowly and slides her phone across the tile floor; it spins to a stop at the robber\'s feet, screen lit, speaker on.', ['沈默：你女儿在线上。']),
    h_c2a: S('捡起', 4, ['robber'], 'close-up', 'Keeping the gun on the teller, the robber bends and picks up the phone with a shaking hand, staring at the screen.', []),
    h_c2b: S('踢开', 4, ['robber'], 'close-up on feet', 'The robber kicks the phone away; it skids under a chair but stays lit, speaker still on.', []),
    h_m2: S('爸爸？', 6, ['robber', 'teller'], 'slow push-in on the robber\'s face', 'From the phone speaker a little girl\'s voice says "Daddy?". The robber\'s face crumples; the muzzle pressed to the teller\'s head starts to tremble.', ['电话：……爸爸？是你吗？']),
    h_c3a: S('摇头', 4, ['shen'], 'extreme close-up on Shen Mo', 'In her earpiece a sniper reports he has a shot; Shen Mo gives a tiny, almost invisible shake of the head.', ['耳机：有角度了。']),
    h_c3b: S('等', 4, ['shen'], 'extreme close-up on Shen Mo and her hand', 'In her earpiece a sniper reports he has a shot; Shen Mo lowers one hand slightly, palm down — wait.', ['耳机：有角度了。']),
    h_m3: S('七号窗口', 6, ['robber', 'teller'], 'two-shot, tight', 'The teller suddenly turns her tear-streaked face toward the robber and whispers. He stares at her, stunned.', ['小周：我认识你……你每周四都来七号窗口，给女儿存钱。']),
    h_c4a: S('转向小周', 4, ['robber', 'teller'], 'medium close-up', 'Panicked, the robber swings the muzzle back hard against the teller\'s forehead; she squeezes her eyes shut.', []),
    h_c4b: S('转向沈默', 4, ['robber', 'shen'], 'over-the-shoulder toward Shen Mo', 'Panicked, the robber swings the gun toward Shen Mo; she does not flinch.', []),
    h_m4: S('给我', 6, ['shen', 'robber'], 'slow tracking shot as Shen Mo approaches', 'Shen Mo walks straight to the counter, step by step, and wraps her hand around the barrel of the pistol.', ['沈默：她还在等你回家。把它给我。']),
    h_c5a: S('枪响', 4, ['shen', 'robber'], 'handheld, sudden', 'A gunshot — the pistol jerks upward, plaster dust rains from the ceiling; Shen Mo still grips the barrel.', []),
    h_c5b: S('松手', 4, ['shen', 'robber'], 'insert close-up on the trigger finger', 'The robber\'s trembling finger slowly slides off the trigger; Shen Mo eases the pistol out of his hand.', []),
    h_m5: S('未接通', 8, ['shen', 'robber', 'teller'], 'wide then insert on the phone screen', 'The robber drops to his knees sobbing; Shen Mo pulls the teller into her arms as tactical officers storm in. Shen Mo picks up the phone: the screen shows a voice recording file, the call was never connected.', ['字幕：通话记录——「女儿」：未接通。', '沈默（低声）：……对不起。']),
    h_x1a: S('防爆盾', 4, [], 'handheld from the doorway', 'The bank door bursts open; the first tactical officer charges in behind a black ballistic shield.', []),
    h_x1b: S('步枪', 4, [], 'handheld from the doorway', 'The bank door bursts open; the first tactical officer sweeps in with a rifle raised, red laser cutting through the dust.', []),
    h_x2a: S('回头看她', 4, ['robber', 'shen'], 'medium shot', 'Handcuffed and led away, the robber looks back over his shoulder at Shen Mo.', []),
    h_x2b: S('回头看小周', 4, ['robber', 'teller'], 'medium shot', 'Handcuffed and led away, the robber looks back over his shoulder at the teller.', []),
    h_x3a: S('发抖', 4, ['shen'], 'close-up on her hands outside the bank, police lights', 'Outside the bank under flashing police lights, Shen Mo tries to light a cigarette; her hands are shaking badly.', []),
    h_x3b: S('稳', 4, ['shen'], 'close-up on her hands outside the bank, police lights', 'Outside the bank under flashing police lights, Shen Mo calmly buttons her jacket, hands perfectly steady.', [])
  }
}

// ───────────────────────── ③ 最后一把 ─────────────────────────
const LASTHAND = {
  v: 2,
  series: { id: 'thr_lasthand', title: '最后一把', tension: 4, logline: '地下牌室，一盏吊灯。欠下高利贷的老陈把左手按在桌上，旁边放着一把剁刀。「输了，留一根。」', gated: true },
  style: STYLE,
  set: 'A cramped underground card room at night: a worn green felt poker table under a single low hanging lamp with a tin shade, cigarette smoke drifting, concrete walls, stacks of chips, an old cleaver lying on the felt, dark edges of the room in shadow.',
  cast: {
    chen: { name: '老陈', look: 'Chinese man, 46, gambler in debt, rumpled sweat-stained white shirt with rolled sleeves, receding hairline, deep forehead lines, nervous darting eyes, cheap steel watch' },
    scar: { name: '刀疤', look: 'Chinese man, 52, loan-shark boss, heavy build, shaved head, long scar across right cheek, thick gold chain over black silk shirt, cigar in mouth, cold half-lidded eyes' },
    dealer: { name: '荷官', look: 'Chinese woman, 30, card dealer, black vest over white shirt, black hair slicked into a tight low bun, small single pearl earring, expressionless face, precise hands' }
  },
  main: ['l_m0', 'l_m1', 'l_m2', 'l_m3', 'l_m4', 'l_m5'],
  cards: [
    { id: 'l_c1', at: 0, q: '第一张公共牌——', a: { label: '红', seg: 'l_c1a' }, b: { label: '黑', seg: 'l_c1b' } },
    { id: 'l_c2', at: 1, q: '刀疤会？', a: { label: '推筹码加注', seg: 'l_c2a' }, b: { label: '敲桌过牌', seg: 'l_c2b' } },
    { id: 'l_c3', at: 2, q: '荷官发牌时的手——', a: { label: '顿了一下', seg: 'l_c3a' }, b: { label: '一点没停', seg: 'l_c3b' } },
    { id: 'l_c4', at: 3, q: '她袖口里掉出的是？', a: { label: '黑桃 A', seg: 'l_c4a' }, b: { label: '红心 K', seg: 'l_c4b' } },
    { id: 'l_c5', at: 4, q: '剁刀被谁先抓住？', a: { label: '刀疤', seg: 'l_c5a' }, b: { label: '荷官', seg: 'l_c5b' } },
    { id: 'l_x1', q: '翻开老陈的底牌——', a: { label: '同花', seg: 'l_x1a' }, b: { label: '什么都不是', seg: 'l_x1b' } },
    { id: 'l_x2', q: '刀疤的雪茄——', a: { label: '掉在地上', seg: 'l_x2a' }, b: { label: '还叼在嘴里', seg: 'l_x2b' } },
    { id: 'l_x3', q: '老陈走出牌室，他会？', a: { label: '回头看一眼', seg: 'l_x3a' }, b: { label: '头也不回', seg: 'l_x3b' } }
  ],
  segments: {
    l_m0: S('留一根', 6, ['chen', 'scar', 'dealer'], 'top-down then low angle across the felt', 'Under the single hanging lamp Old Chen flattens his left hand on the green felt next to an old cleaver. Across the table Scar exhales cigar smoke. The dealer begins dealing cards with crisp precise flicks.', ['刀疤：输了，留一根。']),
    l_c1a: S('红', 4, ['dealer'], 'insert close-up on the felt', 'The dealer flips the first community card: a red heart card lands face up under the lamp.', []),
    l_c1b: S('黑', 4, ['dealer'], 'insert close-up on the felt', 'The dealer flips the first community card: a black spade card lands face up under the lamp.', []),
    l_m1: S('汗', 6, ['chen'], 'extreme close-up', 'Old Chen lifts the corner of his hole cards; his fingers tremble. A drop of sweat falls from his chin onto the green felt.', []),
    l_c2a: S('加注', 4, ['scar'], 'medium close-up', 'Scar slowly pushes a tall stack of chips into the middle without taking his eyes off Old Chen.', ['刀疤：加。']),
    l_c2b: S('过牌', 4, ['scar'], 'medium close-up', 'Scar taps two thick fingers on the felt — check — and smirks around his cigar.', []),
    l_m2: S('全押', 6, ['chen', 'scar'], 'slow push-in', 'Old Chen shoves every chip he has into the middle with both arms, voice cracking. Scar raises an eyebrow.', ['老陈：全……全押。']),
    l_c3a: S('顿了一下', 4, ['dealer'], 'close-up on the dealer\'s hands', 'Dealing the next card, the dealer\'s hand pauses for a split second above the deck.', []),
    l_c3b: S('没停', 4, ['dealer'], 'close-up on the dealer\'s hands', 'The dealer deals the next card in one smooth, unbroken motion, face blank.', []),
    l_m3: S('袖口', 6, ['scar', 'dealer'], 'handheld, sudden', 'Scar\'s hand shoots out and clamps the dealer\'s wrist. He twists it; something slides from inside her sleeve and drops onto the felt.', ['刀疤：手别动。']),
    l_c4a: S('黑桃A', 4, [], 'insert close-up', 'A hidden card spins onto the green felt and lands face up: the ace of spades.', []),
    l_c4b: S('红心K', 4, [], 'insert close-up', 'A hidden card spins onto the green felt and lands face up: the king of hearts.', []),
    l_m4: S('一伙的', 6, ['scar', 'chen', 'dealer'], 'slow pan from dealer to Chen', 'The dealer glances at Old Chen. Scar slowly turns his head toward Old Chen, eyes narrowing. Old Chen goes white.', ['刀疤：……你们是一伙的？']),
    l_c5a: S('刀疤抓刀', 4, ['scar'], 'close-up', 'Scar snatches the cleaver off the felt and raises it.', []),
    l_c5b: S('荷官抓刀', 4, ['dealer'], 'close-up', 'The dealer\'s hand slams down on the cleaver handle first, pinning it to the table.', []),
    l_m5: S('警察', 8, ['dealer', 'scar', 'chen'], 'medium shot, then lights flood on', 'The cleaver thunks into the table. The dealer flips open a police badge from her vest; overhead lights slam on, the door bursts open and officers pour in. Scar\'s cigar drops from his mouth.', ['荷官：警察。都别动。', '字幕：老陈，线人编号 0417。']),
    l_x1a: S('同花', 4, [], 'insert close-up', 'A hand flips Old Chen\'s two hole cards: a flush, all hearts.', []),
    l_x1b: S('什么都不是', 4, [], 'insert close-up', 'A hand flips Old Chen\'s two hole cards: a useless seven and two, nothing.', []),
    l_x2a: S('雪茄落地', 4, ['scar'], 'low angle on the floor', 'Scar\'s cigar rolls across the concrete floor, embers scattering, next to an officer\'s boot.', []),
    l_x2b: S('还叼着', 4, ['scar'], 'close-up', 'Hands cuffed behind his back, Scar still clenches the cigar between his teeth and glares.', []),
    l_x3a: S('回头', 4, ['chen'], 'from behind, stairwell', 'Old Chen climbs the concrete stairwell toward the daylight and turns back for one last look down.', []),
    l_x3b: S('不回头', 4, ['chen'], 'from behind, stairwell', 'Old Chen climbs the concrete stairwell straight into the daylight without looking back.', [])
  }
}

export const THRILL_SCRIPTS: any[] = [ELEVATOR, HOSTAGE, LASTHAND]
