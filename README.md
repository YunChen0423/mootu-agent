# MooTu Agent Lab

用于运行和展示 MooTu 如何观察小组创意讨论、判断发散/收敛阶段、选择是否介入，并输出 Core / Pod 具身动作。

## Agent 架构

1. `public/agent-engine.js` 在滚动时间窗内计算参与均衡度、创意发散度和讨论流动性。参与均衡综合 70% 发言时长与 30% 发言轮次，不使用逐字稿字数。
2. 独立策略层根据证据、讨论阶段和介入冷却时间选择观察、邀请少发言者、激活新方向或推进收敛。
3. 配置 DeepSeek 后，服务端让模型补充语义窗口（想法聚类、新颖度、阶段建议和证据），再交给同一策略层做最终决策。
4. 每个决策事件包含证据、指标、目标成员、后续观察目标和可审计诊断值，并由界面映射到 Core / Pod 动作。

界面将内部连续指标转换为三档离散状态，避免给原型制造不必要的数值精确感；内部数值仍保留在结构化 JSON 中供调试和后续校准。

DeepSeek 不直接控制硬件；缺少 API Key 时，确定性的本地引擎仍可独立工作。

## 运行

需要 Node.js 18 或更高版本：

```bash
npm run dev
```

打开 `http://localhost:4173`。没有 DeepSeek API Key 时，项目自动使用内置示例和本地规则模式。

## 启用 DeepSeek

复制 `.env.example` 为 `.env`，填写 `DEEPSEEK_API_KEY`，然后正常运行：

```bash
npm run dev
```

模型、Base URL 都可以在 `.env` 中替换。

## 修改入口

- `public/config/actions.json`：Core / Pod 动作词典与判断阈值。
- `public/data/sample-session.json`：示例参与者、逐字稿和模拟传感器事件。
- `server.mjs`：DeepSeek 语义分析适配器。
- `public/agent-engine.js`：指标计算与策略决策。
- `public/app.js`：回放状态和界面更新。

## 验证

```bash
npm run check
npm test
npm run build
```

逐字稿格式：

```json
{ "start": 4, "end": 16, "speaker": "A", "text": "发言内容" }
```

界面支持上传 JSON 数组、包含 `transcript` 数组的 JSON 对象，或以下 TXT 格式：

```text
00:04-00:16 A: 我们可以先讨论使用场景。
00:18 B: 我想到另一个方向。
```

“生理异常”只允许来自明确的 `sensorEvents` 数据，不从视频或语言内容推断。
