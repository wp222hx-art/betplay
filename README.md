# MoMocash剧场｜对弈式交互剧平台（7-Agent 协作版 MVP）

> 结果先锁定，再开盘；剧情先生长，再揭晓。

## 项目概述
- **目标**：把 PRD《功能设计与系统工作流总纲 V1.0》落地为可玩、可运营、可验证的平台 MVP
- **示范剧**：《天台》：3 场景 × 3 个 Cash 节点 × 9 个结局簇 × 27+ 变体，另有 3 个结局（内容由 LLM 生成）
- **架构文档**：`docs/ARCHITECTURE.md`

## 🎙 角色声线工作室（/voice）
- **角色卡**：每个角色可以配置千问音色（23 个系统音色，外加自己设计的专属音色）、人设和表演基调、后期处理预设（温暖、硬汉胸腔、面具金属低语、会议厅回响、清亮少女、电话音）、主题色和试听台词
- **即时试听**：按当前草稿直接合成，可以另外指定这一句的情绪（哽咽、压着怒火、耳语、叹气……），并显示实际发给模型的表演指令；也能回放剧中这个角色的原句，标注是千问版还是 ElevenLabs 版
- **声音设计**：写一段文字描述，生成一个全新的专属音色（千问 qwen-voice-design，每个 0.2 元，新账号前 10 次免费），试听满意后一键设为该角色的音色；设计出的音色都记录在「专属音色库」
- **配音进度**：显示对白段落和抉择口播分别有多少条是千问、多少条是 ElevenLabs
- **服务状态**：分别检测千问指令版和基础版是否可用；账户欠费时给出充值链接
  - 指令版不可用时，试听和批量配音都会自动退回基础版 qwen3-tts-flash：音色不变，但这一句没有表演指令
- **配置存储**：D1 的 `voice_cast` 表存覆盖值，默认值来自 `scripts/comic/cast.json`；`voice_custom` 表存专属音色
- **批量配音**：`produce_voice_v3.py` 启动时会读取 `/api/voice/cast`，所以工作室里保存的配置直接生效；人设或音色一改，相关台词会自动重新配
- **API**：`/api/voice/meta|status|cast|cast/:name(POST/DELETE)|audition|design|custom`
- **安全**：DashScope Key 只放在服务端（`.dev.vars` 或 `wrangler secret put DASHSCOPE_API_KEY`），前端拿不到

## 🎬 对弈式影剧《穹顶之下 · 影剧版》（/film）
- **音画一体**：9 段 Seedance 2.0 视频（每段 10–12 秒，多镜头），普通话对白、口型、音效和配乐都在同一次生成里出来，不再是"静帧 + 后配 TTS"
- **结构**：序章，然后 3 个抉择点，最后 5 种结局：以身换命、黎明同盟、全城曝光、坠落、天穹之主（隐藏结局，只有悔棋"新变数"能到达）
- **镜头连续**：每段子片段都用父片段的最后一帧作为开场构图，再加角色设定图，锁定人物一致性
- **字幕**：Whisper 逐字转写原声，再和剧本台词对齐，得到时间轴字幕；说话人的头像同步高亮
- **机制**：和漫剧共用同一套对弈引擎（`src/comic/factory.ts` 里的 `createEngine(DATA)`），包括承诺-揭示、种子扰动、二选一和新变数两种悔棋、复式记账、验证
- **生产脚本**：`scripts/film/story.py`（分镜脚本）→ `produce_film.py`（按层生成，子片段接父片段的末帧）→ `build_film.py`（压制、转写、对齐，生成 `src/film/data.json`）
- **成本**：mini 档每段 12 秒约 1,000 积分，9 段合计约 9,000 积分
- **千问配音 V4（漫剧当前默认）**：用 Qwen3-TTS-Instruct-Flash，每句台词配一条自然语言表演指令（角色人设 + 情绪 + 强度 + 呼吸/叹气/耳语），盲测明显胜过 ElevenLabs
  - 角色音色：林夏 Serena / 陈默 Arthur / 渡鸦 Kai + 面具混响 / 林小雨 Vivian / 顾衡 Moon + 降调增加年龄感
  - Key 放在 `.dev.vars`（`DASHSCOPE_API_KEY`，不进 git），走北京区
  - 断点续跑：`cd scripts/comic && CONC=3 python3 produce_voice_v3.py && python3 build_data.py && npm run build`（已生成的会跳过）
  - 某段千问配音不完整时，这一整段自动回退到 ElevenLabs V3，保证同一场戏里不会混用两种声音；设 `VOICE=el` 可以整体切回 V3

## 对弈式漫剧《穹顶之下》（/comic）
- **规模**：34 个抉择点（4 幕：1→3→9→21），75 条常规分支，34 条悔棋隐藏分支，63 个结局（其中 21 个是隐藏结局）
- **媒体**：112 幅 GPT Image 2 分镜（以角色设定图做参考，锁定人物一致性），全部提前生成
- **V3 一气呵成的剧**（当前版本）：
  - **剧本连贯**：`rewrite_v3.py` 按剧情树逐层改写，每段都带上一段台词和刚做的选择，首句接住选择，末句把悬念交给下一个抉择；34 个抉择点各有一条角色口播，由角色在戏里把两难说出来
  - **听得出谁在说**：台词里角色互相称呼；每个角色有固定声线和后期处理（`cast.json`），在立体声里有固定的左右位置；画面上有角色立绘，谁说话谁高亮，字幕带名字、颜色和情绪标签
  - **配音**：用 ElevenLabs v4 配音，中文是母语水准，并用表演标签加入叹气、呼吸、耳语、停顿；每段台词先混成一条连续的对白轨，被打断时下一句会抢进来，字幕、立绘和音效都按这条轨的时间轴走（`produce_voice_v3.py`）
  - **角色声线**：林夏 Arabella（冷感御姐）/ 陈默 Reginald（沙哑的前刑警）/ 渡鸦 Austin + 面具金属混响 / 林小雨 Hope（电话里的声音走电话音色处理）/ 顾衡 Bradford + 会议厅回响
  - **换成专属声线**：`python3 scripts/comic/clone_cast.py 林夏=样本.mp3 …`，克隆出的 voice_id 会写回 cast.json，然后重跑配音即可
  - **节奏不断档**：结算页倒计时后会自动翻到下一幕，点悔棋或验证可以打断
- **动态漫**：13 段 Seedance 视频，覆盖整个序章、三条主线的首幕揭晓，以及拒绝、公开挑衅、全城曝光、枪战、挡弹、夺枪等高光镜头
- **声场**：ElevenLabs 生成的 9 种环境底噪和 14 种音效，播放时自动混音（底噪交叉淡化、对白时压低底噪、抉择时加紧张铺底和心跳）
- **后台**：`/console#comic`（机制参数 + 全树蒙特卡洛），`/console#comictree`（分支树、分镜预览、试听、按节点覆盖权重）
- **API**：`/api/comic/meta|tree|start|rounds/:id/bet|settle|rewind{mode}|next|verify|config|simulate|stats`
- **生产脚本**：`scripts/comic/gen_story.py`（LLM 剧情树）→ `normalize.py` → `produce.py`（图 + 音，可断点续跑）→ `build_data.py`

## 入口
| 页面 | 路径 |
|---|---|
| 对弈式影剧（Seedance 音画一体） | `/film` |
| 对弈式漫剧 | `/comic` |
| 角色声线工作室 | `/voice` |
| 玩家端 Cash Stage | `/` |
| 运营后台 Forge Console | `/console`（`#monitor #branches #script #derive #regulate #clips #pool #video #economy #rounds #tasks #qa`） |
| 7-Agent 指挥中心 | `/agents` |

## 主要 API
- A1 `GET /api/blueprint` `GET /api/agents` `GET /api/agents/runs`
- A4 `POST /api/rounds/open {node_id, mode:solo|arena}` → `/:id/bet {outcome_id, amount, idem_key}` → `/:id/cancel` → `/:id/settle` → `/:id/rewind`；`GET /:id/verify`；`GET /:id/live`；`POST /api/agents/4/simulate`
- A2 `POST /api/agents/2/generate-variants {outcome_id,count}` `POST /api/agents/2/replenish` `GET /api/agents/2/water`
- A3 `POST /api/agents/3/selftest` `GET /api/agents/3/video-models?tier=` `POST /api/agents/3/predictive {tier,limit,dry_run}` `POST /api/agents/3/video`
- A6 `GET /api/console/overview|branches|script|tasks|rounds` `PATCH /api/console/nodes/:id` `PATCH /api/console/variants/:id`
- A7 `POST /api/agents/7/derive` `POST /api/agents/7/approve` `POST /api/agents/7/poems` `GET /api/agents/7/regulate` `POST /api/agents/7/signals` `GET /api/agents/7/clip-pairs` `POST /api/agents/7/clip-pairs/apply`
- 玩家 `GET /api/series/:id` `GET /api/me` `POST /api/me/faucet` `POST /api/me/limits`

## 已完成
- DFP 七态状态机、Commit-Reveal、事件哈希链、Branch Registry 去重、CAS 局级锁
- 复式记账（零差错校验）、幂等下注、2 秒撤销、日限额/冷静期/自我排除、悔棋税 ×1.5（最多 2 次）
- Solo 固定赔率与 Arena 全网彩池（parimutuel，实时赔率跳动）
- 专属播放器：程序化雨夜镜头、节点冻结预告、倒计时环、WebAudio 音效、本地 AES-GCM 解密揭晓、筹码飞行动画、滑动悔棋 + 倒带、三步公平验证（浏览器本地 HMAC 复算）、战报卡、结局图鉴
- Model Gateway：能力路由、reasoning_effort 分级、熔断、兜底模板、任务记账
- 变体生成：LLM 生成 → 去重 → 评分 → 入池；WF-05 水位补货
- 视频模型五维选型 + 预判生成（配置 FAL_KEY 后真实提交；未配置时降级为 motion-still 程序化渲染）
- WF-06 剧情延展（六维评分，采纳后写入画布，剧场立即可玩）、七绝格律校验 + Critic 重写
- 全网对弈监管（分歧度、一边倒、偏差、分裂）与对弈片对优化
- Agent-3 的 11 项自动化验收，以及 Playwright UI 全流程测试（`tests/ui_play.py`）

## 未实现 / 下一步
1. 真实视频：配置 `FAL_KEY` 后接入队列轮询回调（目前只提交，还没做结果拉取 webhook）
2. Duel 双人盲提交、真金 Cash 与 KYC（需牌照区）
3. 外部平台（抖音 / 小红书 / B站）真实信号采集 API（目前是注入接口 + 模拟数据）
4. RBAC 与 Four-Eyes 双人复核、生产 HSM
5. 部署到 Cloudflare Pages（先创建 D1，并用 wrangler secret 设置 OPENAI_API_KEY / OPENAI_BASE_URL）

## 本地开发
```bash
npm run build
npx wrangler d1 migrations apply webapp-production --local
pm2 start ecosystem.config.cjs
node tests/e2e.mjs            # API 验收
python3 tests/ui_play.py      # 浏览器全流程
```

## 技术栈
Hono + Cloudflare Pages/Workers + D1 · Tailwind CDN · Chart.js · Web Crypto · Canvas 2D · WebAudio · OpenAI 兼容网关（gpt-5 系列）

**状态**：沙盒运行中，尚未部署到生产环境。最后更新：2026-09-25

## 💗 心动回廊 ～传说之樱下的约定～（/love）
心跳回忆式校园恋爱博弈剧。Seedance 2.0 音画一体动画，普通话原声对白，逐字对齐字幕。
- **结构**：序章「入学式·樱花雨」→ N1 命运的红线（诗音/阳菜/凛/莓 + 悔棋隐藏「樱花树下的她·雪」）→ 5 条路线 → 毕业日抉择 → **21 个结局**（每线 1 个隐藏结局，雪线含真结局「心动回廊」）
- **片段**：27 条（12s 路线 + 10s 结局），`public/static/love/`
- **API**：`/api/love/meta|tree|start|rounds/:id/bet|settle|rewind|next|verify|simulate`
- **管线**：`scripts/love/story.py`（剧本/提示词）→ `produce.py`（并行生成）→ `build.py`（压制+转写+字幕+头像+data.json）
- **测试**：`python3 tests/ui_love.py`

## 🧭 平台改版（发现页 · 两大类 · 时间裂隙 · 移动适配）
- **内容分类统一**：只保留「恋爱」「影剧」两大类。首页 `/` = 发现页；旧剧场移至 `/theater`，漫剧 `/comic` 保留直链但不进导航；声线/后台/Agent 收进「工作台」下拉。
- **发现页**（`public/static/discover.{js,css}`）：主推轮播（手势滑动）→ 分类 Tab → 玩法条 → 恋爱/影剧货架 → 深夜禁区（18+ 模糊遮罩 + 年龄确认）→ 想看榜 TOP10 → 全部作品（标签筛选 + 最热/最新/结局最多排序）→ 底部弹出详情抽屉 → 想看/上线提醒 → 我的想看 + 结局收集进度。
- **上架目录**：31 部（恋爱 16 / 影剧 15），2 部可玩，29 部概念封面（nano-banana-pro，`public/static/covers/`）。数据源 `scripts/catalog/catalog.py` → `export.py` → `src/catalog/data.json`；封面 `covers.py`。
- **API**：`GET /api/catalog`（含想看数/我是否想看/游玩数）、`POST /api/catalog/:id/wish {on}`；表 `catalog_wish`（migrations/0004）。
- **⟲ 时间裂隙（悔棋诞生新分支）**：节点可配置 `fork: {node, seg, label, desc}`；揭晓后悔棋多出第三种变局 `mode=fork` —— 不回到原局面，而是撕开平行时间线：播放裂隙片段 → 进入全新抉择节点（新选项/新结局），剧情树与战报记录 `⟲ 时间裂隙`。《心动回廊》四位女主毕业抉择均可裂隙 → K_1「时间裂隙·你记得一切」→ N_K「平行时间线里，你要改写哪一个传说？」
- **移动适配**：顶栏精简 + 底部 Tab 栏（发现/恋爱/影剧/想看），播放页全屏沉浸（100svh）、画面切换自动拉回舞台，全站消除横向溢出（441→390），后台表格横向滚动。测试：`tests/ui_mobile.py`、`tests/ui_rift.py`。

## 🛡️ 平台化：防作弊 · 可延续生成 · 制作/管理 · 结局卡交易（本轮）
架构文档页：`/arch`（六层架构 · 威胁模型 · 生成工作流 · 结局卡经济 · 路线图）

### 防作弊（多人）
| 威胁 | 方案 | 代码 |
|---|---|---|
| 冒充他人 user_id | 服务端签发 HMAC 设备令牌（`POST /api/auth/device`），body/header 的 user_id 一律忽略并记 `spoof` 风控 | `src/core/guard.ts` · `public/static/auth.js` |
| 跳过博弈直接看结局 | 视频移出 public → R2 `MEDIA` 桶；`/m/:series/:clip` 仅凭“用户+片段+过期”签名票据（揭晓/持卡后签发）；`/api/*/tree` 剥离视频与结局图 | `guard.mediaTicket` · `factory.publicTree` |
| 女巫刷币 | 同 IP 24h 新设备 ≤5，超出不发币；免费币 20h 一次；写操作限流（设备 120/min、IP 600/min、建号 20/h） | `guard.issueDevice/rateLimit` |
| 洗售 / 刷价 | 同网络环境禁止成交；7 天双向 ≥2 次拦截；限价带 0.3~10× 参考价；新卡冷却 1h；每日 20 笔 | `src/market/cards.ts` |
| 竞态 / 重复 | 所有状态迁移 CAS；结局卡 `run_id` 唯一；挂单 CAS + 条件扣款 | — |
| 管理面 | `/api/console|agents|studio|admin` 需 `ADMIN_KEY`（生产 secret） | `src/index.tsx` 中间件 |

### 结局卡交易所 `/market`
通关 → 服务端铸造（稀有度 R/SR/SSR/UR：出现率 + 隐藏 + 裂隙）→ 冷却 → 挂单 → CAS 成交（5% 手续费入复式账本）→ 持卡人**完整观看路径**（逐段签发媒体票据的竖屏连播）。
API：`GET /api/market` · `GET /api/market/cards/:id` · `GET /api/me/cards` · `POST /api/market/list|cancel|buy` · `GET /api/me/cards/:id/watch`

### 制作平台 `/studio`
选题池（想看 × 通关热度 × 成交）→ AI 剧本树（`outline` 能力，失败时模板兜底）→ `repairTree` 自动修复 → `validateTree` 静态校验 → 渲染队列（幂等入队、原子认领）→ `scripts/studio/worker.py`（Seedance 生成，`--dry` 演练不花积分）→ 审核通过/驳回重排 → 上架；看板 · 风控台（事件、封禁、账本平衡）。

### 部署前必做
```bash
npx wrangler r2 bucket create webapp-media && ./scripts/upload_media.sh --remote   # 上传受保护视频
npx wrangler pages secret put AUTH_SECRET && npx wrangler pages secret put ADMIN_KEY
npx wrangler d1 migrations apply webapp-production                                 # 含 0005_platform
```
测试：`tests/ui_market.py`（通关得卡→卡详情→完整路径）· `tests/ui_mobile.py` · `tests/ui_rift.py`

### 📺 已上架：《她从地狱回来了》（真人剧 · 试播集）
- 播放：`/s/gen_87c53a9f`；已关联发现页概念卡 `revenge_heiress`（真人剧热度第一），卡片由“即将上线”变为可玩。
- 规模：3 抉择点 / 4 结局 / 11 段（含黄金·白金·钻石彩蛋）；原创面孔设定图，13 个任务 **0 次审核拒绝**；实际消耗约 10,210 积分。
- 质检：本地字幕检测发现 R_2 / E_11 / E_21 被模型烧录了中文字幕 → `scripts/studio/desub.py` 定位字幕带 + delogo 修补后替换 R2 媒体与海报帧。
- worker 新增本地烧录字幕检测（远程 AI 质检 `media-analyze` 当前上传失败，结果不可用），超过 20% 帧命中即判不通过。
- 回归：`python3 tests/ui_series_play.py <BASE> gen_87c53a9f`（发现页卡片 → 开局 → 2 次竞猜 → 结局）。

## 🏭 MoMo Studio · 短剧生产后台（前后端分离 · 新架构 P1 ✅ P2 ✅ P3 ✅ P4 ✅ · 手机适配 ✅）
玩家端（端口 3000，`/`）只负责游戏与筹码博弈；**生产端是独立应用 `studio/`**（端口 3001），独立登录，共享 D1 / R2。

- **独立登录与角色**：PBKDF2(10 万次) 密码、HttpOnly + SameSite=Strict 会话 Cookie（库里只存 token 的 SHA-256）、15 分钟 8 次失败锁定、写操作校验 Origin；角色 `admin / writer / reviewer`，**编剧不能审批自己的产出**（仅审核或管理员可放行）；停用账号立即踢下线；全量审计 `st_audit`
- **十步卡关状态机**：立项 → 世界观·角色 → 结构图 → 剧本描述 → 提示词·连贯监管 → 设定图 → 主线视频 → 分支视频 → 一致性检测 → 预检·上架。**前一步未通过，后一步的保存/运行/审批一律 409 `STEP_LOCKED`**；修改已通过的步骤，下游全部变 `stale` 需重做
- **Agent 配置中心**：10 个生产 Agent 统一配置服务商 / 模型 / 参数 / 提示词版本 / 预算；服务商类型：OpenAI 兼容对话、火山方舟 Seedance、OpenAI 兼容视频中转站、即梦 CLI / gsk（执行节点）、模拟；**API Key 用 AES-GCM（`STUDIO_MASTER_KEY`）加密入库，任何接口只返回掩码**，也可引用环境变量
- **模型接入层**：`chat` / `submitVideo` / `pollVideo` / `testProvider`，每次调用记账 `st_runs`，超预算 402
- 入口：`/#/projects`、`/#/p/:id/:step`、`/#/config`、`/#/users`、`/#/audit`；API：`/api/auth/*`、`/api/config`、`/api/providers*`、`/api/agents/:code*`、`/api/projects/:id/steps/:n[/approve|/reopen|/run]`
- 启动：`npm run build:studio && pm2 start ecosystem.config.cjs --only momo-studio`；`STUDIO_MASTER_KEY` 写在**根目录** `.dev.vars`（wrangler 从根读取；生产用 `wrangler pages secret put`）
- P1 验收覆盖：跳步 409、通过解锁、改上游→下游 stale、Key 不外泄且库内为密文、401/403、跨站 403、登录锁定、登出/停用失效、编剧不能自审
- **P2 结构图画布 ✅（第 3 步）**：纯 SVG 画布（拖拽 / 平移缩放 / 端口连线 / 检查器 / 自动排版），5 种节点：🎬场景 · 🎲博弈锚点（2–4 选项）· 🔀汇合 · ⏳时间裂隙（回溯边，只能指向上游且必须有前进出口）· 🏁结局（坏/普通/黄金/白金/钻石）
  - **结构 Agent**：AI 生成初版 / 在锚点「＋新选项分支」/ 续写后续（结局可续写成新篇章）/ 插入时间裂隙；**AI 只出提案**，新增节点高亮，人工「采纳 / 丢弃」
  - **服务端权威校验** `graph.ts`：环、死胡同、不可达、场景分叉、锚点选项数、问句选项、回溯目标、结局等级…；AI 产出先走确定性 `repair` 自动修正并列出修改记录；**有错误的图不能提交、不能审批（422）**
  - 实时统计：路径数（DAG 动态规划，封顶 1e12 不溢出）、需拍片段数（主线/分支）、**汇合节省率**（对比树展开）、成本估算；1600 节点大图分析 < 30ms
  - API：`/api/projects/:id/graph/{analyze|layout|draft|extend}`
- **P3 剧本描述 · 提示词 · 连贯监管 ✅（第 4/5 步）**
  - **剧情账本** `ledger.ts`：服装 `costume.<id>` / 道具 `prop.<id>` / 伤痕 `injury.<id>` / 已知信息 `know.<id>.<话题>` / 关系 `rel.a.b` / 地点 `loc` / 时间 `time` / 世界事实 `world.*`，沿结构图逐节点推演；角色卡外貌作为全剧服装基线
  - **汇合语义**：所有来路都成立 → 确定事实；只在部分路径成立 → 不确定事实，剧本**不得依赖**（依赖即报 `LEDGER_VARIES`）；汇合节点可以用 sets 重新统一
  - **逐层生成**：节点的所有来路剧本写完 → 入场账本确定 → 才能写它；每次请求 50 秒预算并行 6 个，前端循环续跑，可中断
  - **依赖指纹**：节点定义 + 出入边 + 世界观 + 入场账本 → 只有真正影响本节点的上游变化才会让它「过期」，实测改了 1 个节点只重写受影响的 7/14 个
  - **第 5 步**：提示词 Agent 写英文提示词 → 连贯监管 Agent 对照账本 / 上一段结尾审查 → 硬伤自动打回重写一次 → 仍有冲突的节点留给人工；服装 / 伤痕 / 道具 / 地点由账本**确定性**生成「连贯性附录」拼到提示词末尾，禁止字幕水印
  - **视频模式规划**：主线 / 起点 → 参考图锁人物；单来路分支 → 接上一段尾帧；汇合（多来路）→ 参考图；尾帧接力连续 3 段后强制用参考图校准，防止人物漂移
  - 闸门：剧本 / 提示词未全部通过不能提交（422），审批时再次校验；已通过的步骤只读，要改须「退回修改」（下游失效）
  - 实测（真实模型）：14 节点剧本 60 秒全部通过；提示词 + 监管 22 秒全部通过（参考图 10 / 尾帧 4）
  - API：`/api/projects/:id/scripts[/:node]`、`/scripts-run`、`/prompts[/:node]`、`/prompts-run`
- **P4 素材生产 ✅（第 6–9 步：设定图 · 主线视频 · 分支视频 · 一致性检测）**
  - **交付槽** `st_slots`：每个交付物一行（`cast.<角色>` 三视图 16:9 + `cover` 3:4；每个结构节点 1 段视频，主线 → 第 7 步，其余 → 第 8 步），状态 pending / blocked / queued / running / post / checking / ok / qc_fail / failed / stale
  - **依赖传播**：视频槽的指纹包含所用设定图 / 上一段视频的 media_key → **重画某张设定图，用到它的视频自动变 stale**；尾帧接力的分支必须等上一段 ok 才开拍（blocked）
  - **两种执行路线**：① **直连**（Worker 调服务商）：火山方舟 Seedance 视频 / 图片、OpenAI 兼容中转站视频 / 图片——参考图以 **HMAC 签名的 1 小时临时链接** `/pub/<key>?exp&sig` 发给服务商（无公网域名时退化为 base64）；② **执行节点**（`scripts/studio/studio_node.py`，令牌鉴权）：gsk、即梦 dreamina CLI、后处理（统一 576p 转码、首/尾帧/海报提取）、接缝评分
  - **没有定时任务**：调度是「惰性 tick」——前端轮询 / 节点领任务时推进，受并发上限（默认 4）控制；Cloudflare 托管部署也能跑
  - **第 9 步一致性检测**：接缝分（上一段尾帧 vs 本段首帧，NCC 0.6 + 直方图 0.4，纯色帧用像素差兜底，≥0.55）、烧录字幕检测（≤0.2）、音轨存在、**视觉 Agent** 看首帧判人脸一致性（≥6 分）/ 畸形 / 画面文字；不合格 → `qc_fail`，原因写进下一次提示词自动重拍（≤3 次）；审核可人工「通过 / 打回（附意见，拼进重拍提示词）」或手动上传替换
  - **审核失败自愈**：内容审核拒绝 → 自动追加柔化描述重试；版权 / 肖像拒绝 → 提示重画设定图
  - 媒体：`/m/*` 需登录并支持 Range（视频可拖动）；执行节点 API `/node/claim`、`/node/jobs/:id/report`、`PUT /node/jobs/:id/files/:name`、`/node/media/*`
  - 前端「素材工作台」：卡片网格 + 详情（视频 / 首尾帧 / 质检指标）+ 筛选 + 一键生产 / 重拍 / 上传 / 通过 / 打回；「执行节点」页创建节点（令牌只显示一次）+ 生产参数（阈值 / 并发 / 自动重拍 / 公网域名）
  - API：`/api/projects/:id/media/:n[/run|/judge|/upload]`、`/api/media-settings`、`/api/nodes[/:nid]`
  - **真拍小样** `sp_8a7631217fd4`《雨夜牌局》（gsk · nano-banana-pro 设定图 + Seedance 2.0 mini 视频）：设定图 3 张（MIRI 首张误成男性 → 打回附意见后重画正确）；主线 3 段 8 秒全部一次通过（人脸 8–9 分、0 字幕、有音轨）；分支 e2 走尾帧接力。实测成本 ≈ **3,080 积分 / 8 秒段**（设定图 ≈ 90/张）
- **执行节点部署**：`pm2 start ecosystem.config.cjs --only studio-node`；在 Studio「执行节点」页新建节点拿令牌，写入 `.node.env`（`STUDIO=…  NODE_TOKEN=msn_…  KINDS=post,gsk,jimeng_cli  CONC=3`）。用即梦需先在节点机器上 `dreamina login --headless`
- **手机适配**：底部固定 Tab 栏（含安全区）、十步流水线横滑并自动定位当前步、结构图双指缩放 + 大触控端口、输入框 16px 防 iOS 放大、弹窗改底部抽屉；390 / 360 / 768 宽度全部页面无横向溢出
- 验收：`npm run test:studio` → 结构引擎 **37/37** + 剧情账本 **33/33** + 接口验收 **91/91**（模拟服务商 + 真实执行节点离线跑通 1→9 步：卡关、令牌、生成、质检打回重拍、Range、人工判定、闸门、stale 传播）
- 路线：P5 第 10 步预检 → 版本快照发布到玩家端（替代旧导演台 / 上架中心）

## 📱 玩家端手机适配
- 顶栏精简 + **底部 Tab 栏**（发现 / 漫剧 / 真人剧 / 抽象剧 / 我的，适配刘海 / 底部安全区）；播放页沉浸不显示底栏
- 「工作台」菜单在手机上变全宽下拉，收入「结局卡交易所」入口；点外部 / 选中 / 滚动自动收起
- 输入控件 16px（防 iOS 聚焦放大）、点击区 ≥32px、`touch-action: manipulation` 去 300ms 延迟与点击高亮、无悬停设备不残留 hover 态
- 体检脚本：`python3 scripts/mobile_audit.py`（14 页 × 390/360/768：横向溢出 / 溢出元素 / 小按钮 / JS 报错 + 截图）、`python3 scripts/mobile_flow.py`（交互流：详情抽屉 → 真人剧开局 → 押注确认 → 漫剧阅读 → 抉择押注 → 交易所 → 导演台，逐步校验关键按钮在屏内且未被遮挡）——当前 **全部通过**

## 🐰 品牌 · MoMocash剧场
- **Logo**：粉色兔耳团子「MoMo」，眯眼 + ω 嘴 + 腮红，抱着爱心金币（cash = 押注筹码）；纯矢量手绘，任意尺寸清晰。
- **文件**（`public/static/brand/`）：`momo.svg`（图形标）· `momo-logo.svg/png`（横版组合标）· `favicon-32.png` · `apple-touch-icon.png` · `icon-192/512.png`（PWA）· `og.png`（1200×630 分享卡）；`/static/manifest.webmanifest`。
- **字标**：`MoMo`（粉色渐变）+ `cash`（金币黄）+「剧场」胶囊标签；字体 Fredoka + 站酷快乐体（Google Fonts）。
- **色板**：主粉 `#ff5c9f` / 亮粉 `#ff8cc0` / 浅粉 `#ffd3e5` / 金币 `#ffc53d` / 夜色底 `#170d17`；全局 `--gold` 变量已改为粉色，播放页保留各剧独立主题色。
- 品牌验收：`python3 tests/ui_brand.py`（4 页 × 桌面/手机，校验 logo 加载、无旧品牌名、无 JS 报错）。

## 🚀 上架中心（/publish）· 统一提交上线入口
- **入口**：顶部导航「工作台 → 上架中心 · 提交上线」，或导演台项目卡片里的「去上架中心」按钮。
- **流程**：待上架列表（导演台成片项目）→ 点开自动**预检** → 填写片名 / 简介 / 题材 / 受众 / 分级 / 角标 / 标签 / 关联目录概念卡 → **提交上线**（再次提交 = 版本 +1）→ 已上架可「试玩 / 下架 / 更新版本」，已下架可「恢复」。
- **预检项**（✗ 阻断，⚠ 提示）：真实成片（dry 空跑占位一律拦截）/ 无进行中片段 / 序章 / 首个抉择点 ≥2 选项 / 可达结局 ≥3 / 剧情树结构 / 封面 / R2 序章视频存在；⚠ 精简版裁剪、肖像版权拒绝、时间裂隙、彩蛋 3 档、角色立绘。
- **精简版上架**：失败分支自动从剧情树裁掉（节点剩 <2 选项则整节点移除，常规权重重新归一），只要主干可玩即可先上线，补拍后「更新版本」。
- **失败片段重拍**：内容审核拒绝（content_moderation_rejected）→ LLM 改写提示词（去暴力/赌博措辞，保留角色定义、镜头结构、中文台词）→ 自动重排队，最多 2 轮；肖像/版权拒绝（content_moderation_copyright）= 设定图撞脸真人，改写无效，预检提示重做设定图。设定图提示词已加入“原创面孔、不得像任何真人明星”约束。
- **计费修正**：Seedance 失败任务不扣费（实测余额不变），worker 失败回报 spent=0；「赌桌风云」历史虚记 12,580 积分已写冲销分录（credit_ledger kind=adjust）。
- **审计**：publish_log 记录 publish / update / takedown / restore / meta，含预检快照。
- **API**（ADMIN_KEY）：`GET /api/admin/publish/board`、`GET /api/admin/publish/:pid/preflight`、`POST /api/admin/publish/:pid/submit`、`POST /api/admin/series/:sid/takedown|restore|meta`、`POST /api/director/projects/:id/retry`
- ⚠ 本地未配置 ADMIN_KEY 时管理面开放（开发便利）；**生产必须设置 ADMIN_KEY secret**，否则任何人可上下架。

## 🎬 AI 导演台 · 全自动生成流水线（/director）

### 两段式编剧 v2（2026-09-27 检验后重构）
- **问题**：旧版一次性输出整棵树 + 全部分镜（1~1.6 万字），standard 规模下 fork / bonus 常被截断、被 looseJson 静默吞掉 → 时间裂隙 0 个、结局只剩 9 个、彩蛋 0 段；题面常是“你会……还是……？”这类玩家行动题，不是竞猜题；题面里漏出英文 id。
- **现在**：① 骨架（剧情树 + 竞猜题 + 每段 beat，短 JSON）→ `lintSkeleton`（数量 / 行动题 / 选项≤8 字 / 互斥 / hint / 英文 id 自动替换）→ 不过就带问题清单重写一次 → ② 分镜按 4 段一批**并行**写，每段都知道“结尾要引出哪道题”，不合格段落再重试一次 → compile → repair → validate。
- 网关记录 `finish_reason`，截断会写进 `gen_tasks.degrade_reason`；台词清洗 `cleanLine`（去括号舞台指示、纯省略号不算台词）。
- `/api/director/brief` 新增返回 `lint`（非阻断质检提示，导演台卡片展示）与 `secs`。
- 实测（`python3 tests/director_audit.py`）：3 形态 standard 均为 5 抉择点 / 12 结局 / 3 裂隙入口 / 21 段含 3 彩蛋，结构问题 0，用时 23~56s；pilot 20s、epic 40s（20 结局 / 30 段）。

主题一句话 → LLM 剧本（自动插入博弈抉择 / 隐藏分支 / 时间裂隙）→ repairTree/validateTree → 预算估算 → 立项(greenlight)
→ render_jobs（sheet 角色设定图 → cover → clips）→ `scripts/studio/director_worker.py`（gsk nano-banana-pro + Seedance 2.0 参考模式+原声）
→ 字幕对齐 → ffmpeg 576p → R2 → AI 质检 → 自动审核 → 自动上架 `published_series` → 播放 `/s/:sid`
- 积分台账：`credit_ledger` 每任务真实扣费；预算/余额守卫；worker 心跳与超时任务回收
- 试点《深夜禁区：总裁的秘书》/s/gen_176e47ae：13 个任务，共 12,454 积分（主线 9,904 + 三档彩蛋 2,550）
- API：`/api/director/brief|projects/:id/greenlight|publish|pause|bonus`、`/api/director/claim`、`/api/director/jobs/:id/report|review`（ADMIN_KEY）

## 💎 命运等级 · 黄金 / 白金 / 钻石结局（收益模型）
| 等级 | 条件（本局） | 奖池分红 | 结局卡 | 专属彩蛋 |
|---|---|---|---|---|
| 👑 黄金 | 押注≥200 · 押中≥1 · 不亏 | 奖池 2%（≤400） | 稀有度 +1 · 参考价×1.2 | BONUS_gold |
| 🏆 白金 | 押注≥600 · 押中≥2 · 净赢≥200 | 奖池 5%（≤1200） | +2 · ×1.5 | BONUS_platinum |
| 💎 钻石 | 押注≥1500 · 每幕都押且全中 · 净赢≥800 | 奖池 12%（≤3000） | +3 · ×2 | BONUS_diamond |
- 命运奖池 `pool:fate:<series>` = 每注 2%（平台抽水划转）+ 悔棋税 30%；分红以奖池余额封顶，平台永不超发
- 10 万局模拟：平台净利 6.74% 流水；黄金 14% / 白金 0.68% / 钻石 0.35% 触达率，奖池可持续
- 前端：决策卡命运进度条、结局 fate-fx 揭晓动画 → 专属彩蛋片段 → 徽章 / “差一点就是…”提示
- 测试：`python3 tests/ui_fate.py`（手机视口，已验证白金结局 + 彩蛋播放 + UR 卡）

## 🗂️ 专业分类体系（形态 × 题材 × 受众 × 分级）
| 维度 | 取值 | 作用 |
|---|---|---|
| **形态 format**（一级导航） | 🎨 漫剧 `anime` · 🎬 真人剧 `live` · 🔷 抽象剧 `abstract` | 决定生成管线：Seedance 画风、角色设定图、封面提示词（`src/catalog/taxonomy.ts`） |
| **题材 genre**（二级筛选） | 恋爱·甜宠 / 都市·豪门 / 复仇·逆袭 / 悬疑·惊悚 / 古风·仙侠 / 奇幻·科幻 / 动作·犯罪 / 末日·生存 / 无厘头·整活 / 超现实·梦核 | 决定编剧类型；导演台未指定时按主题关键词自动识别 |
| **受众 audience** | 女频 / 男频 / 全向 | 分发与推荐 |
| **分级 rating** | 全年龄 / 16+ / 18+ | 18+ 走年龄确认遮罩 |
- 目录 41 部：漫剧 8 · 真人剧 27 · 抽象剧 6（新增 6 部抽象剧 + 3 部漫剧，AI 封面）
- URL：`/?cat=anime|live|abstract&genre=suspense&aud=female`；旧链接 `?cat=love|film` 自动映射到 漫剧|真人剧
- 数据：`migrations/0008_taxonomy.sql`（studio_projects / published_series 增加 genre，cat 迁移为新形态）
- 测试：`python3 tests/ui_taxonomy.py`

## 🐱 抽象剧试水：《喵总裁今天也在裁员》（/s/gen_422d4304）
- 导演精修剧本 `scripts/director/cat_ceo.py`（`/api/director/brief` 支持 `outline` 直传，跳过 LLM）→ 23 任务全自动生成：21 段视频 + 设定图 + 封面，共 **19,046 积分**
- 结构：3 路线 + 隐藏支 + 9 结局 + 时间裂隙（3 结局）+ 黄金/白金/钻石彩蛋 · 黏土定格 × 韦斯·安德森对称构图
### 新互动玩法
| 玩法 | 机制 | 目的 |
|---|---|---|
| 🐱 **喵语翻译局** | 每个抉择 = 喵总的一声喵，押哪种“翻译”是对的（`series.mech`） | 抽象剧专属题面，降低理解门槛 |
| 👥 **全民陪审** | 每个选项实时显示“多少人押了它”（真实押注 + 20 票先验平滑） | 社交感 + 从众/反从众博弈 |
| 🦊 **独行侠奖励** | 押中少数派（人群占比 < 0.85/选项数）额外 +20% 本金 | 鼓励反向思考；模拟平台毛利仍 6.6–7.0%（支出≈1%） |
| 📸 **截梗 → 梗图** | 每段自带“名场面”梗，结算时一键截梗，结局页 Canvas 合成梗图（含邀请链接） | UGC 传播 |
| 🎁 **邀请裂变** | `?ref=` 绑定，被邀请人首次开局双方各 +200（sybil 设备 / 每日 10 人上限不发） | K 因子 |
| 🔮 **押注人格 → 真人剧导流** | 独行侠 / 反转猎人 / 梭哈玩家 / 喵语预言家 / 快乐吃瓜人 → 按题材偏好推荐 3 部真人剧 | 抽象剧拉新 → 真人剧变现 |
### 增长漏斗（导演台“增长实验”卡片 · `/api/admin/funnel`）
抽象剧开局 → 通关 → 做梗图 → 分享 → 邀请新人 → 看到真人剧推荐 → 点击 → 真人剧开局；K 因子、邀请奖励、独行侠支出
- 数据：`migrations/0009_growth.sql`（funnel_events / referrals / comic_rounds.contrarian）· `src/growth/growth.ts`
- 测试：`python3 tests/ui_abstract.py`（邀请进场 → 截梗 → 人格 → 梗图 → 导流，errors=[]）
