// The sandbox the tests of infra/scripts/backup.sh, restore.sh and clear-demo.sh run the real
// scripts in: a temporary folder with a fictional production environment file, the scenario of the
// fake docker and age (fake-backup-tools/) first on PATH, their call log and a TMPDIR of its own,
// next to a fake storage zone with a heartbeat (fake-storage.mjs). Every value is fictional.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startFakeStorage } from "./fake-storage.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const FAKE_TOOLS = path.join(import.meta.dirname, "fake-backup-tools");

export const ZONE = "sebela-backups";
export const PASSWORD = "fictional-zone-password-0000-1111-2222";
export const RECIPIENT = `age1${"q".repeat(58)}`;
export const HEARTBEAT_ID = "fictional-heartbeat-id";
/** The fictional site database and the cluster's maintenance database of the environment file. */
export const SITE = "fictional_site";
export const CLUSTER = "fictional_cluster";

/** The script of infra/scripts/ with this name. */
export const script = (name) => path.join(ROOT, "infra", "scripts", name);

export async function createSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-backup-test-"));
  fs.mkdirSync(path.join(dir, "tmp"));
  const storage = await startFakeStorage({ zone: ZONE, password: PASSWORD });
  const envFile = path.join(dir, "production.env");
  const scenarioFile = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "tools.log");

  /** Sets what the fake tools answer (see fake-backup-tools/docker). */
  const scenario = (value) => fs.writeFileSync(scenarioFile, JSON.stringify(value));

  /** Writes the environment file: the documented settings, `overrides` replacing or removing. */
  const settings = (overrides = {}) => {
    const values = {
      POSTGRES_USER: "fictional_superuser",
      POSTGRES_DB: CLUSTER,
      DATABASE_NAME: SITE,
      DATABASE_USER: "fictional_app",
      BACKUP_STORAGE_ENDPOINT: storage.base,
      BACKUP_STORAGE_ZONE: ZONE,
      BACKUP_STORAGE_PASSWORD: PASSWORD,
      BACKUP_AGE_RECIPIENT: RECIPIENT,
      BACKUP_HEARTBEAT_URL: `${storage.base}/heartbeat/${HEARTBEAT_ID}`,
      ...overrides,
    };
    const text = Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${value}\n`)
      .join("");
    fs.writeFileSync(envFile, `# Fictional settings\n${text}`);
  };

  /**
   * Runs a script with the fakes. Resolves with its exit status, its output (stdout as a Buffer
   * in `stdoutBytes` too) and the tool calls it made, in order.
   */
  const run = (file, { args = [], env = {}, input } = {}) => {
    const inherited = { ...process.env };
    for (const name of Object.keys(inherited)) {
      if (/^(?:BACKUP|DEPLOY|CLEAR)_/.test(name)) delete inherited[name];
    }
    const child = spawn("bash", [file, ...args], {
      env: {
        ...inherited,
        PATH: `${FAKE_TOOLS}${path.delimiter}${process.env.PATH ?? ""}`,
        TMPDIR: path.join(dir, "tmp"),
        FAKE_TOOLS_SCENARIO: scenarioFile,
        FAKE_TOOLS_LOG: logFile,
        DEPLOY_ENV_FILE: envFile,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    return new Promise((resolve) => {
      child.on("close", (status) => {
        clearTimeout(timer);
        const calls = fs.existsSync(logFile)
          ? fs
              .readFileSync(logFile, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((entry) => JSON.parse(entry))
          : [];
        fs.rmSync(logFile, { force: true });
        const stdoutBytes = Buffer.concat(out);
        resolve({ status, stdout: stdoutBytes.toString(), stdoutBytes, stderr, calls });
      });
    });
  };

  scenario({});
  settings();

  return {
    dir,
    envFile,
    storage,
    scenario,
    settings,
    run,
    /** What is left in the scripts' TMPDIR. */
    leftovers: () => fs.readdirSync(path.join(dir, "tmp")),
    close: async () => {
      await storage.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The SQL of every psql call, in order. */
export const statements = (calls) =>
  calls
    .filter(({ args }) => args.includes("psql"))
    .map(({ args }) => args[args.indexOf("--command") + 1]);
