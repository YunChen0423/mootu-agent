# MooTu Agent Lab · 网站演示版

MooTu 是面向小组创意讨论的具身主持 Agent 课程原型。本仓库用于展示逐字稿回放、现场音视频输入、讨论状态、Agent 工具调用以及 Core / Pod 的浏览器 MuJoCo 仿真。

[线上演示](https://mootu-agent-lab.rich-hake-3298.chatgpt.site/)

## 项目仓库

- [mootu-agent-research](https://github.com/YunChen0423/mootu-agent-research)：正式研究代码、证据约束、成员意愿处理与合成评测，建议评阅代码与结果时优先查看。
- [mootu-agent](https://github.com/YunChen0423/mootu-agent)：本仓库，保留网站展示编排。
- [mootu-simulation](https://github.com/YunChen0423/mootu-simulation)：原始机器人模型、Python 物理仿真与键盘交互演示。

## 运行

要求 Node.js >= 22.19。在仓库目录运行：

```sh
npm ci
npm run dev
```

打开 [http://localhost:4173](http://localhost:4173)。未配置密钥时明确使用规则回退。需要模型时，复制 `.env.example` 为 `.env` 并填写 DeepSeek 配置，再启动服务；真实模型调用可能产生费用。不要提交 `.env`。

```sh
npm run check
npm test
npm run build
```

`build` 生成 Sites Worker；构建不等于部署。本次提交更新说明，未重新部署线上服务。语法检查和 72 项演示契约测试通过；这些测试不代表主持策略有效性。

## 展示内容及边界

- 导入 JSON / TXT 逐字稿，回放讨论与机器人动作；也可在授权后启用现场麦克风、摄像头及浏览器语音识别。
- 网页展示讨论状态、受限 Agent 工具链、策略理由、Core 动作和 Pod 反馈，可视化最多 6 位成员。
- 网页 MuJoCo 自带导出的物理模型与网格，不需要 Python 或旁边的原始模型目录；首次加载依赖 CDN 上的固定版本 MuJoCo WASM 与 Three.js，需要网络。
- 本版本保留 5 倍回放、第二次邀请、发言预算、按时间推进收敛等演示编排，部分流程与示例文本匹配相关。不能据此宣称 Agent 在真实讨论中自主发现了同样的介入时机。
- 未接入真实机器人和 Pod，dispatch 为 simulated；没有可靠的多人说话人分离，指标是启发式代理量，不能用于心理或生理诊断。
- 网页演示与研究版的行为不同；成员意愿修复和评测结论请查看研究仓库。

## 代码入口

`public/app.js` 管理界面与会话；`public/agent-engine.js` 提供规则测量；`agent/pi-runtime.mjs`、`agent/tools.mjs`、`agent/policy.mjs` 负责工具循环和策略校验；`public/session-harness.js` 管理阶段与投票；`public/browser-mujoco.js` 实现仿真呈现；`public/config/actions.json` 定义动作和参数。

原始仿真仓库如需用于可选 Python 桥接器，请按其 README 安装并以 `mootu/` 为同级目录名。早期架构文档仅作历史参考，见 [归档](docs/DEMO-ARCHIVE.md)。
