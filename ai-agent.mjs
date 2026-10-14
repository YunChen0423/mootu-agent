import { buildObservations, runAgent } from "./public/agent-engine.js";
import { runPiBatchAgent, runPiLiveAgent } from "./agent/pi-runtime.mjs";

const defaultEnv = (name, fallback = "") => typeof process === "undefined" ? fallback : (process.env[name] || fallback);

export async function runAIAgent({
  transcript,
  participants = [],
  duration,
  discussionStart = 0,
  config,
  apiKey = defaultEnv("DEEPSEEK_API_KEY"),
  baseUrl = defaultEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
  model = defaultEnv("DEEPSEEK_MODEL", "deepseek-chat"),
  streamFn,
  modelDefinition
}) {
  if (!apiKey && !streamFn) {
    const analysis = runAgent({ transcript, participants, duration, discussionStart, config });
    return { mode: "fallback", model, architecture: "pi", analysis, events: analysis.events, trace: [] };
  }
  const observations = buildObservations({ transcript, participants, duration, discussionStart, config });
  const { analysis, trace, execution } = await runPiBatchAgent({ observations, participants, config, apiKey, baseUrl, model, streamFn, modelDefinition });
  return { mode: "deepseek", model, architecture: "pi", analysis, events: analysis.events, trace, execution };
}

export async function decideLiveWithAI({
  transcript = [],
  participants = [],
  stage = "diverge",
  signal = {},
  memory = [],
  config,
  apiKey = defaultEnv("DEEPSEEK_API_KEY"),
  baseUrl = defaultEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
  model = defaultEnv("DEEPSEEK_MODEL", "deepseek-chat"),
  streamFn,
  modelDefinition
}) {
  if (!apiKey && !streamFn) return { mode: "fallback", architecture: "pi", decision: null, trace: [] };
  const result = await runPiLiveAgent({ transcript, participants, stage, signal, memory, config, apiKey, baseUrl, model, streamFn, modelDefinition });
  return { mode: "deepseek", architecture: "pi", ...result };
}
