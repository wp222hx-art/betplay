// 架构演示剧本《零点拆弹》—— 占位素材（海报 + 台词，无视频），用于跑通「惊心 1 分钟」全链路
// 正式剧本经猫哥选定后由 Studio 生产（gsk Seedance 2.0），以 status=live 覆盖上架
// 关卡选项数 2/3/3/3/3（经济模型见 engine.ladderRtp：阶梯返还 86.7% + 奖池 5% = 91.7% ≤ 94%）
const P = ['F_P', 'E1', 'E2', 'E3', 'E4', 'E5', 'F_A', 'F_B', 'F_T']
let pi = 0
const seg = (title: string, lines: string[]) => ({ title, video_url: null, poster: `/static/film/${P[pi++ % P.length]}.webp`, dur: 8, lines })
const o = (id: string, label: string, hint = '') => ({ id, label, hint, seg: id })

export const DEMO_THRILL = {
  series: { id: 'thr_demo_bomb', title: '零点拆弹', logline: '商场地下二层，炸弹倒计时 60 秒。拆弹手林岚每一个动作，都由你来押。', tension: 3, gated: false, demo: true },
  thrill: { cfg: {} },
  prologue: 'pro',
  gates: [
    { id: 'g1', title: '第一刀', question: '红线、蓝线，林岚先剪哪根？', options: [o('g1_red', '剪红线'), o('g1_blue', '剪蓝线')] },
    { id: 'g2', title: '变数', question: '倒计时突然加速到 20 秒，她怎么办？',
      options: [o('g2a_shell', '徒手撬外壳'), o('g2a_freeze', '冷冻喷雾冻住电路'), o('g2a_evac', '先吼人撤离')],
      variants: { g1_blue: { title: '密码锁', question: '副屏亮起四位密码锁，她输入什么？', options: [o('g2b_bday', '嫌犯女儿生日'), o('g2b_badge', '自己的警号'), o('g2b_zero', '0000')] } } },
    { id: 'g3', title: '来电', question: '嫌犯打来电话：「想活命就……」她的回应是？', options: [o('g3_hang', '直接挂断'), o('g3_stall', '拖时间套话'), o('g3_deal', '答应条件')] },
    { id: 'g4', title: '核心', question: '外壳打开，三块芯片，只能拔一块', options: [o('g4_a', '拔 A 芯片'), o('g4_b', '拔 B 芯片'), o('g4_c', '拔 C 芯片')] },
    { id: 'g5', title: '零点', question: '最后 1 秒——结局是？', options: [o('g5_dud', '哑火，全场安全'), o('g5_boom', '引爆，但人已撤离'), o('g5_game', '屏幕跳出：游戏才刚开始')] }
  ],
  endings: { perfect: 'end_perfect', '0': 'end_0', '1-2': 'end_low', '3-4': 'end_mid' },
  segments: {
    pro: seg('序章 · 地下二层', ['广播：所有人员立即撤离！', '林岚：给我 60 秒。']),
    g1_red: seg('红线断了', ['滴——计时器猛地加速。', '林岚：不对，它在提速！']),
    g1_blue: seg('蓝线断了', ['计时器停了两秒，又跳了起来。', '副屏亮起一行字：输入密码。']),
    g2a_shell: seg('徒手撬壳', ['指甲崩裂，外壳翘开一道缝。']),
    g2a_freeze: seg('冷冻喷雾', ['白雾腾起，读数终于慢了下来。']),
    g2a_evac: seg('撤离', ['林岚：所有人往 C 口跑！', '人群散开，只剩她一个。']),
    g2b_bday: seg('女儿的生日', ['密码正确。', '林岚：……他真的还在乎她。']),
    g2b_badge: seg('警号', ['屏幕一闪：你终于来了，林警官。']),
    g2b_zero: seg('0000', ['错误。剩余次数：0。', '倒计时直接砍掉一半。']),
    g3_hang: seg('挂断', ['林岚：没空听你废话。', '手机又亮了，她直接扣在地上。']),
    g3_stall: seg('套话', ['林岚：你要什么？说清楚。', '嫌犯：我要你记住那年的仓库。']),
    g3_deal: seg('答应', ['林岚：好，我答应你。', '嫌犯：那你先看看 B 芯片背面。']),
    g4_a: seg('拔 A', ['A 芯片拔出，主灯灭了一盏。']),
    g4_b: seg('拔 B', ['B 芯片背面刻着：仓库，七年前。']),
    g4_c: seg('拔 C', ['C 芯片发烫，副电路自动接管。']),
    g5_dud: seg('哑火', ['00:00。', '什么都没有发生。林岚瘫坐在地。']),
    g5_boom: seg('引爆', ['火光吞没了停车场。', '烟尘里，林岚从 C 口爬了出来。']),
    g5_game: seg('游戏开始', ['00:00——屏幕亮起：第二颗，在你家楼下。']),
    end_perfect: seg('全中 · 神预言', ['你押中了林岚的每一步。']),
    end_mid: seg('差一点', ['只差一步，你就看穿了整局。']),
    end_low: seg('迷雾', ['这一分钟，嫌犯比你更懂她。']),
    end_0: seg('全错', ['你押的每一步，都是嫌犯想要的。'])
  }
}
