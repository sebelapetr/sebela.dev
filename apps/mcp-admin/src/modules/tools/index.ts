/**
 * The MCP tool catalogue of MCP Admin. A fresh server is built for each MCP request around the
 * content of the verified caller, so no state or key outlives the request.
 *
 * Only implemented tools are registered: `get` reads the person, `describe` explains the project
 * contract from the shared contracts. Both are read-only. Arguments are strict: an unknown key, an
 * entity a tool does not support or a credential in the arguments is refused before any read.
 * Tool errors carry a fixed code and message, never an upstream answer, a key or a stack.
 */
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { ProjectCreateSchema, ProjectUpdateSchema } from "@sebela/contracts";
import { z } from "zod";

import type { CallerContent } from "../content/index.js";

const ERRORS = {
  not_found: "No person is stored yet.",
  unavailable: "The content API is unavailable; retry later.",
} as const;

function success(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failure(code: keyof typeof ERRORS): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERRORS[code] } }) }],
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

/**
 * The input JSON Schema of a contract with its root object inline. A contract named with `.meta({id})`
 * would otherwise be only a `$ref` into `$defs`; other shared definitions stay in `$defs`.
 */
function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const ref = json["$ref"];
  const defs = json["$defs"] as Record<string, Record<string, unknown>> | undefined;
  if (typeof ref !== "string" || defs === undefined) return json;
  const name = ref.replace(/^#\/\$defs\//, "");
  const { [name]: root, ...rest } = defs;
  if (root === undefined || JSON.stringify(rest).includes(`"#/$defs/${name}"`)) return json;
  return {
    $schema: json["$schema"],
    ...root,
    ...(Object.keys(rest).length > 0 ? { $defs: rest } : {}),
  };
}

/** The project contract and the records it must point at, derived from the shared contracts. */
const projectDescription = {
  entity: "project",
  create: inputSchema(ProjectCreateSchema),
  update: inputSchema(ProjectUpdateSchema),
  relationships: [
    {
      field: "experience",
      target: "experience",
      rule: "Required on create: the slug of one existing experience. On an update it moves the project to that experience.",
    },
    {
      field: "technologies",
      target: "technology",
      rule: "Slugs of existing technologies, each at most once, in their intended order. On an update the list replaces every link; an omitted list leaves them unchanged.",
    },
  ],
};

/** Builds the MCP server for one request of one verified caller. */
export function createAdminServer(content: CallerContent): McpServer {
  const server = new McpServer({ name: "sebela-mcp-admin", version: "0.0.0" });

  server.registerTool(
    "get",
    {
      title: "Get a record",
      description:
        "Reads a stored record. Supported entity: `person`, the profile of the site's owner. " +
        "Returns the stored record as JSON, or a `not_found` error when none is stored; it never " +
        "returns a guessed record.",
      inputSchema: z.strictObject({
        entity: z.enum(["person"]).describe("The kind of record to read."),
      }),
      annotations: readOnly,
    },
    async () => {
      const outcome = await content.getPerson();
      return outcome.ok ? success(outcome.value) : failure(outcome.reason);
    },
  );

  server.registerTool(
    "describe",
    {
      title: "Describe a content contract",
      description:
        "Explains how a kind of record is written: the JSON Schema of its create and update " +
        "bodies and the existing records it must refer to. Supported entity: `project`. Reads no " +
        "stored content.",
      inputSchema: z.strictObject({
        entity: z.enum(["project"]).describe("The kind of record to describe."),
      }),
      annotations: readOnly,
    },
    () => success(projectDescription),
  );

  return server;
}
