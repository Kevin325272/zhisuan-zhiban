import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8327);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function recognition() {
  return {
    status: "recognized",
    subject: "data_structures",
    question_type: "choice",
    question_text: "队列遵循什么原则？",
    options: [
      { label: "A", text: "先进先出" },
      { label: "B", text: "先进后出" },
    ],
    formulae: [],
    diagram_description: null,
    knowledge_keywords: ["队列", "先进先出"],
    warnings: ["请核对题干与选项文字。"],
  };
}

function explanation(depth) {
  return {
    depth,
    summary: "先判断队列的基本操作约束。",
    knowledge_points: [],
    approach: ["比较元素进入与离开的先后顺序"],
    steps: depth === "direction" ? [] : ["先标出入队顺序", "再核对出队顺序"],
    self_check: "最先进入的元素何时离开？",
    final_answer: depth === "complete" ? "A. 先进先出" : null,
    uncertainty: null,
  };
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ready: true });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size <= 8 * 1024 * 1024) chunks.push(chunk);
  });
  request.on("end", () => {
    if (size > 8 * 1024 * 1024) {
      sendJson(response, 413, { error: "payload_too_large" });
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(response, 400, { error: "invalid_json" });
      return;
    }
    const model = typeof body.model === "string" ? body.model : "gpt-5.6-terra";
    const input = body.input;
    const requestedDepth = typeof input === "string"
      ? /"requested_depth":"(direction|steps|complete)"/u.exec(input)?.[1]
      : null;
    const output = requestedDepth
      ? explanation(requestedDepth)
      : Array.isArray(input)
        ? recognition()
        : null;
    if (!output) {
      sendJson(response, 422, { error: "unsupported_fixture_request" });
      return;
    }
    sendJson(response, 200, {
      model,
      output_text: JSON.stringify(output),
    });
  });
});

server.listen(port, "127.0.0.1");

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
