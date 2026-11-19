/**
 * The MCP tool catalogue of MCP Admin. A fresh server is built for each MCP request around the
 * content of the verified caller, so no state or key outlives the request.
 *
 * Seven tools over the content module's fixed entity registry: `describe`, `list`, `get` and
 * `recent_changes` only read; `save` creates or changes one record, `delete` removes one and
 * `upload` stores one file from base64 bytes the caller passes, returning the media ID to attach.
 * Arguments are strict: an unknown key, an entity outside the registry, anything but a single
 * string identifier, or file content that is not canonical base64 is refused before any request. Results are JSON text; errors carry a stable
 * code (`field`, `conflict`, `not_found`, `unavailable`, `uncertain`, `unsupported_operation`) and
 * a message, never a key, a stack or an unredacted upstream answer.
 *
 * The annotations describe the tools honestly; they do not prove that a human approved a call.
 * Asking for that approval is the client's job.
 */
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { describeEntity, ENTITIES, type CallerContent, type Outcome } from "../content/index.js";

function success(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function result(outcome: Outcome<unknown>): CallToolResult {
  if (outcome.ok) return success(outcome.value);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: outcome.error }) }],
  };
}

/** Canonical, padded standard base64 of at least one byte. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

const entity = z.enum(ENTITIES).describe("The kind of record. `describe` explains each one.");
const id = z
  .string()
  .describe(
    "The one record: a slug, a UUID or a date as `describe` states. Leave it out for the person.",
  );

/** Builds the MCP server for one request of one verified caller. */
export function createAdminServer(content: CallerContent): McpServer {
  const server = new McpServer({ name: "sebela-mcp-admin", version: "0.0.0" });

  server.registerTool(
    "describe",
    {
      title: "Describe a content entity",
      description:
        "Explains a kind of record: the operations it supports, how a record is identified, the " +
        "JSON Schema of its create and update fields and the existing records its fields refer " +
        "to. Reads no stored content. Use it before a save.",
      inputSchema: z.strictObject({ entity }),
      annotations: readOnly,
    },
    ({ entity: name }) => success(describeEntity(name)),
  );

  server.registerTool(
    "list",
    {
      title: "List records",
      description:
        "Reads every stored record of an entity as the public site sees them. There are no " +
        "filters; find the record you mean in the result and ask the owner when several fit.",
      inputSchema: z.strictObject({ entity }),
      annotations: readOnly,
    },
    async ({ entity: name }) => result(await content.list(name)),
  );

  server.registerTool(
    "get",
    {
      title: "Get a record",
      description:
        "Reads one stored record. Returns it as JSON, or a `not_found` error when there is none; " +
        "it never returns a guessed record. Read a record before changing or deleting it.",
      inputSchema: z.strictObject({ entity, id: id.optional() }),
      annotations: readOnly,
    },
    async ({ entity: name, id: record }) => result(await content.get(name, record)),
  );

  server.registerTool(
    "save",
    {
      title: "Create or change a record",
      description:
        "`create` stores a new record from complete fields; `update` changes only the fields " +
        "given and leaves every other field, including other people's edits, as stored. Fields " +
        "follow the schema `describe` returns; derived and protected fields are refused. The " +
        "write is sent once and audited under the caller's key. A `field` error names the " +
        "fields to fix; `uncertain` means the outcome is unknown: read before trying again.",
      inputSchema: z.strictObject({
        entity,
        action: z.enum(["create", "update"]),
        id: id.optional(),
        fields: z
          .record(z.string(), z.unknown())
          .describe("Only the fields to write, as `describe` defines them."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ entity: name, action, id: record, fields }) =>
      result(await content.save(name, { action, id: record, fields })),
  );

  server.registerTool(
    "delete",
    {
      title: "Delete one record",
      description:
        "Deletes exactly one record named by its id. There is no bulk delete, no filter and no " +
        "undo; a record other content still depends on is refused with a `conflict` that says " +
        "why, and nothing else is removed. Ask the owner to approve every delete.",
      inputSchema: z.strictObject({ entity, id }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ entity: name, id: record }) => result(await content.remove(name, record)),
  );

  server.registerTool(
    "upload",
    {
      title: "Upload an image or PDF",
      description:
        "Stores one file the owner gave you, passed as its bytes in base64, as new media and " +
        "returns its media ID. It reads no path and fetches no address: only the bytes you pass " +
        "are sent. The API proves the type from the content (PNG, JPEG, WebP or PDF) and its " +
        "size; a refused file is a `field` error and nothing is stored. Attach the returned ID " +
        "with `save` (for example `photoId` or `cvPdfId` of the person) only after a successful " +
        "upload; a failed upload leaves the current reference as it is. `uncertain` means the " +
        "outcome is unknown: read the recent changes before trying again.",
      inputSchema: z.strictObject({
        fileName: z
          .string()
          .describe("A plain file name whose extension matches the file, such as `portrait.png`."),
        contentBase64: z.string().describe("The file's bytes, base64-encoded with padding."),
        altText: z
          .string()
          .optional()
          .describe("A description of an image for people who cannot see it."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ fileName, contentBase64, altText }) => {
      if (contentBase64.length === 0 || !BASE64.test(contentBase64)) {
        return result({
          ok: false,
          error: {
            code: "field",
            message: "The file content is not base64; nothing was sent.",
            fields: [
              {
                path: "contentBase64",
                message: "The file's own bytes in padded base64; never a path or an address.",
              },
            ],
          },
        });
      }
      const bytes = Buffer.from(contentBase64, "base64");
      return result(await content.upload({ fileName, bytes, altText }));
    },
  );

  server.registerTool(
    "recent_changes",
    {
      title: "Recent content changes",
      description:
        "Reads the newest audited content changes, newest first, at most twenty: who changed " +
        "what, through which operation and provenance, with the record before and after.",
      inputSchema: z.strictObject({}),
      annotations: readOnly,
    },
    async () => result(await content.recentChanges()),
  );

  return server;
}
