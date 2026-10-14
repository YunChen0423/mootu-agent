import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const liveSensing = await readFile(new URL("../public/live-sensing.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const browserMujoco = await readFile(new URL("../public/browser-mujoco.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const enhancements = await readFile(new URL("../public/enhancements.css", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

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
  assert.doesNotMatch(html, /静默不足：跳过破冰|破冰失败：↺ 破冰|出现新方向：↺ 发散|平票／低共识/);
  assert.match(html, /破冰 Workflow/);
  assert.match(html, /投票 Workflow/);
  assert.match(html, /data-discussion-stage="diverge"/);
  assert.match(html, /data-discussion-stage="converge"/);
  assert.match(app, /tab\.dataset\.discussionStage === blackboard\.discussionStage/);
});

test("agent judgment omits redundant ownership tags and decision-cycle chrome", () => {
  assert.match(html, /class="decision-card"/);
  assert.doesNotMatch(html, /decision-ownership|activeAgentLabel|decisionStatus|decisionCycle|Agent 决策循环/);
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
  assert.match(app, /count < 4 \? 1 : 2/);
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

test("DeepSeek generates contextual spoken invitations while display text is reserved for voting", () => {
  assert.match(app, /generateContextualUtterance/);
  assert.match(app, /\/api\/generate-message/);
  assert.match(app, /屏幕信息 · 显示文字/);
  assert.match(app, /candidateInformation/);
  assert.match(app, /key !== "display" \|\| showDisplay/);
  assert.match(app, /SESSION_PHASES\.VOTING, SESSION_PHASES\.RESULT_CONFIRMATION/);
  assert.match(server, /禁止套用/);
  assert.match(server, /具体话题或方案/);
  assert.doesNotMatch(app, /方案综合 v\$\{snapshot\.version\}/);
  assert.match(app, /slice\(0, 8\)/);
  assert.match(html, /id="agentSpeech"/);
  assert.match(app, /#agentSpeech/);
});

test("spoken words and screen information are separate output surfaces", () => {
  assert.match(html, /id="mujocoScreen"[\s\S]*id="agentSpeech"/);
  assert.ok(html.indexOf('id="agentSpeech"') < html.indexOf('class="panel output-panel"'));
  assert.match(app, /display: embodiment\.showDisplay/);
  assert.match(enhancements, /action\[data-channel="display"\]/);
  assert.match(enhancements, /\.mujoco-screen \.spoken-output/);
});

test("group-state detail follows discussion ownership, including ballot preparation convergence", () => {
  assert.match(html, /class="state-block" hidden/);
  assert.match(app, /discussionOwned = blackboard\.phase === SESSION_PHASES\.BALLOT_PREPARATION/);
  assert.match(app, /\$\("\.state-block"\)\.hidden = !discussionOwned/);
  assert.match(app, /renderDecision[\s\S]*\$\("\.state-block"\)\.hidden = false/);
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
  assert.doesNotMatch(html, /class="route-feedback"/);
  assert.match(enhancements, /grid-template-columns: minmax\(82px, \.72fr\) minmax\(0, 1\.28fr\)/);
});

test("desktop transcript fills available input space and judgment highlights share one color", () => {
  assert.match(enhancements, /\.input-panel \.transcript-card[\s\S]*flex: 1 1 auto/);
  assert.match(enhancements, /\.state-scale i\.active/);
});

test("judgment uses three-point scales, stage warnings, and no transition popup", () => {
  assert.match(html, /不开放<\/i><i>适中<\/i><i>开放/);
  assert.match(html, /收束<\/i><i>平衡<\/i><i>发散/);
  assert.match(html, /停滞<\/i><i>过渡<\/i><i>流动/);
  assert.match(app, /value >= 67 \? 2 : value >= 34 \? 1 : 0/);
  assert.doesNotMatch(html, /时长 70% · 轮次 30%/);
  assert.doesNotMatch(html, /id="transitionNotice"/);
  assert.match(app, /metricTarget/);
  assert.match(app, /metric-warning/);
  assert.doesNotMatch(html, /decisionCycle|观察→判断|观察 → 判断/);
});

test("input controls are icon-only on one line and timeline seeking can move backward while playing", () => {
  assert.match(html, /class="input-icon-button live-button"/);
  assert.match(html, /aria-label="导入视频"/);
  assert.match(html, /aria-label="上传逐字稿"/);
  assert.match(enhancements, /\.input-actions[\s\S]*flex-wrap: nowrap !important/);
  assert.match(app, /function seekPlayback/);
  assert.match(app, /state\.playbackOrigin = target/);
  assert.match(app, /if \(!state\.session \|\| !state\.sessionHarness \|\| !state\.events\.length\) return/);
  assert.match(app, /#scrubber"\)\.addEventListener\("input", \(event\) => seekPlayback/);
});

test("current decision is rendered as one compact line", () => {
  assert.match(enhancements, /\.reasoning-panel \.decision-card[\s\S]*white-space: nowrap/);
  assert.match(enhancements, /\.reasoning-panel \.decision-card p,[\s\S]*\.follow-up \{ display: none/);
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
  assert.match(app, /orient: `头颈朝向 \$\{invitedTarget\}`/);
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
  assert.match(html, /<h2>具身输出<\/h2>[\s\S]*id="simulationTitle"[^>]*>MuJoCo 仿真画面/);
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

test("MuJoCo advances only while the left playback is running", () => {
  assert.match(app, /function syncMujocoPlayback/);
  assert.match(app, /state\.mujocoRuntime\?\.setPlaying\(state\.playing\)/);
  assert.match(app, /function togglePlayback[\s\S]*syncMujocoPlayback\(\)/);
  assert.match(browserMujoco, /let running = false/);
  assert.match(browserMujoco, /setPlaying\(active\)/);
  assert.match(browserMujoco, /if \(!running\) return/);
  assert.doesNotMatch(browserMujoco, /frameId = requestAnimationFrame\(animate\);\s*\n\s*return \{/);
  assert.match(app, /state\.macroPhase = null;\s*\n\s*syncMujocoPhase\(state\.currentBlackboard\)/);
});

test("Pod feedback keeps only the concrete behavior card", () => {
  assert.doesNotMatch(html, /Pod 个体反馈|触觉反馈/);
  assert.match(html, /class="pod-section">\s*<div class="pod-row"/);
  assert.match(enhancements, /\.pod-section::after \{ display: none; content: none/);
});

test("the current transcript speaker drives MooTu toward the matching pod", () => {
  assert.match(app, /function participantAt/);
  assert.match(app, /function invitedParticipantFromLine/);
  assert.match(app, /attentionMode/);
  assert.match(app, /move: "保持中心"/);
  assert.match(app, /头颈朝向 \$\{currentSpeaker\}/);
  assert.match(app, /target: invitedTarget, speaker: invitedTarget \? null : currentSpeaker/);
  assert.match(browserMujoco, /POD_LAYOUTS = Object\.freeze/);
  assert.match(browserMujoco, /const focusSpeaker = \(speakerId,/);
  assert.match(browserMujoco, /SPEAKER_NAVIGATION_DURATION = 1\.8/);
  assert.match(app, /embodiment\.speaker \|\| "none"/);
  assert.match(app, /transcriptStart: activeLine\?\.start/);
  assert.match(app, /configureMujocoParticipants/);
});

test("discussion embodiment is gentle, channel-aligned, and keeps pod geometry stable", () => {
  assert.match(browserMujoco, /INVITE_APPROACH_RATIO = 0\.18/);
  assert.match(app, /lightsReady: blackboard\.ballotLightsReady/);
  assert.match(browserMujoco, /demo\.phase === "waiting"/);
  assert.match(browserMujoco, /\["waiting", "open"\]\.includes\(demo\.phase\)/);
  assert.match(browserMujoco, /headYaw = 0\.18 \* Math\.sin\(elapsed \* 0\.72\)/);
  assert.match(browserMujoco, /neckSide = 0\.065 \* Math\.sin\(elapsed \* 0\.72\)/);
  assert.doesNotMatch(browserMujoco, /demo\.mode === "voting" && elapsed >= 5/);
  assert.match(browserMujoco, /shouldMoveForInvitation \? "moving" : "turning"/);
  assert.match(browserMujoco, /approachedSpeakers/);
  assert.match(browserMujoco, /INVITATION_APPROACH_DURATION = 1\.2/);
  assert.match(browserMujoco, /INVITATION_HOLD_MS = 2000/);
  assert.match(browserMujoco, /demo\.navigation === "moving"/);
  assert.doesNotMatch(browserMujoco, /const isDiscussionNavigation = demo\.mode === "discussion" && demo\.phase === "attention" && demo\.attentionMode === "invite"/);
  assert.match(browserMujoco, /const approachKey = speaker/);
  assert.match(browserMujoco, /approachedSpeakers\.has\(approachKey\)/);
  assert.match(browserMujoco, /停留 2 秒/);
  assert.match(browserMujoco, /MAX_INVITATION_ANIMATIONS = 2/);
  assert.match(browserMujoco, /pendingScenario/);
  assert.match(browserMujoco, /pendingAction/);
  assert.match(browserMujoco, /invitationInProgress/);
  assert.match(browserMujoco, /setAction = \(action, \{ force = false \} = \{\}\)/);
  assert.match(browserMujoco, /kind: "invite-return"/);
  assert.match(browserMujoco, /INVITATION_RETURN_DURATION = 1\.8/);
  assert.match(browserMujoco, /INVITATION_COOLDOWN_MS = 10000/);
  assert.match(browserMujoco, /const invitationInProgress = \(\) => Boolean\(demo\.activeInvitationId\)/);
  assert.match(browserMujoco, /action\?\.attention_mode !== "invite"/);
  assert.match(browserMujoco, /demo\.invitationCooldownUntil = now \+ INVITATION_COOLDOWN_MS/);
  assert.match(browserMujoco, /let pauseAfterInvitation = false/);
  assert.match(browserMujoco, /if \(invitationInProgress\(\)\) \{\s*pauseAfterInvitation = true;\s*return;/);
  assert.match(browserMujoco, /completedKind === "invite-return" && pauseAfterInvitation/);
  assert.match(browserMujoco, /if \(running\) frameId = requestAnimationFrame\(animate\)/);
  assert.match(browserMujoco, /clearNavigation\(\);\s*if \(resumeScenario\)/);
  assert.match(browserMujoco, /邀请 \$\{speaker\} 发言/);
  assert.match(browserMujoco, /正在发言 · 保持中心并头颈朝向/);
  assert.match(browserMujoco, /kind: "passive"/);
  assert.match(browserMujoco, /targetYaw = Math\.atan2\(-podX, podY\)/);
  assert.match(browserMujoco, /const startBaseTransition/);
  assert.doesNotMatch(browserMujoco, /const centerRobot/);
  assert.match(browserMujoco, /setScenario[\s\S]*startBaseTransition\(now/);
  assert.match(browserMujoco, /demo\.action\?\.posture\?\.includes\("前倾"\)/);
  assert.match(browserMujoco, /mesh\.userData\.geometryKey !== key/);
  assert.doesNotMatch(browserMujoco, /candidateGeomIds|candidate_a|candidate_b/);
  assert.match(app, /embodiment\.action/);
});

test("spoken overlays expire quickly and a real speaker overrides an old invitation target", () => {
  assert.match(app, /state\.speechTimer = setTimeout\(\(\) => \{[\s\S]*?classList\.remove\("show"\);[\s\S]*?\}, 2600\)/);
  assert.match(app, /scriptedInvitedTarget \|\| \(currentSpeaker \? null : event\.target\)/);
});

test("icebreaker animation runs once and then waits for discussion", () => {
  assert.match(browserMujoco, /demo\.phase = "complete"/);
  assert.match(browserMujoco, /破冰完成 · 等待讨论/);
  assert.match(browserMujoco, /configureParticipants[\s\S]*setScenario\("discussion"\)/);
});

test("speaker and encouragement targets use distinct pod signals", () => {
  assert.match(browserMujoco, /const SPEAKING = \[0\.32, 0\.74, 1, 1\]/);
  assert.match(browserMujoco, /const INVITED = \[0\.18, 1, 0\.46, 1\]/);
  assert.match(browserMujoco, /invitationPulse/);
  assert.match(browserMujoco, /demo\.attentionMode === "invite" \? invitedColor : SPEAKING/);
  assert.match(app, /classList\.toggle\("targeted", Boolean\(invitedTarget\)\)/);
  assert.match(browserMujoco, /demo\.icebreakerTargetIndex = Math\.max\(0, speakers\.indexOf\("A"\)\)/);
  assert.match(browserMujoco, /demo\.round = demo\.icebreakerTargetIndex/);
  assert.match(enhancements, /\.pod-section\.targeted \.pod-row/);
});

test("AI topic stays internal until voting and scripted MooTu speech remains visible", () => {
  assert.match(app, /state\.screenTopic/);
  assert.match(app, /const normalizeScreenTopic/);
  assert.match(app, /result\.analysis\?\.screenTopic/);
  assert.match(app, /robotLine\?\.text \|\| contextualUtterance/);
  assert.match(app, /scriptedInvitedTarget \|\| \(currentSpeaker \? null : event\.target\)/);
  assert.match(browserMujoco, /MooTu 正在说话 · 面向小组/);
});

test("all orchestrators remain visible and the active owner is highlighted", () => {
  assert.match(html, /id="agentOrchestration"/);
  assert.match(html, /阶段路由 Agent/);
  assert.match(html, /方案综合 Agent/);
  assert.match(app, /setActiveOrchestration/);
  assert.match(enhancements, /\.node-card\.active/);
  assert.match(enhancements, /\.node-card\.monitoring/);
  assert.match(app, /scrollLeft/);
  assert.match(app, /BALLOT_PREPARATION \? "discussion"/);
  assert.match(enhancements, /\.node-card\[data-owner="discussion"\]\.discussion-converge/);
});

test("MuJoCo overlays participant labels, speech, and voting candidates", () => {
  assert.match(html, /id="mujocoParticipantLabels"/);
  assert.match(html, /id="mujocoCandidates"/);
  assert.match(app, /function renderMujocoParticipantLabels/);
  assert.match(app, /function renderMujocoCandidates/);
  assert.match(app, /当前投票方案/);
  assert.match(app, /DeepSeek 综合/);
  assert.match(app, /等待 DeepSeek 综合/);
  assert.match(app, /发言确认/);
  assert.match(enhancements, /\.mujoco-participant-labels span/);
  assert.match(enhancements, /\.mujoco-candidates/);
  assert.match(app, /VOTE_OPTION_COLORS/);
  assert.match(app, /投票结果 · \$\{items\[winnerIndex\]\.label\}胜出/);
  assert.match(app, /\$\{counts\[index\]\} 票/);
  assert.match(enhancements, /--vote-color/);
  assert.match(app, /function renderMujocoPausedStatus/);
  assert.match(app, /讨论 · \$\{blackboard\.discussionStage/);
});

test("agent judgment exposes the full orchestration design on demand", () => {
  assert.match(html, /id="agentDetailsBtn"[^>]*>查看详情/);
  assert.match(html, /id="agentDetailsDialog"/);
  assert.match(html, /class="architecture-figure"/);
  assert.match(html, /原始事件日志/);
  assert.match(html, /Session Blackboard/);
  assert.match(html, /阶段路由 Agent/);
  assert.match(html, /讨论促进 Agent/);
  assert.match(html, /方案综合 Agent/);
  assert.match(html, /两次邀请上限、五句语音上限与动画事务锁/);
  assert.match(enhancements, /\.architecture-branches/);
  assert.match(app, /agentDetailsDialog"\)\.showModal/);
});

test("robot speech is globally bounded to five utterances", () => {
  assert.match(app, /MAX_ROBOT_UTTERANCES = 5/);
  assert.match(app, /function boundedRobotUtterance/);
  assert.match(app, /spokenUtteranceKeys\.size >= limit/);
  assert.match(app, /activeSpeechKey === key \? value : ""/);
  assert.match(app, /state\.activeSpeechKey = null/);
  assert.match(app, /spokenUtteranceKeys\.clear/);
});

test("stage-switch evidence is shown compactly during discussion", () => {
  assert.match(html, /id="stageCriteria"[^>]*hidden/);
  assert.match(html, /覆盖度/);
  assert.match(app, /function renderStageCriteria/);
  assert.match(app, /活性下降/);
  assert.match(app, /时间到/);
  assert.match(enhancements, /\.stage-criteria/);
});

test("group state uses plain labels and a flashing warning background", () => {
  assert.match(enhancements, /\.state-scale,[\s\S]*background: transparent !important/);
  assert.match(enhancements, /\.metric-row\.metric-warning[\s\S]*animation: metric-alert/);
  assert.match(enhancements, /@keyframes metric-alert/);
  assert.match(app, /item\.classList\.remove\("target"\)/);
  assert.match(enhancements, /Compact group-state rows/);
});

test("the discussion preview cannot be compressed upward", () => {
  assert.match(enhancements, /\.input-panel \.video-stage \{ flex: 0 0 auto/);
});

test("group-state dimensions only appear while the discussion facilitator owns the phase", () => {
  assert.match(html, /class="state-block" hidden/);
  assert.match(app, /function renderProtocolDecision[\s\S]*discussionOwned/);
  assert.match(app, /\[SESSION_PHASES\.DISCUSSION, SESSION_PHASES\.BALLOT_PREPARATION\]\.includes\(blackboard\.phase\)\) renderDecision/);
  assert.match(app, /function renderDecision[\s\S]*\$\("\.state-block"\)\.hidden = false/);
});

test("uploaded speakers define the visible pod count and time zero has no metric state", () => {
  assert.match(browserMujoco, /const configureParticipants = \(speakerIds\)/);
  assert.match(browserMujoco, /podBaseGeomIds/);
  assert.match(browserMujoco, /demo\.activePods\.includes\(index\)/);
  assert.match(app, /speakers\.length} 位发言人/);
  assert.match(app, /participantSpeakers\(normalized\)/);
  assert.match(app, /metaMatch[\s\S]*speaker: metaMatch\[5\]/);
  assert.match(app, /现场\|设备/);
  assert.match(app, /hasDiscussionEvidence[\s\S]*clearMetric\("participation"/);
  assert.match(app, /showTarget = activeIndex >= 0/);
  assert.match(app, /function resetPlaybackForUpload/);
  assert.match(app, /resetPlaybackForUpload\(\{ resetRuntime: false \}\)/);
  assert.match(app, /state\.mujocoRuntime\?\.reset\(\)/);
  assert.doesNotMatch(html, /id="toast"/);
});

test("session harness separates immutable events, blackboard and scoped agent ownership", () => {
  assert.match(app, /createSessionHarness/);
  assert.match(app, /renderProtocolDecision/);
  assert.match(app, /EVENT_TYPES\.PARTICIPANT_UTTERANCE/);
  assert.match(html, /方案综合 Agent|讨论促进 Agent/);
});
