# DreamForge · Cash 剧场｜对弈式交互剧平台（7-Agent 协作版 MVP）

> 结果先锁定，再开盘；剧情先生长，再揭晓。

## 项目概述
- **目标**：把 PRD《功能设计与系统工作流总纲 V1.0》落地为可玩、可运营、可验证的平台 MVP
- **示范剧**：《天台》：3 场景 × 3 个 Cash 节点 × 9 个结局簇 × 27+ 变体，另有 3 个结局（内容由 LLM 生成）
- **架构文档**：`docs/ARCHITECTURE.md`

## 🆕 对弈式漫剧《穹顶之下》（/comic）
- **规模**：34 个抉择点（4 幕：1→3→9→21），75 条常规分支，34 条悔棋隐藏分支，63 个结局（其中 21 个是隐藏结局）
- **媒体**：112 幅 GPT Image 2 分镜（以角色设定图做参考，锁定人物一致性），全部提前生成
- **V2 纯对白（没有旁白）**：LLM 把全部 112 段改写成纯对白，共 347 句，每句带情绪、语速、环境音和音效标签（`rewrite_dialogue.py` → `dialogue.json`）
- **情感配音**：MiniMax Speech 2.8 HD 逐句按情绪合成，情绪包括 sad、angry、fearful、surprised、happy、disgusted、neutral，生成了 346 条（`produce_voice_v2.py`）。角色音色：林夏 Wise_Woman / 陈默 Determined_Man / 渡鸦 movie_trailer_deep / 顾衡 Elegant_Man / 林小雨 Lovely_Girl
- **声场**：用 ElevenLabs 生成了 9 种环境底噪（屋顶雨、街雨、夜城、室内、机房、楼梯间、会议室、警报、黎明风）和 14 种音效（枪声、爆炸、雷、碎玻璃、狂奔、电梯、摔门、芯片、心跳、狙击上膛、人群惊呼，以及锁盘、揭晓、悔棋），由 `produce_sfx.py` 生成
- **混音**：用 WebAudio 做了一个小混音台。底噪用双源交叠无缝循环，换场景时 2.5 秒交叉淡变；角色说话时底噪自动压低，说完再恢复；抉择时加紧张铺底和心跳；枪声、爆炸这类音效会让画面震动
- **机制概率**：每局概率 = 基础剧情权重 → 后台覆盖 → 悔棋变局 → 种子扰动（±jitter），所以同一抉择每次开局的概率和赔率都不同；公式可复算验证
- **悔棋两种变局**：⚔ 二选一（排除刚发生的结果，剩下的重算概率和赔率）；✦ 新变数（多出一个隐藏选项，概率重新分配）。两种可以叠加
- **动态漫**：已用 Seedance 2.0 把关键分镜做成 5 秒动态画面（序章首镜 P1、首幕揭晓 O_RA）；播放器会自动用视频替换静帧，加载失败时退回静帧。可以继续用 `scripts/comic/produce_video.py <段落ID...>` 扩充，约 1,200 积分/段
- **后台**：`/console#comic`（机制参数 + 全树蒙特卡洛），`/console#comictree`（分支树、分镜预览、试听、按节点覆盖权重）
- **API**：`/api/comic/meta|tree|start|rounds/:id/bet|settle|rewind{mode}|next|verify|config|simulate|stats`
- **生产脚本**：`scripts/comic/gen_story.py`（LLM 剧情树）→ `normalize.py` → `produce.py`（图 + 音，可断点续跑）→ `build_data.py`

## 入口
| 页面 | 路径 |
|---|---|
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
