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
  let lastInvitation = -Infinity;
  let invitationCount = 0;
  let robotUtteranceCount = 0;
  let lastConvergencePrompt = -Infinity;
  let convergencePromptCount = 0;
  let stage = "diverge";
  let convergenceVotes = 0;
  const events = observations.map((observation, index) => {
    const raw = rawEvents.find((item) => Math.abs(Number(item.time) - observation.time) <= 2) || rawEvents[index] || {};
    const resetAfterIcebreaker = observation.diagnostics.discussion_start_seconds > 0;
    const discussionWarmup = resetAfterIcebreaker && observation.diagnostics.discussion_elapsed_seconds < config.thresholds.quiet_member_seconds;
    const recommendation = !discussionWarmup && (raw.stage_recommendation === "converge" || raw.stage === "converge" || observation.suggestedStage === "converge") ? "converge" : "diverge";
    const priorStage = stage;
    if (stage === "diverge" && index > 0) {
      convergenceVotes = recommendation === "converge" ? convergenceVotes + 1 : 0;
      if (convergenceVotes >= 2) stage = "converge";
    }
    const cooldown = observation.time - lastIntervention < config.thresholds.intervention_cooldown_seconds;
    const invitationCooldown = observation.time - lastInvitation < (config.thresholds.quiet_invitation_cooldown_seconds || config.thresholds.intervention_cooldown_seconds);
    const invitationLimit = config.thresholds.max_invitation_count || 2;
    const convergencePromptCooldown = observation.time - lastConvergencePrompt < (config.thresholds.convergence_prompt_cooldown_seconds || 30);
    const convergencePromptLimit = config.thresholds.max_convergence_prompts || 2;
    const selection = selectCandidate(raw, ids, config, { forceObserve: index === 0 || discussionWarmup, cooldown });
    let selected = selection.selected;
    let decisionReason = discussionWarmup ? "破冰结束后重新建立讨论基线，暂不沿用破冰阶段的沉默、参与或阶段判断。" : selection.reason;
    let forcedByHarness = false;
    const forcedCandidate = (strategy, target, title, rationale, utterance) => normalizeCandidate({ strategy, target, title, rationale, utterance, benefit: 95, disruption: 12, goal_fit: 96, confidence: 92, follow_up: "观察下一窗口是否出现更明确的比较与更均衡的参与", expected_effect: "推动讨论按当前阶段目标继续" }, ids, config);
    const justConverged = priorStage === "diverge" && stage === "converge";
    const quietEvidenceReady = observation.diagnostics.discussion_elapsed_seconds >= config.thresholds.quiet_member_seconds
      && observation.diagnostics.quiet_seconds >= config.thresholds.quiet_member_seconds
      && observation.diagnostics.quiet_share < 0.12;
    if (selected.strategy === "invite_quiet_member" && invitationCount >= invitationLimit) {
      selected = defaultObserve(config);
      decisionReason = "本场两次邀请额度已经完成，避免继续点名干扰小组自主讨论。";
    } else if (selected.strategy === "invite_quiet_member" && invitationCooldown) {
      selected = defaultObserve(config);
      decisionReason = "同类邀请仍在冷却期，避免反复点名打断讨论。";
    }
    if (selected.strategy === "observe" && invitationCooldown && quietEvidenceReady) {
      decisionReason = "同类邀请仍在冷却期，避免反复点名打断讨论。";
    }
    if (selected.strategy === "observe" && invitationCount >= invitationLimit && quietEvidenceReady) {
      decisionReason = "本场两次邀请额度已经完成，避免继续点名干扰小组自主讨论。";
    }
    const contentHasConverged = stage === "converge" && (observation.diagnostics.recent_novelty <= 0.35 || observation.metrics.diversity < 60);
    const convergencePromptAvailable = !convergencePromptCooldown && convergencePromptCount < convergencePromptLimit;
    if (["prepare_convergence", "advance_decision"].includes(selected.strategy) && (!convergencePromptAvailable || contentHasConverged)) {
      selected = defaultObserve(config);
      decisionReason = contentHasConverged
        ? "近期内容已经从增加方向转为比较、取舍与确认，判定为有效收敛，不再重复提示。"
        : "收敛提示仍在独立冷却期或已达到本阶段次数上限，避免反复打断。";
    }
    if (selected.strategy === "observe" && justConverged && convergencePromptAvailable) {
      selected = forcedCandidate("prepare_convergence", null, "提示开始收敛", "阶段已经切换到收敛，但讨论仍保持高发散，需要明确发出阶段提示。", "我们已经有几个方向了，现在开始收敛，一起比较各方案的价值、成本和可行性。");
      decisionReason = "Harness 检测到发散→收敛切换，必须向小组明确播报阶段目标。";
      forcedByHarness = true;
    } else if (selected.strategy === "observe" && invitationCount < invitationLimit && !cooldown && !invitationCooldown && quietEvidenceReady) {
      const target = observation.diagnostics.quiet_target;
      selected = forcedCandidate("invite_quiet_member", target, `邀请 ${target} 补充意见`, `${target} 在讨论开始后的观察窗口内参与明显偏低；即使讨论持续流动，也需要给其发言入口。`);
      decisionReason = `Harness 检测到 ${target} 在讨论开始后的持续低参与，不以全场是否有人讲话作为邀请条件。`;
      forcedByHarness = true;
    } else if (selected.strategy === "observe" && !cooldown && convergencePromptAvailable && stage === "converge" && !contentHasConverged && observation.metrics.diversity >= 67) {
      selected = forcedCandidate("advance_decision", null, "提醒聚焦比较", "当前已处于收敛阶段，但新想法仍持续增加，需要把讨论拉回比较与取舍。", "现在先暂停增加新方向，请围绕现有方案比较价值、成本和可行性。");
      decisionReason = "Harness 检测到收敛阶段仍保持高发散，主动发出聚焦提示。";
      forcedByHarness = true;
    }
    const secondInvitationDue = invitationCount === 1
      && !justConverged
      && !invitationCooldown
      && observation.diagnostics.discussion_elapsed_seconds >= config.thresholds.quiet_member_seconds * 2;
    if (secondInvitationDue) {
      const target = observation.diagnostics.quiet_target;
      selected = forcedCandidate("invite_quiet_member", target, `第二次邀请 ${target} 补充意见`, "演示编排要求在不连续打断的前提下完成第二次低压力邀请。", `${target}，我们也想听听你对现有方向的判断。`);
      decisionReason = "第二次邀请已通过冷却校验；该邀请作为完整动画事务优先执行，后续动作排队等待。";
      forcedByHarness = true;
    }
    const utteranceLimit = config.thresholds.max_robot_utterances || 5;
    if (selected.strategy !== "observe" && robotUtteranceCount >= utteranceLimit) {
      selected = defaultObserve(config);
      decisionReason = "本场机器人语音已达到五句上限，后续只通过朝向、灯光与屏幕信息反馈。";
    }
    if (selected.strategy !== "observe") {
      lastIntervention = observation.time;
      robotUtteranceCount += 1;
    }
    if (selected.strategy === "invite_quiet_member") {
      lastInvitation = observation.time;
      invitationCount += 1;
    }
    if (["prepare_convergence", "advance_decision"].includes(selected.strategy)) {
      lastConvergencePrompt = observation.time;
      convergencePromptCount += 1;
    }
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : observation.evidence).map((item) => text(item)).filter(Boolean).slice(0, 3);
    const utterance = selected.strategy === "observe" ? "" : text(selected.utterance, generateContextualUtterance({ strategy: selected.strategy, target: selected.target, stage, transcript: observation.recentTranscript })).slice(0, 80);
    return {
      time: observation.time, stage, stageRecommendation: contentHasConverged ? "converge" : recommendation, stageVotes: convergenceVotes,
      strategy: selected.strategy, target: selected.target, title: selected.title,
      reason: decisionReason.slice(0, 220), evidence: evidence.length ? evidence : observation.evidence,
      missingEvidence: selection.missingEvidence, confidence: selected.confidence,
      candidates: forcedByHarness ? [selected, ...selection.candidates.filter((candidate) => candidate.strategy !== selected.strategy)] : selection.candidates,
      selectionMargin: forcedByHarness ? Math.max(8, selected.utility - (selection.candidates.find((candidate) => candidate.strategy === "observe")?.utility || 0)) : selection.margin,
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
