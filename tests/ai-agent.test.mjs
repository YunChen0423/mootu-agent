import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { decideLiveWithAI, runAIAgent } from "../ai-agent.mjs";
import { sanitizeEvents } from "../agent/policy.mjs";

const config = JSON.parse(await readFile(new URL("../public/config/actions.json", import.meta.url), "utf8"));
const sample = JSON.parse(await readFile(new URL("../public/data/sample-session.json", import.meta.url), "utf8"));
const READ_TOOLS = ["observe_discussion_window", "get_participation_metrics", "get_flow_metrics", "get_diversity_metrics", "read_recent_memory", "check_intervention_cooldown"];
const ACTION_TOOLS = ["propose_intervention", "generate_robot_action", "dispatch_core_action", "dispatch_pod_feedback", "record_expected_effect"];
const COMPLETE_TOOL_CHAIN = [...READ_TOOLS, "evaluate_candidates", ...ACTION_TOOLS];

function toolMessage(calls, turn) {
  const content = calls.map(({ tool, params = {} }, index) => fauxToolCall(tool, params, { id: `call-${turn}-${index}` }));
  return fauxAssistantMessage(content, { stopReason: "toolUse" });
}

function piRuntime(turns) {
  const faux = fauxProvider();
  faux.setResponses(turns.map((calls, index) => toolMessage(calls, index)));
  return { streamFn: faux.provider.streamSimple, modelDefinition: faux.getModel() };
}

function completeRuntime(evaluationParams) {
  return piRuntime([
    READ_TOOLS.map((tool) => ({ tool })),
    [{ tool: "evaluate_candidates", params: evaluationParams }],
    ACTION_TOOLS.map((tool) => ({ tool }))
  ]);
}

test("without a secret the pi-backed agent is explicit about rule fallback", async () => {
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, apiKey: "" });
  assert.equal(result.mode, "fallback");
  assert.equal(result.architecture, "pi");
  assert.ok(result.events.every((event) => event.decisionSource === "rule_fallback"));
});

test("all perception, decision, action, dispatch, and memory capabilities are tools", async () => {
  const runtime = completeRuntime({ summary: "AI 已制定策略", screen_topic: "校园独处空间", vote_candidates: ["安静空间", "校园路线", "共享地图"], events: [
    { time: 0, stage_recommendation: "diverge", evidence: [], missing_evidence: [], candidates: [{ strategy: "invent_strategy", benefit: 99, disruption: 0, goal_fit: 99, confidence: 99 }] },
    { time: 43, stage_recommendation: "diverge", evidence: ["最近窗口未出现明显新方向"], missing_evidence: [], candidates: [
      { strategy: "observe", title: "继续观察", rationale: "保留空间", benefit: 35, disruption: 0, goal_fit: 40, confidence: 75, follow_up: "等待", expected_effect: "保留空间" },
      { strategy: "open_new_direction", title: "打开新方向", rationale: "想法开始重复", benefit: 90, disruption: 15, goal_fit: 90, confidence: 85, follow_up: "观察是否出现新概念", expected_effect: "提升发散性", utterance: "如果把这个方案反过来，会发生什么？" }
    ] }
  ] });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, ...runtime });
  assert.equal(result.mode, "deepseek");
  assert.equal(result.architecture, "pi");
  assert.equal(result.events[0].strategy, "observe");
  assert.equal(result.events[1].strategy, "open_new_direction");
  assert.equal(result.events[1].decisionSource, "deepseek+pi-harness");
  assert.equal(result.events[1].expectedEffect, "提升发散性");
  assert.equal(result.events[1].confidence, 85);
  assert.equal(result.analysis.screenTopic, "校园独处空间");
  assert.deepEqual(result.analysis.voteCandidates, ["安静空间", "校园路线", "共享地图"]);
  assert.ok(result.events[1].selectionMargin >= 8);
  assert.deepEqual(result.trace.filter((event) => event.type === "tool_execution_start").map((event) => event.tool), COMPLETE_TOOL_CHAIN);
  assert.equal(result.execution.recorded, true);
  assert.ok(result.execution.coreDispatch.every((item) => item.status === "simulated"));
  assert.ok(result.execution.podDispatch.every((item) => item.status === "simulated"));
});

test("Harness declines an intervention when submitted utility is too low", async () => {
  const runtime = completeRuntime({ summary: "继续观察", events: [{
    time: 43, stage_recommendation: "diverge", evidence: [], missing_evidence: ["尚未确认停顿是否自然"], candidates: [
      { strategy: "observe", benefit: 55, disruption: 0, goal_fit: 70, confidence: 80, rationale: "继续观察" },
      { strategy: "open_new_direction", benefit: 65, disruption: 30, goal_fit: 70, confidence: 65, rationale: "尝试启发" }
    ]
  }] });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, ...runtime });
  assert.equal(result.events[1].strategy, "observe");
  assert.match(result.events[1].reason, /收益未明显高于打断成本/);
  assert.deepEqual(result.events[1].missingEvidence, ["尚未确认停顿是否自然"]);
});

test("candidate evaluation rejects runs that skipped perception tools", async () => {
  const params = { summary: "观察后决策", events: [{ time: 0, stage_recommendation: "diverge", evidence: [], missing_evidence: [], candidates: [{ strategy: "observe", benefit: 50, disruption: 0, goal_fit: 60, confidence: 80 }] }] };
  const runtime = piRuntime([
    [{ tool: "evaluate_candidates", params }],
    READ_TOOLS.map((tool) => ({ tool })),
    [{ tool: "evaluate_candidates", params }],
    ACTION_TOOLS.map((tool) => ({ tool }))
  ]);
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, ...runtime });
  const toolEnds = result.trace.filter((event) => event.type === "tool_execution_end");
  assert.equal(toolEnds[0].isError, true);
  assert.equal(toolEnds.at(-1).isError, false);
});

test("stage changes still require two consecutive convergence recommendations", async () => {
  const observe = { strategy: "observe", benefit: 50, disruption: 0, goal_fit: 60, confidence: 80 };
  const runtime = completeRuntime({ summary: "阶段判断", events: [
    { time: 0, stage_recommendation: "diverge", evidence: [], missing_evidence: [], candidates: [observe] },
    { time: 43, stage_recommendation: "converge", evidence: [], missing_evidence: [], candidates: [observe] },
    { time: 86, stage_recommendation: "converge", evidence: [], missing_evidence: [], candidates: [observe] }
  ] });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, ...runtime });
  assert.equal(result.events[1].stage, "diverge");
  assert.equal(result.events[2].stage, "converge");
  assert.equal(result.events[2].strategy, "prepare_convergence");
  assert.match(result.events[2].utterance, /开始收敛/);
});

test("icebreaker metrics cannot trigger an immediate discussion intervention or convergence vote", () => {
  const observe = { strategy: "observe", benefit: 20, disruption: 0, goal_fit: 20, confidence: 80 };
  const advance = { strategy: "advance_decision", title: "立即收口", benefit: 95, disruption: 5, goal_fit: 95, confidence: 95, utterance: "马上投票。" };
  const observations = [55, 60, 110, 165, 220].map((time) => ({
    time,
    suggestedStage: "converge",
    metrics: { participation: 50, diversity: 90, flow: 70 },
    diagnostics: { discussion_start_seconds: 60, discussion_elapsed_seconds: Math.max(0, time - 60), quiet_seconds: Math.max(0, time - 60), quiet_share: 0, quiet_target: "C" },
    evidence: [],
    recentTranscript: []
  }));
  const raw = observations.map(({ time }) => ({ time, stage_recommendation: "converge", evidence: [], missing_evidence: [], candidates: [observe, advance] }));
  const events = sanitizeEvents(raw, observations, [{ id: "A" }, { id: "B" }, { id: "C" }], config);
  assert.ok(events.filter((event) => event.time < 130).every((event) => event.strategy === "observe" && event.stage === "diverge"));
  assert.match(events.find((event) => event.time === 60).reason, /重新建立讨论基线/);
  assert.equal(events.find((event) => event.time === 220).stage, "converge");
});

test("quiet-member invitations run exactly twice with a dedicated cooldown", () => {
  const observe = { strategy: "observe", benefit: 20, disruption: 0, goal_fit: 20, confidence: 80 };
  const observations = [165, 220, 275, 330, 385].map((time) => ({
    time,
    suggestedStage: "diverge",
    metrics: { participation: 35, diversity: 55, flow: 75 },
    diagnostics: { discussion_start_seconds: 60, discussion_elapsed_seconds: time - 60, quiet_seconds: time - 60, quiet_share: 0, quiet_target: "C" },
    evidence: [],
    recentTranscript: [{ speaker: "A", text: "我们正在比较真实声音和秘密任务。" }]
  }));
  const raw = observations.map(({ time }) => ({ time, stage_recommendation: "diverge", evidence: [], missing_evidence: [], candidates: [observe] }));
  const events = sanitizeEvents(raw, observations, [{ id: "A" }, { id: "B" }, { id: "C" }], config);
  assert.deepEqual(events.filter((event) => event.strategy === "invite_quiet_member").map((event) => event.time), [165, 275]);
  assert.match(events.find((event) => event.time === 220).reason, /冷却期/);
  assert.match(events.find((event) => event.time === 385).reason, /两次邀请额度/);
});

test("convergence prompts are spaced and stop once the recent content has converged", () => {
  const observe = { strategy: "observe", benefit: 20, disruption: 0, goal_fit: 20, confidence: 80 };
  const observations = [100, 140, 180, 220, 260].map((time, index) => ({
    time,
    suggestedStage: "converge",
    metrics: { participation: 70, diversity: 78, flow: 72 },
    diagnostics: { discussion_start_seconds: 0, discussion_elapsed_seconds: time, quiet_seconds: 0, quiet_share: 0.3, quiet_target: "C", recent_novelty: index < 3 ? 0.8 : 0.2 },
    evidence: [],
    recentTranscript: []
  }));
  const raw = observations.map(({ time }) => ({ time, stage_recommendation: "converge", evidence: [], missing_evidence: [], candidates: [observe] }));
  const events = sanitizeEvents(raw, observations, [{ id: "A" }, { id: "B" }, { id: "C" }], config);
  const prompts = events.filter((event) => ["prepare_convergence", "advance_decision"].includes(event.strategy));
  assert.ok(prompts.length <= 1);
  assert.ok(prompts.every((event, index) => index === 0 || event.time - prompts[index - 1].time >= 30));
  assert.ok(events.filter((event) => event.time >= 220).every((event) => event.strategy !== "advance_decision"));
  assert.ok(events.filter((event) => event.time >= 220).every((event) => event.stageRecommendation === "converge"));
});

test("live decisions run the same complete tool chain", async () => {
  const runtime = completeRuntime({
    stage_recommendation: "diverge",
    evidence: ["近期想法开始重复"],
    missing_evidence: [],
    candidates: [
      { strategy: "observe", benefit: 30, disruption: 0, goal_fit: 35, confidence: 75 },
      { strategy: "open_new_direction", benefit: 90, disruption: 10, goal_fit: 90, confidence: 85, utterance: "换一个使用场景看看？" }
    ]
  });
  const result = await decideLiveWithAI({ transcript: sample.transcript.slice(-4), participants: sample.participants, stage: "diverge", signal: {}, memory: [], config, ...runtime });
  assert.equal(result.decision.strategy, "open_new_direction");
  assert.deepEqual(result.trace.filter((event) => event.type === "tool_execution_start").map((event) => event.tool), COMPLETE_TOOL_CHAIN);
  assert.equal(result.execution.recorded, true);
});
