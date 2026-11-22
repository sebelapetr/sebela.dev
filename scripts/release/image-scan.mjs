#!/usr/bin/env node
// The vulnerability scan of the container images this repository builds (docs/release-workflow.md,
// "Image scan"): the gate in the release workflow's images job, the weekly report of the published
// images, and the installation of the Trivy command line they share.
//
//   node scripts/release/image-scan.mjs install >> "$GITHUB_ENV"
//   TRIVY=<binary> SHA=<commit> BUILD='["web"]' node scripts/release/image-scan.mjs gate
//   TRIVY=<binary> OUT_DIR=<dir> node scripts/release/image-scan.mjs report
//
// Plain Node with no dependencies. Every command explains itself on standard error.
//
// - install: downloads the pinned Trivy release (TRIVY below: a version and the SHA-256 of its
//   archive, held in this repository), refuses an archive whose checksum differs, unpacks it into
//   INSTALL_DIR and prints `TRIVY=<binary>` for $GITHUB_ENV. No third-party action is involved:
//   the Trivy ecosystem was compromised in March 2026 (docs/release-workflow.md, "Image scan").
// - gate: scans the images the release built (BUILD, tagged with SHA, in the local Docker) and
//   fails, with exit status 1, when a critical or high finding that a newer package fixes is left
//   and no unexpired exception in the exceptions file excuses it, or when the file holds an
//   expired, incomplete or unbounded entry. Findings no release fixes, and findings below high,
//   fail nothing.
// - report: scans the `current` image of every service in the registry into SARIF files
//   (OUT_DIR/<service>.sarif) for code scanning. Findings never fail it; a scan that cannot run
//   does, so a silent gap is noticed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CURRENT_TAG, SERVICES, imageName } from "./images.mjs";

/**
 * The Trivy release the scan runs, for linux/arm64 (the runners of the images job and of the
 * weekly scan). Its GitHub release is immutable. To move it, take the version and the archive's
 * SHA-256 from the release page, compare it with a checksum computed from your own download, and
 * change both here in one pull request.
 */
export const TRIVY = (() => {
  const version = "0.76.2";
  return {
    version,
    url: `https://github.com/aquasecurity/trivy/releases/download/v${version}/trivy_${version}_Linux-ARM64.tar.gz`,
    sha256: "ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3",
  };
})();

const EXCEPTIONS_FILE = path.join(import.meta.dirname, "image-scan-exceptions.json");

/** Severities that can fail a release, when a fixed version exists. */
const BLOCKING = new Set(["CRITICAL", "HIGH"]);

/** The longest an exception may run from the day the gate reads it. */
const HORIZON_DAYS = 90;

const COMMIT = /^[0-9a-f]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const log = (message) => process.stderr.write(`${message}\n`);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The findings of a Trivy JSON report (`trivy image --format json`, schema version 2) that fail a
 * release: critical or high severity, with a fixed version. Throws on anything that is not such a
 * report, so a broken scan cannot pass as a clean one.
 */
export function blockingFindings(report) {
  if (!isObject(report) || report.SchemaVersion !== 2) {
    throw new Error("The scan output is not a Trivy report of schema version 2.");
  }
  if (report.Results !== undefined && !Array.isArray(report.Results)) {
    throw new Error("The scan output is not a Trivy report: its results are not a list.");
  }
  const found = [];
  for (const result of report.Results ?? []) {
    if (!isObject(result)) throw new Error("The scan output is not a Trivy report: a bad result.");
    const list = result.Vulnerabilities ?? [];
    if (!Array.isArray(list)) {
      throw new Error("The scan output is not a Trivy report: a result's findings are no list.");
    }
    for (const item of list) {
      if (!isObject(item) || typeof item.VulnerabilityID !== "string") {
        throw new Error("The scan output is not a Trivy report: a finding has no identifier.");
      }
      const fixed = typeof item.FixedVersion === "string" ? item.FixedVersion.trim() : "";
      if (!BLOCKING.has(item.Severity) || fixed === "") continue;
      found.push({
        id: item.VulnerabilityID,
        severity: item.Severity,
        package: String(item.PkgName ?? ""),
        installed: String(item.InstalledVersion ?? ""),
        fixed,
        target: String(result.Target ?? ""),
        path: item.PkgPath === undefined ? undefined : String(item.PkgPath),
      });
    }
  }
  return found;
}

function dayNumber(text) {
  if (typeof text !== "string" || !DAY.test(text)) return undefined;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.getTime() / DAY_MS : undefined;
}

/**
 * The reviewed exceptions: `{"exceptions": [{ "id", "reason", "expires", "package"?, "service"? }]}`.
 * An exception excuses the finding `id` (in `package` and `service` when it names them) through
 * the day `expires` (YYYY-MM-DD, UTC). Returns the entries that are complete and unexpired, and
 * the problems of the others: an expired entry, one whose expiry is more than `horizonDays` ahead
 * of `today`, a missing or empty field, a repeated entry. Never throws on bad content.
 */
export function parseExceptions(text, { today, horizonDays = HORIZON_DAYS }) {
  const problems = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { exceptions: [], problems: ["The exceptions file is not JSON."] };
  }
  if (!isObject(data) || !Array.isArray(data.exceptions)) {
    return { exceptions: [], problems: ['The exceptions file has no "exceptions" list.'] };
  }
  const now = dayNumber(today);
  const exceptions = [];
  const seen = new Set();
  data.exceptions.forEach((item, index) => {
    const label =
      isObject(item) && typeof item.id === "string" && item.id ? item.id : `entry ${index + 1}`;
    const bad = [];
    if (!isObject(item)) {
      problems.push(`The exceptions file's ${label} is not an object.`);
      return;
    }
    if (typeof item.id !== "string" || item.id.trim() === "") bad.push("has no finding id");
    if (typeof item.reason !== "string" || item.reason.trim() === "") bad.push("has no reason");
    if (item.package !== undefined && (typeof item.package !== "string" || item.package === "")) {
      bad.push("has a bad package");
    }
    if (item.service !== undefined && !SERVICES.includes(item.service)) {
      bad.push(`names an unknown service (${String(item.service)})`);
    }
    const expires = dayNumber(item.expires);
    if (expires === undefined) {
      bad.push("has no valid expiry date (YYYY-MM-DD)");
    } else if (expires < now) {
      bad.push(`has expired (${item.expires}): fix the finding or review the entry again`);
    } else if (expires - now > horizonDays) {
      bad.push(`expires ${item.expires}, more than ${horizonDays} days ahead`);
    }
    const key = JSON.stringify([item.id, item.package ?? null, item.service ?? null]);
    if (seen.has(key)) bad.push("is listed twice");
    seen.add(key);
    if (bad.length > 0) {
      problems.push(`Exception ${label} ${bad.join(" and ")}.`);
    } else {
      exceptions.push({
        id: item.id,
        reason: item.reason,
        expires: item.expires,
        ...(item.package === undefined ? {} : { package: item.package }),
        ...(item.service === undefined ? {} : { service: item.service }),
      });
    }
  });
  return { exceptions, problems };
}

/**
 * The gate's verdict for the Trivy reports of the built images (`reports`, service to report) and
 * the text of the exceptions file, on the day `today`. `blocking` holds the findings no exception
 * excuses, `excepted` those one does (with its reason and expiry), `problems` what is wrong with
 * the exceptions file; `ok` only when there are no blocking findings and no problems.
 */
export function evaluateGate({ reports, exceptionsText, today }) {
  const services = SERVICES.filter((service) => reports[service] !== undefined);
  if (services.length === 0) throw new Error("There is no image to judge.");
  const { exceptions, problems } = parseExceptions(exceptionsText, { today });
  const blocking = [];
  const excepted = [];
  for (const service of services) {
    for (const finding of blockingFindings(reports[service])) {
      const excuse = exceptions.find(
        (item) =>
          item.id === finding.id &&
          (item.package === undefined || item.package === finding.package) &&
          (item.service === undefined || item.service === service),
      );
      if (excuse)
        excepted.push({ service, ...finding, reason: excuse.reason, expires: excuse.expires });
      else blocking.push({ service, ...finding });
    }
  }
  return { ok: blocking.length === 0 && problems.length === 0, blocking, excepted, problems };
}

/** Throws unless the SHA-256 of `bytes` is `sha256` (lower-case hex). */
export function verifyArchive(bytes, sha256) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(sha256) || actual !== sha256) {
    throw new Error(`The archive's checksum ${actual} is not the pinned checksum ${sha256}.`);
  }
}

function trivyBinary() {
  const binary = process.env.TRIVY;
  if (!binary) throw new Error("TRIVY, the path of the trivy binary, is not set.");
  return binary;
}

function runTrivy(args) {
  const result = spawnSync(trivyBinary(), args, { stdio: ["ignore", 2, 2] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`trivy ${args[0]} exited with status ${result.status}.`);
}

function builtServices() {
  let list;
  try {
    list = JSON.parse(process.env.BUILD ?? "");
  } catch {
    throw new Error("BUILD is not a JSON list of services.");
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error("BUILD lists no service.");
  for (const service of list) {
    if (!SERVICES.includes(service))
      throw new Error(`BUILD names an unknown service: ${String(service)}`);
  }
  return SERVICES.filter((service) => list.includes(service));
}

async function installCommand() {
  if (process.platform !== "linux" || process.arch !== "arm64") {
    throw new Error(
      `The pinned Trivy is for linux/arm64, not ${process.platform}/${process.arch}.`,
    );
  }
  const dir = process.env.INSTALL_DIR || path.join(process.env.RUNNER_TEMP || os.tmpdir(), "trivy");
  fs.mkdirSync(dir, { recursive: true });
  const response = await fetch(TRIVY.url);
  if (!response.ok) throw new Error(`Downloading Trivy failed: ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyArchive(bytes, TRIVY.sha256);
  const archive = path.join(dir, "trivy.tar.gz");
  fs.writeFileSync(archive, bytes);
  const unpacked = spawnSync("tar", ["-xzf", archive, "-C", dir, "trivy"], {
    stdio: ["ignore", 2, 2],
  });
  if (unpacked.status !== 0) throw new Error("Unpacking the Trivy archive failed.");
  fs.rmSync(archive);
  log(`Installed Trivy ${TRIVY.version} (checksum verified).`);
  process.stdout.write(`TRIVY=${path.join(dir, "trivy")}\n`);
}

function gateCommand() {
  const sha = process.env.SHA ?? "";
  if (!COMMIT.test(sha)) throw new Error(`SHA is not a commit SHA: ${sha}`);
  const services = builtServices();
  const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "image-scan-"));
  const reports = {};
  for (const service of services) {
    const output = path.join(dir, `${service}.json`);
    const reference = `${imageName(service)}:${sha}`;
    log(`Scanning ${reference}`);
    runTrivy([
      "image",
      "--image-src",
      "docker",
      "--scanners",
      "vuln",
      "--severity",
      "CRITICAL,HIGH",
      "--format",
      "json",
      "--output",
      output,
      "--exit-code",
      "0",
      "--timeout",
      "10m",
      "--no-progress",
      reference,
    ]);
    reports[service] = JSON.parse(fs.readFileSync(output, "utf8"));
  }
  const exceptionsPath = process.env.EXCEPTIONS || EXCEPTIONS_FILE;
  const verdict = evaluateGate({
    reports,
    exceptionsText: fs.readFileSync(exceptionsPath, "utf8"),
    today: new Date().toISOString().slice(0, 10),
  });
  const line = (item) =>
    `${item.service} ${item.id} ${item.package} ${item.installed} (${item.severity}), fixed in ${item.fixed}`;
  const lines = [
    ...verdict.blocking.map((item) => `blocking: ${line(item)}`),
    ...verdict.excepted.map(
      (item) => `excepted until ${item.expires}: ${line(item)} - ${item.reason}`,
    ),
    ...verdict.problems.map((problem) => `exceptions file: ${problem}`),
  ];
  for (const text of lines) log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "### Image scan",
      "",
      verdict.ok
        ? "No fixable critical or high finding is left."
        : "The image scan failed the release.",
      "",
      ...lines.map((text) => `- ${text}`),
      "",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (!verdict.ok) {
    log("The image scan failed: nothing is published (docs/release-workflow.md, Image scan).");
    process.exitCode = 1;
  } else {
    log(`Image scan passed for ${services.join(", ")}.`);
  }
}

function reportCommand() {
  const out = process.env.OUT_DIR || "image-scan-sarif";
  fs.mkdirSync(out, { recursive: true });
  for (const service of SERVICES) {
    const reference = `${imageName(service)}:${CURRENT_TAG}`;
    const file = path.join(out, `${service}.sarif`);
    log(`Scanning ${reference}`);
    runTrivy([
      "image",
      "--image-src",
      "remote",
      "--platform",
      "linux/arm64",
      "--scanners",
      "vuln",
      "--severity",
      "CRITICAL,HIGH,MEDIUM",
      "--format",
      "sarif",
      "--output",
      file,
      "--exit-code",
      "0",
      "--timeout",
      "10m",
      "--no-progress",
      reference,
    ]);
    if (!fs.existsSync(file)) throw new Error(`The scan of ${reference} wrote no report.`);
  }
}

const COMMANDS = { install: installCommand, gate: gateCommand, report: reportCommand };

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    log(`Usage: node scripts/release/image-scan.mjs ${Object.keys(COMMANDS).join("|")}`);
    process.exitCode = 2;
  } else {
    try {
      await command();
    } catch (error) {
      log(
        `image-scan ${process.argv[2]}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
