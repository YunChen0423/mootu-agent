import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { generateContextualUtterance } from "./public/agent-engine.js";
import { decideLiveWithAI, runAIAgent } from "./ai-agent.mjs";

const root = join(process.cwd(), "public");
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function generateMessage(payload) {
  const localUtterance = generateContextualUtterance(payload);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || payload.strategy === "observe") return { mode: "local", utterance: localUtterance };
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      response_format: { type: "json_object" },
      temperature: 0.45,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: "你是 MooTu 小组讨论主持机器人。根据最近的真实讨论生成一句自然、具体、简短的中文介入语。邀请低参与成员时，必须点出最近讨论中的具体话题或方案，再向目标成员提出与该话题直接相关的开放问题；禁止套用‘讨论在继续’‘你更支持哪个方向’等固定模板。不得捏造讨论中未出现的事实，不输出分析过程，不超过45个汉字。严格输出 JSON：{\"utterance\":string}。"
        },
        {
          role: "user",
          content: `阶段：${payload.stage}\n策略：${payload.strategy}\n目标成员：${payload.target || "无"}\n最近讨论：${JSON.stringify((payload.transcript || []).slice(-6))}`
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  const result = await response.json();
  const parsed = JSON.parse(result.choices?.[0]?.message?.content || "{}");
  return { mode: "deepseek", utterance: String(parsed.utterance || localUtterance).trim().slice(0, 80) };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, {
        mode: process.env.DEEPSEEK_API_KEY ? "deepseek" : "fallback",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        architecture: "pi",
        capabilities: process.env.DEEPSEEK_API_KEY ? ["tool_loop", "understand", "decide", "speak", "reflect"] : ["rule_fallback"]
      });
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const payload = await readBody(req);
      if (!Array.isArray(payload.transcript) || !payload.transcript.length) return json(res, 400, { error: "transcript 必须是非空数组" });
      const config = JSON.parse(await readFile(join(root, "config/actions.json"), "utf8"));
      const duration = Number(payload.duration) || Math.max(...payload.transcript.map((line) => Number(line.end) || 0));
      const result = await runAIAgent({
        transcript: payload.transcript,
        participants: payload.participants || [],
        duration,
        discussionStart: Number(payload.discussionStart) || 0,
        config
      });
      return json(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/agent/decide") {
      const payload = await readBody(req);
      const config = JSON.parse(await readFile(join(root, "config/actions.json"), "utf8"));
      return json(res, 200, await decideLiveWithAI({ ...payload, config }));
    }
    if (req.method === "POST" && url.pathname === "/api/generate-message") {
      const payload = await readBody(req);
      if (!Array.isArray(payload.transcript)) return json(res, 400, { error: "transcript 必须是数组" });
      if (!payload.strategy) return json(res, 400, { error: "strategy 不能为空" });
      return json(res, 200, await generateMessage(payload));
    }

    let requested = url.pathname === "/" ? "/index.html" : url.pathname;
    requested = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    const file = join(root, requested);
    if (!file.startsWith(root)) return json(res, 403, { error: "Forbidden" });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`MooTu Agent running at http://localhost:${port}`);
});
