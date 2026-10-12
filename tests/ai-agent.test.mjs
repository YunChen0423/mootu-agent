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
      { time: 0, stage: "diverge", strategy: "invent_strategy", title: "非法动作" },
      { time: 43, stage: "diverge", strategy: "open_new_direction", title: "打开新方向", reason: "想法开始重复", evidence: ["最近窗口未出现明显新方向"], follow_up: "观察是否出现新概念", expected_effect: "提升发散性", utterance: "如果把这个方案反过来，会发生什么？" }
    ] }) } }] })
  });
  const result = await runAIAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config, apiKey: "test", fetchImpl: fakeFetch });
  assert.equal(result.mode, "deepseek");
  assert.equal(result.events[0].strategy, "observe");
  assert.equal(result.events[1].strategy, "open_new_direction");
  assert.equal(result.events[1].decisionSource, "deepseek");
  assert.equal(result.events[1].expectedEffect, "提升发散性");
  assert.ok(result.events[1].metrics.participation >= 0 && result.events[1].metrics.participation <= 100);
});
