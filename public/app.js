import { generateContextualUtterance, runAgent } from "./agent-engine.js";
import { createLiveSensing } from "./live-sensing.js";
import { createBrowserMujoco } from "./browser-mujoco.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { session: null, config: null, events: [], agentTrace: [], agentExecution: null, time: 0, playing: false, timer: null, playbackStartedAt: 0, playbackOrigin: 0, model: "fallback", lastTranscriptKey: null, activeEventIndex: null, transitionTimer: null, liveFlowState: null, liveTranscript: "", liveLines: [], liveInterim: "", liveStartedAt: 0, utteranceCache: new Map(), utteranceRequests: new Set(), activeUtteranceKey: null, agentMemory: [], liveRequestId: 0, analysisRequestId: 0, mujocoRuntime: null, pendingMujocoAction: null, mujocoCommandKey: null, pendingMujocoSpeaker: null, mujocoSpeakerKey: null };

const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const timelineSpeed = () => state.config?.display?.timeline_speed_multiplier ?? 1;
const formatPresentationTime = (seconds) => formatTime(seconds / timelineSpeed());
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
  configureMujocoParticipants();
  const status = await fetch("/api/status").then((r) => r.json()).catch(() => ({ mode: "fallback" }));
  state.model = status.mode;
  $("#modelBadge").classList.toggle("fallback", status.mode !== "deepseek");
  $("#modelBadge").innerHTML = `<i></i>${status.mode === "deepseek" ? `DeepSeek AI Agent · 已连接` : "AI 未配置 · 安全回退"}`;
  state.events = runAgent({ transcript: state.session.transcript, participants: state.session.participants, duration: state.session.duration, config: state.config }).events;
  renderStatic();
  setTime(0);
  if (state.model === "deepseek") void runFullAgentAnalysis({ automatic: true });
}

function renderStatic() {
  $("#duration").textContent = formatPresentationTime(state.session.duration);
  $("#scrubber").max = state.session.duration;
  $("#participants").innerHTML = `<div class="participation-bar" aria-label="成员发言比例">${state.session.participants.map((p) => `<i id="segment-${p.id}" style="--participant-color:${p.color};width:0%"></i>`).join("")}</div><div class="participation-legend">${state.session.participants.map((p) => `<span><b style="background:${p.color}"></b>${escapeHtml(p.id)} · ${escapeHtml(p.name)} <strong id="share-${p.id}">0% · 0轮</strong></span>`).join("")}</div>`;
  renderEmbodiedMembers();
  renderConfig();
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

function syncMujocoSpeaker(time) {
  const line = transcriptAt(time);
  if (!line?.speaker) return;
  const key = `${line.speaker}:${line.start}`;
  if (key === state.mujocoSpeakerKey) return;
  state.mujocoSpeakerKey = key;
  state.pendingMujocoSpeaker = line.speaker;
  state.mujocoRuntime?.focusSpeaker(line.speaker);
}

function configureMujocoParticipants() {
  const speakers = state.session?.participants?.map((participant) => participant.id) || [];
  if (!state.mujocoRuntime) return;
  state.mujocoRuntime.configureParticipants(speakers);
  if (speakers.length) setMujocoStatus("MooTu 互动演示在线运行", `${speakers.length} 位发言人 · ${speakers.length} 个 Pod 一一对应`, true);
}

function setTime(time) {
  state.time = clamp(Number(time), 0, state.session.duration);
  $("#scrubber").value = state.time;
  $("#currentTime").textContent = formatPresentationTime(state.time);
  const event = eventAt(state.time);
  const eventIndex = state.events.indexOf(event);
  const previousEvent = state.activeEventIndex == null ? null : state.events[state.activeEventIndex];
  if (state.activeEventIndex != null && eventIndex !== state.activeEventIndex) announceTransition(event, previousEvent);
  state.activeEventIndex = eventIndex;
  renderTranscriptFeed(state.time);
  syncMujocoSpeaker(state.time);
  renderDecision(event, eventIndex, state.time);
  renderParticipation(state.time);
  $$(".stage-switch button").forEach((button) => button.classList.toggle("active", button.dataset.stage === event.stage));
  $("#stageTitle").textContent = event.stage === "converge" ? "收敛决策" : "发散探索";
  $("#stageReason").textContent = event.stage === "converge"
    ? "比较候选方向、明确取舍，并逐步形成可执行结论。"
    : "扩大参与和想法空间，暂不急于形成结论。";
  document.body.dataset.stage = event.stage;
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
  state.mujocoSpeakerKey = null;
  state.pendingMujocoSpeaker = null;
  state.activeEventIndex = null;
  state.utteranceCache.clear();
  state.utteranceRequests.clear();
  $("#transcriptTitle").textContent = "现场实时逐字稿";
  $("#transcriptHint").textContent = "实时识别 · 超出后自动上滚";
  renderLiveTranscriptFeed();
  $("#stageTitle").textContent = "发散探索";
  $("#stageReason").textContent = "现场会话已重新开始，正在从零建立讨论状态。";
  $$(".stage-switch button").forEach((button) => button.classList.toggle("active", button.dataset.stage === "diverge"));
  $("#decisionTitle").textContent = "建立现场基线";
  $("#decisionReason").textContent = "旧回放数据已清空，等待实时音频、画面与语音内容。";
  $("#followUp").textContent = "持续倾听并等待足够证据";
  $("#decisionStatus").textContent = "现场初始化";
  $("#decisionStatus").className = "decision-tag calm";
  clearMetric("participation", ["不开放", "偏不开放", "偏开放", "开放"]);
  clearMetric("diversity", ["收束", "偏收束", "偏发散", "发散"]);
  clearMetric("flow", ["停滞", "偏停滞", "偏流动", "流动"]);
  $("#evidenceList").innerHTML = "<li>现场会话刚刚开始，尚未形成有效判断。</li>";
  renderDecisionCycle(false, -1);
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
      return `<div class="transcript-line"><span class="speaker-chip" style="background:${participant.color}">${escapeHtml(line.speaker)}</span><div><p></p><time>${formatPresentationTime(line.start)}–${formatPresentationTime(line.end)}</time></div></div>`;
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
  const normalized = lines.map((line, index) => {
    const start = Number(line.start);
    const end = Number(line.end ?? start + 8);
    const speaker = String(line.speaker ?? "").trim();
    const text = String(line.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !speaker || !text) throw new Error(`第 ${index + 1} 条格式不完整`);
    return { start, end, speaker, text };
  }).sort((a, b) => a.start - b.start);
  const speakerCount = new Set(normalized.map((line) => line.speaker)).size;
  if (speakerCount > 6) throw new Error(`检测到 ${speakerCount} 位发言人；当前 MuJoCo 场景最多支持 6 位`);
  return normalized;
}

function loadImportedTranscript(lines, fileName) {
  const palette = ["#f59e0b", "#7c6ee6", "#31a68a", "#e76f51", "#4788c7", "#b565a7"];
  const speakers = [...new Set(lines.map((line) => line.speaker))];
  state.session.transcript = lines;
  state.session.participants = speakers.map((speaker, index) => ({ id: speaker, name: speaker, color: palette[index % palette.length] }));
  state.session.duration = Math.max(...lines.map((line) => line.end)) + 5;
  state.lastTranscriptKey = null;
  state.mujocoSpeakerKey = null;
  state.pendingMujocoSpeaker = null;
  state.utteranceCache.clear();
  state.utteranceRequests.clear();
  state.events = runAgent({ transcript: state.session.transcript, participants: state.session.participants, duration: state.session.duration, config: state.config }).events;
  renderStatic();
  configureMujocoParticipants();
  setTime(0);
  toast(`已载入 ${fileName} · ${lines.length} 条发言`);
  if (state.model === "deepseek") void runFullAgentAnalysis({ automatic: true });
}

function renderParticipation(time) {
  const lines = state.session.transcript.filter((line) => line.start <= time);
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

function applyActionOutput(action, utterance) {
  $("#agentSpeechText").textContent = utterance;
  $("#agentSpeech").classList.toggle("show", Boolean(utterance));
  $("#coreActions").innerHTML = Object.entries(action).filter(([key]) => key !== "label").map(([key, value]) => `<div class="action" data-channel="${key}"><span>${channelLabel(key)}</span><strong>${escapeHtml(key === "display" ? utterance : value || "—")}</strong></div>`).join("");
}

function setMujocoStatus(status, detail, connected = false) {
  $("#mujocoStatus").textContent = status;
  $("#mujocoDetail").textContent = detail;
  $("#mujocoDot").classList.toggle("connected", connected);
}

async function initBrowserMujoco() {
  setMujocoStatus("MooTu 互动演示加载中", "正在载入 run_interaction_demo.sh 场景", false);
  try {
    state.mujocoRuntime = await createBrowserMujoco({
      canvas: $("#mujocoViewport"),
      onStatus: (label) => { $("#mujocoStrategy").textContent = label; }
    });
    configureMujocoParticipants();
    if (state.pendingMujocoSpeaker) state.mujocoRuntime.focusSpeaker(state.pendingMujocoSpeaker);
    $("#mujocoScreen").classList.add("streaming");
  } catch (error) {
    setMujocoStatus("MuJoCo 加载失败", "请刷新页面或检查网络", false);
    console.error("MuJoCo WASM initialization failed", error);
  }
}

function dispatchMujocoCommand(event, force = false, utterance = "") {
  if (!event) return;
  const key = `${event.time ?? "live"}:${event.strategy}:${event.target || "group"}:${utterance}`;
  if (!force && key === state.mujocoCommandKey) return;
  state.mujocoCommandKey = key;
  const action = state.config.core.strategies[event.strategy] || state.config.core.strategies.observe;
  const command = {
    type: "mootu.command",
    version: 1,
    issued_at: new Date().toISOString(),
    strategy: event.strategy,
    target: event.target || null,
    stage: event.stage || document.body.dataset.stage || "diverge",
    core: { ...action, ...(event.target ? { orient: `朝向 ${event.target}` } : {}), display: utterance || event.utterance || action.display || "" }
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
      if (state.activeUtteranceKey === key) applyActionOutput(action, result.utterance);
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
  const action = state.config.core.strategies[event.strategy];
  const intervening = event.strategy !== "observe";
  $("#decisionStatus").textContent = intervening ? "准备介入" : "持续观察";
  $("#decisionStatus").className = `decision-tag ${intervening ? "active" : "calm"}`;
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
  $("#evidenceList").innerHTML = event.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const hasDiscussionEvidence = state.session.transcript.some((line) => line.start <= time);
  if (hasDiscussionEvidence) {
    setMetric("participation", event.metrics.participation, ["不开放", "偏不开放", "偏开放", "开放"], event.stage);
    setMetric("diversity", event.metrics.diversity, ["收束", "偏收束", "偏发散", "发散"], event.stage);
    setMetric("flow", event.metrics.flow, ["停滞", "偏停滞", "偏流动", "流动"], event.stage);
  } else {
    clearMetric("participation", ["不开放", "偏不开放", "偏开放", "开放"]);
    clearMetric("diversity", ["收束", "偏收束", "偏发散", "发散"]);
    clearMetric("flow", ["停滞", "偏停滞", "偏流动", "流动"]);
  }
  const nextTime = state.events[eventIndex + 1]?.time ?? state.session.duration;
  const phaseCount = intervening ? 4 : 2;
  const cyclePhase = Math.min(phaseCount - 1, Math.floor(clamp((time - event.time) / Math.max(nextTime - event.time, 1), 0, 0.999) * phaseCount));
  renderDecisionCycle(intervening, cyclePhase);
  $("#robot").classList.toggle("intervening", intervening);
  orientRobotTo(event.target);
  $("#robotMood").textContent = `${action.expression} · ${action.posture}`;
  const contextLines = state.session.transcript.filter((line) => line.start <= time).slice(-6);
  const utteranceKey = `replay:${event.time}:${event.strategy}:${event.target || "group"}`;
  const renderedAction = event.target ? { ...action, orient: `朝向 ${event.target}` } : action;
  const utterance = event.utterance || contextualUtterance({ key: utteranceKey, strategy: event.strategy, target: event.target, stage: event.stage, transcript: contextLines, action: renderedAction });
  applyActionOutput(renderedAction, utterance);
  dispatchMujocoCommand(event, false, utterance);
  const pod = event.target ? state.config.pod.responses.low_participation : state.config.pod.responses.normal;
  $("#podTarget").textContent = event.target ? `Pod ${event.target} · 个体鼓励` : "群体陪伴";
  $("#podActions").textContent = `${pod.temperature} · ${pod.vibration} · ${pod.breathing}`;
  $("#podOrb").classList.toggle("active", Boolean(event.target));
  $("#jsonOutput").textContent = JSON.stringify({ timestamp: formatPresentationTime(event.time), source_timestamp: formatTime(event.time), playback_speed: timelineSpeed(), runtime: { architecture: "pi", tool_trace: state.agentTrace, execution: state.agentExecution }, stage: event.stage, stage_control: { recommendation: event.stageRecommendation, consecutive_votes: event.stageVotes }, observation: { evidence: event.evidence, missing_evidence: gaps }, assessment: event.metrics, decision: { source: event.decisionSource, intervene: intervening, strategy: event.strategy, target: event.target, reason: event.reason, confidence: event.confidence, expected_effect: event.expectedEffect, selection_margin: event.selectionMargin, candidate_evaluation: event.candidates }, memory: { previous_outcome: event.reflection, entries: eventIndex }, actions: { core: { ...renderedAction, display: utterance }, pod: event.target ? { target: event.target, ...pod } : pod }, follow_up: event.followUp }, null, 2);
}

function metricTarget(name, stage) {
  if (name === "diversity") return stage === "converge" ? 0 : 3;
  return 3;
}

function updateMetricGoal(name, activeIndex, stage, enableWarning = true, showTarget = true) {
  const targetIndex = metricTarget(name, stage);
  const row = $(`#${name}State`);
  const scale = $(`#${name}States`);
  const farFromTarget = enableWarning && activeIndex >= 0 && Math.abs(activeIndex - targetIndex) >= 2;
  row.classList.toggle("metric-warning", farFromTarget);
  row.dataset.goal = showTarget ? (stage === "converge" ? "收敛阶段目标" : "发散阶段目标") : "";
  [...scale.children].forEach((item, index) => {
    item.classList.toggle("target", showTarget && index === targetIndex);
    item.title = showTarget && index === targetIndex ? row.dataset.goal : "";
  });
}

function setMetric(name, value, labels, stage, enableWarning = true) {
  const stateIndex = value >= 75 ? 3 : value >= 50 ? 2 : value >= 25 ? 1 : 0;
  $(`#${name}State`).title = `内部判断值 ${value}/100`;
  [...$(`#${name}States`).children].forEach((item, index) => {
    item.textContent = labels[index];
    item.classList.toggle("active", index === stateIndex);
  });
  updateMetricGoal(name, stateIndex, stage, enableWarning);
}

function renderDecisionCycle(intervening, activeIndex) {
  const cycle = $("#decisionCycle");
  const steps = [...cycle.querySelectorAll("span")];
  cycle.classList.toggle("observing-only", !intervening);
  steps[2].textContent = intervening ? "介入" : "不介入";
  steps[3].textContent = intervening ? "反馈" : "继续观察";
  steps.forEach((item, index) => item.classList.toggle("active", index === activeIndex));
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
  const activeIndex = count === 0 ? -1 : count === 1 ? 1 : count < 4 ? 2 : 3;
  setMetricOptions("participation", ["不开放", "偏不开放", "偏开放", "开放"], activeIndex);
  setMetricOptions("diversity", ["收束", "偏收束", "偏发散", "发散"], activeIndex);
}

function announceTransition(event, previousEvent) {
  [$(".reasoning-panel"), $(".output-panel"), $("#stageFocus"), $(".decision-card")].forEach((element) => {
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
  const utterance = contextualUtterance({ key, strategy, target: null, stage: document.body.dataset.stage || "diverge", transcript, action });
  applyActionOutput(action, utterance);
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
  setMetric("flow", decision.value, ["停滞", "偏停滞", "偏流动", "流动"], document.body.dataset.stage || "diverge");
  $("#decisionTitle").textContent = decision.title;
  $("#decisionReason").textContent = decision.reason;
  $("#followUp").textContent = decision.followUp;
  $("#decisionStatus").textContent = decision.strategy === "observe" ? "实时观察" : "准备介入";
  $("#decisionStatus").className = `decision-tag ${decision.strategy === "observe" ? "calm" : "active"}`;
  $("#evidenceList").innerHTML = `<li>${decision.reason}</li><li>画面运动水平：${Math.round(signal.motion * 100)}%；画面亮度：${Math.round(signal.brightness * 100)}%。</li><li>当前浏览器版本尚未区分不同说话人。</li>`;
  renderLiveAction(decision.strategy);
  renderDecisionCycle(decision.strategy !== "observe", decision.strategy === "observe" ? 1 : 2);
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
    $("#evidenceList").innerHTML = (decision.evidence.length ? decision.evidence : [decision.reason]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    renderLiveAction(decision.strategy);
    if (decision.utterance) applyActionOutput(state.config.core.strategies[decision.strategy], decision.utterance);
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
  $("#liveBtn").innerHTML = "<i></i>开启现场模式";
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
  return ({ move: "移动", orient: "朝向", posture: "姿态", voice: "语音", expression: "表情", display: "信息 · 实时生成" })[key] || key;
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
        setTime(state.session.duration);
        return;
      }
      setTime(nextTime);
    }, 80);
  }
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 2400);
}

$("#playBtn").addEventListener("click", togglePlayback);
$("#scrubber").addEventListener("input", (event) => setTime(event.target.value));
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
    await liveSensing.start();
    enterLiveSession();
    $("#videoPlaceholder").hidden = true;
    $("#liveSignals").hidden = false;
    $("#liveBtn").classList.add("active");
    $("#liveBtn").innerHTML = "<i></i>结束现场模式";
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
  $("#video").src = URL.createObjectURL(file);
  $("#video").hidden = false;
  $("#videoPlaceholder").hidden = true;
  $("#video").addEventListener("timeupdate", () => setTime($("#video").currentTime));
  $("#video").addEventListener("loadedmetadata", () => { state.session.duration = $("#video").duration; $("#video").playbackRate = timelineSpeed(); $("#scrubber").max = state.session.duration; $("#duration").textContent = formatPresentationTime(state.session.duration); });
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
  $("#analyzeBtn").disabled = true;
  $("#analyzeBtn").textContent = "AI 分析中…";
  $("#decisionSource").textContent = "DeepSeek 正在分析";
  $("#decisionConfidence").textContent = "计算中…";
  $("#candidateSummary").textContent = "生成并比较候选策略…";
  $("#toolTrace").textContent = "等待 pi Agent 调用工具…";
  try {
    const result = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: state.session.transcript, participants: state.session.participants, duration: state.session.duration }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); });
    if (requestId !== state.analysisRequestId) return;
    state.events = result.events;
    state.agentTrace = result.trace || [];
    state.agentExecution = result.execution || null;
    renderStatic();
    setTime(0);
    state.model = result.mode;
    $("#modelBadge").classList.toggle("fallback", result.mode !== "deepseek");
    $("#modelBadge").innerHTML = `<i></i>${result.mode === "deepseek" ? "DeepSeek AI Agent · 已连接" : "AI 未配置 · 安全回退"}`;
    toast(`${automatic ? "自动" : "重新"}${result.mode === "deepseek" ? " AI 分析" : "安全回退分析"}完成：${result.analysis.summary}`);
  } catch (error) {
    if (requestId !== state.analysisRequestId) return;
    if (state.model !== "deepseek") {
      const local = runAgent({ transcript: state.session.transcript, participants: state.session.participants, duration: state.session.duration, config: state.config });
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
  finally {
    if (requestId === state.analysisRequestId) {
      $("#analyzeBtn").disabled = false;
      $("#analyzeBtn").textContent = "重新分析";
    }
  }
}

$("#analyzeBtn").addEventListener("click", () => runFullAgentAnalysis({ automatic: false }));
$("#mujocoResetBtn").addEventListener("click", () => state.mujocoRuntime?.reset());
$("#mujocoIcebreakerBtn").addEventListener("click", () => {
  state.mujocoRuntime?.setScenario("icebreaker");
  $("#mujocoIcebreakerBtn").classList.add("active");
  $("#mujocoVotingBtn").classList.remove("active");
});
$("#mujocoVotingBtn").addEventListener("click", () => {
  state.mujocoRuntime?.setScenario("voting");
  $("#mujocoVotingBtn").classList.add("active");
  $("#mujocoIcebreakerBtn").classList.remove("active");
});
$("#jsonBtn").addEventListener("click", () => $("#jsonDialog").showModal());
$("#configBtn").addEventListener("click", () => $("#configDialog").showModal());
$$("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

load();
