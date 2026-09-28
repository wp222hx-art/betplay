# MoMocash剧场 —— 系统架构（Agent-1 · 系统产品策划师）

> 结果先锁定，再开盘；剧情先生长，再揭晓。
> 上游依据：《MoMocash剧场｜对弈式交互剧平台 功能设计与系统工作流总纲 V1.0》

## 1. 三端一台 × 六层栈

| 端 | 路径 | 负责 Agent |
|---|---|---|
| 玩家端 Cash Stage（专属交互播放器） | `/`、`/play/:series` | A5 |
| 运营后台 Forge Console（12 模块） | `/console#<module>` | A6（+A2/A3/A4/A7 子页） |
| 创作端 Forge Canvas（剧本树） | `/console#script` | A6 / A7 |
| 7-Agent 指挥中心 | `/agents` | A1 |

| 层 | 名称 | 实现 | Agent |
|---|---|---|---|
| L5 | Cash Stage | `public/static/player.js`：Canvas 程序化镜头 + 下注面板 + 倒计时环 + 本地 AES-GCM 解密 + 悔棋滑动确认 + 公平验证 | A5 |
| L4 | ForgeLedger | `engine.ts#post`：复式记账（借贷必平）、冻结→派彩/收注、彩池分账、悔棋税独立科目 | A4 |
| L3 | ForgeCore | `engine.ts`：DFP 七态、Commit-Reveal、Branch Registry、事件溯源哈希链、CAS 局级锁 | A2 |
| L2 | 编排播放 | 生成-播放分离：每局为全部结局簇生成等长密文分片，REVEAL 仅下发真分片密钥 | A5 |
| L1 | 画布创作 | 剧本树（spine/flesh/skin）、变体池、WF-06 延展、诗词 | A7 |
| L0 | Model Gateway | `gateway/llm.ts`（能力→模型路由、熔断、兜底模板、任务契约）+ `gateway/video.ts`（视频五维选型） | A3 |

## 2. 7-Agent 分工

| # | Agent | 核心产出 | 工作流 |
|---|---|---|---|
| 1 | 系统产品策划师 | 架构、D1 Schema、Agent 注册表、示范剧蓝图播种 | WF-01 |
| 2 | 子模块开发师 | ForgeCore / Ledger / Gateway 模块；变体批量生成（差异化指令→LLM→bigram 去重≥0.85→规则评分≥75 入池） | WF-02 / WF-05 |
| 3 | 测试与视频模型官 | 11 项自动化验收；视频模型五维加权选型；预判优先级 = 0.6·story_weight + 0.4·全网热度 | WF-09 / 投机生成 |
| 4 | 交互下注结算师 | 固定赔率 `(1-rake)/w`、Arena parimutuel、幂等下注、2s 撤销、日限额、悔棋 ×1.5、蒙特卡洛 EV | WF-03 / 04 / 07 |
| 5 | 专属播放器设计师 | 8 段式一局体验：剧情→预告冻结→下注→咔哒锁盘→揭晓→结算→悔棋→下一节点 | L5 |
| 6 | 后台统计与剧本管理 | 监控大屏、分支到达 vs 权重偏差、水位、剧本编辑/休眠、任务、审计 | WF-10 |
| 7 | 剧本衍生与诗词提炼 | WF-06 延展（六维评分→自动过/人审→写入画布血肉层）；七绝格律校验 + Critic 重写；全网决策类目监管；对弈片对优化 | WF-06 / WF-08 |

## 3. 关键机制

- **Commit-Reveal**：`seed = 32B 随机`；`r = HMAC(seed,"outcome")[0:52bit]/2^52`，按 outcome_id 字典序累积 story_weight；`commit = HMAC(seed, round|outcome|variant)`。结算后公开 seed，玩家浏览器本地复算。
- **防预判**：客户端拿到 N 个等长 AES-GCM 密文（顺序随机、按最大分片字节对齐），无 outcome 映射。
- **有序并发**：钱与结果串行（CAS `BETTING→LOCK`、单写者），生成/信号/统计旁路异步。
- **兜底永远存在**：每结局簇 ≥1 兜底变体；LLM 失败→备选模型→模板；视频无供应商密钥→`motion-still` 程序化渲染。
- **全网对弈监管**：归一化熵分歧度、最大占比（>65% 一边倒 / >90% P0 暂停）、到达率偏差（样本≥30 且 >15%）、全网 vs 站内意见分裂。
- **片对优化**：节点对弈价值 = 分歧度 × (1 + 热度占比)；片对 = Σ C(k,2)；完整路径 = Π k；分配结果写回 `outcomes.target_variants` 驱动补货。

## 4. 数据模型（D1）
`series · nodes · outcomes · variants · users · rounds · bets · ledger · round_events · branch_registry · gen_tasks · extensions · decision_signals · agent_runs · test_reports`（见 `migrations/0001_init.sql`）
