import { buildObservations, generateContextualUtterance, runAgent } from "./agent-engine.js";

const STRATEGIES = new Set(["observe", "invite_quiet_member", "open_new_direction", "sustain_flow", "prepare_convergence", "advance_decision"]);

function parseJson(content) {
  const cleaned = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned || "{}");
}

function text(value, fallback = "") {
  return String(value || fallback).trim();
}

function outcome(previous, current) {
  if (!previous || previous.strategy === "observe") return previous ? "上一轮保持观察，无需评估介入效果" : "尚无上一轮行动";
  const changes = [
    ["参与", current.metrics.participation - previous.metrics.participation],
    ["发散", current.metrics.diversity - previous.metrics.diversity],
    ["流动", current.metrics.flow - previous.metrics.flow]
  ].map(([label, delta]) => `${label}${delta >= 0 ? "+" : ""}${delta}`);
  return `上一轮“${previous.title}”后的可观察变化：${changes.join("、")}`;
}

function sanitizeEvents(rawEvents, observations, participants, config) {
  const ids = new Set(participants.map((participant) => String(participant.id)));
  let lastIntervention = -Infinity;
  const events = observations.map((observation, index) => {
    const raw = rawEvents.find((item) => Math.abs(Number(item.time) - observation.time) <= 2) || rawEvents[index] || {};
    let strategy = STRATEGIES.has(raw.strategy) ? raw.strategy : "observe";
    let target = ids.has(String(raw.target)) ? String(raw.target) : null;
    if (strategy !== "invite_quiet_member") target = null;
    if (strategy === "invite_quiet_member" && !target) strategy = "observe";
    if (index === 0 || observation.time - lastIntervention < config.thresholds.intervention_cooldown_seconds) strategy = "observe";
    if (strategy !== "observe") lastIntervention = observation.time;
    if (strategy === "observe") target = null;
    const stage = raw.stage === "converge" || raw.stage === "diverge" ? raw.stage : observation.suggestedStage;
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : observation.evidence).map((item) => text(item)).filter(Boolean).slice(0, 3);
    const title = text(raw.title, strategy === "observe" ? "保持观察" : config.core.strategies[strategy].label).slice(0, 40);
    const followUp = text(raw.follow_up, "在下一观察窗口验证状态是否朝目标变化").slice(0, 80);
    const utterance = strategy === "observe" ? "" : text(raw.utterance, generateContextualUtterance({ strategy, target, stage, transcript: observation.recentTranscript })).slice(0, 80);
    return {
      time: observation.time, stage, strategy, target, title,
      reason: text(raw.reason, evidence.join(" ")).slice(0, 220),
      evidence: evidence.length ? evidence : observation.evidence,
      followUp, expectedEffect: text(raw.expected_effect, followUp).slice(0, 100), utterance,
      metrics: observation.metrics, diagnostics: observation.diagnostics,
      decisionSource: "deepseek", reflection: ""
    };
  });
  events.forEach((event, index) => { event.reflection = outcome(events[index - 1], event); });
  return events;
}

async function callDeepSeek({ apiKey, baseUrl, model, fetchImpl, messages, maxTokens = 2600 }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, temperature: 0.25, max_tokens: maxTokens, messages })
  });
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return parseJson(result.choices?.[0]?.message?.content);
}

export async function runAIAgent({ transcript, participants = [], duration, config, apiKey = process.env.DEEPSEEK_API_KEY, baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model = process.env.DEEPSEEK_MODEL || "deepseek-chat", fetchImpl = fetch }) {
  if (!apiKey) {
    const analysis = runAgent({ transcript, participants, duration, config });
    return { mode: "fallback", model, analysis, events: analysis.events };
  }
  const observations = buildObservations({ transcript, participants, duration, config });
  const catalog = Object.fromEntries(Object.entries(config.core.strategies).map(([key, value]) => [key, value.label]));
  const prompt = {
    goal: "促进小组创意讨论的参与开放性、创意发散性和讨论流动性；仅在介入的预期收益明显高于打断成本时介入",
    participants: participants.map(({ id, name }) => ({ id, name })),
    allowed_strategies: catalog,
    constraints: ["只能选择 allowed_strategies", "target 只能是已有参与者且仅 invite_quiet_member 可指定", "只引用输入中的可观察证据", "不得推断心理、生理、性格或身份", "observe 时 utterance 必须为空", "发言需自然具体且不超过45个汉字"],
    observations
  };
  const parsed = await callDeepSeek({ apiKey, baseUrl, model, fetchImpl, messages: [
    { role: "system", content: "你是 MooTu 具身讨论促进 AI Agent 的决策策略层。你需要根据测量信号与逐字稿，逐检查点选择阶段、策略、对象和一句可执行发言，并说明可核验证据与预期效果。不要输出隐藏思维链。严格输出 JSON：{\"summary\":string,\"events\":[{\"time\":number,\"stage\":\"diverge|converge\",\"strategy\":string,\"target\":string|null,\"title\":string,\"reason\":string,\"evidence\":[string],\"follow_up\":string,\"expected_effect\":string,\"utterance\":string}]}。" },
    { role: "user", content: JSON.stringify(prompt) }
  ] });
  const events = sanitizeEvents(Array.isArray(parsed.events) ? parsed.events : [], observations, participants, config);
  const analysis = { summary: text(parsed.summary, `DeepSeek 已完成 ${events.length} 个检查点的策略决策。`), ideaClusters: Array.isArray(parsed.idea_clusters) ? parsed.idea_clusters.slice(0, 8) : [], events };
  return { mode: "deepseek", model, analysis, events };
}

export async function decideLiveWithAI({ transcript = [], participants = [], stage = "diverge", signal = {}, memory = [], config, apiKey = process.env.DEEPSEEK_API_KEY, baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model = process.env.DEEPSEEK_MODEL || "deepseek-chat", fetchImpl = fetch }) {
  if (!apiKey) return { mode: "fallback", decision: null };
  const parsed = await callDeepSeek({ apiKey, baseUrl, model, fetchImpl, maxTokens: 500, messages: [
    { role: "system", content: "你是实时小组讨论促进 AI Agent。只根据可观察信号选择一次动作。严格输出 JSON：{\"stage\":\"diverge|converge\",\"strategy\":\"observe|invite_quiet_member|open_new_direction|sustain_flow|prepare_convergence|advance_decision\",\"target\":string|null,\"title\":string,\"reason\":string,\"evidence\":[string],\"follow_up\":string,\"expected_effect\":string,\"utterance\":string}。不要推断心理或生理状态；证据不足就 observe。" },
    { role: "user", content: JSON.stringify({ stage, participants, signal, recent_transcript: transcript.slice(-8), recent_memory: memory.slice(-4), allowed_strategies: [...STRATEGIES] }) }
  ] });
  const strategy = STRATEGIES.has(parsed.strategy) ? parsed.strategy : "observe";
  const target = strategy === "invite_quiet_member" && participants.some((p) => String(p.id) === String(parsed.target)) ? String(parsed.target) : null;
  const finalStrategy = strategy === "invite_quiet_member" && !target ? "observe" : strategy;
  return { mode: "deepseek", decision: { stage: parsed.stage === "converge" ? "converge" : stage, strategy: finalStrategy, target, title: text(parsed.title, "保持观察"), reason: text(parsed.reason, "证据不足，继续观察"), evidence: (Array.isArray(parsed.evidence) ? parsed.evidence : []).slice(0, 3), followUp: text(parsed.follow_up, "继续收集证据"), expectedEffect: text(parsed.expected_effect, "在下一窗口验证"), utterance: finalStrategy === "observe" ? "" : text(parsed.utterance).slice(0, 80), decisionSource: "deepseek" } };
}
