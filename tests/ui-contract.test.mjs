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

test("primary discussion stage and distinct state labels are present", () => {
  assert.match(html, /id="stageFocus"/);
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

test("discussion stage controls the full-page theme", () => {
  assert.match(app, /document\.body\.dataset\.stage/);
  assert.match(enhancements, /body\[data-stage="converge"\]/);
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

test("stage switch is in the top navigation and live interim text has no entrance animation", () => {
  assert.ok(html.indexOf("stageFocus") < html.indexOf("header-actions"));
  assert.match(enhancements, /\.live-mode \.transcript-line[\s\S]*animation: none/);
});

test("speaking shares use one compact segmented bar", () => {
  assert.match(app, /participation-bar/);
  assert.match(app, /segment-\$\{p\.id\}/);
});

test("embodied display copy is generated from recent discussion context", () => {
  assert.match(app, /generateContextualUtterance/);
  assert.match(app, /\/api\/generate-message/);
  assert.match(app, /信息 · 实时生成/);
  assert.match(html, /id="agentSpeech"/);
  assert.match(app, /#agentSpeech/);
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

test("disabled analysis button keeps readable contrast", () => {
  assert.match(styles, /\.button\.primary:disabled/);
  assert.match(styles, /-webkit-text-fill-color:#65645f/);
  assert.match(styles, /opacity:1/);
});

test("embodied scene supports five dynamic members and target-specific orientation", () => {
  assert.match(html, /id="memberRing"/);
  assert.match(app, /const MEMBER_LAYOUTS/);
  assert.match(app, /participants\.slice\(0, 5\)/);
  assert.match(app, /Math\.atan2/);
  assert.match(app, /--focus-angle/);
  assert.match(app, /orient: `朝向 \$\{event\.target\}`/);
  assert.match(enhancements, /--member-x/);
  assert.match(enhancements, /rotate\(var\(--focus-angle/);
});

test("AI analysis starts automatically and the button is only a retry", () => {
  assert.match(html, />重新分析<\/button>/);
  assert.match(app, /runFullAgentAnalysis\(\{ automatic: true \}\)/);
  assert.match(app, /loadImportedTranscript[\s\S]*runFullAgentAnalysis\(\{ automatic: true \}\)/);
  assert.doesNotMatch(html, />运行 AI Agent<\/button>/);
});

test("embodied output reproduces the interaction demo in browser MuJoCo", () => {
  assert.match(html, /id="mujocoViewport"/);
  assert.match(html, /run_interaction_demo\.sh · 浏览器复刻/);
  assert.match(html, /破冰接力/);
  assert.match(html, /投票收敛/);
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
