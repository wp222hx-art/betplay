// 技术架构 & 工作流设计体系（可视化文档页）
;(() => {
  const root = document.getElementById('arch')
  const L = [
    { k: 'L5 体验层', c: '#ff7eb3', items: ['发现页（恋爱 / 影剧）', '播放器（影剧 · 恋爱）', '结局卡交易所', '完整路径播放器', '我的 · 想看 · 卡册'], note: '移动优先 · 底部 Tab · 全屏沉浸 · 抽屉交互' },
    { k: 'L4 业务层', c: '#f5c451', items: ['对弈引擎 createEngine', '悔棋三变局：二选一 / 新变数 / ⟲时间裂隙', '结局卡铸造 · 稀有度', '交易撮合 · 手续费', '想看 · 选题需求'], note: '一个引擎驱动所有作品：换 data.json 即上新剧' },
    { k: 'L3 可信层', c: '#3ddc97', items: ['签名设备令牌（HMAC）', 'Commit-Reveal 承诺 + 可复算', 'AES-GCM 等长密文分片', '媒体票据（签名 · 过期）', '复式记账 ForgeLedger', '风控：女巫 / 洗售 / 限价 / 限流'], note: '“服务端是唯一裁判”——客户端只拿密文与短时票据' },
    { k: 'L2 生产层', c: '#8b5cf6', items: ['选题池（想看 × 通关热度 × 成交）', 'AI 剧本树 + 静态校验', '渲染队列（原子认领 · 幂等）', 'AI 质检 + 人工审核', '上架 / 续集派生'], note: '可延续：数据 → 选题 → 生成 → 上架 → 数据' },
    { k: 'L1 模型层', c: '#38bdf8', items: ['Seedance 2.0（音画一体）', 'nano-banana-pro / GPT Image 2（封面·设定）', 'Qwen3-TTS / ElevenLabs（声线）', 'GPT-5 系（剧本·质检）', 'Whisper（字幕对齐）'], note: '能力路由 · 熔断降级 · 任务记账' },
    { k: 'L0 基础设施', c: '#94a3b8', items: ['Cloudflare Workers（Hono）', 'D1（账本 · 局 · 卡 · 队列）', 'R2（受保护的视频）', 'Pages CDN（公开封面/海报）'], note: '边缘部署 · 无服务器 · 按量计费' }
  ]
  const THREATS = [
    ['冒充他人身份下注 / 花别人的币', '客户端自报 user_id，服务端照单全收', '服务端签发 HMAC 设备令牌；body/header 里的 user_id 全部忽略，冒充行为记风控', 'done'],
    ['跳过博弈直接看结局', '结局视频是公开静态地址', '视频移入 R2；只有揭晓/持卡后才签发“用户+片段+过期”签名票据；剧情树接口剥离视频地址', 'done'],
    ['抓包提前知道结果', '选项分镜可被预取', '所有选项等长 AES-GCM 密文，揭晓才下发真分片密钥（已有）；预载改为不含地址', 'done'],
    ['篡改概率 / 事后改结果', '—', 'Commit-Reveal：下注前公开 HMAC 承诺，揭晓后公开种子，任何人可复算（已有）', 'done'],
    ['并发重复下注 / 重复领奖', '竞态', '所有状态迁移用 CAS（WHERE state=…）；结局卡 run_id 唯一；成交挂单 CAS + 余额条件扣款', 'done'],
    ['多开小号刷新手币（女巫）', '新号即送 1000', '同 IP 24h 新设备 ≤ 5，超出不发币；免费币 20h 一次；每设备/IP 写操作限流', 'done'],
    ['左手倒右手刷价格 / 洗钱', '—', '同网络环境禁止互买；7 天内双向成交 ≥2 次拦截；限价带 0.3~10× 参考价；每日 20 笔上限；新卡 1h 冷却', 'done'],
    ['伪造结局卡', '—', '卡只能在服务端 advance() 判定通关时铸造，卡 ID = hash(run+ending)，无任何客户端铸造入口', 'done'],
    ['刷后台 / 改配置', '管理接口无鉴权', '/api/console|agents|studio|admin 及配置写入需 ADMIN_KEY（生产环境 secret）；审计日志', 'done'],
    ['机器人脚本批量通关刷卡', '—', '下注窗口 + 限流已抬高成本；下一步：设备指纹 + Turnstile 人机验证 + 行为评分（路径/时长异常）', 'next'],
    ['多人同局串通（竞猜模式）', '—', '下一步：人群赔率（parimutuel）+ 锁盘前 N 秒不可改注 + 关联账户聚类', 'next']
  ]
  const FLOW = [
    ['① 选题', '想看榜 × 结局通关热度 × 卡交易活跃度 → 需求分', '/api/studio/next'],
    ['② 剧本树', 'LLM 生成：角色圣经 + 3 层节点 + 隐藏支 + 时间裂隙 + 每段分镜台词；无模型时模板兜底', 'POST /api/studio/projects'],
    ['③ 静态校验', '可达性 / 每节点 ≥2 选项 / 隐藏支 / 裂隙闭环 / 片段齐备 / 结局数 / 积分预算', 'validateTree()'],
    ['④ 渲染队列', '一片段一任务，幂等入队；外部 worker 原子认领 → Seedance 生成 → 回报', '/api/studio/jobs/claim'],
    ['⑤ 质检审核', 'AI 质检（人物漂移 / 口型 / 字幕）+ 人工一键通过 / 驳回重排', '/api/studio/jobs/:id/review'],
    ['⑥ 构建上架', '压制 → 转写对齐字幕 → 海报末帧 → data.json → 上传 R2 → 发现页上架', 'scripts/*/build.py'],
    ['⑦ 数据回流', '通关分布 · 悔棋/裂隙率 · 卡成交 → 派生续集 / 新裂隙 → 回到 ①', '飞轮']
  ]
  const CARD = [
    ['通关', '服务端 advance() 判定结局', 'fa-flag-checkered'],
    ['铸造', '唯一卡 ID · 序号 · 稀有度（出现率 + 隐藏 + 裂隙）', 'fa-gem'],
    ['冷却', '1 小时后可挂单', 'fa-hourglass-half'],
    ['挂单', '限价带内定价', 'fa-tag'],
    ['成交', 'CAS 撮合 · 5% 手续费入账', 'fa-handshake'],
    ['观看', '持卡人重播完整路径（逐段签发票据）', 'fa-play']
  ]
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  root.innerHTML = `
    <header class="st-head"><h1><i class="fas fa-sitemap"></i> 技术架构 · 工作流设计体系</h1><p>多人不作弊 · 内容可延续生成 · 制作 / 管理 / 交易一体化</p></header>
    <nav class="toc"><a href="#a1">分层架构</a><a href="#a2">防作弊</a><a href="#a3">生成工作流</a><a href="#a4">结局卡经济</a><a href="#a5">路线图</a></nav>
    <section id="a1" class="st-card"><h3>① 六层架构</h3><div class="layers">${L.map((l) => `<div class="ly" style="--c:${l.c}"><h4>${l.k}</h4><div class="it">${l.items.map((x) => `<span>${esc(x)}</span>`).join('')}</div><p>${esc(l.note)}</p></div>`).join('')}</div></section>
    <section id="a2" class="st-card"><h3>② 防作弊体系 · 威胁模型</h3><p class="mut">原则：<b>服务端是唯一裁判</b>。客户端永远只拿到“密文 + 短时签名票据”，所有资产变动走 CAS 状态机与复式账本。</p>
      <div class="threats">${THREATS.map(([t, why, fix, st]) => `<div class="th ${st}"><div><b>${esc(t)}</b>${why !== '—' ? `<span class="why">原漏洞：${esc(why)}</span>` : ''}</div><p>${esc(fix)}</p><em>${st === 'done' ? '✓ 已上线' : '→ 下一步'}</em></div>`).join('')}</div></section>
    <section id="a3" class="st-card"><h3>③ 可延续生成工作流</h3><div class="flow2">${FLOW.map(([k, d, a]) => `<div><b>${k}</b><p>${esc(d)}</p><code>${esc(a)}</code></div>`).join('')}</div>
      <p class="mut">入口：<a href="/studio">制作平台</a>（看板 · 选题池 · 渲染队列 · 审核 · 风控台）。一部 21 结局的作品约 28 段 × ~900 积分 ≈ 2.5 万积分。</p></section>
    <section id="a4" class="st-card"><h3>④ 结局卡经济 · 完整观看路径</h3><div class="cardflow">${CARD.map(([k, d, ic]) => `<div><i class="fas ${ic}"></i><b>${k}</b><span>${esc(d)}</span></div>`).join('')}</div>
      <ul class="mut"><li>稀有度：全服出现率 &lt;2% +3 / &lt;5% +2 / &lt;12% +1；隐藏结局 +1；路径含时间裂隙 +1 → R / SR / SSR / UR</li>
        <li>卡的价值 = 稀缺性 + <b>完整观看路径</b>：买到一张卡，就能完整重看别人那一局的全部片段与抉择</li>
        <li>平台收入：交易手续费 5% · 悔棋税 · 心动值；全部计入复式账本，风控台实时校验借贷平衡</li></ul>
      <p><a class="btn2" href="/market"><i class="fas fa-gem"></i> 打开结局卡交易所</a></p></section>
    <section id="a5" class="st-card"><h3>⑤ 路线图</h3><div class="road">
      <div><b>P0 · 本次上线</b><span>签名身份 · 媒体票据门禁 · 女巫/限流 · 结局卡铸造 · 交易所 · 完整路径播放 · 制作平台 · 风控台</span></div>
      <div><b>P1 · 生产部署</b><span>R2 存储桶上传全部片段 · AUTH_SECRET / ADMIN_KEY secret · Turnstile 人机验证 · 渲染 worker 常驻</span></div>
      <div><b>P2 · 多人竞猜</b><span>同一节点多人同时下注的人群赔率 · 直播间 · 串通聚类检测</span></div>
      <div><b>P3 · 创作者生态</b><span>外部创作者提交剧本树 → 平台渲染 → 分成；结局卡版税（二级成交按比例回流创作者）</span></div></div></section>`
})()
