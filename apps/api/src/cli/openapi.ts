// Export adapter: writes the OpenAPI document the API serves to a file, so clients can be generated
// from it without a running server, a database, configuration or secrets.
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { describeApi } from "../app.js";

/** The document as committed: two-space JSON with a final newline, identical for identical routes. */
export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(describeApi(), null, 2)}\n`;
}

async function main(target: string | undefined): Promise<number> {
  if (!target) {
    process.stderr.write("Usage: openapi <file>   Write the OpenAPI document to <file>.\n");
    return 2;
  }
  await writeFile(target, serializeOpenApiDocument());
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2])
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
