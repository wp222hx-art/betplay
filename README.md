# DreamForge · Cash 剧场｜对弈式交互剧平台（7-Agent 协作版 MVP）

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

## 🎬 AI 导演台 · 全自动生成流水线（/director）
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
