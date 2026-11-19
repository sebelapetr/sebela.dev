// @ts-check

/**
 * The controlled client adapter of the evals: the part of a supported MCP client that asks the
 * owner before a change. It sits between Promptfoo's MCP client and MCP Admin and forwards every
 * request unchanged, the caller's `Authorization` header included, except `tools/call` requests of
 * the write tools (`save`, `delete`, `upload`): those are forwarded only when the case's scripted owner
 * decision approves them. A declined call returns a `declined` tool error and never reaches MCP
 * Admin, so it makes no API call.
 *
 * The adapter also plays the case's controlled events: a scripted tool result instead of
 * forwarding (`inject`), and an edit by another caller right after a forwarded read
 * (`concurrent`). It logs tool names and decisions only, never arguments, headers or results.
 *
 * Batched JSON-RPC requests are refused, so no write can pass unseen.
 */
import { createServer } from "node:http";

import { matchesRule } from "./scenarios.js";

/** Tools that change content and need the owner's approval in the client. */
export const WRITE_TOOLS = Object.freeze(["save", "delete", "upload"]);

/** The tool result of a write the owner declined. */
export const DECLINED = Object.freeze({
  error: {
    code: "declined",
    message: "The owner declined this change in the client; nothing was sent.",
  },
});

/**
 * @typedef {{ tool: string, decision: "forwarded" | "declined" | "injected" }} LogEntry
 *
 * @typedef {object} ClientAdapterOptions
 * @property {string} target The MCP endpoint of MCP Admin.
 * @property {readonly import("./scenarios.js").ApprovalRule[]} approvals
 * @property {import("./scenarios.js").Injection} [inject]
 * @property {{ after: { tool: string, entity: string, id?: string }, run: () => Promise<void> }} [concurrent]
 * @property {string} [host] The loopback interface to listen on; the system picks the port.
 *
 * @typedef {object} ClientAdapter
 * @property {string} url The adapter's MCP endpoint.
 * @property {LogEntry[]} log
 * @property {() => Promise<void>} stop
 */

/**
 * Starts the adapter on a port the system picks.
 *
 * @param {ClientAdapterOptions} options
 * @returns {Promise<ClientAdapter>}
 */
export function startClientAdapter({ target, approvals, inject, concurrent, host }) {
  /** @type {LogEntry[]} */
  const log = [];
  let injected = 0;
  let concurrentDone = false;
  const targetUrl = new URL(target);

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  async function handle(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(/** @type {Buffer} */ (chunk));
    const body = Buffer.concat(chunks);
    const message = parseMessage(body);
    if (Array.isArray(message)) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Batched requests are not supported." }));
      return;
    }
    const call = toolCall(message);
    if (call) {
      if (inject && injected < inject.times && matchesRule(inject.match, call.tool, call.args)) {
        injected += 1;
        log.push({ tool: call.tool, decision: "injected" });
        return reply(response, call.id, inject.result);
      }
      if (
        WRITE_TOOLS.includes(call.tool) &&
        !approvals.some((rule) => matchesRule(rule, call.tool, call.args))
      ) {
        log.push({ tool: call.tool, decision: "declined" });
        return reply(response, call.id, DECLINED);
      }
      log.push({ tool: call.tool, decision: "forwarded" });
    }
    const forwarded = await forward(request, body);
    if (
      call &&
      concurrent &&
      !concurrentDone &&
      call.tool === concurrent.after.tool &&
      isRecord(call.args) &&
      call.args["entity"] === concurrent.after.entity &&
      (concurrent.after.id === undefined || call.args["id"] === concurrent.after.id)
    ) {
      concurrentDone = true;
      await concurrent.run();
    }
    response.writeHead(forwarded.status, forwarded.headers);
    response.end(forwarded.body);
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {Buffer} body
   */
  async function forward(request, body) {
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (HOP_BY_HOP.has(name) || value === undefined) continue;
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const method = request.method ?? "GET";
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      redirect: "manual",
      ...(method === "GET" || method === "HEAD" ? {} : { body }),
    });
    /** @type {Record<string, string>} */
    const responseHeaders = {};
    upstream.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name) && name !== "content-encoding") responseHeaders[name] = value;
    });
    return {
      status: upstream.status,
      headers: responseHeaders,
      body: Buffer.from(await upstream.arrayBuffer()),
    };
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host ?? targetUrl.hostname.replace(/^\[|\]$/g, ""), () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The client adapter has no port."));
        return;
      }
      const url = new URL(targetUrl.href);
      url.port = String(address.port);
      resolve({
        url: url.href,
        log,
        stop: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

/** Headers that belong to one connection and are never forwarded. */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

/**
 * @param {Buffer} body
 * @returns {unknown}
 */
function parseMessage(body) {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The tool call a JSON-RPC message makes, if it is one.
 *
 * @param {unknown} message
 * @returns {{ id: unknown, tool: string, args: unknown } | null}
 */
function toolCall(message) {
  if (!isRecord(message) || message["method"] !== "tools/call") return null;
  const params = message["params"];
  if (!isRecord(params)) return null;
  return { id: message["id"], tool: String(params["name"]), args: params["arguments"] };
}

/**
 * Answers a tool call in the client, as an error result when the JSON carries an error.
 *
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} id
 * @param {unknown} result
 */
function reply(response, id, result) {
  const isError = isRecord(result) && "error" in result;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }], isError },
    }),
  );
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
