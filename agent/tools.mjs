import { Type } from "typebox";
import { sanitizeEvents, sanitizeLiveDecision } from "./policy.mjs";

const REQUIRED_READS = ["window", "participation", "flow", "diversity", "memory", "cooldown"];
const emptyParameters = Type.Object({});

function jsonResult(value, details = {}) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details };
}

function errorResult(message, reason) {
  return { content: [{ type: "text", text: message }], details: { reason }, isError: true };
}

function actionPlans(decisions, config) {
  return decisions.map((decision) => {
    const core = config.core.strategies[decision.strategy];
    const pod = decision.target ? config.pod.responses.low_participation : config.pod.responses.normal;
    return {
      time: decision.time ?? null,
      strategy: decision.strategy,
      target: decision.target,
      core: { ...core, display: decision.utterance || core.display || "" },
      pod: { ...(decision.target ? { target: decision.target } : {}), ...pod }
    };
  });
}

function pipelineTools({ state, config, decisions }) {
  const requireEvaluated = () => state.analysis || state.decision;
  return [
    {
      name: "propose_intervention",
      label: "提出介入方案",
      description: "读取 Harness 已批准的决策，并形成待执行的介入提案。候选评估完成后调用。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        if (!requireEvaluated()) return errorResult("必须先调用 evaluate_candidates。", "evaluation_required");
        state.proposed = true;
        return jsonResult(decisions().map(({ time, strategy, target, title, reason }) => ({ time, strategy, target, title, reason })), { count: decisions().length });
      }
    },
    {
      name: "generate_robot_action",
      label: "生成机器人动作",
      description: "把已批准的介入策略映射为 Core 与 Pod 动作计划。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        if (!state.proposed) return errorResult("必须先调用 propose_intervention。", "proposal_required");
        state.actionPlans = actionPlans(decisions(), config);
        return jsonResult(state.actionPlans, { count: state.actionPlans.length });
      }
    },
    {
      name: "dispatch_core_action",
      label: "控制 Core",
      description: "将 Core 动作发送到当前原型执行层。当前没有硬件驱动，因此以可审计的模拟命令执行。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        if (!state.actionPlans) return errorResult("必须先调用 generate_robot_action。", "action_plan_required");
        state.coreDispatch = state.actionPlans.map(({ time, strategy, target, core }) => ({ time, strategy, target, command: core, status: "simulated" }));
        return jsonResult(state.coreDispatch, { mode: "simulation", count: state.coreDispatch.length });
      }
    },
    {
      name: "dispatch_pod_feedback",
      label: "控制 Pod",
      description: "将 Pod 个体反馈发送到当前原型执行层。当前没有硬件驱动，因此以可审计的模拟命令执行。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        if (!state.actionPlans) return errorResult("必须先调用 generate_robot_action。", "action_plan_required");
        state.podDispatch = state.actionPlans.map(({ time, strategy, target, pod }) => ({ time, strategy, target, command: pod, status: "simulated" }));
        return jsonResult(state.podDispatch, { mode: "simulation", count: state.podDispatch.length });
      }
    },
    {
      name: "record_expected_effect",
      label: "记录预期效果",
      description: "记录本轮介入的预期效果与后续观察目标，结束本轮 Agent loop。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        if (!state.coreDispatch || !state.podDispatch) return errorResult("必须先完成 Core 与 Pod dispatch。", "dispatch_required");
        state.memoryEntries = decisions().map(({ time, strategy, target, expectedEffect, followUp }) => ({ time: time ?? null, strategy, target, expectedEffect, followUp }));
        state.recorded = true;
        return jsonResult(state.memoryEntries, { count: state.memoryEntries.length });
      }
    }
  ];
}

export function createBatchToolset({ observations, participants, memory = [], config, decisionSchema, analysisSchema }) {
  const state = { reads: new Set(), analysis: null, decision: null, proposed: false, actionPlans: null, coreDispatch: null, podDispatch: null, memoryEntries: null, recorded: false };
  const mark = (name, value, details) => { state.reads.add(name); return jsonResult(value, details); };
  const tools = [
    {
      name: "observe_discussion_window",
      label: "读取讨论窗口",
      description: "读取全部检查点的最近逐字稿和可观察证据。批量分析必须覆盖完整会话。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        const selected = observations.map(({ time, suggestedStage, evidence, recentTranscript }) => ({ time, suggestedStage, evidence, recentTranscript }));
        return mark("window", selected, { count: selected.length });
      }
    },
    {
      name: "get_participation_metrics",
      label: "查询成员参与度",
      description: "查询参与开放性、发言时长、发言轮次和低参与目标。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("participation", observations.map(({ time, metrics, diagnostics }) => ({ time, score: metrics.participation, speaking_seconds: diagnostics.speaking_seconds, turn_counts: diagnostics.turn_counts, quiet_target: diagnostics.quiet_target, quiet_seconds: diagnostics.quiet_seconds })))
    },
    {
      name: "get_flow_metrics",
      label: "查询讨论流动性",
      description: "查询讨论流动性与当前连续沉默时长。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("flow", observations.map(({ time, metrics, diagnostics }) => ({ time, score: metrics.flow, current_silence_seconds: diagnostics.current_silence_seconds })))
    },
    {
      name: "get_diversity_metrics",
      label: "获取创意发散指标",
      description: "查询创意发散度、想法数量和近期新颖度。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("diversity", observations.map(({ time, metrics, diagnostics }) => ({ time, score: metrics.diversity, idea_count: diagnostics.idea_count, recent_novelty: diagnostics.recent_novelty })))
    },
    {
      name: "read_recent_memory",
      label: "读取短期记忆",
      description: "读取最近介入、预期效果与复盘记录。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("memory", memory.slice(-8), { count: Math.min(memory.length, 8) })
    },
    {
      name: "check_intervention_cooldown",
      label: "检查介入冷却",
      description: "检查介入冷却阈值和最近介入记录。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        const last = [...memory].reverse().find((entry) => entry.strategy && entry.strategy !== "observe") || null;
        return mark("cooldown", { cooldown_seconds: config.thresholds.intervention_cooldown_seconds, last_intervention: last });
      }
    },
    {
      name: "evaluate_candidates",
      label: "评估候选策略",
      description: "提交各检查点候选策略，由确定性 Harness 执行白名单、效用、冷却和阶段防抖校验。",
      parameters: analysisSchema,
      executionMode: "sequential",
      execute: async (_id, params) => {
        const missing = REQUIRED_READS.filter((name) => !state.reads.has(name));
        if (missing.length) return errorResult(`评估前缺少工具读取：${missing.join(", ")}`, "perception_tools_required");
        const events = sanitizeEvents(params.events, observations, participants, config);
        const screenTopic = [params.screen_topic, ...(params.idea_clusters || [])]
          .map((value) => String(value || "").replace(/[。！？；;，,].*$/, "").replace(/^(?:讨论|关于|主题)[：:\s]*/, "").trim())
          .find((value) => value.length >= 3 && value.length <= 8 && !/[吗呢么？?]$/.test(value)) || "";
        const voteCandidates = [...new Set((params.vote_candidates || []).map((value) => String(value || "").trim()).filter((value) => value.length >= 2 && value.length <= 8))].slice(0, 4);
        state.analysis = { summary: String(params.summary).slice(0, 300), screenTopic, ideaClusters: params.idea_clusters || [], voteCandidates, events };
        return jsonResult(events.map(({ time, strategy, target, confidence, selectionMargin }) => ({ time, strategy, target, confidence, selectionMargin })), { count: events.length });
      }
    }
  ];
  tools.push(...pipelineTools({ state, config, decisions: () => state.analysis?.events || [] }));
  return { tools, state };
}

export function createLiveToolset({ transcript, participants, stage, signal, memory, config, decisionSchema }) {
  const state = { reads: new Set(), analysis: null, decision: null, proposed: false, actionPlans: null, coreDispatch: null, podDispatch: null, memoryEntries: null, recorded: false };
  const mark = (name, value, details) => { state.reads.add(name); return jsonResult(value, details); };
  const recentTranscript = transcript.slice(-8);
  const ideaCues = recentTranscript.filter((line) => /可以|也许|或者|不如|想到|方案|方向/.test(line.text || "")).length;
  const tools = [
    {
      name: "observe_discussion_window",
      label: "读取现场讨论窗口",
      description: "读取当前阶段、传感信号和最近逐字稿。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("window", { stage, signal, recent_transcript: recentTranscript }, { transcriptCount: recentTranscript.length })
    },
    {
      name: "get_participation_metrics",
      label: "查询现场参与度",
      description: "查询现场已确认发言数量；当前版本不做多人说话人分离。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("participation", { recognized_utterances: recentTranscript.length, per_member_available: false, reason: "未接入可靠的多人说话人分离" })
    },
    {
      name: "get_flow_metrics",
      label: "查询现场流动性",
      description: "查询现场讲话状态、连续沉默和音频活动。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("flow", { speaking: Boolean(signal.speaking), silence_seconds: Number(signal.silenceSeconds || 0), audio_active: Boolean(signal.audioActive) })
    },
    {
      name: "get_diversity_metrics",
      label: "获取现场发散指标",
      description: "基于已确认的最近逐字稿返回可验证的想法线索数量。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("diversity", { idea_cue_count: ideaCues, transcript_count: recentTranscript.length, semantic_model: false })
    },
    {
      name: "read_recent_memory",
      label: "读取短期记忆",
      description: "读取最近介入、预期效果与阶段防抖记录。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => mark("memory", memory.slice(-8), { count: Math.min(memory.length, 8) })
    },
    {
      name: "check_intervention_cooldown",
      label: "检查介入冷却",
      description: "根据最近介入时间检查当前是否仍在冷却期。",
      parameters: emptyParameters,
      executionMode: "sequential",
      execute: async () => {
        const last = [...memory].reverse().find((entry) => entry.strategy && entry.strategy !== "observe") || null;
        const elapsed = last?.at ? Math.max(0, (Date.now() - Number(last.at)) / 1000) : null;
        return mark("cooldown", { cooldown_seconds: config.thresholds.intervention_cooldown_seconds, elapsed_seconds: elapsed, active: elapsed != null && elapsed < config.thresholds.intervention_cooldown_seconds, last_intervention: last });
      }
    },
    {
      name: "evaluate_candidates",
      label: "评估实时候选",
      description: "提交当前窗口候选策略，由确定性 Harness 执行白名单、效用与阶段防抖校验。",
      parameters: decisionSchema,
      executionMode: "sequential",
      execute: async (_id, params) => {
        const missing = REQUIRED_READS.filter((name) => !state.reads.has(name));
        if (missing.length) return errorResult(`评估前缺少工具读取：${missing.join(", ")}`, "perception_tools_required");
        state.decision = sanitizeLiveDecision(params, { participants, stage, transcript, memory, config });
        return jsonResult(state.decision, { strategy: state.decision.strategy });
      }
    }
  ];
  tools.push(...pipelineTools({ state, config, decisions: () => state.decision ? [state.decision] : [] }));
  return { tools, state };
}

export function toolStateSnapshot(state) {
  return {
    reads: [...state.reads],
    proposed: state.proposed,
    actionPlans: state.actionPlans,
    coreDispatch: state.coreDispatch,
    podDispatch: state.podDispatch,
    memoryEntries: state.memoryEntries,
    recorded: state.recorded
  };
}
