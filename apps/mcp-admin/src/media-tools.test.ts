// The `upload` tool and media attachment in-process, against the fake content API: the
// deterministic cases of .plan/done/05-mcp-admin/security.md for slice S04 that need no real API
// (D12, D13, D15, D17, D20). The real API's inspection, storage and audit are in
// content.e2e.test.ts (D17, D18).
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpAdminApp, type McpAdminApp } from "./app.js";
import {
  API_BASE,
  connectClient,
  fakeApi,
  FAKE_MEDIA_MAX_BYTES,
  KEY_A,
  testConfig,
  toolText,
  type FakeApi,
} from "./test-support/index.js";

/** A fictional 2x2 PNG and a minimal fictional PDF, as base64 the way a client passes a file. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGNoAAMGCAUAKg4GARWeQtcAAAAASUVORK5CYII=";
const PDF_TEXT =
  "%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
  "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n" +
  "trailer << /Root 1 0 R >>\n%%EOF\n";
const PDF = Buffer.from(PDF_TEXT).toString("base64");
/** A PDF cut off before its trailer: the API refuses it as malformed. */
const TRUNCATED_PDF = Buffer.from(PDF_TEXT.replace("%%EOF\n", "")).toString("base64");

const UPLOAD_PROVENANCE = /^mcp-admin\/upload\/[0-9a-f]{12}$/;

const opened: McpAdminApp[] = [];
const clients: Client[] = [];

async function open(api: FakeApi = fakeApi(), overrides: Record<string, string> = {}) {
  const admin = createMcpAdminApp({
    config: testConfig(overrides),
    fetch: api.fetch,
    log: () => undefined,
  });
  opened.push(admin);
  const client = await connectClient(admin.app.fetch, KEY_A);
  clients.push(client);
  return { api, client };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(opened.splice(0).map((admin) => admin.close()));
});

interface ToolOutcome {
  isError: boolean;
  text: string;
  json: unknown;
}

async function call(client: Client, name: string, args: unknown): Promise<ToolOutcome> {
  try {
    const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
    const text = toolText(result);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { isError: result.isError === true, text, json };
  } catch (error) {
    return { isError: true, text: String(error), json: null };
  }
}

function errorOf(outcome: ToolOutcome) {
  return (
    outcome.json as {
      error?: { code: string; message: string; fields?: { path: string; message: string }[] };
    } | null
  )?.error;
}

/** The uploads the fake API received. */
const uploads = (api: FakeApi) =>
  api.calls.filter((entry) => entry.method === "POST" && entry.url === `${API_BASE}/v1/media`);

describe("the upload tool", () => {
  it("is one more write tool with honest annotations and a strict input", async () => {
    const { client } = await open();

    const { tools } = await client.listTools();
    const upload = tools.find((tool) => tool.name === "upload");

    expect(tools).toHaveLength(13);
    expect(upload?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(upload?.inputSchema["additionalProperties"]).toBe(false);
    expect(Object.keys(upload?.inputSchema.properties ?? {}).sort()).toEqual([
      "altText",
      "contentBase64",
      "fileName",
    ]);
    expect(upload?.inputSchema.required?.sort()).toEqual(["contentBase64", "fileName"]);
  });

  it("sends the caller's bytes once as a multipart upload with the caller's key and a provenance", async () => {
    const { api, client } = await open();

    const outcome = await call(client, "upload", {
      fileName: "portrait.png",
      contentBase64: PNG,
      altText: "A fictional portrait.",
    });

    expect(outcome.isError).toBe(false);
    const [stored] = [...api.media.values()];
    expect(outcome.json).toMatchObject({
      entity: "media",
      id: stored?.id,
      action: "created",
      record: { id: stored?.id, mediaType: "image/png", altText: "A fictional portrait." },
    });
    const sent = uploads(api);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorization).toBe(`Bearer ${KEY_A}`);
    expect(sent[0]?.provenance).toMatch(UPLOAD_PROVENANCE);
    expect(sent[0]?.redirect).toBe("manual");
    const file = stored ? api.files.get(stored.id) : undefined;
    expect(Buffer.from(file?.bytes ?? []).toString("base64")).toBe(PNG);
    expect(file?.name).toBe("portrait.png");
    expect(api.changes.at(-1)).toMatchObject({
      entity: "media",
      record: stored?.id,
      action: "created",
      actor: { keyName: "fixture-a" },
      provenance: sent[0]?.provenance,
    });
  });

  it("returns the media record, never the file's bytes or the caller's key (D15)", async () => {
    const { client } = await open();

    const outcome = await call(client, "upload", { fileName: "cv.pdf", contentBase64: PDF });

    expect(outcome.isError).toBe(false);
    expect(outcome.text).not.toContain(PDF);
    expect(outcome.text).not.toContain(KEY_A);
    expect(outcome.text).not.toContain("%PDF");
  });

  it("does not send the same upload twice when called twice; each call is its own upload", async () => {
    const { api, client } = await open();

    await call(client, "upload", { fileName: "a.png", contentBase64: PNG });
    await call(client, "upload", { fileName: "b.png", contentBase64: PNG });

    const sent = uploads(api);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.provenance).not.toBe(sent[1]?.provenance);
  });
});

describe("only the caller's bytes are uploaded (D13)", () => {
  it.each([
    ["a relative path", "../../etc/passwd.png"],
    ["an absolute path", "/srv/media/portrait.png"],
    ["a Windows path", "C:\\Users\\owner\\portrait.png"],
    ["a backslash traversal", "..\\portrait.png"],
    ["an address", "https://files.example.test/portrait.png"],
    ["a file address", "file:portrait.png"],
    ["a hidden name", ".portrait.png"],
    ["a control character", "portrait\n.png"],
    ["an empty name", ""],
  ])("refuses %s as the file name before any request", async (_label, fileName) => {
    const { api, client } = await open();
    const before = api.calls.length;

    const outcome = await call(client, "upload", { fileName, contentBase64: PNG });

    expect(outcome.isError).toBe(true);
    expect(api.calls.slice(before).filter((entry) => entry.method !== "GET")).toEqual([]);
    expect(api.media.size).toBe(0);
  });

  it("names the file name as the field to fix", async () => {
    const { client } = await open();

    const outcome = await call(client, "upload", {
      fileName: "../portrait.png",
      contentBase64: PNG,
    });

    expect(errorOf(outcome)?.code).toBe("field");
    expect(errorOf(outcome)?.fields?.[0]?.path).toBe("fileName");
  });

  it.each([
    ["an address", "https://files.example.test/portrait.png"],
    ["a path", "/srv/media/portrait.png"],
    ["text that is not base64", "not base64!"],
    ["unpadded base64", PNG.replace(/=+$/, "")],
    ["an empty file", ""],
  ])("refuses %s as the content before any request", async (_label, contentBase64) => {
    const { api, client } = await open();

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64 });

    expect(outcome.isError).toBe(true);
    expect(errorOf(outcome)?.code).toBe("field");
    expect(errorOf(outcome)?.fields?.[0]?.path).toBe("contentBase64");
    expect(uploads(api)).toEqual([]);
  });

  it("refuses arguments the tool does not name, such as a path, address or storage target", async () => {
    const { api, client } = await open();

    for (const extra of [{ path: "/etc/passwd" }, { url: "https://x.test" }, { bucket: "media" }]) {
      const outcome = await call(client, "upload", {
        fileName: "portrait.png",
        contentBase64: PNG,
        ...extra,
      });
      expect(outcome.isError).toBe(true);
    }
    expect(uploads(api)).toEqual([]);
  });

  it("refuses a file larger than the request body limit before any request", async () => {
    const { api, client } = await open(fakeApi(), { MCP_ADMIN_BODY_LIMIT_BYTES: "2048" });
    const large = Buffer.alloc(4096, 1).toString("base64");

    const outcome = await call(client, "upload", { fileName: "large.png", contentBase64: large });

    expect(outcome.isError).toBe(true);
    expect(uploads(api)).toEqual([]);
  });

  it("does not follow a redirect from the upload route", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/media",
      () => new Response(null, { status: 307, headers: { location: "https://elsewhere.test/" } }),
      "POST",
    );
    const { client } = await open(api);

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64: PNG });

    expect(outcome.isError).toBe(true);
    expect(api.calls.every((entry) => entry.url.startsWith(API_BASE))).toBe(true);
    expect(uploads(api)).toHaveLength(1);
  });
});

describe("refused uploads leave no attachment (D12, D17)", () => {
  it.each([
    ["an unsupported type", "notes.txt", Buffer.from("plain fictional text").toString("base64")],
    ["a type the name contradicts", "portrait.pdf", PNG],
    ["a malformed PDF", "cv.pdf", TRUNCATED_PDF],
    [
      "an oversized file",
      "large.pdf",
      Buffer.alloc(FAKE_MEDIA_MAX_BYTES + 1, 37).toString("base64"),
    ],
  ])(
    "reports %s as a field error on the file, stores nothing",
    async (_label, fileName, content) => {
      const { api, client } = await open();

      const outcome = await call(client, "upload", { fileName, contentBase64: content });

      expect(outcome.isError).toBe(true);
      expect(errorOf(outcome)?.code).toBe("field");
      expect(errorOf(outcome)?.fields?.map((field) => field.path)).toContain("file");
      expect(uploads(api)).toHaveLength(1);
      expect(api.media.size).toBe(0);
      expect(api.changes).toEqual([]);
    },
  );

  it("keeps the current CV when the replacement upload is refused", async () => {
    const { api, client } = await open();
    const first = await call(client, "upload", { fileName: "cv.pdf", contentBase64: PDF });
    const cvPdfId = (first.json as { id: string }).id;
    await call(client, "save", { entity: "person", action: "update", fields: { cvPdfId } });

    const refused = await call(client, "upload", {
      fileName: "cv.pdf",
      contentBase64: TRUNCATED_PDF,
    });

    expect(errorOf(refused)?.code).toBe("field");
    expect(api.person()["cvPdfId"]).toBe(cvPdfId);
    expect(api.media.size).toBe(1);
  });

  it("reports a storage failure as uncertain, never retried and never attached", async () => {
    const api = fakeApi();
    api.failStorage();
    const { client } = await open(api);

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64: PNG });

    expect(errorOf(outcome)?.code).toBe("uncertain");
    expect(uploads(api)).toHaveLength(1);
    expect(api.media.size).toBe(0);
    expect(api.person()["photoId"]).toBeNull();
  });

  it("reports a refused key or rate limit as unavailable without retrying", async () => {
    const api = fakeApi();
    api.answer(
      "/v1/media",
      () =>
        Response.json({ error: { code: "rate_limited", message: "Slow down." } }, { status: 429 }),
      "POST",
    );
    const { client } = await open(api);

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64: PNG });

    expect(errorOf(outcome)?.code).toBe("unavailable");
    expect(uploads(api)).toHaveLength(1);
  });
});

describe("lost upload answers (D20)", () => {
  it("reconciles an upload committed before its answer was lost, with the stored media ID", async () => {
    const api = fakeApi();
    api.lose("POST", "/v1/media", "after-commit");
    const { client } = await open(api);

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64: PNG });

    const [stored] = [...api.media.values()];
    expect(outcome.json).toMatchObject({
      entity: "media",
      id: stored?.id,
      action: "created",
      reconciled: true,
    });
    expect(uploads(api)).toHaveLength(1);
  });

  it("reports uncertain and never retries when the audit shows no such upload", async () => {
    const api = fakeApi();
    api.lose("POST", "/v1/media", "before-commit");
    const { client } = await open(api);

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64: PNG });

    expect(errorOf(outcome)?.code).toBe("uncertain");
    expect(uploads(api)).toHaveLength(1);
    expect(api.media.size).toBe(0);
  });

  it("does not upload when the audit cannot be read to reconcile later", async () => {
    const api = fakeApi();
    api.answer("/v1/audit/changes", () => new Response("down", { status: 503 }));
    const { client } = await open(api);

    const outcome = await call(client, "upload", { fileName: "portrait.png", contentBase64: PNG });

    expect(errorOf(outcome)?.code).toBe("unavailable");
    expect(uploads(api)).toEqual([]);
  });
});

describe("attaching uploaded media", () => {
  it("attaches the returned media ID as the photo through the person update", async () => {
    const { api, client } = await open();
    const uploaded = await call(client, "upload", {
      fileName: "portrait.png",
      contentBase64: PNG,
    });
    const photoId = (uploaded.json as { id: string }).id;

    const saved = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { photoId },
    });

    expect(saved.isError).toBe(false);
    expect(api.person()["photoId"]).toBe(photoId);
    expect(api.changes.map((change) => `${change.entity} ${change.action}`)).toEqual([
      "media created",
      "person updated",
    ]);
  });

  it("returns the API's refusal when the ID names no stored media of the right kind", async () => {
    const { api, client } = await open();
    const uploaded = await call(client, "upload", { fileName: "cv.pdf", contentBase64: PDF });
    const pdfId = (uploaded.json as { id: string }).id;

    const saved = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { photoId: pdfId },
    });

    expect(errorOf(saved)?.code).toBe("field");
    expect(errorOf(saved)?.fields?.[0]?.path).toBe("photoId");
    expect(api.person()["photoId"]).toBeNull();
  });

  it("attaches media the owner stored with the upload command, without passing any bytes", async () => {
    const api = fakeApi();
    // Stored outside the model, as `media upload <file>` of the API does (issue #201).
    const id = "00000000-0000-4000-9000-000000000201";
    api.media.set(id, {
      id,
      key: `fixture/${id}.pdf`,
      mediaType: "application/pdf",
      byteSize: 250_000,
      width: null,
      height: null,
      altText: null,
      url: `${API_BASE}/v1/media/files/fixture/${id}.pdf`,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const { client } = await open(api);

    const saved = await call(client, "save", {
      entity: "person",
      action: "update",
      fields: { cvPdfId: id },
    });

    expect(saved.isError).toBe(false);
    expect(api.person()["cvPdfId"]).toBe(id);
    expect(uploads(api)).toEqual([]);
  });

  it("sends photos and PDFs through the owner's upload command instead of base64", async () => {
    const { client } = await open();

    const { tools } = await client.listTools();
    const upload = tools.find((tool) => tool.name === "upload")?.description ?? "";
    const person = await call(client, "describe", { entity: "person" });
    const organization = await call(client, "describe", { entity: "organization" });

    for (const text of [upload, person.text, organization.text]) {
      expect(text).toMatch(/media upload <file>/);
    }
    expect(upload).toMatch(/never base64/i);
  });

  it("tells a caller how media is uploaded and attached", async () => {
    const { client } = await open();

    const person = await call(client, "describe", { entity: "person" });
    const media = await call(client, "describe", { entity: "media" });

    expect(person.text).toMatch(/upload/);
    expect(person.text).not.toMatch(/Uploading files is not part of this server/);
    expect(media.text).toMatch(/upload/);
    expect(media.text).not.toMatch(/Uploading files is not part of this server/);
  });
});
