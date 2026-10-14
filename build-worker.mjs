import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const assetNames = ["index.html", "styles.css", "enhancements.css", "app.js", "agent-engine.js", "session-harness.js", "live-sensing.js", "browser-mujoco.js", "mujoco/exact-physics-model.xml", "config/actions.json", "data/sample-session.json"];
const assets = {};
for (const name of assetNames) assets[`/${name}`] = await readFile(`public/${name}`, "utf8");
const binaryAssets = {
  "/mujoco/visuals-exact-v4.bin.gz": (await readFile("public/mujoco/visuals-exact-v4.bin.gz")).toString("base64")
};
const config = JSON.parse(assets["/config/actions.json"]);

const worker = `import { decideLiveWithAI, runAIAgent } from "./ai-agent.mjs";
import { generateContextualUtterance } from "./public/agent-engine.js";

const ASSETS = ${JSON.stringify(assets)};
const BINARY_ASSETS = ${JSON.stringify(binaryAssets)};
const CONFIG = ${JSON.stringify(config)};
const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8" };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": TYPES.json } });
const modelOptions = (env) => ({ apiKey: env.DEEPSEEK_API_KEY || "", baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model: env.DEEPSEEK_MODEL || "deepseek-chat" });

async function generateMessage(payload, env) {
  const local = generateContextualUtterance(payload);
  if (!env.DEEPSEEK_API_KEY || payload.strategy === "observe") return { mode: "fallback", utterance: local };
  const response = await fetch((env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\\/$/, "") + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.DEEPSEEK_API_KEY }, body: JSON.stringify({ model: env.DEEPSEEK_MODEL || "deepseek-chat", response_format: { type: "json_object" }, temperature: .4, max_tokens: 120, messages: [{ role: "system", content: "根据最近讨论生成一句自然、具体、不超过45个汉字的中文主持介入语。严格输出 JSON：{\\\"utterance\\\":string}。" }, { role: "user", content: JSON.stringify(payload) }] }) });
  if (!response.ok) throw new Error("DeepSeek " + response.status);
  const data = await response.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  return { mode: "deepseek", utterance: String(parsed.utterance || local).trim().slice(0, 80) };
}

export default { async fetch(request, env) {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/status") return reply({ mode: env.DEEPSEEK_API_KEY ? "deepseek" : "fallback", model: env.DEEPSEEK_MODEL || "deepseek-chat", architecture: "pi", capabilities: env.DEEPSEEK_API_KEY ? ["tool_loop", "understand", "decide", "speak", "reflect"] : ["rule_fallback"] });
    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const payload = await request.json();
      if (!Array.isArray(payload.transcript) || !payload.transcript.length) return reply({ error: "transcript 必须是非空数组" }, 400);
      const duration = Number(payload.duration) || Math.max(...payload.transcript.map((line) => Number(line.end) || 0));
      return reply(await runAIAgent({ transcript: payload.transcript, participants: payload.participants || [], duration, discussionStart: Number(payload.discussionStart) || 0, config: CONFIG, ...modelOptions(env) }));
    }
    if (request.method === "POST" && url.pathname === "/api/agent/decide") return reply(await decideLiveWithAI({ ...(await request.json()), config: CONFIG, ...modelOptions(env) }));
    if (request.method === "POST" && url.pathname === "/api/generate-message") return reply(await generateMessage(await request.json(), env));
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const encoded = BINARY_ASSETS[path];
    if (encoded != null) {
      const raw = atob(encoded);
      const body = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) body[index] = raw.charCodeAt(index);
      return new Response(body, { headers: { "content-type": "application/gzip", "cache-control": "public, max-age=31536000, immutable" } });
    }
    const content = ASSETS[path];
    if (content == null) return new Response("Not found", { status: 404 });
    const extension = path.split(".").pop();
    return new Response(content, { headers: { "content-type": TYPES[extension] || "text/plain; charset=utf-8", "cache-control": extension === "html" ? "no-cache" : "public, max-age=300" } });
  } catch (error) { return reply({ error: error.message || "Agent request failed" }, 500); }
} };
`;

await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await build({
  stdin: { contents: worker, resolveDir: process.cwd(), sourcefile: "worker-entry.js", loader: "js" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/server/index.js"
});
await writeFile("dist/.openai/hosting.json", await readFile(".openai/hosting.json", "utf8"));
console.log("pi-based Sites Worker bundled to dist/");
