const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { session: null, config: null, events: [], time: 0, playing: false, timer: null, playbackStartedAt: 0, playbackOrigin: 0, model: "mock", lastTranscriptKey: null };

const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const timelineSpeed = () => state.config?.display?.timeline_speed_multiplier ?? 1;
const formatPresentationTime = (seconds) => formatTime(seconds / timelineSpeed());

async function load() {
  [state.session, state.config] = await Promise.all([
    fetch("/data/sample-session.json").then((r) => r.json()),
    fetch("/config/actions.json").then((r) => r.json())
  ]);
  const status = await fetch("/api/status").then((r) => r.json()).catch(() => ({ mode: "mock" }));
  state.model = status.mode;
  $("#modelBadge").innerHTML = `<i></i>${status.mode === "deepseek" ? `DeepSeek · ${status.model}` : "本地规则 · 可演示"}`;
  buildEvents();
  renderStatic();
  setTime(0);
}

function buildEvents() {
  state.events = [
    decision(0, "diverge", "observe", ["讨论尚未开始，暂不介入。"], [58, 42, 50], "等待讨论自然启动", "继续收集发言证据"),
    decision(42, "diverge", "invite_quiet_member", ["C 尚未参与讨论。", "A 与 B 占据当前全部发言时间。"], [34, 46, 77], "低压力邀请 C", "30 秒后检查 C 是否开始参与", "C"),
    decision(82, "diverge", "open_new_direction", ["近期方案都围绕封闭小空间。", "新想法增长速度下降。"], [61, 31, 67], "激活新的探索方向", "观察是否出现不同类型的方案"),
    decision(116, "diverge", "observe", ["C 提出了“安静路线”的新方向。", "B 正在接续和扩展该想法。"], [79, 73, 88], "不介入，让讨论继续", "保持倾听，避免打断有效生成"),
    decision(171, "converge", "prepare_convergence", ["已形成空间、路线、地图三个方向。", "近期新方向增长下降，剩余时间有限。"], [84, 82, 71], "建议从发散转向收敛", "展示候选方向并提示评价维度"),
    decision(205, "converge", "advance_decision", ["成员已经开始比较隐私和成本。", "方案间仍缺少共同选择。"], [89, 76, 63], "推进方案比较", "总结共识与仍有分歧的维度"),
    decision(246, "converge", "observe", ["成员已提出地图作为核心方案。", "另一成员明确认可组合方向。"], [93, 83, 91], "保持观察，等待自然确认", "记录阶段结果，不追加干预")
  ];
}

function decision(time, stage, strategy, evidence, metrics, title, followUp, target = null) {
  return { time, stage, strategy, evidence, metrics: { participation: metrics[0], diversity: metrics[1], flow: metrics[2] }, title, reason: evidence.join(" "), followUp, target };
}

function renderStatic() {
  $("#duration").textContent = `${formatPresentationTime(state.session.duration)} · ${timelineSpeed()}×`;
  $("#scrubber").max = state.session.duration;
  $("#participants").innerHTML = state.session.participants.map((p) => `<div class="participant"><span>${p.id} · ${p.name}</span><strong id="share-${p.id}">0%</strong></div>`).join("");
  $("#timeline").innerHTML = state.events.map((e, i) => `<button class="timeline-event" data-index="${i}"><span>${formatPresentationTime(e.time)}</span><strong>${e.title}</strong></button>`).join("");
  $$(".timeline-event").forEach((button) => button.addEventListener("click", () => setTime(state.events[Number(button.dataset.index)].time)));
  renderConfig();
}

function eventAt(time) {
  return [...state.events].reverse().find((event) => event.time <= time) || state.events[0];
}

function transcriptAt(time) {
  return state.session.transcript.find((line) => line.start <= time && line.end >= time);
}

function setTime(time) {
  state.time = clamp(Number(time), 0, state.session.duration);
  $("#scrubber").value = state.time;
  $("#currentTime").textContent = formatPresentationTime(state.time);
  const event = eventAt(state.time);
  renderTranscriptFeed(state.time);
  renderDecision(event);
  renderParticipation(state.time);
  const progress = (state.time / state.session.duration) * 100;
  $("#stageProgress").style.width = `${progress}%`;
  $$(".stage-switch button").forEach((button) => button.classList.toggle("active", button.dataset.stage === event.stage));
  $$(".timeline-event").forEach((button, index) => button.classList.toggle("active", state.events[index] === event));
  if ($("#video").src && Math.abs($("#video").currentTime - state.time) > 1) $("#video").currentTime = state.time;
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
  return lines.map((line, index) => {
    const start = Number(line.start);
    const end = Number(line.end ?? start + 8);
    const speaker = String(line.speaker ?? "").trim();
    const text = String(line.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !speaker || !text) throw new Error(`第 ${index + 1} 条格式不完整`);
    return { start, end, speaker, text };
  }).sort((a, b) => a.start - b.start);
}

function loadImportedTranscript(lines, fileName) {
  const palette = ["#f59e0b", "#7c6ee6", "#31a68a", "#e76f51", "#4788c7", "#b565a7"];
  const speakers = [...new Set(lines.map((line) => line.speaker))];
  state.session.transcript = lines;
  state.session.participants = speakers.map((speaker, index) => ({ id: speaker, name: speaker, color: palette[index % palette.length] }));
  state.session.duration = Math.max(...lines.map((line) => line.end)) + 5;
  state.lastTranscriptKey = null;
  buildImportedEvents();
  renderStatic();
  setTime(0);
  toast(`已载入 ${fileName} · ${lines.length} 条发言`);
}

function buildImportedEvents() {
  const duration = state.session.duration;
  state.events = [
    decision(0, "diverge", "observe", ["逐字稿已载入，等待讨论开始。"], [50, 45, 50], "等待讨论自然启动", "继续收集发言证据"),
    decision(Math.round(duration * 0.3), "diverge", "observe", ["正在累计发言分布与想法方向。"], [62, 55, 68], "保持观察", "等待更多上下文后再决定是否介入"),
    decision(Math.round(duration * 0.55), "diverge", "open_new_direction", ["已到达讨论中段，需要检查是否仍有新方向。"], [70, 52, 64], "检查探索是否固着", "结合 DeepSeek 语义分析确认是否启发"),
    decision(Math.round(duration * 0.75), "converge", "prepare_convergence", ["讨论进入后段，开始整理候选方向。"], [78, 73, 66], "准备收敛", "总结候选方案和评价维度"),
    decision(Math.round(duration * 0.92), "converge", "observe", ["接近讨论结束，观察是否形成明确结果。"], [84, 76, 82], "等待自然确认", "记录结果或继续推进")
  ];
}

function renderParticipation(time) {
  const lines = state.session.transcript.filter((line) => line.start <= time);
  const totals = Object.fromEntries(state.session.participants.map((p) => [p.id, 0]));
  lines.forEach((line) => { totals[line.speaker] += Math.max(0, Math.min(line.end, time) - line.start); });
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  Object.entries(totals).forEach(([id, duration]) => { $(`#share-${id}`).textContent = `${Math.round(duration / sum * 100)}%`; });
}

function renderDecision(event) {
  const action = state.config.core.strategies[event.strategy];
  const intervening = event.strategy !== "observe";
  $("#decisionStatus").textContent = intervening ? "准备介入" : "持续观察";
  $("#decisionStatus").className = `decision-tag ${intervening ? "active" : "calm"}`;
  $("#decisionTitle").textContent = event.title;
  $("#decisionReason").textContent = event.reason;
  $("#followUp").textContent = event.followUp;
  $("#evidenceList").innerHTML = event.evidence.map((item) => `<li>${item}</li>`).join("");
  setMetric("participation", event.metrics.participation);
  setMetric("diversity", event.metrics.diversity);
  setMetric("flow", event.metrics.flow);
  $$(".cycle span").forEach((item, index) => item.classList.toggle("active", index === (intervening ? 2 : 0)));
  $("#robot").classList.toggle("intervening", intervening);
  $$(".member").forEach((member) => member.classList.toggle("target", member.dataset.member === event.target));
  $("#focusArrow").classList.toggle("show", Boolean(event.target));
  if (event.target) $("#focusLabel").textContent = `朝向 ${event.target}`;
  $("#robotMood").textContent = `${action.expression} · ${action.posture}`;
  $("#coreActions").innerHTML = Object.entries(action).filter(([key]) => key !== "label").map(([key, value]) => `<div class="action"><span>${channelLabel(key)}</span><strong>${value || "—"}</strong></div>`).join("");
  const pod = event.target ? state.config.pod.responses.low_participation : state.config.pod.responses.normal;
  $("#podTarget").textContent = event.target ? `Pod ${event.target} · 个体鼓励` : "群体陪伴";
  $("#podActions").textContent = `${pod.temperature} · ${pod.vibration} · ${pod.breathing}`;
  $("#podOrb").classList.toggle("active", Boolean(event.target));
  $("#jsonOutput").textContent = JSON.stringify({ timestamp: formatPresentationTime(event.time), source_timestamp: formatTime(event.time), playback_speed: timelineSpeed(), stage: event.stage, observation: { evidence: event.evidence }, assessment: event.metrics, decision: { intervene: intervening, strategy: event.strategy, reason: event.reason }, actions: { core: action, pod: event.target ? { target: event.target, ...pod } : pod }, follow_up: event.followUp }, null, 2);
}

function setMetric(name, value) {
  $(`#${name}Metric`).value = value;
  $(`#${name}Label`).textContent = value >= 75 ? "良好" : value >= 50 ? "需观察" : "不足";
}

function channelLabel(key) {
  return ({ move: "移动", orient: "朝向", posture: "姿态", voice: "语音", expression: "表情", display: "信息" })[key] || key;
}

function renderConfig() {
  const rows = Object.entries(state.config.core.strategies).map(([key, action]) => `<tr><td>${action.label}</td><td>${key}</td><td>${Object.values(action).slice(1).filter(Boolean).join(" · ")}</td></tr>`).join("");
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
$("#videoInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $("#video").src = URL.createObjectURL(file);
  $("#video").hidden = false;
  $("#videoPlaceholder").hidden = true;
  $("#video").addEventListener("timeupdate", () => setTime($("#video").currentTime));
  $("#video").addEventListener("loadedmetadata", () => { state.session.duration = $("#video").duration; $("#video").playbackRate = timelineSpeed(); $("#scrubber").max = state.session.duration; $("#duration").textContent = `${formatPresentationTime(state.session.duration)} · ${timelineSpeed()}×`; });
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
$("#analyzeBtn").addEventListener("click", async () => {
  $("#analyzeBtn").disabled = true;
  $("#analyzeBtn").textContent = "分析中…";
  try {
    const result = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: state.session.transcript }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); });
    if (result.analysis) toast(`DeepSeek 分析完成：${result.analysis.summary || "已更新语义判断"}`);
    else toast("本地规则分析完成；配置 Key 后将启用 DeepSeek");
    setTime(42);
  } catch (error) {
    if (state.model === "mock") {
      toast("本地规则分析完成；本地启动并配置 Key 后可启用 DeepSeek");
      setTime(42);
    } else {
      toast(`分析失败：${error.message}`);
    }
  }
  finally { $("#analyzeBtn").disabled = false; $("#analyzeBtn").textContent = "运行分析"; }
});
$("#jsonBtn").addEventListener("click", () => $("#jsonDialog").showModal());
$("#configBtn").addEventListener("click", () => $("#configDialog").showModal());
$$("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

load();
