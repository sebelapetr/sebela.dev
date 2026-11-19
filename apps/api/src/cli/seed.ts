// Maintenance adapter: loads a seed folder straight through the services, so it works against a
// migrated database without a running HTTP server and without an API key.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  demoSeedFolder,
  DomainError,
  openServices,
  readDatabaseConfig,
  readMediaConfig,
  type SeedKind,
  type Services,
} from "@sebela/services";

import { logCleanupFailure } from "../modules/media/index.js";
import type { CommandOutput } from "./api-keys.js";

const USAGE = `Usage: seed [--if-empty] [folder]

  Loads a seed folder (format: packages/db/seed/README.md) into the database. Without a folder it
  loads the fictional demo seed. A relative folder is resolved against the directory the command
  was started from. Records are matched by slug and overwritten with the seed's values.

  --if-empty  Load only into an empty profile; a profile that holds anything is left as it is.
`;

const kindLabels: Record<SeedKind, string> = {
  person: "person",
  technologies: "technologies",
  topics: "topics",
  organizations: "organizations",
  experiences: "experiences",
  projects: "projects",
  caseStudies: "case studies",
  explorations: "explorations",
  services: "services",
  education: "education",
  testimonials: "testimonials",
  currentFocus: "current focus",
  roadmapAreas: "roadmap areas",
  roadmapModules: "roadmap modules",
  roadmapBooks: "roadmap books",
  roadmapResources: "roadmap resources",
  roadmapEvents: "roadmap events",
  roadmapDiary: "diary days",
  roadmapTimeEntries: "time entry sessions",
};

/**
 * Runs the seed command (`[--if-empty] [folder]`) through the services and returns the exit code:
 * 0 on success or a skipped load, 1 for a refused or unreadable seed, 2 for bad usage. Prints counts and refusals by file and field,
 * never seed content or the folder's path (a file-system failure is reported by its code).
 */
export async function runSeedCommand(
  args: readonly string[],
  services: Pick<Services, "seed">,
  output: CommandOutput,
  cwd: string = process.cwd(),
): Promise<number> {
  const ifEmpty = args[0] === "--if-empty";
  const [folder, ...extra] = ifEmpty ? args.slice(1) : args;
  if (extra.length > 0 || folder?.startsWith("-") === true || folder === "") {
    output.err(USAGE);
    return 2;
  }
  try {
    const source = folder === undefined ? demoSeedFolder : resolve(cwd, folder);
    const report = ifEmpty
      ? await services.seed.loadSeedIntoEmpty(source)
      : await services.seed.loadSeed(source);
    if (report === null) {
      output.out("The profile already holds content; the seed was skipped.\n");
      return 0;
    }
    for (const [kind, label] of Object.entries(kindLabels) as [SeedKind, string][]) {
      const { created, updated } = report.records[kind];
      output.out(`${label}: ${String(created)} created, ${String(updated)} updated\n`);
    }
    const { uploaded, reused, removed } = report.media;
    output.out(
      `media: ${String(uploaded)} uploaded, ${String(reused)} reused, ${String(removed)} removed\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof DomainError) {
      output.err(`${error.message}\n`);
      for (const field of error.fields ?? []) output.err(`  ${field.path}: ${field.message}\n`);
      return 1;
    }
    // A Node file-system error names the path it failed on; print its code only.
    if (error instanceof Error && "syscall" in error && "code" in error) {
      output.err(`The seed folder could not be read (${String(error.code)}).\n`);
      return 1;
    }
    throw error;
  }
}

async function main() {
  const services = openServices(readDatabaseConfig(process.env), {
    media: {
      config: readMediaConfig(process.env),
      onCleanupFailure: logCleanupFailure((line) => process.stderr.write(`${line}\n`)),
    },
  });
  try {
    // pnpm runs package scripts in the package folder; INIT_CWD is where the command was started.
    process.exitCode = await runSeedCommand(
      process.argv.slice(2),
      services,
      { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
      process.env["INIT_CWD"] ?? process.cwd(),
    );
  } finally {
    await services.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
