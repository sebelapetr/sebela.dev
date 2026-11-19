// The content-management path over real sockets: the official SDK client -> MCP Admin -> the real
// API on a temporary database seeded from the fictional S02 fixture. Covers D18 (the API's audit
// names the verified key and the tool's provenance, with before and after) and the API's own
// dependency protection on a delete (D21), and media upload and attachment through the API's own
// inspection, storage driver and audit (D17, D18).
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureFolder, startApi } from "../evals/fixture.js";

import { startMcpAdminServer } from "./app.js";
import { readMcpAdminConfig } from "./config.js";
import { toolText } from "./test-support/index.js";

type RunningApi = Awaited<ReturnType<typeof startApi>>;

let api: RunningApi | undefined;
let mcp: { url: string; close: () => Promise<void> } | undefined;

beforeAll(async () => {
  api = await startApi({
    seedFolder: fixtureFolder("s02"),
    keyNames: ["owner"],
    env: { API_RATE_LIMIT_PRIVATE: "1000/60", API_RATE_LIMIT_KEY: "1000/60" },
  });
  const config = readMcpAdminConfig({
    ...process.env,
    MCP_ADMIN_PORT: "0",
    MCP_ADMIN_API_URL: api.url,
  });
  mcp = await startMcpAdminServer({ config, log: () => undefined });
});

afterAll(async () => {
  try {
    await mcp?.close();
  } finally {
    await api?.stop();
  }
});

async function connect(): Promise<Client> {
  const owner = api?.keys["owner"];
  if (!api || !mcp || !owner) throw new Error("The fixture did not start.");
  const client = new Client({ name: "mcp-admin-e2e", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${mcp.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${owner.key}` } },
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, json: JSON.parse(toolText(result)) as unknown };
}

/** A fictional 2x2 PNG and a minimal fictional PDF, as base64 the way a client passes a file. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGNoAAMGCAUAKg4GARWeQtcAAAAASUVORK5CYII=";
const PDF_TEXT =
  "%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
  "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n" +
  "trailer << /Root 1 0 R >>\n%%EOF\n";
const base64 = (text: string) => Buffer.from(text).toString("base64");

interface AuditChange {
  actor: { keyName: string };
  provenance: string | null;
  entity: string;
  record: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

describe("content management against the real API", () => {
  it("audits a profile change with the verified key, the tool's provenance and before/after", async () => {
    const client = await connect();
    const before = (await call(client, "get", { entity: "person" })).json as { headline: string };

    const saved = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { headline: "Software engineer" },
    });
    const recent = await call(client, "recent_changes", {});
    await client.close();

    expect(saved.isError).toBe(false);
    expect(saved.json).toMatchObject({
      entity: "person",
      action: "updated",
      record: { headline: "Software engineer" },
    });
    const { changes } = recent.json as {
      changes: {
        actor: { keyName: string };
        provenance: string | null;
        entity: string;
        action: string;
        before: { headline?: string } | null;
        after: { headline?: string } | null;
      }[];
    };
    expect(changes[0]).toMatchObject({
      actor: { keyName: "owner" },
      entity: "person",
      action: "updated",
      before: { headline: before.headline },
      after: { headline: "Software engineer" },
    });
    expect(changes[0]?.provenance).toMatch(/^mcp-admin\/save\/[0-9a-f]{12}$/);
  });

  it("leaves a project others depend on in place and reports why", async () => {
    const client = await connect();

    const refused = await call(client, "delete", { entity: "project", id: "cedar-portal-billing" });
    const still = await call(client, "get", { entity: "project", id: "cedar-portal-billing" });
    await client.close();

    expect(refused.isError).toBe(true);
    expect(refused.json).toMatchObject({ error: { code: "conflict" } });
    expect((refused.json as { error: { message: string } }).error.message).toContain(
      "cedar-portal-billing",
    );
    expect(still.isError).toBe(false);
  });

  it("uploads the caller's photo, attaches the returned ID and audits both with the key", async () => {
    const client = await connect();

    const uploaded = await call(client, "upload", {
      fileName: "portrait.png",
      contentBase64: PNG,
      altText: "A fictional portrait.",
    });
    const id = (uploaded.json as { id: string }).id;
    const saved = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { photoId: id },
    });
    const recent = await call(client, "recent_changes", {});
    await client.close();
    const person = (await (await fetch(`${api?.url ?? ""}/v1/person`)).json()) as {
      photoId: string | null;
    };

    expect(uploaded.isError).toBe(false);
    expect(uploaded.json).toMatchObject({
      entity: "media",
      action: "created",
      record: { id, mediaType: "image/png", altText: "A fictional portrait." },
    });
    expect(saved.isError).toBe(false);
    expect(person.photoId).toBe(id);
    const { changes } = recent.json as { changes: AuditChange[] };
    const created = changes.find((change) => change.entity === "media" && change.record === id);
    expect(created).toMatchObject({ actor: { keyName: "owner" }, action: "created" });
    expect(created?.provenance).toMatch(/^mcp-admin\/upload\/[0-9a-f]{12}$/);
    expect(JSON.stringify(created)).not.toContain(PNG);
    expect(changes[0]).toMatchObject({
      actor: { keyName: "owner" },
      entity: "person",
      action: "updated",
      after: { photoId: id },
    });
  });

  it("keeps the current CV when a replacement is malformed, mistyped or traversal-shaped", async () => {
    const client = await connect();
    const first = await call(client, "upload", {
      fileName: "cv.pdf",
      contentBase64: base64(PDF_TEXT),
    });
    const cvPdfId = (first.json as { id: string }).id;
    await call(client, "save", { entity: "person", action: "update", fields: { cvPdfId } });
    const listed = async () =>
      (await (await fetch(`${api?.url ?? ""}/v1/media`)).json()) as
        { items?: unknown[] } | unknown[];
    const mediaBefore = JSON.stringify(await listed());

    const refusals = [
      await call(client, "upload", {
        fileName: "cv.pdf",
        contentBase64: base64(PDF_TEXT.replace("%%EOF\n", "")),
      }),
      await call(client, "upload", { fileName: "cv.pdf", contentBase64: PNG }),
      await call(client, "upload", { fileName: "notes.pdf", contentBase64: base64("not a PDF") }),
      await call(client, "upload", { fileName: "../../cv.pdf", contentBase64: base64(PDF_TEXT) }),
    ];
    const person = (await call(client, "get", { entity: "person" })).json as {
      cvPdfId: string | null;
    };
    await client.close();

    for (const refused of refusals) {
      expect(refused.isError).toBe(true);
      expect(refused.json).toMatchObject({ error: { code: "field" } });
    }
    expect(person.cvPdfId).toBe(cvPdfId);
    expect(JSON.stringify(await listed())).toBe(mediaBefore);
  });
});
