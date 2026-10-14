const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function overlap(line, start, end) {
  return Math.max(0, Math.min(line.end, end) - Math.max(line.start, start));
}

function bigrams(text) {
  const normalized = text.replace(/[\s，。！？、,.!?：:；;（）()]/g, "");
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((item) => { if (b.has(item)) intersection += 1; });
  return intersection / (a.size + b.size - intersection);
}

function participationAt(transcript, speakers, time, windowSeconds, discussionStart = 0) {
  const baseline = Math.max(0, Number(discussionStart) || 0);
  const start = Math.max(baseline, time - windowSeconds);
  const totals = Object.fromEntries(speakers.map((speaker) => [speaker, 0]));
  const turnCounts = Object.fromEntries(speakers.map((speaker) => [speaker, 0]));
  transcript.forEach((line) => {
    if (line.speaker in totals) {
      totals[line.speaker] += overlap(line, start, time);
      if (line.start <= time && line.end >= start) turnCounts[line.speaker] += 1;
    }
  });
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const totalTurns = Object.values(turnCounts).reduce((sum, value) => sum + value, 0);
  const ideal = 1 / speakers.length;
  const shares = Object.fromEntries(speakers.map((speaker) => [speaker, total ? totals[speaker] / total : 0]));
  const turnShares = Object.fromEntries(speakers.map((speaker) => [speaker, totalTurns ? turnCounts[speaker] / totalTurns : 0]));
  const maximumDeviation = 2 * (1 - ideal);
  const evenness = (values) => 1 - Object.values(values).reduce((sum, share) => sum + Math.abs(share - ideal), 0) / maximumDeviation;
  const durationScore = speakers.length <= 1 ? 100 : total ? clamp(Math.round(evenness(shares) * 100)) : 50;
  const turnScore = speakers.length <= 1 ? 100 : totalTurns ? clamp(Math.round(evenness(turnShares) * 100)) : 50;
  const score = Math.round(durationScore * 0.7 + turnScore * 0.3);
  const quietTarget = [...speakers].sort((a, b) => (shares[a] * 0.7 + turnShares[a] * 0.3) - (shares[b] * 0.7 + turnShares[b] * 0.3))[0];
  const lastSpoken = Object.fromEntries(speakers.map((speaker) => {
    const lines = transcript.filter((line) => line.speaker === speaker && line.start >= baseline && line.start <= time);
    return [speaker, lines.length ? Math.max(...lines.map((line) => line.end)) : baseline];
  }));
  return { score, durationScore, turnScore, totals, shares, turnCounts, turnShares, quietTarget, silenceSince: Math.max(0, time - lastSpoken[quietTarget]) };
}

function flowAt(transcript, time, windowSeconds, thresholds, discussionStart = 0) {
  const start = Math.max(Number(discussionStart) || 0, time - windowSeconds);
  const recent = transcript.filter((line) => line.start <= time && line.end >= start).sort((a, b) => a.start - b.start);
  const lastEnd = recent.length ? Math.min(time, Math.max(...recent.map((line) => line.end))) : start;
  const currentSilence = Math.max(0, time - lastEnd);
  const gaps = recent.slice(1).map((line, index) => Math.max(0, line.start - recent[index].end));
  const averageGap = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : currentSilence;
  let score = clamp(Math.round(92 - averageGap * 3 - currentSilence * 2));
  if (currentSilence >= thresholds.silence_stalled_seconds) score = Math.min(score, 28);
  else if (currentSilence >= thresholds.silence_thinking_seconds) score = Math.min(score, 58);
  return { score, currentSilence, averageGap, turnCount: recent.length };
}

function diversityAt(transcript, time, windowSeconds, discussionStart = 0) {
  const ideaCue = /(可以|也许|或者|比如|方向|方案|设计|想到|尝试|如果|不一定)/;
  const earlier = transcript.filter((line) => line.start >= discussionStart && line.start <= time);
  const recent = earlier.filter((line) => line.end >= Math.max(0, time - windowSeconds));
  const ideaLines = earlier.filter((line) => ideaCue.test(line.text));
  const recentIdeas = recent.filter((line) => ideaCue.test(line.text));
  const noveltyScores = ideaLines.map((line, index) => {
    if (index === 0) return 1;
    const prior = ideaLines.slice(0, index);
    return 1 - Math.max(...prior.map((candidate) => similarity(line.text, candidate.text)));
  });
  const recentNovelty = noveltyScores.slice(-Math.max(recentIdeas.length, 1));
  const novelty = recentNovelty.length ? recentNovelty.reduce((sum, value) => sum + value, 0) / recentNovelty.length : 0.35;
  const score = clamp(Math.round(28 + Math.min(ideaLines.length, 6) * 8 + novelty * 28));
  return { score, ideaCount: ideaLines.length, recentIdeaCount: recentIdeas.length, novelty };
}

function semanticAt(semantic, time) {
  if (!semantic?.windows?.length) return null;
  return [...semantic.windows].sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}

function compactTopic(lines) {
  const text = [...lines].reverse().map((line) => String(line.text || "").trim()).find(Boolean) || "刚才的讨论";
  return text.replace(/[。！？!?]+$/g, "").slice(0, 24);
}

export function generateContextualUtterance({ strategy, transcript = [], target = null, stage = "diverge" }) {
  if (strategy === "observe") return "";
  const topic = compactTopic(transcript.slice(-4));
  const utterances = {
    invite_quiet_member: `${target || "这位伙伴"}，刚才大家提到“${topic}”，你怎么看？`,
    open_new_direction: `围绕“${topic}”，如果换一个完全不同的视角，会是什么？`,
    sustain_flow: `刚才提到“${topic}”，还能再具体到一个场景吗？`,
    prepare_convergence: `围绕“${topic}”已经有了几个方向，我们先比较一下好吗？`,
    advance_decision: `关于“${topic}”，现在更倾向哪个方案？为什么？`
  };
  return utterances[strategy] || (stage === "converge" ? `关于“${topic}”，我们先明确取舍好吗？` : `关于“${topic}”，还能想到别的方向吗？`);
}

function evidenceFor({ participation, diversity, flow, stage, target, semantic }) {
  const evidence = [];
  if (participation.score < 58 && target) evidence.push(`${target} 在最近观察窗口中的参与明显低于其他成员。`);
  else evidence.push(`近期参与状态综合发言时长与轮次，均衡度为 ${participation.score}/100。`);
  if (diversity.score < 52) evidence.push(`近期新方向增长有限，创意发散度为 ${diversity.score}/100。`);
  else evidence.push(`目前累计识别到约 ${diversity.ideaCount} 条候选想法表达。`);
  if (flow.currentSilence >= 10) evidence.push(`当前连续沉默约 ${Math.round(flow.currentSilence)} 秒。`);
  if (semantic?.evidence) evidence.push(String(semantic.evidence));
  if (stage === "converge") evidence.push("讨论已进入收敛阶段，需要逐步形成可比较的候选方向。");
  return evidence.slice(0, 3);
}

export function buildObservations({ transcript, participants = [], duration, config, semantic = null, discussionStart = 0 }) {
  const sorted = [...transcript].sort((a, b) => a.start - b.start);
  const speakers = participants.length ? participants.map((participant) => participant.id) : [...new Set(sorted.map((line) => line.speaker))];
  if (!sorted.length) throw new Error("逐字稿不能为空");
  if (!speakers.length) throw new Error("至少需要一位参与者");
  const endTime = duration || Math.max(...sorted.map((line) => line.end));
  const thresholds = config.thresholds;
  const interval = Math.max(35, Math.min(55, Math.round(endTime / 6)));
  const checkpoints = [0];
  for (let time = interval; time < endTime; time += interval) checkpoints.push(time);
  if (endTime - checkpoints.at(-1) < interval / 2) checkpoints[checkpoints.length - 1] = endTime;
  else checkpoints.push(endTime);

  return checkpoints.map((time) => {
    const participation = participationAt(sorted, speakers, time, thresholds.window_seconds, discussionStart);
    const flow = flowAt(sorted, time, thresholds.window_seconds, thresholds, discussionStart);
    const diversity = diversityAt(sorted, time, thresholds.window_seconds, discussionStart);
    const semanticWindow = semanticAt(semantic, time);
    if (semanticWindow?.idea_diversity != null) diversity.score = clamp(Math.round((diversity.score + Number(semanticWindow.idea_diversity)) / 2));
    const stageByTime = time >= thresholds.converge_after_seconds || time / endTime >= 0.68;
    const suggestedStage = semanticWindow?.stage_recommendation === "converge" || stageByTime ? "converge" : "diverge";
    const recentTranscript = sorted.filter((line) => line.start <= time && line.end >= Math.max(0, time - thresholds.window_seconds)).slice(-8);
    return {
      time: Math.round(time), suggestedStage,
      metrics: { participation: participation.score, diversity: diversity.score, flow: flow.score },
      evidence: time === 0 ? ["讨论尚未开始，Agent 暂不介入。"] : evidenceFor({ participation, diversity, flow, stage: suggestedStage, target: participation.quietTarget, semantic: semanticWindow }),
      recentTranscript,
      diagnostics: { speaking_seconds: participation.totals, turn_counts: participation.turnCounts, participation_basis: "70% speaking duration + 30% turn count", quiet_target: participation.quietTarget, quiet_share: Number(((participation.shares[participation.quietTarget] || 0) * 0.7 + (participation.turnShares[participation.quietTarget] || 0) * 0.3).toFixed(3)), quiet_seconds: Math.round(participation.silenceSince), discussion_start_seconds: Math.max(0, Math.round(discussionStart)), discussion_elapsed_seconds: Math.max(0, Math.round(time - discussionStart)), current_silence_seconds: Math.round(flow.currentSilence), idea_count: diversity.ideaCount, recent_novelty: Number(diversity.novelty.toFixed(2)) }
    };
  });
}

function chooseDecision(context) {
  const { time, stage, previousStage, participation, diversity, flow, thresholds, lastInterventionTime } = context;
  const cooledDown = time - lastInterventionTime >= thresholds.intervention_cooldown_seconds;
  if (stage !== previousStage) return { strategy: "prepare_convergence", title: "建议从发散转向收敛", followUp: "展示已有方向，并观察成员是否开始比较方案" };
  if (!cooledDown) return { strategy: "observe", title: "暂不追加介入", followUp: "等待上一轮介入产生反馈" };
  const quietShare = (participation.shares[participation.quietTarget] || 0) * 0.7 + (participation.turnShares[participation.quietTarget] || 0) * 0.3;
  if (participation.score < 58 && quietShare < 0.12 && participation.silenceSince >= thresholds.quiet_member_seconds * 0.65) {
    return { strategy: "invite_quiet_member", title: `低压力邀请 ${participation.quietTarget}`, followUp: `观察 ${participation.quietTarget} 是否在下一窗口开始参与`, target: participation.quietTarget };
  }
  if (stage === "diverge" && diversity.score < 55 && flow.score < 72) {
    return { strategy: "open_new_direction", title: "激活新的探索方向", followUp: "观察下一窗口是否出现语义上不同的新想法" };
  }
  if (stage === "converge" && flow.score < 65) {
    return { strategy: "advance_decision", title: "推进方案比较", followUp: "总结候选方案，并检查是否形成明确偏好" };
  }
  return { strategy: "observe", title: "保持观察", followUp: "讨论仍在有效推进，避免不必要的打断" };
}

export function runAgent({ transcript, participants = [], duration, config, semantic = null, discussionStart = 0 }) {
  const sorted = [...transcript].sort((a, b) => a.start - b.start);
  const speakers = participants.length ? participants.map((participant) => participant.id) : [...new Set(sorted.map((line) => line.speaker))];
  if (!sorted.length) throw new Error("逐字稿不能为空");
  if (!speakers.length) throw new Error("至少需要一位参与者");
  const endTime = duration || Math.max(...sorted.map((line) => line.end));
  const thresholds = config.thresholds;
  const observations = buildObservations({ transcript: sorted, participants, duration: endTime, config, semantic, discussionStart });

  let previousStage = "diverge";
  let lastInterventionTime = -Infinity;
  let lastInvitationTime = -Infinity;
  let invitationCount = 0;
  let robotUtteranceCount = 0;
  const events = observations.map((observation, index) => {
    const { time, suggestedStage: stage } = observation;
    const participation = participationAt(sorted, speakers, time, thresholds.window_seconds, discussionStart);
    const flow = flowAt(sorted, time, thresholds.window_seconds, thresholds, discussionStart);
    const diversity = diversityAt(sorted, time, thresholds.window_seconds, discussionStart);
    let decision = index === 0
      ? { strategy: "observe", title: "等待讨论自然启动", followUp: "继续收集发言与想法证据" }
      : chooseDecision({ time, stage, previousStage, participation, diversity, flow, thresholds, lastInterventionTime });
    const invitationLimit = thresholds.max_invitation_count || 2;
    const invitationCooldown = thresholds.quiet_invitation_cooldown_seconds || thresholds.intervention_cooldown_seconds;
    const secondInvitationDue = invitationCount === 1
      && stage === previousStage
      && time - lastInvitationTime >= invitationCooldown
      && observation.diagnostics.discussion_elapsed_seconds >= thresholds.quiet_member_seconds * 2;
    if (secondInvitationDue) {
      decision = { strategy: "invite_quiet_member", title: `第二次邀请 ${participation.quietTarget}`, followUp: "完成第二次低压力邀请后继续当前阶段", target: participation.quietTarget };
    }
    if (decision.strategy === "invite_quiet_member" && invitationCount >= invitationLimit) {
      decision = { strategy: "observe", title: "两次邀请已完成", followUp: "继续观察，不再点名邀请" };
    }
    const utteranceLimit = thresholds.max_robot_utterances || 5;
    if (decision.strategy !== "observe" && robotUtteranceCount >= utteranceLimit) {
      decision = { strategy: "observe", title: "语音预算已用完", followUp: "改用朝向、灯光与屏幕信息反馈" };
    }
    if (decision.strategy !== "observe") {
      lastInterventionTime = time;
      robotUtteranceCount += 1;
    }
    if (decision.strategy === "invite_quiet_member") {
      lastInvitationTime = time;
      invitationCount += 1;
    }
    const evidence = index === 0
      ? ["讨论尚未开始，Agent 暂不介入。"]
      : evidenceFor({ participation, diversity, flow, stage, target: decision.target, semantic: semanticAt(semantic, time) });
    const event = {
      time: Math.round(time), stage, strategy: decision.strategy, evidence,
      metrics: observation.metrics,
      title: decision.title, reason: evidence.join(" "), followUp: decision.followUp, target: decision.target || null,
      diagnostics: observation.diagnostics,
      decisionSource: "rule_fallback", expectedEffect: decision.followUp, reflection: index ? "等待下一观察窗口验证" : "尚无上一轮行动",
      confidence: index ? 65 : 40,
      missingEvidence: index ? ["未接入语义模型，当前仅使用可解释规则"] : ["尚无讨论内容"],
      candidates: [{ strategy: decision.strategy, target: decision.target || null, utility: 65, confidence: index ? 65 : 40 }],
      selectionMargin: 0,
      stageRecommendation: stage,
      stageVotes: 0
    };
    previousStage = stage;
    return event;
  });

  return {
    summary: semantic?.summary || `分析了 ${sorted.length} 条发言、${speakers.length} 位参与者，生成 ${events.length} 个决策检查点。`,
    ideaClusters: semantic?.idea_clusters || [], events
  };
}
