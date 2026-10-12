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

### 2. 阶段与策略

策略层使用指标、讨论阶段、介入冷却时间和最近证据选择以下决策：

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

### 4. DeepSeek 的角色

没有 API Key 时，确定性的本地策略引擎可以独立运行。配置 DeepSeek 后：

- 服务端可以补充想法聚类、新颖度、阶段建议和语义证据；
- 介入时可以依据最近 6 条发言生成一句简短、具体的中文表达；
- 模型不直接控制硬件，最终策略仍经过同一决策层。

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- 支持现代 ES Modules 的浏览器

### 本地运行

```bash
npm run dev
```

打开 [http://localhost:4173](http://localhost:4173)。没有配置 DeepSeek 时，页面会自动使用本地策略模式和内置示例数据。

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
│   └── ui-contract.test.mjs
├── server.mjs                 # 静态服务与 DeepSeek API 适配
├── build.mjs                  # 生成 dist/
└── .openai/hosting.json       # OpenAI Sites 部署配置
```

## 常用命令

```bash
npm run dev      # 启动本地开发服务器
npm run check    # 检查 JavaScript 语法
npm test         # 运行 Agent 与 UI 契约测试
npm run build    # 将可部署静态文件生成到 dist/
```

## 修改入口

- 调整动作、文案和阈值：`public/config/actions.json`
- 修改指标与策略：`public/agent-engine.js`
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
