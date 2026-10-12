import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateContextualUtterance, runAgent } from "../public/agent-engine.js";

const config = JSON.parse(await readFile(new URL("../public/config/actions.json", import.meta.url), "utf8"));
const sample = JSON.parse(await readFile(new URL("../public/data/sample-session.json", import.meta.url), "utf8"));

test("presentation playback keeps the five-times demo speed", () => {
  assert.equal(config.display.timeline_speed_multiplier, 5);
});

test("sample discussion produces bounded metrics and a convergence transition", () => {
  const result = runAgent({ transcript: sample.transcript, participants: sample.participants, duration: sample.duration, config });
  assert.ok(result.events.length >= 5);
  assert.ok(result.events.some((event) => event.strategy === "prepare_convergence"));
  assert.equal(result.events[1].diagnostics.participation_basis, "70% speaking duration + 30% turn count");
  assert.ok(result.events[1].diagnostics.turn_counts);
  result.events.forEach((event) => {
    Object.values(event.metrics).forEach((value) => assert.ok(value >= 0 && value <= 100));
  });
});

test("a persistently quiet member is invited after enough observable evidence", () => {
  const transcript = [
    { start: 2, end: 18, speaker: "A", text: "我们可以先做一个空间方案。" },
    { start: 20, end: 36, speaker: "B", text: "也许可以增加预约和灯光。" },
    { start: 42, end: 58, speaker: "A", text: "或者尝试一条安静路线。" },
    { start: 62, end: 78, speaker: "B", text: "这个方向还可以加上植物。" },
    { start: 82, end: 98, speaker: "A", text: "我们也可以设计一个地图。" }
  ];
  const participants = ["A", "B", "C"].map((id) => ({ id, name: id }));
  const result = runAgent({ transcript, participants, duration: 120, config });
  assert.ok(result.events.some((event) => event.strategy === "invite_quiet_member" && event.target === "C"));
});

test("intervention utterances reuse the latest discussion content", () => {
  const utterance = generateContextualUtterance({
    strategy: "open_new_direction",
    stage: "diverge",
    transcript: [{ speaker: "A", text: "我们可以保留陶瓷敲击的声音。" }]
  });
  assert.match(utterance, /陶瓷敲击/);
  assert.match(utterance, /不同的视角/);
});
