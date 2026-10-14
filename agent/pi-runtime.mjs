import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple as openAICompletionsStream } from "@earendil-works/pi-ai/api/openai-completions";
import { Type } from "typebox";
import { STRATEGIES } from "./policy.mjs";
import { createBatchToolset, createLiveToolset, toolStateSnapshot } from "./tools.mjs";

const score = Type.Number({ minimum: 0, maximum: 100 });
const candidateSchema = Type.Object({
  strategy: Type.String(),
  target: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  title: Type.Optional(Type.String()),
  rationale: Type.Optional(Type.String()),
  benefit: score,
  disruption: score,
  goal_fit: score,
  confidence: score,
  follow_up: Type.Optional(Type.String()),
  expected_effect: Type.Optional(Type.String()),
  utterance: Type.Optional(Type.String())
});

const decisionSchema = Type.Object({
  time: Type.Optional(Type.Number()),
  stage_recommendation: Type.Union([Type.Literal("diverge"), Type.Literal("converge")]),
  evidence: Type.Array(Type.String(), { maxItems: 3 }),
  missing_evidence: Type.Array(Type.String(), { maxItems: 4 }),
  candidates: Type.Array(candidateSchema, { minItems: 1, maxItems: 3 })
});

const analysisSchema = Type.Object({
  summary: Type.String(),
  screen_topic: Type.Optional(Type.String({ maxLength: 8 })),
  idea_clusters: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
  vote_candidates: Type.Optional(Type.Array(Type.String({ maxLength: 8 }), { minItems: 2, maxItems: 4 })),
  events: Type.Array(decisionSchema, { minItems: 1 })
});

function createDeepSeekModel(model, baseUrl) {
  return {
    id: model,
    name: model,
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: baseUrl.replace(/\/$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek"
    }
  };
}

function compactTraceEvent(event) {
  if (event.type === "tool_execution_start") return { type: event.type, tool: event.toolName };
  if (event.type === "tool_execution_end") return { type: event.type, tool: event.toolName, isError: event.isError, durationMs: event.durationMs };
  if (event.type === "message_end") return { type: event.type, role: event.message.role };
  return { type: event.type };
}

function makeAgent({ systemPrompt, tools, shouldFinish, apiKey, baseUrl, model, streamFn, modelDefinition }) {
  return new Agent({
    initialState: {
      systemPrompt,
      model: modelDefinition || createDeepSeekModel(model, baseUrl),
      thinkingLevel: "off",
      tools
    },
    streamFn: streamFn || openAICompletionsStream,
    getApiKey: () => apiKey,
    toolExecution: "sequential",
    finishTurn: () => shouldFinish?.() ? { action: "end" } : undefined
  });
}

async function runToolAgent({ systemPrompt, userPayload, tools, shouldFinish, runtime }) {
  const trace = [];
  const agent = makeAgent({ systemPrompt, tools, shouldFinish, ...runtime });
  agent.subscribe((event) => { trace.push(compactTraceEvent(event)); });
  await agent.prompt(JSON.stringify(userPayload));
  if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
  return trace;
}

const sharedPrompt = `你是 MooTu 具身讨论促进 Agent。你只引用工具返回的可观察证据，不推断心理、生理、性格或身份。可用策略仅限：${STRATEGIES.join("、")}。每组候选必须包含 observe；只有 invite_quiet_member 可以指定已有参与者为 target。必须通过工具完成感知、评估、提案、动作生成、模拟 dispatch 和效果记录，不要直接用普通文本回答。读取类工具可以在同一轮调用；所有带状态变化的工具必须按流程顺序调用。`;

export async function runPiBatchAgent({ observations, participants, config, apiKey, baseUrl, model, streamFn, modelDefinition }) {
  const toolkit = createBatchToolset({ observations, participants, config, decisionSchema, analysisSchema });
  const trace = await runToolAgent({
    systemPrompt: `${sharedPrompt}\n流程：先调用全部 6 个感知/记忆工具；再调用 evaluate_candidates；最后依次调用 propose_intervention、generate_robot_action、dispatch_core_action、dispatch_pod_feedback、record_expected_effect。逐个覆盖输入中的全部检查点。evaluate_candidates 的 screen_topic 必须是一个语义完整、可直接显示在屏幕上的中文讨论主题，不超过 8 个字；不能截取半句话，不能写成员正在说的句子。vote_candidates 必须是从完整讨论中去重归纳出的 2 到 4 个可投票方案名称，每项不超过 8 个字，必须是名词短语而不是发言片段。`,
    userPayload: { goal: "促进参与开放性、创意发散性和讨论流动性；仅在预期收益明显高于打断成本时介入", participant_count: participants.length, checkpoint_count: observations.length },
    tools: toolkit.tools,
    shouldFinish: () => toolkit.state.recorded,
    runtime: { apiKey, baseUrl, model, streamFn, modelDefinition }
  });
  if (!toolkit.state.analysis || !toolkit.state.recorded) throw new Error("pi agent 未完成完整讨论工具链");
  return { analysis: toolkit.state.analysis, trace, execution: toolStateSnapshot(toolkit.state) };
}

export async function runPiLiveAgent({ transcript, participants, stage, signal, memory, config, apiKey, baseUrl, model, streamFn, modelDefinition }) {
  const toolkit = createLiveToolset({ transcript, participants, stage, signal, memory, config, decisionSchema });
  const trace = await runToolAgent({
    systemPrompt: `${sharedPrompt}\n流程：先调用全部 6 个感知/记忆工具；再调用 evaluate_candidates；最后依次调用 propose_intervention、generate_robot_action、dispatch_core_action、dispatch_pod_feedback、record_expected_effect。只评估当前窗口。`,
    userPayload: { task: "评估当前现场讨论窗口" },
    tools: toolkit.tools,
    shouldFinish: () => toolkit.state.recorded,
    runtime: { apiKey, baseUrl, model, streamFn, modelDefinition }
  });
  if (!toolkit.state.decision || !toolkit.state.recorded) throw new Error("pi agent 未完成完整实时工具链");
  return { decision: toolkit.state.decision, trace, execution: toolStateSnapshot(toolkit.state) };
}
