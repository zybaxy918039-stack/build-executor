import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const UPSTREAM_WS_URL = process.env.BUILD_UPSTREAM_WS_URL || "wss://gcli.ggchan.dev/api/build/ws";
const UPSTREAM_API_KEY = String(process.env.BUILD_UPSTREAM_API_KEY || "").trim();
const GOOGLE_API_KEY = String(process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
const LOCAL_API_KEY = String(process.env.LOCAL_API_KEY || "").trim();
const CLIENT_VERSION = process.env.BUILD_CLIENT_VERSION || "0.0.1";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

if (!UPSTREAM_API_KEY) console.warn("[build] BUILD_UPSTREAM_API_KEY is not set");

const pending = new Map();
let socket = null;
let registered = false;
let reconnectTimer = null;
let reconnectDelay = 1000;
let connectWaiters = [];

const authOK = (req) => !LOCAL_API_KEY || req.headers.authorization === `Bearer ${LOCAL_API_KEY}` || req.headers["x-api-key"] === LOCAL_API_KEY;
const fail = (status, message, code = "proxy_error") => ({ error: { code, message, status } });
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
function rejectPending(error) {
  for (const [id, item] of pending) { item.error?.(error); pending.delete(id); }
  for (const waiter of connectWaiters.splice(0)) waiter.reject(error);
}
function scheduleReconnect() {
  if (reconnectTimer || registered) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectUpstream().catch(scheduleReconnect); }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}
function connectUpstream() {
  if (registered && socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (socket?.readyState === WebSocket.CONNECTING) return new Promise((resolve, reject) => connectWaiters.push({ resolve, reject }));
  if (!UPSTREAM_API_KEY) return Promise.reject(new Error("BUILD_UPSTREAM_API_KEY is not configured"));
  return new Promise((resolve, reject) => {
    connectWaiters.push({ resolve, reject });
    const current = new WebSocket(UPSTREAM_WS_URL);
    socket = current;
    current.on("open", () => current.send(JSON.stringify({ type: "register", clientVersion: CLIENT_VERSION, apiKey: UPSTREAM_API_KEY })));
    current.on("message", (raw) => handleUpstreamMessage(raw));
    current.on("error", (error) => { if (!registered) for (const waiter of connectWaiters.splice(0)) waiter.reject(error); });
    current.on("close", () => {
      if (socket !== current) return;
      socket = null; registered = false; rejectPending(new Error("upstream connection closed")); scheduleReconnect();
    });
  });
}
function handleUpstreamMessage(raw) {
  let message; try { message = JSON.parse(String(raw)); } catch { return; }
  if (message.type === "registered") {
    registered = true; reconnectDelay = 1000;
    for (const waiter of connectWaiters.splice(0)) waiter.resolve();
    console.log("[build] upstream connected"); return;
  }
  if (message.type === "error" && !message.requestId) {
    const error = new Error(String(message.message || "upstream registration failed"));
    for (const waiter of connectWaiters.splice(0)) waiter.reject(error); socket?.close(); return;
  }
  if (message.type === "request") return executeWorkerRequest(message).catch((error) => sendWorkerError(message, error));
  const item = pending.get(String(message.requestId || "")); if (!item) return;
  if (message.type === "response") return item.resolve({ status: message.status || 200, body: message.responseBody || "{}" });
  if (message.type === "stream-chunk") return item.chunk?.(String(message.chunkBody || ""));
  if (message.type === "stream-end") return item.resolve({ status: message.status || 200 });
  if (message.type === "error" || message.type === "stream-error") {
    const error = new Error(String(message.error?.message || message.message || "upstream request failed"));
    error.status = Number(message.status || message.error?.status || 502); error.body = message.error?.body || ""; return item.error?.(error);
  }
}
async function executeWorkerRequest(message) {
  const requestId = String(message.requestId || "");
  const model = String(message.model || "");
  const body = String(message.requestBody || "");
  const issue = validate(model, body);
  if (!requestId || issue) return sendWorkerError(message, Object.assign(new Error(issue || "invalid request"), { status: 400 }));
  const response = await callGoogle(model, message.stream === true, body);
  if (!response.ok) return sendWorkerError(message, Object.assign(new Error(await response.text()), { status: response.status }));
  if (message.stream === true) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Google returned no stream body");
    const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator;
      while ((separator = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const event = buffer.slice(0, separator); buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, "");
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
        if (data && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stream-chunk", requestId, chunkBody: data }));
      }
      if (done) break;
    }
    return socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "stream-end", requestId, status: response.status }));
  }
  const responseBody = await response.text();
  return socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "response", requestId, status: response.status, responseBody }));
}
async function sendWorkerError(message, error) {
  if (socket?.readyState !== WebSocket.OPEN || !message.requestId) return;
  socket.send(JSON.stringify({ type: message.stream === true ? "stream-error" : "error", requestId: message.requestId, status: error.status || 502, error: { code: "google_request_failed", message: error.message, body: "" } }));
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body too large"), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks).toString("utf8");
}
function validate(model, body) {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(model)) return "invalid model name";
  let payload; try { payload = JSON.parse(body); } catch { return "request body must be valid JSON"; }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.contents)) return "request body must contain a contents array";
  return null;
}
async function proxyGemini(req, res, model, stream) {
  const body = await readBody(req); const validationError = validate(model, body);
  if (validationError) return json(res, 400, fail(400, validationError, "invalid_request"));
  if (!GOOGLE_API_KEY) return json(res, 503, fail(503, "GEMINI_API_KEY/API_KEY is not configured", "missing_google_api_key"));
  const response = await callGoogle(model, stream, body);
  if (stream) {
    const responseBody = response.body;
    if (!responseBody) return json(res, 502, fail(502, "Google returned no stream body"));
    res.writeHead(response.status, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    if (!response.ok) return res.end(`event: error\ndata: ${JSON.stringify(fail(response.status, await response.text()))}\n\n`);
    for await (const chunk of responseBody) res.write(chunk);
    return res.end();
  }
  const responseBody = await response.text();
  res.writeHead(response.status, { "content-type": "application/json; charset=utf-8" });
  return res.end(responseBody);
}
function callGoogle(model, stream, requestBody) {
  const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GOOGLE_API_KEY }, body: requestBody });
}
async function handler(req, res) {
  if (req.url === "/health") return json(res, 200, { ok: true, upstream: registered, pending: pending.size });
  if (!authOK(req)) return json(res, 401, fail(401, "unauthorized", "unauthorized"));
  const match = req.url?.match(/^\/v1beta\/models\/([^:/?]+):(generateContent|streamGenerateContent)(?:\?alt=sse)?$/);
  if (req.method === "POST" && match) {
    try { return await proxyGemini(req, res, decodeURIComponent(match[1]), match[2] === "streamGenerateContent"); }
    catch (error) { return json(res, error.status || 502, fail(error.status || 502, error.message)); }
  }
  return json(res, 404, fail(404, "not found", "not_found"));
}
const server = http.createServer((req, res) => handler(req, res).catch((error) => json(res, 500, fail(500, error.message))));
server.listen(PORT, HOST, () => console.log(`[build] local API listening at http://${HOST}:${PORT}`));
connectUpstream().catch((error) => { console.warn(`[build] initial upstream connection failed: ${error.message}`); scheduleReconnect(); });
process.on("SIGINT", () => { socket?.close(); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { socket?.close(); server.close(() => process.exit(0)); });