// Agent-1 · 7-Agent 协作蓝图（系统产品策划师定义的职责边界、输入输出、触发的工作流）
export const AGENTS = [
  {
    no: 1, code: 'ARCHITECT', name: '系统产品策划师', icon: 'fa-sitemap', color: '#a78bfa',
    mission: '定义整体架构（三端一台 × 六层栈 × 10 条工作流）、前后台规划、数据模型与开发结构，并把示范剧蓝图播种入库',
    owns: ['docs/ARCHITECTURE.md', 'migrations/0001_init.sql', 'src/core/seed.ts', 'src/agents/registry.ts'],
    workflows: ['WF-01 剧集创作与发布'], layer: '全栈', api: ['GET /api/blueprint', 'POST /api/admin/seed']
  },
  {
    no: 2, code: 'BUILDER', name: '子模块开发师', icon: 'fa-code', color: '#60a5fa',
    mission: '开发各子模块：ForgeCore 状态机、Commit-Reveal、Branch Registry、ForgeLedger、Model Gateway；并执行变体池批量生成与补货',
    owns: ['src/core/engine.ts', 'src/core/crypto.ts', 'src/gateway/llm.ts', 'src/agents/builder.ts'],
    workflows: ['WF-02 变体池批量生成', 'WF-05 变体补货'], layer: 'L0–L3', api: ['POST /api/agents/2/generate-variants', 'POST /api/agents/2/replenish']
  },
  {
    no: 3, code: 'QA_VIDEO', name: '测试与视频模型官', icon: 'fa-vial-circle-check', color: '#34d399',
    mission: '对 Agent-2 的产出做自动化验收（公平复算/幂等/账本平衡/不重复/EV 无套利）；按五维评分挑选视频模型，预判热门分支先行生成并入库',
    owns: ['src/agents/qa.ts', 'src/gateway/video.ts'],
    workflows: ['WF-09 合规审核（AI 初审）', '投机生成'], layer: 'L0/L2', api: ['POST /api/agents/3/selftest', 'GET /api/agents/3/video-models', 'POST /api/agents/3/predictive']
  },
  {
    no: 4, code: 'WAGER', name: '交互下注结算师', icon: 'fa-coins', color: '#fbbf24',
    mission: '负责下注—锁盘—揭晓—结算—悔棋全链路：固定赔率/彩池赔率、幂等下注、复式记账、悔棋税、EV 蒙特卡洛沙盘',
    owns: ['src/core/engine.ts#wager', 'POST /api/rounds/*'],
    workflows: ['WF-03 一局戏运行', 'WF-04 悔棋', 'WF-07 结算与分账'], layer: 'L3/L4', api: ['POST /api/rounds/open', 'POST /api/rounds/:id/bet', 'POST /api/rounds/:id/settle', 'POST /api/rounds/:id/rewind', 'POST /api/agents/4/simulate']
  },
  {
    no: 5, code: 'PLAYER', name: '专属播放器设计师', icon: 'fa-clapperboard', color: '#f472b6',
    mission: '打造 Cash Stage 独有交互播放器：剧情段落播放 → 节点预告冻结 → 下注面板+倒计时环 → 咔哒锁盘 → 解密揭晓 → 筹码结算 → 倒带悔棋 → 一键验证公平',
    owns: ['public/static/player.js', 'public/static/player.css'],
    workflows: ['L5 Cash Stage'], layer: 'L2/L5', api: ['GET /', 'GET /play/:series']
  },
  {
    no: 6, code: 'CONSOLE', name: '后台统计与剧本管理师', icon: 'fa-chart-line', color: '#22d3ee',
    mission: 'Forge Console：局监控大屏、分支到达统计与 EV 偏差、变体池水位、剧本树管理（编辑/休眠/新增）、实时衍生剧本入口',
    owns: ['public/static/console.js', 'src/agents/console.ts'],
    workflows: ['WF-10 数据回流'], layer: 'Console', api: ['GET /api/console/overview', 'GET /api/console/branches', 'PATCH /api/console/nodes/:id']
  },
  {
    no: 7, code: 'DERIVER', name: '剧本衍生与诗词提炼师', icon: 'fa-feather-pointed', color: '#fb7185',
    mission: '持续衍生下一幕（WF-06）并为每个分支提炼诗词；聚合全网决策类目信号监管对弈公平度（一边倒/偏差告警）；把剧本优化为可对弈的“片对”数量配置',
    owns: ['src/agents/deriver.ts'],
    workflows: ['WF-06 剧情延展', 'WF-08 风控(对弈监管)'], layer: 'L1/Flywheel', api: ['POST /api/agents/7/derive', 'POST /api/agents/7/poems', 'GET /api/agents/7/regulate', 'GET /api/agents/7/clip-pairs']
  }
]

export const BLUEPRINT = {
  name: 'MoMocash剧场',
  motto: '结果先锁定，再开盘；剧情先生长，再揭晓。',
  terminals: [
    { name: '对弈式漫剧《穹顶之下》', path: '/comic', owner: 5 },
    { name: '玩家端 Cash Stage', path: '/', owner: 5 },
    { name: '运营后台 Forge Console', path: '/console', owner: 6 },
    { name: 'Agent 指挥中心', path: '/agents', owner: 1 },
    { name: '创作端 Forge Canvas（剧本树）', path: '/console#script', owner: 6 }
  ],
  stack: [
    { layer: 'L5', name: 'Cash Stage 剧场前台', items: ['专属播放器', '下注面板', '悔棋', '公平验证'], agent: 5 },
    { layer: 'L4', name: 'ForgeLedger 资金结算', items: ['复式记账', '彩池分账', '冻结/派彩'], agent: 4 },
    { layer: 'L3', name: 'ForgeCore 博弈内核', items: ['DFP 七态', 'Commit-Reveal', 'Branch Registry', '事件哈希链'], agent: 2 },
    { layer: 'L2', name: '编排播放层', items: ['生成-播放分离', 'AES-GCM 加密分片', '无感切换'], agent: 5 },
    { layer: 'L1', name: '画布创作层', items: ['剧本树', '变体池', 'AI 延展', '诗词'], agent: 7 },
    { layer: 'L0', name: 'Model Gateway', items: ['文本路由+熔断', '视频五维选型', '任务契约'], agent: 3 }
  ],
  principles: ['结果先锁定再开盘', '生成与播放分离', '预生成为主·兜底永远存在', '人机协同 Copilot', '有序并发：钱与结果串行', '可解释公平', '合规前置']
}
