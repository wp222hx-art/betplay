# DreamForge · Cash 剧场｜对弈式交互剧平台（7-Agent 协作版 MVP）

> 结果先锁定，再开盘；剧情先生长，再揭晓。

## 项目概述
- **目标**：把 PRD《功能设计与系统工作流总纲 V1.0》落地为可玩、可运营、可验证的平台 MVP
- **示范剧**：《天台》：3 场景 × 3 个 Cash 节点 × 9 个结局簇 × 27+ 变体，另有 3 个结局（内容由 LLM 生成）
- **架构文档**：`docs/ARCHITECTURE.md`

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
