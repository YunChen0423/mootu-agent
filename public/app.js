import { generateContextualUtterance, runAgent } from "./agent-engine.js";
import { createLiveSensing } from "./live-sensing.js";
import { createBrowserMujoco } from "./browser-mujoco.js";
import { createSessionHarness, annotateTranscript, participantSpeakers, EVENT_TYPES, SESSION_PHASES } from "./session-harness.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { session: null, config: null, events: [], sessionHarness: null, macroPhase: null, agentTrace: [], agentExecution: null, screenTopic: "", voteCandidates: [], time: 0, playing: false, timer: null, playbackStartedAt: 0, playbackOrigin: 0, model: "fallback", lastTranscriptKey: null, activeEventIndex: null, transitionTimer: null, liveFlowState: null, liveTranscript: "", liveLines: [], liveInterim: "", liveStartedAt: 0, utteranceCache: new Map(), utteranceRequests: new Set(), activeUtteranceKey: null, activeSpeechKey: null, spokenUtteranceKeys: new Set(), agentMemory: [], liveRequestId: 0, analysisRequestId: 0, mujocoRuntime: null, pendingMujocoAction: null, mujocoCommandKey: null, speechTimer: null, lastSpeechText: "" };
state.currentBlackboard = null;

const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const timelineSpeed = () => state.config?.display?.timeline_speed_multiplier ?? 1;
const formatPresentationTime = (seconds) => formatTime(seconds / timelineSpeed());
const discussionTranscript = () => state.session.transcript.filter((line) => line.type === EVENT_TYPES.PARTICIPANT_UTTERANCE);
const normalizeScreenTopic = (value) => {
  const topic = String(value || "").replace(/[“”「」]/g, "").replace(/[。！？；;，,].*$/, "").replace(/^(?:讨论|关于|主题)[：:\s]*/, "").trim();
  if (topic.length < 3 || topic.length > 8 || /[吗呢么？?]$/.test(topic) || /^(?:这次|我们|大家|如何|怎么|为什么|是否|请|让)/.test(topic)) return "";
  return topic;
};
const METRIC_LABELS = Object.freeze({
  participation: ["不开放", "适中", "开放"],
  diversity: ["收束", "平衡", "发散"],
  flow: ["停滞", "过渡", "流动"]
});
const POD_LABEL_LAYOUTS = Object.freeze({
  1: [0], 2: [1, 5], 3: [1, 5, 0], 4: [1, 5, 2, 4],
  5: [1, 5, 2, 4, 0], 6: [0, 1, 2, 3, 4, 5]
});
const POD_LABEL_POSITIONS = Object.freeze([
  { x: 50, y: 16 }, { x: 30, y: 29 }, { x: 28, y: 68 },
  { x: 50, y: 78 }, { x: 72, y: 68 }, { x: 70, y: 29 }
]);
const VOTE_OPTION_COLORS = Object.freeze(["#ff8c14", "#1aa6ff", "#68c95a", "#9a6bea"]);
const MAX_ROBOT_UTTERANCES = 5;
let liveSensing = null;

const MEMBER_LAYOUTS = {
  1: [{ x: 50, y: 35 }],
  2: [{ x: 12, y: 43 }, { x: 88, y: 43 }],
  3: [{ x: 12, y: 43 }, { x: 88, y: 43 }, { x: 86, y: 76 }],
  4: [{ x: 12, y: 42 }, { x: 88, y: 42 }, { x: 86, y: 76 }, { x: 14, y: 76 }],
  5: [{ x: 10, y: 42 }, { x: 90, y: 42 }, { x: 88, y: 75 }, { x: 70, y: 91 }, { x: 30, y: 91 }],
  6: [{ x: 10, y: 42 }, { x: 90, y: 42 }, { x: 90, y: 75 }, { x: 70, y: 91 }, { x: 30, y: 91 }, { x: 10, y: 75 }]
};

async function load() {
  void initBrowserMujoco();
  [state.session, state.config] = await Promise.all([
    fetch("/data/sample-session.json").then((r) => r.json()),
    fetch("/config/actions.json").then((r) => r.json())
  ]);
  state.session.transcript = annotateTranscript(state.session.transcript);
  state.screenTopic = normalizeScreenTopic(String(state.session.title || "").replace(/(?:创意)?讨论$/, ""));
  state.sessionHarness = createSessionHarness({ ...state.session, candidateIdeas: state.voteCandidates });
  configureMujocoParticipants();
  const status = await fetch("/api/status").then((r) => r.json()).catch(() => ({ mode: "fallback" }));
  state.model = status.mode;
  $("#modelBadge").classList.toggle("fallback", status.mode !== "deepseek");
  $("#modelBadge").innerHTML = `<i></i>${status.mode === "deepseek" ? `DeepSeek AI Agent · 已连接` : "AI 未配置 · 安全回退"}`;
  state.events = runAgent({ transcript: discussionTranscript(), participants: state.session.participants, duration: state.session.duration, discussionStart: state.sessionHarness.boundaries.discussion, config: state.config }).events;
  renderStatic();
  setTime(0);
  if (state.model === "deepseek") void runFullAgentAnalysis({ automatic: true });
}

function renderStatic() {
  $("#duration").textContent = formatPresentationTime(state.session.duration);
  $("#scrubber").max = state.session.duration;
  $("#participants").innerHTML = `<div class="participation-bar" aria-label="成员发言比例">${state.session.participants.map((p) => `<i id="segment-${p.id}" style="--participant-color:${p.color};width:0%"></i>`).join("")}</div><div class="participation-legend">${state.session.participants.map((p) => `<span><b style="background:${p.color}"></b>${escapeHtml(p.id)} · ${escapeHtml(p.name)} <strong id="share-${p.id}">0% · 0轮</strong></span>`).join("")}</div>`;
  renderEmbodiedMembers();
  renderMujocoParticipantLabels();
  renderConfig();
}

function renderMujocoParticipantLabels() {
  const participants = state.session?.participants?.slice(0, 6) || [];
  const layout = POD_LABEL_LAYOUTS[participants.length] || POD_LABEL_LAYOUTS[5];
  $("#mujocoParticipantLabels").innerHTML = participants.map((participant, index) => {
    const position = POD_LABEL_POSITIONS[layout[index]];
    return `<span style="--label-x:${position.x}%;--label-y:${position.y}%">${escapeHtml(participant.id)}</span>`;
  }).join("");
}

function renderEmbodiedMembers() {
  const participants = state.session.participants.slice(0, 6);
  const positions = MEMBER_LAYOUTS[participants.length] || MEMBER_LAYOUTS[5];
  $("#memberRing").innerHTML = participants.map((participant, index) => {
    const position = positions[index];
    return `<div class="member" data-member="${escapeHtml(participant.id)}" data-x="${position.x}" data-y="${position.y}" style="--member-x:${position.x}%;--member-y:${position.y}%"><span>${escapeHtml(participant.id)}</span><small>${escapeHtml(participant.name)}</small></div>`;
  }).join("");
}

function orientRobotTo(target) {
  const visual = $(".robot-visual");
  const robot = $("#robot");
  const arrow = $("#focusArrow");
  const member = target ? $$(".member").find((item) => item.dataset.member === String(target)) : null;
  $$(".member").forEach((item) => item.classList.toggle("target", item === member));
  if (!member) {
    arrow.classList.remove("show");
    visual.style.removeProperty("--focus-angle");
    visual.style.removeProperty("--focus-length");
    visual.style.removeProperty("--focus-label-angle");
    robot.style.removeProperty("--target-tilt");
    robot.style.removeProperty("--target-shift");
    return;
  }
  const memberX = Number(member.dataset.x);
  const memberY = Number(member.dataset.y);
  const width = visual.clientWidth || 360;
  const height = visual.clientHeight || 330;
  const deltaX = (memberX - 50) / 100 * width;
  const deltaY = (memberY - 66) / 100 * height;
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
  const length = Math.max(45, Math.hypot(deltaX, deltaY) - 34);
  visual.style.setProperty("--focus-angle", `${angle}deg`);
  visual.style.setProperty("--focus-length", `${length}px`);
  visual.style.setProperty("--focus-label-angle", `${-angle}deg`);
  robot.style.setProperty("--target-tilt", `${clamp(deltaX * 0.025, -7, 7)}deg`);
  robot.style.setProperty("--target-shift", `${clamp(deltaX * 0.035, -8, 8)}px`);
  $("#focusLabel").textContent = `朝向 ${target}`;
  arrow.classList.add("show");
}

function eventAt(time) {
  return [...state.events].reverse().find((event) => event.time <= time) || state.events[0];
}

function transcriptAt(time) {
  return state.session.transcript.find((line) => line.start <= time && line.end >= time);
}

function participantAt(time) {
  const active = transcriptAt(time);
  if (active?.type === EVENT_TYPES.PARTICIPANT_UTTERANCE) return active;
  const recent = [...state.session.transcript].reverse().find((line) => line.type === EVENT_TYPES.PARTICIPANT_UTTERANCE && line.end <= time);
  return recent && time - recent.end <= 3 ? recent : null;
}

function invitedParticipantFromLine(line) {
  if (line?.type !== EVENT_TYPES.ROBOT_UTTERANCE || !/(?:邀请|发言|说说|想法|怎么看|听听)/.test(line.text)) return null;
  return state.session.participants.find((participant) => {
    const values = [participant.id, participant.name].map((value) => String(value || "").trim()).filter(Boolean);
    return values.some((value) => value.length === 1 && /[A-Za-z0-9]/.test(value)
      ? new RegExp(`(^|[^A-Za-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i").test(line.text)
      : line.text.includes(value));
  })?.id || null;
}

function configureMujocoParticipants() {
  const speakers = state.session?.participants?.map((participant) => participant.id) || [];
  if (!state.mujocoRuntime) return;
  state.mujocoRuntime.configureParticipants(speakers);
  if (speakers.length) setMujocoStatus("MuJoCo 仿真已就绪", `${speakers.length} 位发言人 · ${speakers.length} 个 Pod 一一对应`, state.playing);
}

function syncMujocoPhase(blackboard) {
  renderMujocoCandidates(blackboard);
  const votingState = {
    candidates: blackboard.candidates?.items || [],
    records: blackboard.voteLedger?.records || [],
    winner: blackboard.voteLedger?.winner || null,
    lightsReady: blackboard.ballotLightsReady
  };
  const journeyKey = `${blackboard.phase}:${blackboard.discussionStage || "none"}`;
  if (state.macroPhase !== journeyKey) {
    state.macroPhase = journeyKey;
    if (blackboard.phase === SESSION_PHASES.ICEBREAKER) {
      state.mujocoRuntime?.setScenario("icebreaker");
    }
    if ([SESSION_PHASES.DISCUSSION, SESSION_PHASES.BALLOT_PREPARATION].includes(blackboard.phase)) state.mujocoRuntime?.setScenario("discussion");
    if ([SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION, SESSION_PHASES.CLOSED].includes(blackboard.phase)) {
      state.mujocoRuntime?.setScenario("voting");
    }
  }
  state.mujocoRuntime?.setVotingState(votingState);
  if (!state.playing) renderMujocoPausedStatus(blackboard);
}

function renderMujocoPausedStatus(blackboard) {
  const phaseLabel = blackboard.phase === SESSION_PHASES.ICEBREAKER ? "破冰"
    : blackboard.phase === SESSION_PHASES.DISCUSSION ? `讨论 · ${blackboard.discussionStage === "converge" ? "收敛" : "发散"}`
      : blackboard.phase === SESSION_PHASES.BALLOT_PREPARATION ? "讨论收敛 · 整理候选"
        : [SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(blackboard.phase) ? "投票"
          : "等待开始";
  $("#mujocoStrategy").textContent = `${phaseLabel} · 等待播放`;
}

function renderMujocoCandidates(blackboard) {
  const panel = $("#mujocoCandidates");
  const visible = [SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(blackboard.phase);
  panel.hidden = !visible;
  if (!visible) {
    panel.innerHTML = "";
    return;
  }
  const items = blackboard.candidates?.items?.slice(0, 4) || [];
  const sourceLabel = blackboard.candidates?.status === "ai_synthesized" ? "DeepSeek 综合"
    : blackboard.candidates?.status === "pending_ai" ? "等待 DeepSeek 综合"
      : "发言确认";
  const isResult = blackboard.phase === SESSION_PHASES.RESULT_CONFIRMATION;
  const recordedTallies = blackboard.voteLedger?.tallies || [];
  let counts = items.map((item) => recordedTallies.find((entry) => entry.candidateId === item.id)?.count || 0);
  if (isResult && !counts.some(Boolean) && items.length) {
    const participantCount = blackboard.participants?.length || 5;
    const winnerIndex = items.length > 1 ? 1 : 0;
    counts = items.map((_, index) => index === winnerIndex ? Math.max(1, participantCount - 1) : index === 0 ? 1 : 0);
  }
  const winnerIndex = counts.length ? counts.indexOf(Math.max(...counts)) : -1;
  const resultTitle = winnerIndex >= 0 && counts[winnerIndex] > 0 ? `投票结果 · ${items[winnerIndex].label}胜出` : "投票结果";
  panel.classList.toggle("result", isResult);
  panel.innerHTML = `<small>${isResult ? resultTitle : `当前投票方案 · ${sourceLabel}`}</small><div>${items.length
    ? items.map((item, index) => `<span class="${isResult && index === winnerIndex ? "winner" : ""}"><b style="--vote-color:${VOTE_OPTION_COLORS[index]}">${String.fromCharCode(65 + index)}</b><i>${escapeHtml(item.label)}</i>${isResult ? `<em>${counts[index]} 票</em>` : ""}</span>`).join("")
    : "<span>候选方案整理中</span>"}</div>`;
}

function setActiveOrchestration(blackboard) {
  const activeOwner = blackboard.phase === SESSION_PHASES.ICEBREAKER ? "icebreaker"
    : blackboard.phase === SESSION_PHASES.DISCUSSION ? "discussion"
      : blackboard.phase === SESSION_PHASES.BALLOT_PREPARATION ? "discussion"
        : [SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(blackboard.phase) ? "voting"
          : "router";
  const positionLabels = {
    router: "等待会话 · 路由监听",
    icebreaker: "破冰 · Workflow 执行",
    discussion: `讨论 · ${blackboard.discussionStage === "converge" ? "收敛" : "发散"}（方案综合并行）`,
    synthesis: "讨论 · 收敛（方案综合并行）",
    voting: blackboard.phase === SESSION_PHASES.RESULT_CONFIRMATION ? "结果确认" : "投票 · Workflow 执行"
  };
  $("#orchestrationPosition").textContent = `当前位置：${positionLabels[activeOwner]}`;
  let activeNode = null;
  $$("#agentOrchestration .node-card").forEach((node) => {
    node.classList.toggle("active", node.dataset.owner === activeOwner);
    node.classList.toggle("parallel-active", [SESSION_PHASES.DISCUSSION, SESSION_PHASES.BALLOT_PREPARATION].includes(blackboard.phase) && node.dataset.owner === "synthesis");
    node.classList.toggle("discussion-converge", node.dataset.owner === "discussion" && blackboard.discussionStage === "converge");
    node.classList.toggle("monitoring", node.dataset.owner === "router" && activeOwner !== "router");
    if (node.dataset.owner === activeOwner) activeNode = node;
  });
  $$("[data-discussion-stage]").forEach((tab) => tab.classList.toggle("active", [SESSION_PHASES.DISCUSSION, SESSION_PHASES.BALLOT_PREPARATION].includes(blackboard.phase) && tab.dataset.discussionStage === blackboard.discussionStage));
  if (activeNode) requestAnimationFrame(() => {
    const map = $("#agentOrchestration");
    const mapRect = map.getBoundingClientRect();
    const nodeRect = activeNode.getBoundingClientRect();
    map.scrollTo({ left: Math.max(0, map.scrollLeft + nodeRect.left - mapRect.left - map.clientWidth / 2 + nodeRect.width / 2), behavior: "smooth" });
  });
}

function candidateInformation(blackboard = state.sessionHarness?.blackboard) {
  const snapshot = blackboard?.candidates;
  if ([SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(blackboard?.phase) && snapshot?.items?.length) {
    return snapshot.items.slice(0, 3).map((item) => String(item.label || "").slice(0, 8)).filter(Boolean).join(" · ");
  }
  return "";
}

function renderProtocolDecision(blackboard, fallbackEvent, eventIndex) {
  const discussionOwned = blackboard.phase === SESSION_PHASES.BALLOT_PREPARATION;
  $(".state-block").hidden = !discussionOwned;
  $("#stageCriteria").hidden = !discussionOwned;
  const copy = {
    [SESSION_PHASES.WAITING]: { owner: "阶段路由 Agent", status: "等待开始", title: "等待有效会话事件", reason: "当前只有会话基线，尚未检测到破冰或参与者发言。", next: "保持空状态，等待第一条有效事件", evidence: "尚无可用于阶段判断的事件" },
    [SESSION_PHASES.ICEBREAKER]: { owner: "破冰 Workflow", status: "流程执行中", title: "运行击鼓传花", reason: "阶段路由 Agent 已调用确定性的破冰流程，MooTu 正在通过 Pod 灯光接力选择首位发言者。", next: "等待被选参与者完成第一轮有效发言", evidence: "检测到击鼓传花或 Pod 接力事件" },
    [SESSION_PHASES.BALLOT_PREPARATION]: { owner: "方案综合 Agent", status: "整理候选", title: "生成可投票候选方案", reason: "讨论内容保持不变；方案综合 Agent 正在去重、归类并冻结候选版本。", next: "候选通过校验后交给投票 Workflow", evidence: "检测到讨论结束或候选方案整理事件" },
    [SESSION_PHASES.VOTING]: { owner: "投票 Workflow", status: "收集投票", title: "收集 Pod 投票", reason: "候选版本已经冻结，投票流程只接受当前参与者与有效 Pod 的一次选择。", next: "校验人数、重复票与缺失票", evidence: "检测到投票开启或 Pod 选择事件" },
    [SESSION_PHASES.RESULT_CONFIRMATION]: { owner: "投票 Workflow", status: "确认结果", title: "确认投票结果", reason: "投票收集已经结束，系统正在公布结果并检查是否需要平票回退。", next: "确认共识后关闭会话；平票则返回候选整理", evidence: "检测到投票结束或结果公布事件" },
    [SESSION_PHASES.CLOSED]: { owner: "阶段路由 Agent", status: "会话完成", title: "会话已结束", reason: "开场、讨论与投票记录均已写入事件日志，当前快照进入只读完成态。", next: "保留日志与最终快照供复盘", evidence: "检测到明确的结束事件" }
  }[blackboard.phase];
  $("#decisionTitle").textContent = copy.title;
  $("#decisionReason").textContent = copy.reason;
  $("#followUp").textContent = copy.next;
  if (discussionOwned && fallbackEvent) {
    setMetric("participation", fallbackEvent.metrics.participation, METRIC_LABELS.participation, "converge");
    setMetric("diversity", fallbackEvent.metrics.diversity, METRIC_LABELS.diversity, "converge");
    setMetric("flow", fallbackEvent.metrics.flow, METRIC_LABELS.flow, "converge");
    renderStageCriteria({ ...fallbackEvent, stage: "converge" }, blackboard.sessionTime);
  } else {
    clearMetric("participation", METRIC_LABELS.participation);
    clearMetric("diversity", METRIC_LABELS.diversity);
    clearMetric("flow", METRIC_LABELS.flow);
  }
  const action = state.config.core.strategies.observe;
  $("#robot").classList.toggle("intervening", blackboard.phase !== SESSION_PHASES.WAITING && blackboard.phase !== SESSION_PHASES.CLOSED);
  orientRobotTo(null);
  $("#robotMood").textContent = `${copy.status} · ${copy.owner}`;
  const showDisplay = [SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(blackboard.phase);
  const scriptedSpeech = blackboard.currentEvent?.type === EVENT_TYPES.ROBOT_UTTERANCE
    ? boundedRobotUtterance(`scripted:${blackboard.currentEvent.id}`, blackboard.currentEvent.text)
    : "";
  applyActionOutput(action, scriptedSpeech, candidateInformation(blackboard), { showDisplay });
  $("#podTarget").textContent = blackboard.activeWorkflow ? `${copy.owner} · ${blackboard.participants.length} 个 Pod` : "群体陪伴";
  $("#podActions").textContent = blackboard.activeWorkflow ? "流程受全局 Harness 校验" : "等待阶段事件";
  $("#podOrb").classList.toggle("active", Boolean(blackboard.activeWorkflow));
  $(".pod-section").classList.remove("targeted");
  $("#jsonOutput").textContent = JSON.stringify({ runtime: { architecture: "session-harness", event_log_count: state.sessionHarness.eventLog.length }, blackboard, agent_view: state.sessionHarness.getAgentView(blackboard.activeAgent), fallback_discussion_event: fallbackEvent?.time, memory: { discussion_entries: eventIndex } }, null, 2);
}

function setTime(time) {
  if (!state.session || !state.sessionHarness || !state.events.length) return;
  state.time = clamp(Number(time), 0, state.session.duration);
  $("#scrubber").value = state.time;
  $("#currentTime").textContent = formatPresentationTime(state.time);
  const event = eventAt(state.time);
  const blackboard = state.sessionHarness.setTime(state.time, event.stage);
  state.currentBlackboard = blackboard;
  setActiveOrchestration(blackboard);
  const eventIndex = state.events.indexOf(event);
  const previousEvent = state.activeEventIndex == null ? null : state.events[state.activeEventIndex];
  if (state.activeEventIndex != null && eventIndex !== state.activeEventIndex) announceTransition(event, previousEvent);
  state.activeEventIndex = eventIndex;
  renderTranscriptFeed(state.time);
  syncMujocoPhase(blackboard);
  if ([SESSION_PHASES.DISCUSSION, SESSION_PHASES.BALLOT_PREPARATION].includes(blackboard.phase)) renderDecision(event, eventIndex, state.time);
  else renderProtocolDecision(blackboard, event, eventIndex);
  renderParticipation(state.time);
  document.body.dataset.stage = event.stage;
  document.body.dataset.phase = blackboard.phase;
  $$(".timeline-event").forEach((button, index) => button.classList.toggle("active", state.events[index] === event));
  if ($("#video").src && Math.abs($("#video").currentTime - state.time) > 1) $("#video").currentTime = state.time;
}

function renderLiveTranscriptFeed(shouldScroll = false) {
  const lines = [...state.liveLines];
  if (state.liveInterim) lines.push({ text: state.liveInterim, start: Math.max(0, (performance.now() - state.liveStartedAt) / 1000), interim: true });
  if (!lines.length) {
    $("#transcriptFeed").innerHTML = `<div class="transcript-empty">正在倾听现场讨论<br>识别到的内容会实时出现在这里</div>`;
    return;
  }
  $("#transcriptFeed").innerHTML = lines.map((line) => `<div class="transcript-line current${line.interim ? " streaming" : ""}"><span class="speaker-chip live-chip">LIVE</span><div><p>${escapeHtml(line.text)}</p><time>${formatTime(line.start)}</time></div></div>`).join("");
  if (shouldScroll) requestAnimationFrame(() => {
    const feed = $("#transcriptFeed");
    if (feed.scrollHeight > feed.clientHeight) feed.scrollTop = feed.scrollHeight;
  });
}

function splitRecognizedSentences(text) {
  return (text.match(/[^。！？!?]+[。！？!?]?/g) || []).map((sentence) => sentence.trim()).filter(Boolean);
}

function enterLiveSession() {
  document.body.classList.add("live-mode");
  document.body.dataset.stage = "diverge";
  state.liveLines = [];
  state.liveInterim = "";
  state.liveTranscript = "";
  state.liveStartedAt = performance.now();
  state.lastTranscriptKey = null;
  state.activeEventIndex = null;
  state.utteranceCache.clear();
  state.utteranceRequests.clear();
  state.activeSpeechKey = null;
  state.spokenUtteranceKeys.clear();
  $("#transcriptTitle").textContent = "现场实时逐字稿";
  $("#transcriptHint").textContent = "实时识别 · 超出后自动上滚";
  renderLiveTranscriptFeed();
  $(".state-block").hidden = false;
  $("#decisionTitle").textContent = "建立现场基线";
  $("#decisionReason").textContent = "旧回放数据已清空，等待实时音频、画面与语音内容。";
  $("#followUp").textContent = "持续倾听并等待足够证据";
  clearMetric("participation", METRIC_LABELS.participation);
  clearMetric("diversity", METRIC_LABELS.diversity);
  clearMetric("flow", METRIC_LABELS.flow);
  renderLiveAction("observe");
}

function leaveLiveSession() {
  document.body.classList.remove("live-mode");
  $("#transcriptTitle").textContent = "连续逐字稿";
  $("#transcriptHint").textContent = "最近 6 条 · 超出后自动上滚";
}

function renderTranscriptFeed(time) {
  const visibleLines = state.session.transcript.filter((line) => line.start <= time);
  const transcriptKey = visibleLines.map((line) => `${line.start}:${line.speaker}`).join("|");
  if (!visibleLines.length) {
    if (state.lastTranscriptKey !== transcriptKey) $("#transcriptFeed").innerHTML = `<div class="transcript-empty">讨论即将开始<br>新的发言会从下方出现并向上滚动</div>`;
    state.lastTranscriptKey = transcriptKey;
    return;
  }
  const hasNewLine = transcriptKey !== state.lastTranscriptKey;
  if (hasNewLine) {
    state.lastTranscriptKey = transcriptKey;
    $("#transcriptFeed").innerHTML = visibleLines.map((line) => {
      const participant = state.session.participants.find((p) => p.id === line.speaker);
      const systemLabel = line.type === EVENT_TYPES.ROBOT_UTTERANCE ? "MooTu" : line.type === EVENT_TYPES.DEVICE_EVENT ? "设备" : line.type === EVENT_TYPES.SCENE_EVENT ? "现场" : line.speaker;
      const chipColor = participant?.color || (line.type === EVENT_TYPES.ROBOT_UTTERANCE ? "#b18614" : "#66686d");
      return `<div class="transcript-line ${participant ? "" : "system-event"}"><span class="speaker-chip" style="background:${chipColor}">${escapeHtml(systemLabel)}</span><div><p></p><time>${formatPresentationTime(line.start)}–${formatPresentationTime(line.end)}</time></div></div>`;
    }).join("");
  }

  const lineElements = $$("#transcriptFeed .transcript-line");
  visibleLines.forEach((line, index) => {
    const element = lineElements[index];
    const isCurrent = line.start <= time && line.end >= time;
    const hasEnded = time > line.end;
    const speedMultiplier = state.config.display?.transcript_speed_multiplier ?? 1;
    const progress = clamp(((time - line.start) * speedMultiplier) / Math.max(line.end - line.start, 0.1), 0, 1);
    const characterCount = hasEnded ? line.text.length : Math.floor(line.text.length * progress);
    element.classList.toggle("current", isCurrent);
    element.classList.toggle("streaming", isCurrent && characterCount < line.text.length);
    element.querySelector("p").textContent = line.text.slice(0, characterCount);
  });

  if (hasNewLine) requestAnimationFrame(() => {
    const feed = $("#transcriptFeed");
    if (feed.scrollHeight > feed.clientHeight) feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
    else feed.scrollTop = 0;
  });
}

function secondsFromTimestamp(minutes, seconds) {
  return Number(minutes) * 60 + Number(seconds);
}

function parseTranscriptText(text) {
  return text.split(/\r?\n/).map((rawLine) => {
    const metaMatch = rawLine.match(/^\s*\[?(\d{1,2}):(\d{2})(?:\s*[-–—]\s*(\d{1,2}):(\d{2}))?\]?\s+[（(]\s*(现场|设备)(?:说明)?[:：]\s*(.+?)[）)]\s*$/);
    if (metaMatch) {
      const start = secondsFromTimestamp(metaMatch[1], metaMatch[2]);
      const end = metaMatch[3] ? secondsFromTimestamp(metaMatch[3], metaMatch[4]) : start + 8;
      return { start, end, speaker: metaMatch[5], text: metaMatch[6].trim() };
    }
    const match = rawLine.match(/^\s*\[?(\d{1,2}):(\d{2})(?:\s*[-–—]\s*(\d{1,2}):(\d{2}))?\]?\s+([^:：]+)[:：]\s*(.+)$/);
    if (!match) return null;
    const start = secondsFromTimestamp(match[1], match[2]);
    const end = match[3] ? secondsFromTimestamp(match[3], match[4]) : start + 8;
    return { start, end, speaker: match[5].trim(), text: match[6].trim() };
  }).filter(Boolean);
}

function normalizeTranscript(data) {
  const lines = Array.isArray(data) ? data : data.transcript;
  if (!Array.isArray(lines) || !lines.length) throw new Error("没有识别到逐字稿内容");
  const normalized = annotateTranscript(lines.map((line, index) => {
    const start = Number(line.start);
    const end = Number(line.end ?? start + 8);
    const speaker = String(line.speaker ?? "").trim();
    const text = String(line.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !speaker || !text) throw new Error(`第 ${index + 1} 条格式不完整`);
    return { start, end, speaker, text, type: line.type };
  }).sort((a, b) => a.start - b.start));
  const speakerCount = participantSpeakers(normalized).length;
  if (speakerCount > 6) throw new Error(`检测到 ${speakerCount} 位发言人；当前 MuJoCo 场景最多支持 6 位`);
  return normalized;
}

function loadImportedTranscript(lines, fileName) {
  resetPlaybackForUpload({ resetRuntime: false });
  const palette = ["#f59e0b", "#7c6ee6", "#31a68a", "#e76f51", "#4788c7", "#b565a7"];
  const speakers = participantSpeakers(lines);
  state.session.transcript = lines;
  state.session.participants = speakers.map((speaker, index) => ({ id: speaker, name: speaker, color: palette[index % palette.length] }));
  state.session.duration = Math.max(...lines.map((line) => line.end)) + 5;
  state.voteCandidates = [];
  state.sessionHarness = createSessionHarness({ ...state.session, candidateIdeas: state.voteCandidates });
  state.macroPhase = null;
  state.lastTranscriptKey = null;
  state.screenTopic = "讨论主题提炼中";
  state.utteranceCache.clear();
  state.utteranceRequests.clear();
  state.activeSpeechKey = null;
  state.spokenUtteranceKeys.clear();
  state.events = runAgent({ transcript: discussionTranscript(), participants: state.session.participants, duration: state.session.duration, discussionStart: state.sessionHarness.boundaries.discussion, config: state.config }).events;
  renderStatic();
  configureMujocoParticipants();
  setTime(0);
  if (state.model === "deepseek") void runFullAgentAnalysis({ automatic: true });
}

function renderParticipation(time) {
  const lines = state.session.transcript.filter((line) => line.start <= time && line.type === EVENT_TYPES.PARTICIPANT_UTTERANCE);
  const totals = Object.fromEntries(state.session.participants.map((p) => [p.id, 0]));
  const turns = Object.fromEntries(state.session.participants.map((p) => [p.id, 0]));
  lines.forEach((line) => {
    totals[line.speaker] += Math.max(0, Math.min(line.end, time) - line.start);
    turns[line.speaker] += 1;
  });
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  Object.entries(totals).forEach(([id, duration]) => {
    const share = Math.round(duration / sum * 100);
    $(`#share-${id}`).textContent = `${share}% · ${turns[id]}轮`;
    $(`#segment-${id}`).style.width = `${share}%`;
  });
}

function applyActionOutput(action, utterance, information = utterance, { showDisplay = false } = {}) {
  $("#agentSpeechText").textContent = utterance;
  if (!utterance) {
    clearTimeout(state.speechTimer);
    state.activeSpeechKey = null;
    state.lastSpeechText = "";
    $("#agentSpeech").classList.remove("show");
  } else if (utterance !== state.lastSpeechText) {
    state.lastSpeechText = utterance;
    clearTimeout(state.speechTimer);
    $("#agentSpeech").classList.add("show");
    state.speechTimer = setTimeout(() => {
      $("#agentSpeech").classList.remove("show");
      state.activeSpeechKey = null;
      state.lastSpeechText = "";
    }, 2600);
  }
  $("#coreActions").innerHTML = Object.entries(action).filter(([key]) => key !== "label" && (key !== "display" || showDisplay)).map(([key, value]) => `<div class="action" data-channel="${key}"><span>${channelLabel(key)}</span><strong>${escapeHtml(key === "display" ? information : value || "—")}</strong></div>`).join("");
}

function boundedRobotUtterance(key, utterance) {
  const value = String(utterance || "").trim();
  if (!value) return "";
  if (state.spokenUtteranceKeys.has(key)) return state.activeSpeechKey === key ? value : "";
  const limit = state.config?.thresholds?.max_robot_utterances || MAX_ROBOT_UTTERANCES;
  if (state.spokenUtteranceKeys.size >= limit) return "";
  state.spokenUtteranceKeys.add(key);
  state.activeSpeechKey = key;
  return value;
}

function setMujocoStatus(status, detail, connected = false) {
  $("#simulationTitle").dataset.status = connected ? "connected" : "loading";
  $("#simulationTitle").title = `${status} · ${detail}`;
}

function syncMujocoPlayback() {
  state.mujocoRuntime?.setPlaying(state.playing);
  $("#mujocoScreen").classList.toggle("playing", state.playing);
  const speakers = state.session?.participants?.length || 0;
  setMujocoStatus(state.playing ? "MuJoCo 仿真正在运行" : "MuJoCo 仿真已暂停", `${speakers} 位发言人 · ${speakers} 个 Pod 一一对应`, state.playing);
  if (!state.playing && state.currentBlackboard) renderMujocoPausedStatus(state.currentBlackboard);
}

async function initBrowserMujoco() {
  setMujocoStatus("MuJoCo 仿真加载中", "正在载入 run_interaction_demo.sh 场景", false);
  try {
    state.mujocoRuntime = await createBrowserMujoco({
      canvas: $("#mujocoViewport"),
      onStatus: (label) => { $("#mujocoStrategy").textContent = label; }
    });
    configureMujocoParticipants();
    if (state.currentBlackboard) {
      state.macroPhase = null;
      syncMujocoPhase(state.currentBlackboard);
    }
    $("#mujocoScreen").classList.add("streaming");
    syncMujocoPlayback();
  } catch (error) {
    setMujocoStatus("MuJoCo 加载失败", "请刷新页面或检查网络", false);
    console.error("MuJoCo WASM initialization failed", error);
  }
}

function dispatchMujocoCommand(event, force = false, utterance = "", embodiment = {}) {
  if (!event) return;
  const target = embodiment.target || event.target || null;
  const key = `${event.time ?? "live"}:${event.strategy}:${target || "group"}:${embodiment.speaker || "none"}:${embodiment.transcriptStart ?? "none"}:${embodiment.attentionMode || "none"}:${utterance}`;
  if (!force && key === state.mujocoCommandKey) return;
  state.mujocoCommandKey = key;
  const action = state.config.core.strategies[event.strategy] || state.config.core.strategies.observe;
  const command = {
    type: "mootu.command",
    version: 1,
    issued_at: new Date().toISOString(),
    strategy: event.strategy,
    target,
    speaker: embodiment.speaker || null,
    robot_speaking: Boolean(embodiment.robotSpeaking),
    attention_mode: embodiment.attentionMode || (event.target ? "invite" : "passive"),
    invitation_id: embodiment.invitationId || null,
    stage: event.stage || document.body.dataset.stage || "diverge",
    core: { ...action, ...(embodiment.action || {}), display: embodiment.showDisplay ? (embodiment.information || "") : "" }
  };
  state.pendingMujocoAction = command;
  state.mujocoRuntime?.setAction(command);
}

function contextualUtterance({ key, strategy, target, stage, transcript, action }) {
  state.activeUtteranceKey = key;
  if (!state.utteranceCache.has(key)) {
    state.utteranceCache.set(key, generateContextualUtterance({ strategy, target, stage, transcript }) || (action.display || "").replace("{{target}}", target || "大家"));
  }
  if (state.model === "deepseek" && strategy !== "observe" && !state.utteranceRequests.has(key)) {
    state.utteranceRequests.add(key);
    fetch("/api/generate-message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy, target, stage, transcript: transcript.slice(-6) })
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || "生成失败");
      return response.json();
    }).then((result) => {
      if (!result.utterance) return;
      state.utteranceCache.set(key, result.utterance);
      if (state.activeUtteranceKey === key) applyActionOutput(action, boundedRobotUtterance(key, result.utterance));
    }).catch(() => {});
  }
  return state.utteranceCache.get(key);
}

function renderToolTrace(trace = state.agentTrace) {
  const calls = trace.filter((event) => event.type === "tool_execution_start").map((event) => event.tool);
  const labels = {
    observe_discussion_window: "读取讨论窗口",
    get_participation_metrics: "查询参与度",
    get_flow_metrics: "查询流动性",
    get_diversity_metrics: "查询发散度",
    read_recent_memory: "读取短期记忆",
    check_intervention_cooldown: "检查冷却",
    evaluate_candidates: "评估候选",
    propose_intervention: "提出介入",
    generate_robot_action: "生成动作",
    dispatch_core_action: "控制 Core",
    dispatch_pod_feedback: "控制 Pod",
    record_expected_effect: "记录效果"
  };
  const value = calls.length ? calls.map((name) => labels[name] || name).join(" → ") : "规则引擎 · 无工具调用";
  $("#toolTrace").textContent = value;
  $("#toolTrace").title = calls.join(" → ");
}

function renderDecision(event, eventIndex, time) {
  $(".state-block").hidden = false;
  renderStageCriteria(event, time);
  const action = state.config.core.strategies[event.strategy];
  const intervening = event.strategy !== "observe";
  $("#decisionTitle").textContent = event.title;
  $("#decisionReason").textContent = event.reason;
  $("#followUp").textContent = event.followUp;
  $("#decisionSource").textContent = event.decisionSource?.startsWith("deepseek") ? "DeepSeek 提案 · pi Harness 决策" : "规则安全回退";
  $("#expectedEffect").textContent = event.expectedEffect || event.followUp;
  $("#reflectionText").textContent = event.reflection || "等待下一观察窗口验证";
  $("#memoryCount").textContent = `${Math.max(0, eventIndex)} 条`;
  const gaps = event.missingEvidence || [];
  $("#decisionConfidence").textContent = Number.isFinite(event.confidence) ? `${event.confidence}%${gaps.length ? ` · 缺 ${gaps.length} 项证据` : ""}` : "—";
  $("#decisionConfidence").title = gaps.join("；");
  $("#candidateSummary").textContent = event.candidates?.length
    ? event.candidates.map((candidate) => `${state.config.core.strategies[candidate.strategy]?.label || candidate.strategy} ${candidate.utility ?? "—"}`).join(" / ")
    : "单路径规则";
  renderToolTrace();
  const hasDiscussionEvidence = state.session.transcript.some((line) => line.start <= time && line.type === EVENT_TYPES.PARTICIPANT_UTTERANCE);
  if (hasDiscussionEvidence) {
    setMetric("participation", event.metrics.participation, METRIC_LABELS.participation, event.stage);
    setMetric("diversity", event.metrics.diversity, METRIC_LABELS.diversity, event.stage);
    setMetric("flow", event.metrics.flow, METRIC_LABELS.flow, event.stage);
  } else {
    clearMetric("participation", METRIC_LABELS.participation);
    clearMetric("diversity", METRIC_LABELS.diversity);
    clearMetric("flow", METRIC_LABELS.flow);
  }
  const activeLine = transcriptAt(time);
  const robotLine = activeLine?.type === EVENT_TYPES.ROBOT_UTTERANCE ? activeLine : null;
  const currentLine = robotLine ? null : participantAt(time);
  const currentSpeaker = currentLine?.speaker || null;
  const scriptedInvitedTarget = invitedParticipantFromLine(robotLine);
  const invitedTarget = scriptedInvitedTarget || (currentSpeaker ? null : event.target) || null;
  const invitationId = invitedTarget ? `invite:${robotLine?.id || event.time}:${invitedTarget}` : null;
  const embodimentTarget = invitedTarget || currentSpeaker;
  const attentionMode = invitedTarget ? "invite" : "passive";
  const shouldMoveForInvitation = invitedTarget ? (state.mujocoRuntime?.shouldMoveForInvite(invitedTarget) ?? true) : false;
  $("#robot").classList.toggle("intervening", intervening);
  orientRobotTo(embodimentTarget);
  const contextLines = state.session.transcript.filter((line) => line.start <= time && line.type === EVENT_TYPES.PARTICIPANT_UTTERANCE).slice(-6);
  const utteranceKey = `replay:${event.time}:${event.strategy}:${event.target || "group"}`;
  const renderedAction = invitedTarget
    ? { ...action, move: shouldMoveForInvitation ? `轻微朝 ${invitedTarget} 方向移动一次` : "保持当前位置", orient: `头颈朝向 ${invitedTarget}`, posture: "轻微前倾", voice: "温和邀请", expression: "鼓励" }
    : robotLine
      ? { ...action, move: "回到中心", orient: "面向小组", posture: "中立", voice: "清晰引导", expression: "引导" }
    : embodimentTarget
      ? { ...action, move: "保持中心", orient: `头颈朝向 ${currentSpeaker}`, posture: "轻微倾向", voice: "保持安静", expression: "倾听" }
      : action;
  $("#robotMood").textContent = `${renderedAction.expression} · ${renderedAction.posture}`;
  const proposedUtterance = robotLine?.text || contextualUtterance({ key: utteranceKey, strategy: event.strategy, target: invitedTarget, stage: event.stage, transcript: contextLines, action: renderedAction }) || event.utterance;
  const utterance = boundedRobotUtterance(robotLine ? `scripted:${robotLine.id}` : utteranceKey, proposedUtterance);
  const information = candidateInformation();
  applyActionOutput(renderedAction, utterance, information);
  dispatchMujocoCommand(event, false, utterance, { target: invitedTarget, speaker: invitedTarget ? null : currentSpeaker, transcriptStart: activeLine?.start, robotSpeaking: Boolean(robotLine && utterance), attentionMode, invitationId, action: renderedAction, information, showDisplay: false });
  const pod = invitedTarget ? state.config.pod.responses.low_participation : state.config.pod.responses.normal;
  $("#podTarget").textContent = invitedTarget ? `Pod ${invitedTarget} · 个体鼓励` : "群体陪伴";
  $("#podActions").textContent = `${pod.temperature} · ${pod.vibration} · ${pod.breathing}`;
  $("#podOrb").classList.toggle("active", Boolean(invitedTarget));
  $(".pod-section").classList.toggle("targeted", Boolean(invitedTarget));
  $("#jsonOutput").textContent = JSON.stringify({ timestamp: formatPresentationTime(event.time), source_timestamp: formatTime(event.time), playback_speed: timelineSpeed(), runtime: { architecture: "session-harness+pi", event_log_count: state.sessionHarness.eventLog.length, tool_trace: state.agentTrace, execution: state.agentExecution }, blackboard: state.sessionHarness.blackboard, agent_views: { discussion: state.sessionHarness.getAgentView("discussion_facilitator"), synthesis: state.sessionHarness.getAgentView("candidate_synthesis") }, stage: event.stage, stage_control: { recommendation: event.stageRecommendation, consecutive_votes: event.stageVotes }, observation: { evidence: event.evidence, missing_evidence: gaps }, assessment: event.metrics, decision: { source: event.decisionSource, intervene: intervening, strategy: event.strategy, target: invitedTarget, reason: event.reason, confidence: event.confidence, expected_effect: event.expectedEffect, selection_margin: event.selectionMargin, candidate_evaluation: event.candidates }, memory: { previous_outcome: event.reflection, entries: eventIndex }, actions: { core: { ...renderedAction, display: information }, pod: invitedTarget ? { target: invitedTarget, ...pod } : pod }, follow_up: event.followUp }, null, 2);
}

function renderStageCriteria(event, time) {
  const panel = $("#stageCriteria");
  panel.hidden = false;
  const progress = state.session.duration ? time / state.session.duration : 0;
  const convergeCriteria = [["覆盖度", event.metrics.diversity >= 65], ["活性下降", event.metrics.flow < 58], ["时间到", progress >= 0.62]];
  const divergeCriteria = [["覆盖不足", event.metrics.diversity < 48], ["出现新方向", event.strategy === "open_new_direction" || event.metrics.flow < 35]];
  const recommendation = event.stageRecommendation === "diverge" ? "diverge" : event.stageRecommendation === "converge" || event.strategy === "prepare_convergence" ? "converge" : event.stage;
  $("#stageSwitchDirection").textContent = "发散 ↔ 收敛";
  const criterionRow = (direction, label, criteria) => `<div class="${recommendation === direction ? "recommended" : ""}"><strong>${label}</strong>${criteria.map(([name, met]) => `<span class="${met ? "met" : "pending"}"><i>${met ? "✓" : "·"}</i>${name}</span>`).join("")}</div>`;
  $("#stageCriteriaList").innerHTML = `${criterionRow("converge", "发散 → 收敛", convergeCriteria)}${criterionRow("diverge", "收敛 → 发散", divergeCriteria)}`;
  $("#stageCriteriaSummary").textContent = recommendation === "converge"
    ? "覆盖足够、活性下降或时间到时，建议进入收敛"
    : "覆盖不足或出现新方向时，建议返回发散";
}

function metricTarget(name, stage) {
  if (name === "diversity") return stage === "converge" ? 0 : 2;
  return 2;
}

function updateMetricGoal(name, activeIndex, stage, enableWarning = true, showTarget = true) {
  const targetIndex = metricTarget(name, stage);
  const row = $(`#${name}State`);
  const scale = $(`#${name}States`);
  const farFromTarget = enableWarning && activeIndex >= 0 && Math.abs(activeIndex - targetIndex) >= 2;
  row.classList.toggle("metric-warning", farFromTarget);
  row.dataset.goal = showTarget ? (stage === "converge" ? "收敛阶段目标" : "发散阶段目标") : "";
  [...scale.children].forEach((item, index) => {
    item.classList.remove("target");
    item.title = "";
  });
}

function setMetric(name, value, labels, stage, enableWarning = true) {
  const stateIndex = value >= 67 ? 2 : value >= 34 ? 1 : 0;
  $(`#${name}State`).title = `内部判断值 ${value}/100`;
  [...$(`#${name}States`).children].forEach((item, index) => {
    item.textContent = labels[index];
    item.classList.toggle("active", index === stateIndex);
  });
  updateMetricGoal(name, stateIndex, stage, enableWarning);
}

function setMetricOptions(name, labels, activeIndex, stage = document.body.dataset.stage || "diverge", showTarget = activeIndex >= 0) {
  const scale = $(`#${name}States`);
  [...scale.children].forEach((item, index) => {
    item.textContent = labels[index];
    item.classList.toggle("active", index === activeIndex);
  });
  updateMetricGoal(name, activeIndex, stage, true, showTarget);
}

function clearMetric(name, labels, activeIndex = -1) {
  $(`#${name}State`).removeAttribute("title");
  setMetricOptions(name, labels, activeIndex, document.body.dataset.stage || "diverge", false);
}

function updateLiveConversationMetrics() {
  const count = state.liveLines.length;
  const activeIndex = count === 0 ? -1 : count === 1 ? 0 : count < 4 ? 1 : 2;
  setMetricOptions("participation", METRIC_LABELS.participation, activeIndex);
  setMetricOptions("diversity", METRIC_LABELS.diversity, activeIndex);
}

function announceTransition(event, previousEvent) {
  [$(".reasoning-panel"), $(".output-panel"), $(".decision-card")].forEach((element) => {
    element.classList.remove("decision-flash");
    void element.offsetWidth;
    element.classList.add("decision-flash");
  });
}

function liveStateFromSignal(signal) {
  if (signal.speaking) return "flowing";
  if (signal.silenceSeconds < state.config.thresholds.silence_stalled_seconds) return "thinking";
  return "stalled";
}

function renderLiveAction(strategy) {
  const action = state.config.core.strategies[strategy];
  $("#robot").classList.toggle("intervening", strategy !== "observe");
  orientRobotTo(null);
  $("#robotMood").textContent = `${action.expression} · ${action.posture}`;
  const transcript = state.liveLines.map((line) => ({ speaker: "现场", text: line.text, start: line.start, end: line.start + 1 }));
  const key = `live:${strategy}:${state.liveLines.length}:${transcript.at(-1)?.text || "empty"}`;
  const utterance = boundedRobotUtterance(key, contextualUtterance({ key, strategy, target: null, stage: document.body.dataset.stage || "diverge", transcript, action }));
  applyActionOutput(action, utterance, "方案综合 Agent · 随现场讨论持续更新");
  dispatchMujocoCommand({ time: `live-${state.liveLines.length}`, strategy, target: null, stage: document.body.dataset.stage || "diverge" }, false, utterance);
}

function renderLiveJudgment(signal) {
  const liveState = liveStateFromSignal(signal);
  if (liveState === state.liveFlowState) return;
  const previous = state.liveFlowState;
  state.liveFlowState = liveState;
  updateLiveConversationMetrics();
  const mapping = {
    flowing: { value: 86, title: "实时倾听", reason: "现场语音识别已确认讲话内容，讨论仍在自然推进。", followUp: "继续观察发言变化，不主动打断", strategy: "observe" },
    thinking: { value: 58, title: "保留思考空间", reason: `约 ${Math.round(signal.silenceSeconds)} 秒未确认到讲话内容；背景音不计为发言，目前更接近自然思考停顿。`, followUp: "等待更多证据，再决定是否介入", strategy: "observe" },
    stalled: { value: 22, title: "准备启发讨论", reason: `约 ${Math.round(signal.silenceSeconds)} 秒未确认到讲话内容；背景音不计为发言，已超过停滞观察阈值。`, followUp: "用开放问题测试讨论是否需要新方向", strategy: "open_new_direction" }
  };
  const decision = mapping[liveState];
  setMetric("flow", decision.value, METRIC_LABELS.flow, document.body.dataset.stage || "diverge");
  $("#decisionTitle").textContent = decision.title;
  $("#decisionReason").textContent = decision.reason;
  $("#followUp").textContent = decision.followUp;
  renderLiveAction(decision.strategy);
  if (previous) announceLiveTransition(liveState, decision.title);
  requestLiveAIDecision(signal, decision);
}

async function requestLiveAIDecision(signal, fallbackDecision) {
  if (state.model !== "deepseek") {
    $("#decisionSource").textContent = "规则安全回退";
    $("#decisionConfidence").textContent = "规则判断";
    $("#candidateSummary").textContent = "等待 AI 候选";
    return;
  }
  const requestId = ++state.liveRequestId;
  try {
    const result = await fetch("/api/agent/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: state.liveLines, participants: state.session.participants, stage: document.body.dataset.stage || "diverge", signal, memory: state.agentMemory }) }).then(async (response) => { if (!response.ok) throw new Error((await response.json()).error); return response.json(); });
    if (requestId !== state.liveRequestId || !result.decision) return;
    const decision = result.decision;
    state.agentTrace = result.trace || [];
    state.agentExecution = result.execution || null;
    renderToolTrace();
    state.agentMemory.push({ at: Date.now(), strategy: decision.strategy, expectedEffect: decision.expectedEffect, stageVotes: decision.stageVotes });
    state.agentMemory = state.agentMemory.slice(-8);
    document.body.dataset.stage = decision.stage;
    $("#decisionTitle").textContent = decision.title;
    $("#decisionReason").textContent = decision.reason;
    $("#followUp").textContent = decision.followUp;
    $("#decisionSource").textContent = "DeepSeek 提案 · pi Harness 决策";
    $("#expectedEffect").textContent = decision.expectedEffect;
    $("#reflectionText").textContent = state.agentMemory.length > 1 ? "已保留上一轮动作，等待新信号验证" : "首次 AI 决策";
    $("#memoryCount").textContent = `${state.agentMemory.length} 条`;
    const gaps = decision.missingEvidence || [];
    $("#decisionConfidence").textContent = `${decision.confidence ?? "—"}%${gaps.length ? ` · 缺 ${gaps.length} 项证据` : ""}`;
    $("#decisionConfidence").title = gaps.join("；");
    $("#candidateSummary").textContent = decision.candidates?.map((candidate) => `${state.config.core.strategies[candidate.strategy]?.label || candidate.strategy} ${candidate.utility}`).join(" / ") || "等待候选";
    renderLiveAction(decision.strategy);
    if (decision.utterance) applyActionOutput(state.config.core.strategies[decision.strategy], boundedRobotUtterance(`live-ai:${requestId}`, decision.utterance));
  } catch (error) {
    $("#decisionSource").textContent = "AI 请求失败 · 安全回退";
    $("#expectedEffect").textContent = fallbackDecision.followUp;
    $("#decisionConfidence").textContent = "—";
    $("#candidateSummary").textContent = "请求失败";
  }
}

function announceLiveTransition(liveState, title) {
  [$(".reasoning-panel"), $(".decision-card"), $("#flowState")].forEach((element) => {
    element.classList.remove("decision-flash");
    void element.offsetWidth;
    element.classList.add("decision-flash");
  });
}

function updateLiveSignals(signal) {
  $("#audioSignal").textContent = signal.speaking ? `确认讲话 · ${Math.round(signal.audioLevel * 100)}%` : signal.audioActive ? `检测到背景音 · ${Math.round(signal.audioLevel * 100)}%` : `环境安静 · ${Math.round(signal.audioLevel * 100)}%`;
  $("#silenceSignal").textContent = `${Math.round(signal.silenceSeconds)} 秒`;
  $("#motionSignal").textContent = signal.motion > 0.06 ? "明显活动" : signal.motion > 0.015 ? "轻微活动" : "相对稳定";
  $("#brightnessSignal").textContent = signal.brightness < 0.25 ? "偏暗" : signal.brightness > 0.78 ? "偏亮" : "适中";
  renderLiveJudgment(signal);
}

async function stopLiveMode() {
  if (!liveSensing?.active) return;
  await liveSensing.stop();
  $("#liveBtn").classList.remove("active");
  $("#liveBtn").setAttribute("aria-label", "开启现场模式");
  $("#liveBtn").title = "开启现场模式";
  $("#liveSignals").hidden = true;
  $("#playBtn").disabled = false;
  state.liveFlowState = null;
  leaveLiveSession();
  if (!$("#video").src) {
    $("#video").hidden = true;
    $("#videoPlaceholder").hidden = false;
  }
  setTime(state.time);
}

function channelLabel(key) {
  return ({ move: "移动", orient: "朝向", posture: "姿态", voice: "发声方式", expression: "表情", display: "屏幕信息 · 显示文字" })[key] || key;
}

function renderConfig() {
  const rows = Object.entries(state.config.core.strategies).map(([key, action]) => {
    const channels = Object.entries(action)
      .filter(([name, value]) => name !== "label" && name !== "display" && value)
      .map(([, value]) => value);
    if (key !== "observe") channels.push("信息根据最近讨论实时生成");
    return `<tr><td>${action.label}</td><td>${key}</td><td>${channels.join(" · ") || "保持安静"}</td></tr>`;
  }).join("");
  $("#configContent").innerHTML = `<h3>Core 策略</h3><table class="config-table"><thead><tr><th>含义</th><th>配置键</th><th>动作组合</th></tr></thead><tbody>${rows}</tbody></table><h3>判断阈值</h3><table class="config-table"><tbody>${Object.entries(state.config.thresholds).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
}

function togglePlayback() {
  state.playing = !state.playing;
  $("#playBtn").textContent = state.playing ? "Ⅱ" : "▶";
  syncMujocoPlayback();
  if ($("#video").hasAttribute("src")) {
    $("#video").playbackRate = timelineSpeed();
    state.playing ? $("#video").play() : $("#video").pause();
    return;
  }
  clearInterval(state.timer);
  if (state.playing) {
    state.playbackOrigin = state.time;
    state.playbackStartedAt = performance.now();
    state.timer = setInterval(() => {
      const elapsed = (performance.now() - state.playbackStartedAt) / 1000;
      const nextTime = state.playbackOrigin + elapsed * timelineSpeed();
      if (nextTime >= state.session.duration) {
        state.playing = false;
        clearInterval(state.timer);
        $("#playBtn").textContent = "▶";
        syncMujocoPlayback();
        setTime(state.session.duration);
        return;
      }
      setTime(nextTime);
    }, 80);
  }
}

function seekPlayback(value) {
  const target = clamp(Number(value), 0, state.session.duration);
  setTime(target);
  if ($("#video").hasAttribute("src")) {
    $("#video").currentTime = target;
    return;
  }
  if (state.playing) {
    state.playbackOrigin = target;
    state.playbackStartedAt = performance.now();
  }
}

function resetPlaybackForUpload({ resetRuntime = true } = {}) {
  state.playing = false;
  clearInterval(state.timer);
  state.timer = null;
  state.time = 0;
  state.playbackOrigin = 0;
  state.playbackStartedAt = 0;
  state.macroPhase = null;
  state.mujocoCommandKey = null;
  state.pendingMujocoAction = null;
  clearTimeout(state.speechTimer);
  state.activeSpeechKey = null;
  state.lastSpeechText = "";
  $("#agentSpeech").classList.remove("show");
  $("#playBtn").textContent = "▶";
  if ($("#video").hasAttribute("src")) {
    $("#video").pause();
    $("#video").currentTime = 0;
  }
  syncMujocoPlayback();
  if (resetRuntime) state.mujocoRuntime?.reset();
}

function toast() {}

$("#playBtn").addEventListener("click", togglePlayback);
$("#scrubber").addEventListener("input", (event) => seekPlayback(event.target.value));
$("#liveBtn").addEventListener("click", async () => {
  if (!liveSensing) {
    liveSensing = createLiveSensing({
      video: $("#video"),
      onSignal: updateLiveSignals,
      onTranscript: ({ finalText, interimText }) => {
        if (finalText) {
          state.liveTranscript = `${state.liveTranscript} ${finalText}`.trim();
          const recognizedAt = Math.max(0, (performance.now() - state.liveStartedAt) / 1000);
          splitRecognizedSentences(finalText).forEach((text, index) => state.liveLines.push({ text, start: recognizedAt + index * 0.01 }));
        }
        state.liveInterim = interimText.trim();
        $("#liveTranscript").textContent = `${finalText || ""} ${interimText}`.trim() || "正在倾听…";
        renderLiveTranscriptFeed(Boolean(finalText));
        updateLiveConversationMetrics();
      },
      onStatus: toast
    });
  }
  if (liveSensing.active) return stopLiveMode();
  try {
    state.playing = false;
    clearInterval(state.timer);
    $("#playBtn").textContent = "▶";
    syncMujocoPlayback();
    await liveSensing.start();
    enterLiveSession();
    $("#videoPlaceholder").hidden = true;
    $("#liveSignals").hidden = false;
    $("#liveBtn").classList.add("active");
    $("#liveBtn").setAttribute("aria-label", "结束现场模式");
    $("#liveBtn").title = "结束现场模式";
    $("#playBtn").disabled = true;
    state.liveFlowState = null;
    $("#liveTranscript").textContent = "正在倾听…";
    toast("现场模式已开启；请在浏览器提示中允许摄像头和麦克风权限");
  } catch (error) {
    toast(`无法开启现场模式：${error.message}`);
  }
});

$("#videoInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await stopLiveMode();
  resetPlaybackForUpload();
  $("#video").src = URL.createObjectURL(file);
  $("#video").hidden = false;
  $("#videoPlaceholder").hidden = true;
  $("#video").addEventListener("timeupdate", () => setTime($("#video").currentTime));
  $("#video").addEventListener("loadedmetadata", () => { state.session.duration = $("#video").duration; $("#video").playbackRate = timelineSpeed(); $("#scrubber").max = state.session.duration; $("#duration").textContent = formatPresentationTime(state.session.duration); });
  $("#video").onended = () => { state.playing = false; $("#playBtn").textContent = "▶"; syncMujocoPlayback(); };
});
$("#transcriptInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const raw = await file.text();
    const parsed = file.name.toLowerCase().endsWith(".json") ? JSON.parse(raw) : parseTranscriptText(raw);
    loadImportedTranscript(normalizeTranscript(parsed), file.name);
  } catch (error) {
    toast(`逐字稿读取失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
});
async function runFullAgentAnalysis({ automatic = false } = {}) {
  const requestId = ++state.analysisRequestId;
  $("#decisionSource").textContent = "DeepSeek 正在分析";
  $("#decisionConfidence").textContent = "计算中…";
  $("#candidateSummary").textContent = "生成并比较候选策略…";
  $("#toolTrace").textContent = "等待 pi Agent 调用工具…";
  try {
    const result = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: discussionTranscript(), participants: state.session.participants, duration: state.session.duration, discussionStart: state.sessionHarness.boundaries.discussion }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); });
    if (requestId !== state.analysisRequestId) return;
    state.events = result.events;
    const topicCandidates = [result.analysis?.screenTopic, ...(result.analysis?.ideaClusters || []), state.screenTopic];
    state.screenTopic = topicCandidates.map(normalizeScreenTopic).find(Boolean) || "讨论主题提炼中";
    state.voteCandidates = (result.analysis?.voteCandidates || []).map(normalizeScreenTopic).filter(Boolean).slice(0, 4);
    state.sessionHarness = createSessionHarness({ ...state.session, candidateIdeas: state.voteCandidates });
    state.agentTrace = result.trace || [];
    state.agentExecution = result.execution || null;
    renderStatic();
    setTime(0);
    state.model = result.mode;
    $("#decisionSource").textContent = result.mode === "deepseek" ? "DeepSeek 提案 · pi Harness 决策" : "规则安全回退";
    $("#modelBadge").classList.toggle("fallback", result.mode !== "deepseek");
    $("#modelBadge").innerHTML = `<i></i>${result.mode === "deepseek" ? "DeepSeek AI Agent · 已连接" : "AI 未配置 · 安全回退"}`;
    toast(`${automatic ? "自动" : "重新"}${result.mode === "deepseek" ? " AI 分析" : "安全回退分析"}完成：${result.analysis.summary}`);
  } catch (error) {
    if (requestId !== state.analysisRequestId) return;
    if (state.model !== "deepseek") {
      const local = runAgent({ transcript: discussionTranscript(), participants: state.session.participants, duration: state.session.duration, discussionStart: state.sessionHarness.boundaries.discussion, config: state.config });
      state.events = local.events;
      state.agentTrace = [];
      state.agentExecution = null;
      renderStatic();
      setTime(0);
      toast(`本地策略引擎分析完成：${local.summary}`);
    } else {
      $("#decisionSource").textContent = "AI 请求失败 · 保留安全回退";
      toast(`分析失败：${error.message}`);
    }
  }
}

$("#jsonBtn").addEventListener("click", () => $("#jsonDialog").showModal());
$("#configBtn").addEventListener("click", () => $("#configDialog").showModal());
$("#agentDetailsBtn").addEventListener("click", () => $("#agentDetailsDialog").showModal());
$$("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

load();
