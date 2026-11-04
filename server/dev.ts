import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleCollect, handleDisburse, handleStatus, handleWebhook } from "./handlers";
import type { ServerEnv } from "./dgateway";
import { json } from "./http";

const env = process.env as ServerEnv;
const port = Number(process.env.PORT || 8787);

async function toRequest(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, String(value));
  }
  const host = req.headers.host || `127.0.0.1:${port}`;
  const url = `http://${host}${req.url || "/"}`;
  return new Request(url, {
    method: req.method || "GET",
    headers,
    body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : body,
  });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const path = new URL(request.url).pathname;
    let response: Response;
    if (path === "/api/health") response = json(request, { ok: true, service: "tank-payments-api" });
    else if (path === "/api/payments/collect") response = await handleCollect(request, env);
    else if (path === "/api/payments/disburse") response = await handleDisburse(request, env);
    else if (path === "/api/webhooks/dgateway") response = await handleWebhook(request, env);
    else {
      const match = path.match(/^\/api\/payments\/([^/]+)\/status$/);
      if (match) response = await handleStatus(request, env, decodeURIComponent(match[1]));
      else response = json(request, { ok: false, error: "Not found." }, 404);
    }
    await send(res, response);
  } catch (err) {
    console.error("payments-api dev server error", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Internal server error." }));
    } else res.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`TANK payments API listening on http://0.0.0.0:${port}`);
});
