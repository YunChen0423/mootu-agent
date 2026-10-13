import { generateContextualUtterance } from "../public/agent-engine.js";

export const STRATEGIES = Object.freeze([
  "observe",
  "invite_quiet_member",
  "open_new_direction",
  "sustain_flow",
  "prepare_convergence",
  "advance_decision"
]);

const STRATEGY_SET = new Set(STRATEGIES);
const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const text = (value, fallback = "") => String(value || fallback).trim();

export function outcome(previous, current) {
  if (!previous || previous.strategy === "observe") return previous ? "上一轮保持观察，无需评估介入效果" : "尚无上一轮行动";
  const deltas = [["参与", current.metrics.participation - previous.metrics.participation], ["发散", current.metrics.diversity - previous.metrics.diversity], ["流动", current.metrics.flow - previous.metrics.flow]];
  const changes = deltas.map(([label, delta]) => `${label}${delta >= 0 ? "+" : ""}${delta}`);
  const improved = deltas.some(([, delta]) => delta > 0);
  return `上一轮“${previous.title}”后的可观察变化：${changes.join("、")}；${improved ? "出现正向变化，继续验证" : "尚未出现明确收益，避免连续加码"}`;
}

export function normalizeCandidate(raw, ids, config) {
  if (!raw || !STRATEGY_SET.has(raw.strategy)) return null;
  let strategy = raw.strategy;
  let target = ids.has(String(raw.target)) ? String(raw.target) : null;
  if (strategy !== "invite_quiet_member") target = null;
  if (strategy === "invite_quiet_member" && !target) strategy = "observe";
  const benefit = clampScore(raw.benefit);
  const disruption = clampScore(raw.disruption);
  const goalFit = clampScore(raw.goal_fit ?? raw.goalFit);
  const confidence = clampScore(raw.confidence);
  const utility = Math.round(benefit * 0.4 + goalFit * 0.3 + confidence * 0.2 - disruption * 0.35);
  return {
    strategy, target, benefit, disruption, goalFit, confidence, utility,
    title: text(raw.title, config.core.strategies[strategy].label).slice(0, 40),
    rationale: text(raw.rationale || raw.reason, "等待更多可观察证据").slice(0, 140),
    followUp: text(raw.follow_up ?? raw.followUp, "在下一观察窗口验证状态是否朝目标变化").slice(0, 80),
    expectedEffect: text(raw.expected_effect ?? raw.expectedEffect, "验证讨论状态是否改善").slice(0, 100),
    utterance: strategy === "observe" ? "" : text(raw.utterance).slice(0, 80)
  };
}

function defaultObserve(config, confidence = 70) {
  return normalizeCandidate({ strategy: "observe", benefit: 45, disruption: 0, goal_fit: 60, confidence, title: "保持观察", rationale: "继续收集证据，避免不必要的打断", follow_up: "在下一观察窗口重新评估", expected_effect: "保留讨论自主推进空间" }, new Set(), config);
}

export function selectCandidate(raw, ids, config, { forceObserve = false, cooldown = false } = {}) {
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

export function sanitizeEvents(rawEvents, observations, participants, config) {
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
      decisionSource: "deepseek+pi-harness", reflection: ""
    };
  });
  events.forEach((event, index) => { event.reflection = outcome(events[index - 1], event); });
  return events;
}

export function sanitizeLiveDecision(raw, { participants, stage, transcript, memory, config }) {
  const ids = new Set(participants.map((participant) => String(participant.id)));
  const selection = selectCandidate(raw, ids, config);
  const selected = selection.selected;
  const recommended = raw.stage_recommendation === "converge" ? "converge" : "diverge";
  const priorVotes = Number(memory.at(-1)?.stageVotes || 0);
  const stageVotes = stage === "diverge" && recommended === "converge" ? priorVotes + 1 : 0;
  const stableStage = stage === "converge" || stageVotes >= 2 ? "converge" : "diverge";
  return {
    stage: stableStage, stageRecommendation: recommended, stageVotes,
    strategy: selected.strategy, target: selected.target, title: selected.title, reason: selection.reason,
    evidence: (Array.isArray(raw.evidence) ? raw.evidence : []).slice(0, 3), missingEvidence: selection.missingEvidence,
    confidence: selected.confidence, candidates: selection.candidates, selectionMargin: selection.margin,
    followUp: selected.followUp, expectedEffect: selected.expectedEffect,
    utterance: selected.strategy === "observe" ? "" : text(selected.utterance, generateContextualUtterance({ strategy: selected.strategy, target: selected.target, stage: stableStage, transcript })).slice(0, 80),
    decisionSource: "deepseek+pi-harness"
  };
}
