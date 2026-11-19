/**
 * The MCP tool catalogue of MCP Admin. A fresh server is built for each MCP request around the
 * content of the verified caller, so no state or key outlives the request.
 *
 * Six tools over the content module's fixed entity registry: `describe`, `list`, `get` and
 * `recent_changes` only read; `save` creates or changes one record and `delete` removes one.
 * Six learning task tools over the learning module: `find_resource` only reads; `add_resource`,
 * `set_resource_status`, `log_session`, `save_event` and `save_book` each make one write.
 * Arguments are strict: an unknown key, an entity outside the registry or anything but a single
 * string identifier is refused before any request. Results are JSON text; errors carry a stable
 * code (`field`, `conflict`, `not_found`, `unavailable`, `uncertain`, `unsupported_operation`) and
 * a message, never a key, a stack or an unredacted upstream answer.
 *
 * The annotations describe the tools honestly; they do not prove that a human approved a call.
 * Asking for that approval is the client's job.
 */
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  roadmapEventKinds,
  roadmapResourceStatuses,
  roadmapResourceTypes,
} from "@sebela/contracts";

import { describeEntity, ENTITIES, type CallerContent, type Outcome } from "../content/index.js";
import { createLearningTasks } from "../learning/index.js";

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

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

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
      annotations: write,
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

  const learning = createLearningTasks(content);
  const instant = z.iso
    .datetime({ offset: true })
    .describe("An absolute instant with `Z` or an offset, such as `2026-11-17T18:00:00+01:00`.");
  const day = z.iso.date().describe("A calendar date, `YYYY-MM-DD`.");
  const slug = z.string().describe("The stored record's slug.");

  server.registerTool(
    "find_resource",
    {
      title: "Find a roadmap resource",
      description:
        "Finds stored roadmap resources whose name or slug contains the query, or whose stored " +
        "link equals a link query. A link is only compared with stored links; the tool never " +
        "opens or fetches it. Returns at most twenty candidates with their module and area; " +
        "when several fit, ask the owner which one is meant.",
      inputSchema: z.strictObject({
        query: z.string().min(1).describe("Part of the resource's name or slug, or its full link."),
      }),
      annotations: readOnly,
    },
    async ({ query }) => result(await learning.findResource(query)),
  );

  server.registerTool(
    "add_resource",
    {
      title: "Add a roadmap resource",
      description:
        "Creates a resource at the end of an existing roadmap module. Use it only after " +
        "`find_resource` found nothing and the owner confirmed the module, name and type. A " +
        "stored resource with the same link, or the same name in the module, is a `conflict` " +
        "naming it, and nothing is written.",
      inputSchema: z.strictObject({
        module: z.string().describe("The slug of the existing module."),
        name: z.string().min(1),
        type: z.enum(roadmapResourceTypes),
        link: z.url().optional(),
        slug: z.string().optional().describe("Leave out to derive it from the name."),
        status: z.enum(roadmapResourceStatuses).optional(),
        estimatedMinutes: z.int().positive().optional(),
      }),
      annotations: write,
    },
    async (resource) => result(await learning.addResource(resource)),
  );

  server.registerTool(
    "set_resource_status",
    {
      title: "Set a resource's status",
      description:
        "Sets a resource's canonical status: planned, in-progress, completed, paused or skipped. " +
        'The owner\'s "started" means in-progress. Give `startedAt` or `finishedAt` only when ' +
        "the owner stated them; nothing else of the resource changes.",
      inputSchema: z.strictObject({
        resource: slug,
        status: z.enum(roadmapResourceStatuses),
        startedAt: instant.optional(),
        finishedAt: instant.optional(),
      }),
      annotations: write,
    },
    async (change) => result(await learning.setResourceStatus(change)),
  );

  server.registerTool(
    "log_session",
    {
      title: "Log a study session",
      description:
        "Logs one session of study time on exactly one resource, book or event, with optional " +
        "diary notes, in one write. Both endpoints are absolute instants with an offset; " +
        "diary days are Europe/Prague days and a session over midnight is split by the API. " +
        "Never invent a start, an end or a note: ask the owner for a missing or ambiguous " +
        "time. A book's reading is logged on its linked resource and counts once. A session " +
        "overlapping another one is a `conflict`; `uncertain` means read the diary before " +
        "trying again.",
      inputSchema: z.strictObject({
        resource: slug.optional(),
        book: slug.optional(),
        event: slug.optional(),
        startedAt: instant,
        endedAt: instant,
        notes: z.string().min(1).optional().describe("Diary notes in the owner's words."),
      }),
      annotations: write,
    },
    async (session) => result(await learning.logSession(session)),
  );

  server.registerTool(
    "save_event",
    {
      title: "Create or change an event",
      description:
        "`create` stores an event from its confirmed name, kind and inclusive start and end " +
        "dates; missing facts are a `field` error to ask the owner about. `update` changes only " +
        "the given fields. The dates record no attendance time: log attendance with " +
        "`log_session` on the event.",
      inputSchema: z.strictObject({
        action: z.enum(["create", "update"]),
        slug: slug.optional().describe("Required for an update; derived for a create."),
        name: z.string().min(1).optional(),
        kind: z.enum(roadmapEventKinds).optional(),
        organizer: z.string().optional(),
        place: z.string().optional(),
        online: z.boolean().optional(),
        link: z.url().optional(),
        takeaways: z.string().optional(),
        startsOn: day.optional(),
        endsOn: day.optional(),
        topics: z.array(z.string()).optional(),
      }),
      annotations: write,
    },
    async ({ action, slug: record, ...fields }) =>
      result(await learning.saveEvent({ action, slug: record, fields })),
  );

  server.registerTool(
    "save_book",
    {
      title: "Create or change a book",
      description:
        "`create` stores a book from its title; `update` changes only the given fields. A " +
        "book's state comes from its dates: `startedOn` starts it and `endedOn` finishes it, " +
        "so there is no status to set.",
      inputSchema: z.strictObject({
        action: z.enum(["create", "update"]),
        slug: slug.optional().describe("Required for an update; derived for a create."),
        title: z.string().min(1).optional(),
        author: z.string().optional(),
        description: z.string().optional(),
        pages: z.int().positive().optional(),
        year: z.int().optional(),
        startedOn: day.optional(),
        endedOn: day.optional(),
        summary: z.string().optional(),
      }),
      annotations: write,
    },
    async ({ action, slug: record, ...fields }) =>
      result(await learning.saveBook({ action, slug: record, fields })),
  );

  return server;
}
