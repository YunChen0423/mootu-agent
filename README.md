# MooTu Agent Lab

MooTu 是一个面向小组创意讨论的具身主持 Agent 原型。它持续观察讨论中的可验证信号，判断群体处于发散或收敛阶段，决定是否介入，并把策略映射为 Core 机器人的群体动作与 Pod 的个体反馈。

在线演示：[https://mootu-agent-lab.rich-hake-3298.chatgpt.site/](https://mootu-agent-lab.rich-hake-3298.chatgpt.site/)

> 当前项目是用于交互研究与设计验证的原型，不应被当作心理、生理或行为诊断系统。

## 主要能力

- **讨论回放**：导入视频或逐字稿，按时间轴查看 Agent 的判断与介入。
- **现场模式**：经用户授权后读取摄像头和麦克风，展示音频活动、连续沉默、画面运动、亮度和浏览器语音识别结果。
- **群体状态判断**：用四点量表呈现参与开放性、创意发散性和讨论流动性，并在状态远离当前阶段目标时提示。
- **阶段识别**：在“发散探索”和“收敛决策”之间切换整页主题与策略目标。
- **可解释决策**：每次判断显示证据、策略、后续观察目标和结构化 JSON。
- **具身动作编排**：把策略映射为移动、朝向、姿态、语音、表情和信息六个 Core 通道，以及 Pod 的温度、振动和呼吸反馈。
- **动态成员布局**：根据逐字稿自动生成最多 5 位成员的位置；机器人会根据目标成员的位置改变朝向和指向角度。
- **上下文发言**：介入文本由最近讨论内容生成；配置 DeepSeek 后可使用模型生成更自然的中文表达。
- **自动运行**：示例或逐字稿载入后自动执行完整 AI 分析；现场模式在状态窗口变化时自动决策。“重新分析”仅用于手动重试。

## Agent 如何工作

```text
视频 / 音频 / 逐字稿
          │
          ▼
   可观察信号与时间窗
          │
          ▼
参与开放性 · 创意发散性 · 讨论流动性
          │
          ▼
阶段与策略选择（观察 / 邀请 / 启发 / 收敛）
          │
          ▼
Core 群体动作 + Pod 个体反馈 + 可审计 JSON
```

### 1. 感知与指标

`public/agent-engine.js` 在滚动时间窗中计算三类状态：

- **参与开放性**：综合 70% 发言时长与 30% 发言轮次，不使用逐字稿字数作为唯一依据。
- **创意发散性**：结合想法线索、候选想法数量和文本新颖度估计。
- **讨论流动性**：结合发言间隔、连续沉默和近期轮次数判断。

浏览器现场模式由 `public/live-sensing.js` 提供。背景噪声不会直接被当成有效发言；只有语音识别确认的内容才进入实时逐字稿。当前版本不提供多人说话人分离。

### 2. AI 决策策略

配置 DeepSeek 后，`ai-agent.mjs` 会启动一个基于 pi core 的有状态 Agent loop，把测量信号、最近逐字稿、可用动作和短期记忆交给模型。模型不能直接修改决策结果，只能调用注册的提交工具，提出“继续观察”和 1–2 个介入候选，并估计每个候选的收益、打断成本、目标匹配度和置信度。工具执行器中的确定性 Harness 比较候选后才选择最终动作，并为下一观察窗口写下预期效果。下一次决策会复盘上一轮介入后的参与、发散与流动变化。

模型只能从下面的受限动作空间选择；服务端会校验策略、目标成员、冷却时间和文本长度。无效输出会降级为 `observe`：

| 策略 | 典型触发情境 | 目标 |
| --- | --- | --- |
| `observe` | 讨论仍在自然推进 | 避免不必要的打断 |
| `invite_quiet_member` | 某成员长期低参与 | 低压力扩大参与 |
| `open_new_direction` | 发散阶段方向增长有限 | 激活新的探索方向 |
| `sustain_flow` | 想法值得继续展开 | 通过追问维持生成 |
| `prepare_convergence` | 从发散转向收敛 | 总结方向并开始比较 |
| `advance_decision` | 收敛阶段推进不足 | 促进取舍和形成结论 |

### 3. 具身输出

`public/config/actions.json` 定义策略到动作通道的映射：

- Core：移动、朝向、姿态、语音、表情、信息
- Pod：情感倾向、温度、振动、呼吸

动作配置与判断引擎分离，因此可以独立修改动作表现、阈值和文案，而不需要重写核心决策代码。

### 4. DeepSeek 与安全回退

配置 DeepSeek 后，它不只是生成文案，而是 pi Agent loop 中的策略提案层：

- 理解最近讨论及测量信号；
- 生成多个阶段与动作候选，并标明置信度和证据缺口；
- 生成与讨论内容相关的自然发言；
- 写下预期效果，并在后续窗口复盘可观察变化。

确定性代码仍负责信号测量、权限、动作白名单、介入冷却和输出校验。没有 API Key 或请求失败时，系统明确显示“AI 未配置 · 安全回退”，并使用规则策略维持演示；此时不声称正在进行大模型推理。

### 5. pi Agent 架构

服务端使用 `@earendil-works/pi-agent-core` 的 `Agent` 作为运行时：

- **状态归 Agent 所有**：消息、模型、工具和运行状态由 Agent 实例持有，而不是散落在一次性请求函数中。
- **工具闭环**：感知、指标、记忆、冷却检查、候选评估、介入提案、动作生成、Core / Pod dispatch 和效果记录均为独立工具。观察数据只通过 tool result 进入上下文，普通文本回答不会被当作有效决策。
- **生命周期事件**：运行过程记录 `agent_start`、消息、工具执行、轮次结束等事件，API 结果中的 `trace` 可用于调试和研究审计。
- **确定性执行边界**：模型负责提出候选，策略白名单、目标成员、冷却、阶段防抖和最终仲裁仍由本地 policy 层执行。
- **故障回退**：没有密钥时不启动模型循环，直接使用确定性规则引擎，保持原有体验可用。

注册的领域工具：

| 阶段 | 工具 |
| --- | --- |
| 感知 | `observe_discussion_window` |
| 指标 | `get_participation_metrics`、`get_flow_metrics`、`get_diversity_metrics` |
| 状态 | `read_recent_memory`、`check_intervention_cooldown` |
| 决策 | `evaluate_candidates`、`propose_intervention` |
| 行动 | `generate_robot_action`、`dispatch_core_action`、`dispatch_pod_feedback` |
| 反馈 | `record_expected_effect` |

当前项目没有真实机器人硬件驱动，因此两个 dispatch 工具会生成状态为 `simulated` 的可审计命令；未来接入硬件时只需替换对应 executor。

### 6. Agent Harness

这里的 harness 是围绕 pi 运行时的一组工程约束与运行设施，而不是提示词本身：

- **上下文组装**：把观察窗口、最近逐字稿、参与者、阶段和短期记忆整理为模型输入。
- **动作空间**：模型只能从 6 个允许策略中选择，并通过注册的领域工具完成完整流程，不能自由发明硬件动作。
- **结构化协议**：pi 工具使用 TypeBox schema 校验阶段建议、证据缺口、多个候选、四项候选评分、发言与后续观察。
- **候选仲裁**：Harness 按 `40% 收益 + 30% 目标匹配 + 20% 置信度 - 35% 打断成本` 计算效用；介入候选至少领先观察 8 分且置信度达到 60 才会执行。
- **校验与护栏**：校验策略、成员目标、文本长度与介入冷却；证据不足、目标无效或非法输出都会降级为观察。
- **阶段防抖**：连续两个观察窗口都建议收敛后才切换阶段，避免界面与行为随单次模型波动来回跳变。
- **记忆与反馈**：保留最近动作及预期效果，在下一窗口比较参与、发散和流动变化。
- **故障回退**：模型缺失、超时或输出无效时使用确定性规则，不阻塞现场体验。
- **可观测性**：界面和 JSON 明确展示候选效用、最终置信度、证据缺口、预期效果、复盘和记忆条数。
- **密钥隔离**：DeepSeek 密钥只存在于 `.env` 或 Sites Secret，绝不进入浏览器和版本库。
- **测试与发布**：自动化测试覆盖动作约束、指标边界、回退和 UI 契约；Sites Worker 提供同源 Agent API。

## 快速开始

### 环境要求

- Node.js 22.19 或更高版本
- 支持现代 ES Modules 的浏览器

### 本地运行

```bash
npm run dev
```

打开 [http://localhost:4173](http://localhost:4173)。没有配置 DeepSeek 时，页面会自动使用本地策略模式和内置示例数据。

### MuJoCo 在线演示

网页右侧“具身输出”会自动加载官方 MuJoCo WebAssembly 运行时，并在浏览器内完成物理计算和 WebGL 渲染。不需要安装 MuJoCo、启动 Python，也不需要连接本机 WebSocket；打开线上网站即可运行。

在线版由同级 `mootu/interaction_demo.xml` 和原始 OBJ 网格生成浏览器资产，完整保留机器人机身、头部、万向轮、前轮和六个球形部件的全部拓扑，不再做聚类、减面或几何替代。物理层使用同一套刚体、关节和碰撞体，视觉层直接绘制原始网格，从而绕开 MuJoCo 浏览器端单网格三角面限制。页面首次打开需要联网下载固定版本的 MuJoCo WASM、Three.js 和约 9 MB 的原始网格包，加载完成后仿真循环在浏览器本地执行。

当前映射包括：

- `observe`：停止底盘并轻微环视；
- `invite_quiet_member`：转向对应成员 Pod，短距离靠近并前倾；
- `open_new_direction` / `prepare_convergence`：抬头并进行不同幅度的环视；
- `sustain_flow` / `advance_decision`：前倾、点头，维持或推进讨论。

成员 `A`–`F` 分别映射到场景中的 `pod_1_light`–`pod_6_light`。右上角“重置仿真”可以把机器人恢复到初始位置。

仓库中的旧版 Python 桥接器仍可用于验证同级 `mootu` 原始模型：

```bash
npm run mujoco:validate
```

### 启用 DeepSeek

复制环境变量模板：

```bash
cp .env.example .env
```

填写：

```dotenv
DEEPSEEK_API_KEY=your_api_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

然后重新运行：

```bash
npm run dev
```

`.env` 已被忽略，不应提交到版本库。

## 逐字稿格式

页面支持 JSON 数组、包含 `transcript` 数组的 JSON 对象，以及 TXT 文本。

### JSON

```json
[
  {
    "start": 4,
    "end": 16,
    "speaker": "A",
    "text": "我们可以先讨论使用场景。"
  },
  {
    "start": 18,
    "end": 26,
    "speaker": "B",
    "text": "我想到一个不同的方向。"
  }
]
```

### TXT

```text
00:04-00:16 A: 我们可以先讨论使用场景。
00:18-00:26 B: 我想到一个不同的方向。
```

成员会根据 `speaker` 字段自动生成。当前具身场景最多同时显示 5 位成员。

## 项目结构

```text
mootu-agent/
├── agent/
│   ├── pi-runtime.mjs          # pi Agent loop、工具与生命周期 trace
│   ├── tools.mjs               # 感知、决策、动作、dispatch 与记忆工具
│   └── policy.mjs              # 候选校验、效用仲裁与阶段防抖
├── public/
│   ├── index.html              # 页面结构
│   ├── app.js                  # 回放、现场模式与界面状态
│   ├── agent-engine.js         # 指标、阶段与策略决策
│   ├── live-sensing.js         # 摄像头、麦克风与语音识别
│   ├── styles.css              # 基础样式
│   ├── enhancements.css        # 当前交互与响应式样式
│   ├── config/actions.json     # Core / Pod 动作与阈值配置
│   └── data/sample-session.json
├── tests/
│   ├── agent-engine.test.mjs
│   ├── ai-agent.test.mjs
│   └── ui-contract.test.mjs
├── ai-agent.mjs               # pi runtime 与规则回退的 API 适配层
├── server.mjs                 # 静态服务与 Agent API
├── build-worker.mjs           # 生成可运行 Agent API 的 Sites Worker
├── build.mjs                  # 可选的纯静态构建
└── .openai/hosting.json       # OpenAI Sites 部署配置
```

## 常用命令

```bash
npm run dev      # 启动本地开发服务器
npm run check    # 检查 JavaScript 语法
npm test         # 运行 Agent 与 UI 契约测试
npm run build    # 生成包含 Agent API 的 Sites Worker 到 dist/
npm run build:static # 仅生成纯静态版本
```

## 修改入口

- 调整动作、文案和阈值：`public/config/actions.json`
- 修改确定性测量与回退策略：`public/agent-engine.js`
- 修改 pi 工具循环与提示：`agent/pi-runtime.mjs`
- 修改候选效用、阶段防抖和安全校验：`agent/policy.mjs`
- 修改 AI/回退 API 适配：`ai-agent.mjs`
- 修改现场音视频判断：`public/live-sensing.js`
- 修改界面状态和逐字稿处理：`public/app.js`
- 替换示例讨论：`public/data/sample-session.json`
- 修改视觉样式：`public/styles.css`、`public/enhancements.css`

## 隐私与限制

- 摄像头和麦克风只会在用户主动开启现场模式并授权后使用。
- 音频活动、沉默、运动和亮度在当前页面中计算；语音识别的处理位置取决于浏览器实现。
- 项目不从语言、视频或一般音频推断心理状态或生理异常。
- “生理异常”反馈只允许来自明确提供的 `sensorEvents` 数据。
- 当前原型不包含可靠的多人说话人分离、身份识别或真实机器人硬件驱动。

## 当前状态

这是一个持续迭代的 HCI / 具身交互研究原型。当前重点是验证：可解释的群体状态判断，是否能帮助具身主持 Agent 在正确的时机、以合适的方式介入讨论。
