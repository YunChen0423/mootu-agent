# MooTu Agent Lab

用于展示 MooTu 如何观察小组创意讨论、判断发散/收敛阶段、选择是否介入，并输出 Core / Pod 具身动作。

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
- `public/app.js`：状态计算、决策事件与界面更新。

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
