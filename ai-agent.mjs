import { buildObservations, generateContextualUtterance, runAgent } from "./public/agent-engine.js";

const STRATEGIES = new Set(["observe", "invite_quiet_member", "open_new_direction", "sustain_flow", "prepare_convergence", "advance_decision"]);
const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function parseJson(content) {
  const cleaned = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned || "{}");
}

function text(value, fallback = "") { return String(value || fallback).trim(); }

function outcome(previous, current) {
  if (!previous || previous.strategy === "observe") return previous ? "上一轮保持观察，无需评估介入效果" : "尚无上一轮行动";
  const deltas = [["参与", current.metrics.participation - previous.metrics.participation], ["发散", current.metrics.diversity - previous.metrics.diversity], ["流动", current.metrics.flow - previous.metrics.flow]];
  const changes = deltas.map(([label, delta]) => `${label}${delta >= 0 ? "+" : ""}${delta}`);
  const improved = deltas.some(([, delta]) => delta > 0);
  return `上一轮“${previous.title}”后的可观察变化：${changes.join("、")}；${improved ? "出现正向变化，继续验证" : "尚未出现明确收益，避免连续加码"}`;
}

function normalizeCandidate(raw, ids, config) {
  if (!raw || !STRATEGIES.has(raw.strategy)) return null;
  let strategy = raw.strategy;
  let target = ids.has(String(raw.target)) ? String(raw.target) : null;
  if (strategy !== "invite_quiet_member") target = null;
  if (strategy === "invite_quiet_member" && !target) strategy = "observe";
  const benefit = clampScore(raw.benefit);
  const disruption = clampScore(raw.disruption);
  const goalFit = clampScore(raw.goal_fit);
  const confidence = clampScore(raw.confidence);
  const utility = Math.round(benefit * 0.4 + goalFit * 0.3 + confidence * 0.2 - disruption * 0.35);
  return {
    strategy, target, benefit, disruption, goalFit, confidence, utility,
    title: text(raw.title, config.core.strategies[strategy].label).slice(0, 40),
    rationale: text(raw.rationale || raw.reason, "等待更多可观察证据").slice(0, 140),
    followUp: text(raw.follow_up, "在下一观察窗口验证状态是否朝目标变化").slice(0, 80),
    expectedEffect: text(raw.expected_effect, "验证讨论状态是否改善").slice(0, 100),
    utterance: strategy === "observe" ? "" : text(raw.utterance).slice(0, 80)
  };
}

function defaultObserve(config, confidence = 70) {
  return normalizeCandidate({ strategy: "observe", benefit: 45, disruption: 0, goal_fit: 60, confidence, title: "保持观察", rationale: "继续收集证据，避免不必要的打断", follow_up: "在下一观察窗口重新评估", expected_effect: "保留讨论自主推进空间" }, new Set(), config);
}

function selectCandidate(raw, ids, config, { forceObserve = false, cooldown = false } = {}) {
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : (raw.strategy ? [raw] : []);
  const candidates = rawCandidates.map((candidate) => normalizeCandidate(candidate, ids, config)).filter(Boolean);
  if (!candidates.some((candidate) => candidate.strategy === "observe")) candidates.push(defaultObserve(config));
  candidates.sort((a, b) => b.utility - a.utility);
  const observe = candidates.filter((candidate) => candidate.strategy === "observe").sort((a, b) => b.utility - a.utility)[0];
  const intervention = candidates.find((candidate) => candidate.strategy !== "observe");
  const missingEvidence = (Array.isArray(raw.missing_evidence) ? raw.missing_evidence : []).map((item) => text(item)).filter(Boolean).slice(0, 4);
  const hasTargetGap = intervention?.strategy === "invite_quiet_member" && missingEvidence.some((item) => /说话人|身份|对象|target/i.test(item));
  const margin = intervention ? intervention.utility - observe.utility : 0;
  const eligible = intervention && intervention.confidence >= 60 && margin >= 8 && !hasTargetGap && !forceObserve && !cooldown;
  const selected = eligible ? intervention : observe;
  const reason = eligible ? selected.rationale
    : forceObserve ? "讨论尚未开始，先建立观察基线"
      : cooldown ? "上一轮介入仍在验证期，暂不连续打断"
        : intervention && margin < 8 ? "介入收益未明显高于打断成本，继续观察"
          : intervention && intervention.confidence < 60 ? "当前证据置信度不足，继续观察"
            : selected.rationale;
  return { selected, candidates, missingEvidence, margin, reason };
}

function sanitizeEvents(rawEvents, observations, participants, config) {
  const ids = new Set(participants.map((participant) => String(participant.id)));
  let lastIntervention = -Infinity;
  let stage = "diverge";
  let convergenceVotes = 0;
  const events = observations.map((observation, index) => {
    const raw = rawEvents.find((item) => Math.abs(Number(item.time) - observation.time) <= 2) || rawEvents[index] || {};
    const recommendation = raw.stage_recommendation === "converge" || raw.stage === "converge" || observation.suggestedStage === "converge" ? "converge" : "diverge";
    if (stage === "diverge" && index > 0) {
      convergenceVotes = recommendation === "converge" ? convergenceVotes + 1 : 0;
      if (convergenceVotes >= 2) stage = "converge";
    }
    const cooldown = observation.time - lastIntervention < config.thresholds.intervention_cooldown_seconds;
    const selection = selectCandidate(raw, ids, config, { forceObserve: index === 0, cooldown });
    const { selected } = selection;
    if (selected.strategy !== "observe") lastIntervention = observation.time;
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : observation.evidence).map((item) => text(item)).filter(Boolean).slice(0, 3);
    const utterance = selected.strategy === "observe" ? "" : text(selected.utterance, generateContextualUtterance({ strategy: selected.strategy, target: selected.target, stage, transcript: observation.recentTranscript })).slice(0, 80);
    return {
      time: observation.time, stage, stageRecommendation: recommendation, stageVotes: convergenceVotes,
      strategy: selected.strategy, target: selected.target, title: selected.title,
      reason: selection.reason.slice(0, 220), evidence: evidence.length ? evidence : observation.evidence,
      missingEvidence: selection.missingEvidence, confidence: selected.confidence,
      candidates: selection.candidates, selectionMargin: selection.margin,
      followUp: selected.followUp, expectedEffect: selected.expectedEffect, utterance,
      metrics: observation.metrics, diagnostics: observation.diagnostics,
      decisionSource: "deepseek+harness", reflection: ""
    };
  });
  events.forEach((event, index) => { event.reflection = outcome(events[index - 1], event); });
  return events;
}

async function callDeepSeek({ apiKey, baseUrl, model, fetchImpl, messages, maxTokens = 3200 }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, temperature: 0.2, max_tokens: maxTokens, messages })
  });
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return parseJson(result.choices?.[0]?.message?.content);
}

const CANDIDATE_SCHEMA = "每个检查点输出 stage_recommendation、evidence、missing_evidence，以及 2-3 个 candidates（必须包含 observe）。每个候选包含 strategy、target、title、rationale、benefit、disruption、goal_fit、confidence、follow_up、expected_effect、utterance；四项分数均为 0-100。模型只提出候选，不直接决定最终动作。";

export async function runAIAgent({ transcript, participants = [], duration, config, apiKey = process.env.DEEPSEEK_API_KEY, baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model = process.env.DEEPSEEK_MODEL || "deepseek-chat", fetchImpl = fetch }) {
  if (!apiKey) {
    const analysis = runAgent({ transcript, participants, duration, config });
    return { mode: "fallback", model, analysis, events: analysis.events };
  }
  const observations = buildObservations({ transcript, participants, duration, config });
  const catalog = Object.fromEntries(Object.entries(config.core.strategies).map(([key, value]) => [key, value.label]));
  const prompt = {
    goal: "促进小组创意讨论的参与开放性、创意发散性和讨论流动性；仅在介入的预期收益明显高于打断成本时介入",
    participants: participants.map(({ id, name }) => ({ id, name })), allowed_strategies: catalog,
    constraints: ["只能选择 allowed_strategies", "target 只能是已有参与者且仅 invite_quiet_member 可指定", "只引用输入中的可观察证据", "不得推断心理、生理、性格或身份", "observe 时 utterance 必须为空", "发言需自然具体且不超过45个汉字", "明确列出缺失证据，不确定时降低 confidence"], observations
  };
  const parsed = await callDeepSeek({ apiKey, baseUrl, model, fetchImpl, messages: [
    { role: "system", content: `你是 MooTu 具身讨论促进 AI Agent 的策略提案层。${CANDIDATE_SCHEMA} 不要输出隐藏思维链，只给简短可核验的 rationale。严格输出 JSON：{\"summary\":string,\"events\":[{\"time\":number,\"stage_recommendation\":\"diverge|converge\",\"evidence\":[string],\"missing_evidence\":[string],\"candidates\":[object]}]}。` },
    { role: "user", content: JSON.stringify(prompt) }
  ] });
  const events = sanitizeEvents(Array.isArray(parsed.events) ? parsed.events : [], observations, participants, config);
  const analysis = { summary: text(parsed.summary, `DeepSeek 与 Harness 已完成 ${events.length} 个检查点的候选评估。`), ideaClusters: Array.isArray(parsed.idea_clusters) ? parsed.idea_clusters.slice(0, 8) : [], events };
  return { mode: "deepseek", model, analysis, events };
}

export async function decideLiveWithAI({ transcript = [], participants = [], stage = "diverge", signal = {}, memory = [], config, apiKey = process.env.DEEPSEEK_API_KEY, baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model = process.env.DEEPSEEK_MODEL || "deepseek-chat", fetchImpl = fetch }) {
  if (!apiKey) return { mode: "fallback", decision: null };
  const parsed = await callDeepSeek({ apiKey, baseUrl, model, fetchImpl, maxTokens: 900, messages: [
    { role: "system", content: `你是实时小组讨论促进 AI Agent 的策略提案层。${CANDIDATE_SCHEMA} 不要推断心理或生理状态。严格输出一个 JSON 对象。` },
    { role: "user", content: JSON.stringify({ stage, participants, signal, recent_transcript: transcript.slice(-8), recent_memory: memory.slice(-4), allowed_strategies: [...STRATEGIES] }) }
  ] });
  const ids = new Set(participants.map((participant) => String(participant.id)));
  const selection = selectCandidate(parsed, ids, config);
  const selected = selection.selected;
  const recommended = parsed.stage_recommendation === "converge" ? "converge" : "diverge";
  const priorVotes = Number(memory.at(-1)?.stageVotes || 0);
  const stageVotes = stage === "diverge" && recommended === "converge" ? priorVotes + 1 : 0;
  const stableStage = stage === "converge" || stageVotes >= 2 ? "converge" : "diverge";
  return { mode: "deepseek", decision: {
    stage: stableStage, stageRecommendation: recommended, stageVotes,
    strategy: selected.strategy, target: selected.target, title: selected.title, reason: selection.reason,
    evidence: (Array.isArray(parsed.evidence) ? parsed.evidence : []).slice(0, 3), missingEvidence: selection.missingEvidence,
    confidence: selected.confidence, candidates: selection.candidates, selectionMargin: selection.margin,
    followUp: selected.followUp, expectedEffect: selected.expectedEffect,
    utterance: selected.strategy === "observe" ? "" : text(selected.utterance, generateContextualUtterance({ strategy: selected.strategy, target: selected.target, stage: stableStage, transcript })).slice(0, 80),
    decisionSource: "deepseek+harness"
  } };
}
