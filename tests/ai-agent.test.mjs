import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runAIAgent } from "../ai-agent.mjs";

const config = JSON.parse(await readFile(new URL("../public/config/actions.json", import.meta.url), "utf8"));
const sample = JSON.parse(await readFile(new URL("../public/data/sample-session.json", import.meta.url), "utf8"));

test("without a secret the agent is explicit about rule fallback", async () => {
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, apiKey: "" });
  assert.equal(result.mode, "fallback");
  assert.ok(result.events.every((event) => event.decisionSource === "rule_fallback"));
});

test("DeepSeek decisions are constrained by measured observations and action policy", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: "AI 已制定策略", events: [
      { time: 0, stage_recommendation: "diverge", candidates: [{ strategy: "invent_strategy", confidence: 99 }] },
      { time: 43, stage_recommendation: "diverge", evidence: ["最近窗口未出现明显新方向"], missing_evidence: [], candidates: [
        { strategy: "observe", title: "继续观察", rationale: "保留空间", benefit: 35, disruption: 0, goal_fit: 40, confidence: 75, follow_up: "等待", expected_effect: "保留空间" },
        { strategy: "open_new_direction", title: "打开新方向", rationale: "想法开始重复", benefit: 90, disruption: 15, goal_fit: 90, confidence: 85, follow_up: "观察是否出现新概念", expected_effect: "提升发散性", utterance: "如果把这个方案反过来，会发生什么？" }
      ] }
    ] }) } }] })
  });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, apiKey: "test", fetchImpl: fakeFetch });
  assert.equal(result.mode, "deepseek");
  assert.equal(result.events[0].strategy, "observe");
  assert.equal(result.events[1].strategy, "open_new_direction");
  assert.equal(result.events[1].decisionSource, "deepseek+harness");
  assert.equal(result.events[1].expectedEffect, "提升发散性");
  assert.equal(result.events[1].confidence, 85);
  assert.ok(result.events[1].selectionMargin >= 8);
  assert.equal(result.events[1].candidates.length, 2);
  assert.ok(result.events[1].metrics.participation >= 0 && result.events[1].metrics.participation <= 100);
});

test("Harness declines an intervention when its utility does not clearly beat observing", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ events: [{
    time: 43, stage_recommendation: "diverge", missing_evidence: ["尚未确认停顿是否自然"], candidates: [
      { strategy: "observe", benefit: 55, disruption: 0, goal_fit: 70, confidence: 80, rationale: "继续观察" },
      { strategy: "open_new_direction", benefit: 65, disruption: 30, goal_fit: 70, confidence: 65, rationale: "尝试启发" }
    ]
  }] }) } }] }) });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, apiKey: "test", fetchImpl: fakeFetch });
  assert.equal(result.events[1].strategy, "observe");
  assert.match(result.events[1].reason, /收益未明显高于打断成本/);
  assert.deepEqual(result.events[1].missingEvidence, ["尚未确认停顿是否自然"]);
});

test("Stage changes require two consecutive convergence recommendations", async () => {
  const content = JSON.stringify({ events: [
    { time: 0, stage_recommendation: "diverge", candidates: [{ strategy: "observe", benefit: 50, disruption: 0, goal_fit: 60, confidence: 80 }] },
    { time: 43, stage_recommendation: "converge", candidates: [{ strategy: "observe", benefit: 50, disruption: 0, goal_fit: 60, confidence: 80 }] },
    { time: 86, stage_recommendation: "converge", candidates: [{ strategy: "observe", benefit: 50, disruption: 0, goal_fit: 60, confidence: 80 }] }
  ] });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, apiKey: "test", fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) });
  assert.equal(result.events[1].stage, "diverge");
  assert.equal(result.events[2].stage, "converge");
});
