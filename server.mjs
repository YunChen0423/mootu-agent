import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

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

async function analyzeWithDeepSeek(payload) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1600,
      messages: [
        {
          role: "system",
          content: `你是 MooTu 小组创意讨论促进 Agent 的语义分析器。只分析证据，不直接控制硬件。输出 JSON：{\"summary\":string,\"idea_clusters\":[string],\"recent_novelty\":\"high|medium|low\",\"flow_interpretation\":string,\"suggested_stage\":\"diverge|converge\",\"confidence\":number}。不得从视频或文本猜测生理状态。`
        },
        {
          role: "user",
          content: `请以 JSON 分析这段带说话人的创意讨论逐字稿：\n${JSON.stringify(payload.transcript)}`
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return JSON.parse(result.choices?.[0]?.message?.content || "{}");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, {
        mode: process.env.DEEPSEEK_API_KEY ? "deepseek" : "mock",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat"
      });
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const payload = await readBody(req);
      if (!Array.isArray(payload.transcript)) return json(res, 400, { error: "transcript 必须是数组" });
      const analysis = await analyzeWithDeepSeek(payload);
      return json(res, 200, { mode: analysis ? "deepseek" : "mock", analysis });
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
