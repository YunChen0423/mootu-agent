import test from "node:test";
import assert from "node:assert/strict";
import { createSessionHarness, annotateTranscript, participantSpeakers, EVENT_TYPES, SESSION_PHASES } from "../public/session-harness.js";
import { validateTransition } from "../agent/session-router.mjs";

const transcript = annotateTranscript([
  { start: 0, end: 23, speaker: "[现场]", text: "五位成员沉默，等待开始。" },
  { start: 24, end: 36, speaker: "MooTu", text: "先玩一个击鼓传花，Pod 灯光依次接力。" },
  { start: 37, end: 47, speaker: "[设备]", text: "五个 Pod 依次点亮。" },
  { start: 55, end: 59, speaker: "A", text: "那我先来吧。" },
  { start: 60, end: 70, speaker: "B", text: "我有一个城市解谜的想法。" },
  { start: 71, end: 80, speaker: "C", text: "可以缩小到市集。" },
  { start: 81, end: 90, speaker: "D", text: "我想保留拼合体验。" },
  { start: 91, end: 100, speaker: "E", text: "现场声音不要太吵。" },
  { start: 894, end: 903, speaker: "[现场]", text: "讨论即将结束，切换到方案确认。" },
  { start: 904, end: 918, speaker: "MooTu", text: "现在有三个选择：一，感官集章；二，真实声音；三，秘密任务。请大家用 Pod 投票。" },
  { start: 936, end: 955, speaker: "[设备]", text: "A、B、C、D、E 依次按下各自的 Pod 完成投票。" },
  { start: 964, end: 976, speaker: "MooTu", text: "投票结束，五票支持方案二，大家一致选择真实声音。" },
  { start: 1013, end: 1023, speaker: "MooTu", text: "大家达成一致，今天的讨论到这里结束。" }
]);

test("system and robot events do not become participants", () => {
  assert.deepEqual(participantSpeakers(transcript), ["A", "B", "C", "D", "E"]);
  assert.equal(transcript[0].type, EVENT_TYPES.SCENE_EVENT);
  assert.equal(transcript[1].type, EVENT_TYPES.ROBOT_UTTERANCE);
  assert.equal(transcript[2].type, EVENT_TYPES.DEVICE_EVENT);
});

test("session harness maps five participants to five pods and derives the full journey", () => {
  const harness = createSessionHarness({ transcript, participants: participantSpeakers(transcript).map((id) => ({ id, name: id })) });
  assert.equal(harness.setTime(0).phase, SESSION_PHASES.WAITING);
  assert.equal(harness.setTime(24).phase, SESSION_PHASES.ICEBREAKER);
  assert.equal(harness.setTime(55).phase, SESSION_PHASES.ICEBREAKER);
  assert.equal(harness.setTime(60).phase, SESSION_PHASES.DISCUSSION);
  assert.equal(harness.setTime(894).phase, SESSION_PHASES.BALLOT_PREPARATION);
  assert.equal(harness.blackboard.activeAgent, "discussion_facilitator");
  assert.equal(harness.blackboard.discussionStage, "converge");
  assert.deepEqual(harness.blackboard.coactiveAgents, ["discussion_facilitator", "candidate_synthesis"]);
  assert.equal(harness.setTime(904).phase, SESSION_PHASES.VOTING);
  assert.equal(harness.setTime(964).phase, SESSION_PHASES.RESULT_CONFIRMATION);
  assert.equal(harness.setTime(1013).phase, SESSION_PHASES.CLOSED);
  assert.equal(harness.blackboard.podMap.length, 5);
  assert.equal(harness.blackboard.candidates.items.length, 3);
});

test("event log stays immutable while scoped agent views stay compact", () => {
  const harness = createSessionHarness({ transcript });
  assert.ok(Object.isFrozen(harness.eventLog));
  assert.throws(() => harness.eventLog.push({}), TypeError);
  harness.setTime(100, "diverge");
  const view = harness.getAgentView("discussion_facilitator");
  assert.ok(view.recentUtterances.length <= 8);
  assert.equal("eventLog" in view, false);
});

test("global harness guards voting until a candidate snapshot exists", () => {
  const result = validateTransition({ from: SESSION_PHASES.BALLOT_PREPARATION, to: SESSION_PHASES.VOTING, blackboard: { candidates: { items: [] } } });
  assert.equal(result.allowed, false);
});

test("a long silent opening triggers the icebreaker before the first participant speaks", () => {
  const harness = createSessionHarness({ transcript: annotateTranscript([
    { start: 0, end: 20, speaker: "[现场]", text: "所有成员保持沉默。" },
    { start: 25, end: 30, speaker: "A", text: "我先说一个想法。" }
  ]) });
  assert.equal(harness.setTime(17).phase, SESSION_PHASES.WAITING);
  assert.equal(harness.setTime(18).phase, SESSION_PHASES.ICEBREAKER);
});

test("candidate synthesis evolves in parallel with discussion without reading future events", () => {
  const harness = createSessionHarness({ transcript });
  const early = harness.setTime(80, "diverge");
  assert.deepEqual(early.coactiveAgents, ["discussion_facilitator", "candidate_synthesis"]);
  assert.equal(early.candidates.status, "evolving");
  assert.ok(early.candidates.items.length > 0);
  assert.ok(early.candidates.items.every((item) => item.label.length <= 8));
  assert.equal(early.candidates.items.some((item) => item.label.includes("真实声音")), false);
});

test("DeepSeek candidate names replace transcript fragments until the explicit ballot is spoken", () => {
  const harness = createSessionHarness({ transcript, candidateIdeas: ["感官集章", "声音AI合成", "秘密任务"] });
  assert.deepEqual(harness.setTime(700, "converge").candidates.items.map((item) => item.label), ["感官集章", "声音AI合成", "秘密任务"]);
  assert.ok(harness.setTime(700).candidates.items.every((item) => item.source === "deepseek"));
  assert.deepEqual(harness.setTime(904).candidates.items.map((item) => item.label), ["感官集章", "真实声音", "秘密任务"]);
});

test("participant questions about voting do not prematurely enter or freeze the ballot", () => {
  const earlyVoteQuestion = annotateTranscript([
    ...transcript.slice(0, 9),
    { start: 500, end: 510, speaker: "E", text: "屏幕会显示哪个方案，我们按 Pod 吗？" },
    ...transcript.slice(9)
  ]);
  const harness = createSessionHarness({ transcript: earlyVoteQuestion, candidateIdeas: ["感官集章", "声音AI合成", "秘密任务"] });
  assert.notEqual(harness.setTime(500, "converge").phase, SESSION_PHASES.VOTING);
  assert.equal(harness.setTime(904).phase, SESSION_PHASES.VOTING);
});

test("an explicit participant vote statement enters the voting workflow", () => {
  const spokenVote = annotateTranscript([
    ...transcript.slice(0, 8),
    { start: 500, end: 510, speaker: "A", text: "我先投收集加组合，实体交互最完整。" },
    ...transcript.slice(8)
  ]);
  const harness = createSessionHarness({ transcript: spokenVote, candidateIdeas: ["感官集章", "声音AI合成", "秘密任务"] });
  assert.equal(harness.setTime(499, "converge").phase, SESSION_PHASES.DISCUSSION);
  assert.equal(harness.setTime(500, "converge").phase, SESSION_PHASES.VOTING);
  assert.equal(harness.blackboard.activeWorkflow, "voting");
  assert.equal(harness.blackboard.candidates.status, "ai_synthesized");
});

test("spoken voting waits for AI candidates instead of freezing transcript fragments", () => {
  const spokenVote = annotateTranscript([
    ...transcript.slice(0, 8),
    { start: 500, end: 510, speaker: "A", text: "我先投收集加组合，实体交互最完整。" },
    ...transcript.slice(8)
  ]);
  const harness = createSessionHarness({ transcript: spokenVote });
  assert.equal(harness.setTime(500, "converge").phase, SESSION_PHASES.VOTING);
  assert.equal(harness.blackboard.candidates.status, "pending_ai");
  assert.equal(harness.blackboard.candidates.items.length, 0);
});

test("voting freezes one candidate snapshot through result confirmation", () => {
  const harness = createSessionHarness({ transcript });
  const voting = harness.setTime(904).candidates;
  const result = harness.setTime(976).candidates;
  const closed = harness.setTime(1023).candidates;
  assert.strictEqual(result, voting);
  assert.strictEqual(closed, voting);
  assert.deepEqual(result.items.map((item) => item.label), voting.items.map((item) => item.label));
});
