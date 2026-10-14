import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const liveSensing = await readFile(new URL("../public/live-sensing.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const browserMujoco = await readFile(new URL("../public/browser-mujoco.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const enhancements = await readFile(new URL("../public/enhancements.css", import.meta.url), "utf8");

test("live mode exposes an explicit user-triggered camera control", () => {
  assert.match(html, /id="liveBtn"/);
  assert.match(liveSensing, /getUserMedia/);
  assert.match(liveSensing, /echoCancellation/);
});

test("nonlinear agent map replaces the redundant top stage strip", () => {
  assert.doesNotMatch(html, /id="stageFocus"/);
  assert.match(html, /id="agentOrchestration"/);
  assert.match(html, /当前位置：等待会话/);
  assert.match(html, /并行协作/);
  assert.match(html, /出现新方向：↺ 发散/);
  assert.match(html, /破冰 Workflow/);
  assert.match(html, /投票 Workflow/);
  assert.match(app, /偏不开放/);
  assert.match(app, /偏发散/);
  assert.match(app, /偏流动/);
});

test("decision card appears before the reasoning cycle", () => {
  assert.ok(html.indexOf("decision-card") < html.indexOf("Agent 决策循环"));
});

test("pi tool calls are visible in the agent state", () => {
  assert.doesNotMatch(html, /class="agent-state"/);
  assert.match(app, /observe_discussion_window/);
  assert.match(app, /dispatch_core_action/);
});

test("five-times playback is not shown as interface copy", () => {
  assert.doesNotMatch(html, /5×/);
});

test("live mode starts a clean session and renders recognition into the transcript feed", () => {
  assert.match(app, /enterLiveSession/);
  assert.match(app, /renderLiveTranscriptFeed/);
  assert.match(enhancements, /\.live-mode \.playback-row/);
});

test("discussion stages keep one neutral full-page theme", () => {
  assert.match(app, /document\.body\.dataset\.stage/);
  assert.match(enhancements, /body\[data-stage="diverge"\],\s*body\[data-stage="converge"\]/);
  assert.match(enhancements, /background: var\(--paper\) !important/);
});

test("decision timeline is removed and group state keeps visible alternatives in two columns", () => {
  assert.doesNotMatch(html, /决策时间轴/);
  assert.match(html, /class="metric-row"/);
  assert.match(html, /class="state-scale"/);
});

test("live mode counts recognized utterances without claiming speaker identity", () => {
  assert.match(app, /count < 4 \? 2 : 3/);
  assert.doesNotMatch(app, /待说话人分离/);
});

test("background audio alone is not treated as confirmed speech", () => {
  assert.match(liveSensing, /recentlyRecognized && audioActive/);
  assert.match(app, /检测到背景音/);
});

test("the removed top stage switch stays absent and live interim text has no entrance animation", () => {
  assert.doesNotMatch(html, /stageFocus/);
  assert.match(enhancements, /\.live-mode \.transcript-line[\s\S]*animation: none/);
});

test("speaking shares use one compact segmented bar", () => {
  assert.match(app, /participation-bar/);
  assert.match(app, /segment-\$\{p\.id\}/);
});

test("embodied display copy is generated from recent discussion context", () => {
  assert.match(app, /generateContextualUtterance/);
  assert.match(app, /\/api\/generate-message/);
  assert.match(app, /屏幕信息 · 显示文字/);
  assert.match(app, /candidateInformation/);
  assert.match(html, /id="agentSpeech"/);
  assert.match(app, /#agentSpeech/);
});

test("spoken words and screen information are separate output surfaces", () => {
  assert.match(html, /机器人语音 · 实际说出/);
  assert.match(app, /display: embodiment\.information/);
  assert.match(enhancements, /action\[data-channel="display"\]/);
});

test("discussion workflow is hidden for non-discussion agents", () => {
  assert.match(html, /id="decisionCycle"[^>]*hidden/);
  assert.match(app, /renderProtocolDecision[\s\S]*#decisionCycle"\)\.hidden = true/);
  assert.match(app, /renderDecision[\s\S]*#decisionCycle"\)\.hidden = false/);
});

test("desktop layout gives MuJoCo the wide upper area and moves judgment below it", () => {
  assert.match(html, /class="right-workspace"/);
  assert.match(html, /class="analysis-row"/);
  assert.match(html, /class="panel simulation-panel"/);
  assert.doesNotMatch(html, /class="panel workflow-panel"/);
  assert.doesNotMatch(html, /阶段依据/);
  assert.doesNotMatch(html, /可验证依据|id="evidenceList"/);
  assert.match(enhancements, /\.simulation-panel \{ grid-column: 1; grid-row: 1/);
  assert.match(enhancements, /\.output-panel \{ grid-column: 2; grid-row: 1; height: 100%/);
  assert.match(enhancements, /grid-column: 1 \/ 3;\s*grid-row: 2/);
  assert.match(enhancements, /\.reasoning-panel \.agent-modules[\s\S]*min-width: 0/);
  assert.match(enhancements, /\.reasoning-panel \.route-feedback \{ min-width: 0/);
  assert.match(enhancements, /grid-template-columns: minmax\(82px, \.72fr\) minmax\(0, 1\.28fr\)/);
});

test("desktop transcript fills available input space and judgment highlights share one color", () => {
  assert.match(enhancements, /\.input-panel \.transcript-card[\s\S]*flex: 1 1 auto/);
  assert.match(enhancements, /\.state-scale i\.active/);
});

test("judgment uses four-point scales, stage warnings, and no transition popup", () => {
  assert.match(html, /不开放<\/i><i>偏不开放<\/i><i>偏开放<\/i><i>开放/);
  assert.doesNotMatch(html, /时长 70% · 轮次 30%/);
  assert.doesNotMatch(html, /id="transitionNotice"/);
  assert.match(app, /metricTarget/);
  assert.match(app, /metric-warning/);
  assert.match(app, /phaseCount = intervening \? 4 : 2/);
  assert.match(app, /intervening \? "介入" : "不介入"/);
  assert.match(app, /intervening \? "反馈" : "继续观察"/);
  assert.match(enhancements, /\.cycle\.observing-only/);
});

test("manual reanalysis control is removed", () => {
  assert.doesNotMatch(html, /id="analyzeBtn"/);
  assert.doesNotMatch(html, />重新分析<\/button>/);
});

test("embodied scene supports six dynamic members and target-specific orientation", () => {
  assert.match(html, /id="memberRing"/);
  assert.match(app, /const MEMBER_LAYOUTS/);
  assert.match(app, /participants\.slice\(0, 6\)/);
  assert.match(app, /Math\.atan2/);
  assert.match(app, /--focus-angle/);
  assert.match(app, /orient: `头颈朝向 \$\{event\.target\}`/);
  assert.match(enhancements, /--member-x/);
  assert.match(enhancements, /rotate\(var\(--focus-angle/);
});

test("AI analysis starts automatically without a retry button", () => {
  assert.doesNotMatch(html, />重新分析<\/button>/);
  assert.match(app, /runFullAgentAnalysis\(\{ automatic: true \}\)/);
  assert.match(app, /loadImportedTranscript[\s\S]*runFullAgentAnalysis\(\{ automatic: true \}\)/);
  assert.doesNotMatch(html, />运行 AI Agent<\/button>/);
});

test("embodied output reproduces the interaction demo in browser MuJoCo", () => {
  assert.match(html, /id="mujocoViewport"/);
  assert.match(html, /id="simulationTitle"[^>]*>MooTu 实时互动演示/);
  assert.doesNotMatch(html, /class="mujoco-link"/);
  assert.doesNotMatch(html, /id="icebreakerDemoBtn"|id="votingDemoBtn"|id="resetMujocoBtn"/);
  assert.match(app, /createBrowserMujoco/);
  assert.match(browserMujoco, /visuals-exact-v4\.bin\.gz/);
  assert.match(browserMujoco, /asset\.localQuaternion/);
  assert.match(browserMujoco, /bodyId\(asset\.bodyName\)/);
  assert.match(browserMujoco, /SETTLE_SECONDS = 0\.5/);
  assert.match(browserMujoco, /neckPitch \/ NECK_SEGMENT_COUNT/);
  assert.match(browserMujoco, /haltBaseMotion/);
  assert.match(browserMujoco, /NAVIGATION_DURATION = 3/);
  assert.match(browserMujoco, /灯光接力/);
  assert.match(browserMujoco, /applyScriptedNavigation/);
  assert.match(browserMujoco, /MjModel\.from_xml_string/);
  assert.match(app, /type: "mootu\.command"/);
  assert.match(app, /version: 1/);
  assert.match(app, /dispatchMujocoCommand\(event/);
  assert.doesNotMatch(app, /ws:\/\/127\.0\.0\.1:8765/);
});

test("the current transcript speaker drives MooTu toward the matching pod", () => {
  assert.match(app, /function syncMujocoSpeaker/);
  assert.match(app, /attentionMode/);
  assert.match(app, /稍微靠近 \$\{currentSpeaker\}/);
  assert.match(app, /头颈朝向 \$\{currentSpeaker\}/);
  assert.match(browserMujoco, /POD_LAYOUTS = Object\.freeze/);
  assert.match(browserMujoco, /const focusSpeaker = \(speakerId,/);
  assert.match(browserMujoco, /SPEAKER_NAVIGATION_DURATION = 1\.2/);
  assert.match(app, /configureMujocoParticipants/);
});

test("discussion embodiment is gentle, channel-aligned, and keeps pod geometry stable", () => {
  assert.match(browserMujoco, /PASSIVE_APPROACH_RATIO = 0\.22/);
  assert.match(browserMujoco, /INVITE_APPROACH_RATIO = 0\.34/);
  assert.match(browserMujoco, /demo\.action\?\.posture\?\.includes\("前倾"\)/);
  assert.match(browserMujoco, /mesh\.userData\.geometryKey !== key/);
  assert.match(browserMujoco, /setColor\(candidateGeomIds\[0\], \[0, 0, 0, 0\]\)/);
  assert.match(app, /embodiment\.action/);
});

test("all orchestrators remain visible and the active owner is highlighted", () => {
  assert.match(html, /id="agentOrchestration"/);
  assert.match(html, /阶段路由 Agent/);
  assert.match(html, /方案综合 Agent/);
  assert.match(app, /setActiveOrchestration/);
  assert.match(enhancements, /\.node-card\.active/);
  assert.match(enhancements, /\.node-card\.monitoring/);
  assert.match(app, /scrollLeft/);
});

test("group-state dimensions only appear during the discussion facilitator phase", () => {
  assert.match(html, /class="state-block" hidden/);
  assert.match(app, /function renderProtocolDecision[\s\S]*\$\("\.state-block"\)\.hidden = true/);
  assert.match(app, /function renderDecision[\s\S]*\$\("\.state-block"\)\.hidden = false/);
});

test("uploaded speakers define the visible pod count and time zero has no metric state", () => {
  assert.match(browserMujoco, /const configureParticipants = \(speakerIds\)/);
  assert.match(browserMujoco, /podBaseGeomIds/);
  assert.match(browserMujoco, /demo\.activePods\.includes\(index\)/);
  assert.match(app, /speakers\.length} 位发言人/);
  assert.match(app, /participantSpeakers\(normalized\)/);
  assert.match(app, /hasDiscussionEvidence[\s\S]*clearMetric\("participation"/);
  assert.match(app, /showTarget = activeIndex >= 0/);
});

test("session harness separates immutable events, blackboard and scoped agent ownership", () => {
  assert.match(app, /createSessionHarness/);
  assert.match(app, /activeAgentLabel/);
  assert.match(app, /renderProtocolDecision/);
  assert.match(app, /EVENT_TYPES\.PARTICIPANT_UTTERANCE/);
  assert.match(html, /方案综合 Agent|讨论促进 Agent/);
});
