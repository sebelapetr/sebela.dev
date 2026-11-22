// Behaviour of the image scan (docs/release-workflow.md, "Image scan"): which findings of a Trivy
// report fail a release, how the reviewed exceptions file excuses a finding and refuses an expired
// or unbounded entry, how the pinned Trivy archive is checked, and the `gate` and `report`
// commands run against a stand-in `trivy` that writes a fixture. The workflow itself cannot run here.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  FIXABLE_CRITICAL,
  FIXABLE_HIGH,
  FIXABLE_LOW,
  FIXABLE_MEDIUM,
  UNFIXED_CRITICAL,
  report,
  vulnerability,
} from "./fixtures/image-scan.mjs";
import {
  TRIVY,
  blockingFindings,
  evaluateGate,
  parseExceptions,
  verifyArchive,
} from "./image-scan.mjs";

const script = path.join(import.meta.dirname, "image-scan.mjs");
const TODAY = "2026-11-22";

const entry = (overrides = {}) => ({
  id: "CVE-2030-0001",
  reason: "No fixed base image yet; the vulnerable path is not reachable from the network.",
  expires: "2026-12-15",
  ...overrides,
});
const exceptionsText = (...entries) => JSON.stringify({ exceptions: entries });

describe("findings that fail a release", () => {
  it("takes a fixable critical or high finding", () => {
    const found = blockingFindings(report([FIXABLE_HIGH, FIXABLE_CRITICAL]));
    assert.deepEqual(
      found.map(({ id, severity, package: name, installed, fixed }) => [
        id,
        severity,
        name,
        installed,
        fixed,
      ]),
      [
        ["CVE-2030-0001", "HIGH", "libexample", "1.0.0", "1.0.1"],
        ["CVE-2030-0002", "CRITICAL", "libexample", "1.0.0", "1.0.2"],
      ],
    );
  });

  it("leaves out a critical finding that no release fixes", () => {
    assert.deepEqual(blockingFindings(report([UNFIXED_CRITICAL])), []);
  });

  it("leaves out fixable findings below high", () => {
    assert.deepEqual(blockingFindings(report([FIXABLE_MEDIUM, FIXABLE_LOW])), []);
  });

  it("accepts a clean report, which has no results at all", () => {
    assert.deepEqual(blockingFindings(report(null)), []);
  });

  it("reads every result of a report and a finding Trivy lists for several packages", () => {
    const two = report([FIXABLE_HIGH]);
    two.Results.push({
      Target: "Node.js",
      Class: "lang-pkgs",
      Vulnerabilities: [{ ...FIXABLE_HIGH, PkgName: "other", PkgPath: "usr/lib/other" }],
    });
    assert.deepEqual(
      blockingFindings(two).map(({ id, package: name }) => `${id} ${name}`),
      ["CVE-2030-0001 libexample", "CVE-2030-0001 other"],
    );
  });

  it("finds the fixable high findings of a real report of a published image", () => {
    const real = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, "fixtures", "image-scan", "published-api.json"),
      ),
    );
    const found = blockingFindings(real);
    assert.deepEqual([...new Set(found.map(({ package: name }) => name))].sort(), [
      "brace-expansion",
      "undici",
      "zlib1g",
    ]);
    assert.equal(found.length, 7);
    assert.ok(found.every(({ severity }) => severity === "HIGH"));
  });

  it("refuses what is not a Trivy report rather than pass it", () => {
    for (const bad of [
      null,
      "text",
      [],
      {},
      { SchemaVersion: 1 },
      { SchemaVersion: 2, Results: {} },
    ]) {
      assert.throws(() => blockingFindings(bad), /report/i);
    }
    assert.throws(
      () => blockingFindings({ SchemaVersion: 2, Results: [{ Target: "x", Vulnerabilities: {} }] }),
      /report/i,
    );
  });
});

describe("exceptions file", () => {
  it("accepts reviewed entries with a finding, a reason and an expiry", () => {
    const { exceptions, problems } = parseExceptions(
      exceptionsText(
        entry(),
        entry({ id: "CVE-2030-0002", package: "libexample", service: "web" }),
      ),
      { today: TODAY },
    );
    assert.deepEqual(problems, []);
    assert.equal(exceptions.length, 2);
  });

  it("accepts an empty list", () => {
    assert.deepEqual(parseExceptions(exceptionsText(), { today: TODAY }), {
      exceptions: [],
      problems: [],
    });
  });

  it("fails an expired entry and names it", () => {
    const { problems } = parseExceptions(exceptionsText(entry({ expires: "2026-11-21" })), {
      today: TODAY,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /CVE-2030-0001.*expired.*2026-11-21/);
  });

  it("keeps an entry valid through the day it expires", () => {
    const { problems } = parseExceptions(exceptionsText(entry({ expires: TODAY })), {
      today: TODAY,
    });
    assert.deepEqual(problems, []);
  });

  it("refuses an expiry more than 90 days ahead, so no exception is indefinite", () => {
    const { problems } = parseExceptions(exceptionsText(entry({ expires: "2027-02-21" })), {
      today: TODAY,
    });
    assert.match(problems.join("\n"), /CVE-2030-0001.*90 days/);
    const ok = parseExceptions(exceptionsText(entry({ expires: "2027-02-21" })), {
      today: "2026-11-22",
      horizonDays: 100,
    });
    assert.deepEqual(ok.problems, []);
  });

  it("refuses a missing or empty finding, reason or expiry and an impossible date", () => {
    const cases = [
      entry({ id: "" }),
      entry({ id: undefined }),
      entry({ reason: "  " }),
      entry({ reason: undefined }),
      entry({ expires: undefined }),
      entry({ expires: "tomorrow" }),
      entry({ expires: "2026-02-30" }),
      entry({ package: 7 }),
      entry({ service: "database" }),
    ];
    for (const bad of cases) {
      const { problems } = parseExceptions(exceptionsText(bad), { today: TODAY });
      assert.ok(problems.length >= 1, JSON.stringify(bad));
    }
  });

  it("refuses text that is not the file's format and the same exception twice", () => {
    for (const bad of ["not json", "[]", "{}", '{"exceptions": {}}', '{"exceptions": [1]}']) {
      assert.ok(parseExceptions(bad, { today: TODAY }).problems.length >= 1, bad);
    }
    const twice = parseExceptions(exceptionsText(entry(), entry()), { today: TODAY });
    assert.match(twice.problems.join("\n"), /twice/);
  });

  it("the committed file is a valid list", () => {
    const text = fs.readFileSync(
      path.join(import.meta.dirname, "image-scan-exceptions.json"),
      "utf8",
    );
    // Dates are checked by the gate when it runs, not here, so an expiring entry cannot turn
    // unrelated pull requests red.
    assert.deepEqual(
      parseExceptions(text, { today: "2000-01-01", horizonDays: 100000 }).problems,
      [],
    );
  });
});

describe("gate verdict", () => {
  const options = { today: TODAY };

  it("passes images without a fixable critical or high finding", () => {
    const verdict = evaluateGate({
      reports: { api: report([UNFIXED_CRITICAL, FIXABLE_MEDIUM]), web: report(null) },
      exceptionsText: exceptionsText(),
      ...options,
    });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.blocking, []);
  });

  it("fails on a fixable critical or high finding and names the service", () => {
    const verdict = evaluateGate({
      reports: { api: report([FIXABLE_HIGH]), web: report([FIXABLE_CRITICAL]) },
      exceptionsText: exceptionsText(),
      ...options,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(
      verdict.blocking.map(({ service, id }) => `${service} ${id}`),
      ["api CVE-2030-0001", "web CVE-2030-0002"],
    );
  });

  it("lets an unexpired exception excuse its finding, and lists it as excepted", () => {
    const verdict = evaluateGate({
      reports: { api: report([FIXABLE_HIGH]) },
      exceptionsText: exceptionsText(entry()),
      ...options,
    });
    assert.equal(verdict.ok, true);
    assert.deepEqual(
      verdict.excepted.map(({ service, id, reason }) => [service, id, typeof reason]),
      [["api", "CVE-2030-0001", "string"]],
    );
  });

  it("limits an exception to its package and service when it names them", () => {
    const reports = { api: report([FIXABLE_HIGH]), web: report([FIXABLE_HIGH]) };
    const forWeb = evaluateGate({
      reports,
      exceptionsText: exceptionsText(entry({ service: "web" })),
      ...options,
    });
    assert.deepEqual(
      forWeb.blocking.map(({ service }) => service),
      ["api"],
    );
    const otherPackage = evaluateGate({
      reports: { api: report([FIXABLE_HIGH]) },
      exceptionsText: exceptionsText(entry({ package: "libsomethingelse" })),
      ...options,
    });
    assert.equal(otherPackage.ok, false);
  });

  it("fails on an expired exception even when its finding is gone", () => {
    const verdict = evaluateGate({
      reports: { api: report(null) },
      exceptionsText: exceptionsText(entry({ expires: "2026-11-01" })),
      ...options,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join("\n"), /expired/);
  });

  it("does not let an expired exception excuse its finding", () => {
    const verdict = evaluateGate({
      reports: { api: report([FIXABLE_HIGH]) },
      exceptionsText: exceptionsText(entry({ expires: "2026-11-01" })),
      ...options,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.blocking.length, 1);
    assert.equal(verdict.excepted.length, 0);
  });

  it("fails when there is no image to judge", () => {
    assert.throws(
      () => evaluateGate({ reports: {}, exceptionsText: exceptionsText(), ...options }),
      /no image/i,
    );
  });
});

describe("pinned Trivy archive", () => {
  it("is a version with a SHA-256 and a release URL of the Trivy project", () => {
    assert.match(TRIVY.version, /^\d+\.\d+\.\d+$/);
    assert.match(TRIVY.sha256, /^[0-9a-f]{64}$/);
    assert.equal(
      TRIVY.url,
      `https://github.com/aquasecurity/trivy/releases/download/v${TRIVY.version}/trivy_${TRIVY.version}_Linux-ARM64.tar.gz`,
    );
  });

  it("accepts the bytes that match the checksum", () => {
    const bytes = Buffer.from("fictional archive");
    verifyArchive(bytes, createHash("sha256").update(bytes).digest("hex"));
  });

  it("refuses bytes that do not, and a malformed checksum", () => {
    const bytes = Buffer.from("fictional archive");
    assert.throws(
      () => verifyArchive(Buffer.from("changed"), createHash("sha256").update(bytes).digest("hex")),
      /checksum/i,
    );
    assert.throws(() => verifyArchive(bytes, "abc"), /checksum/i);
  });
});

// A stand-in `trivy`: writes the fixture named by FAKE_REPORT to the file after --output and records
// its arguments, one call per line, in FAKE_ARGS. It prints nothing else.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-scan-"));
  const fake = path.join(dir, "trivy");
  fs.writeFileSync(
    fake,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      "const args = process.argv.slice(2);",
      'fs.appendFileSync(process.env.FAKE_ARGS, args.join(" ") + "\\n");',
      'fs.writeFileSync(args[args.indexOf("--output") + 1], process.env.FAKE_REPORT);',
    ].join("\n"),
    { mode: 0o755 },
  );
  return { dir, fake, args: path.join(dir, "args.log") };
}

function run(command, env, box) {
  return spawnSync(process.execPath, [script, command], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, TRIVY: box.fake, FAKE_ARGS: box.args, ...env },
  });
}

describe("gate command", () => {
  const SHA = "a".repeat(40);

  it("scans the built images by their commit tag and passes a clean one", () => {
    const box = sandbox();
    const result = run(
      "gate",
      { SHA, BUILD: '["api","mcp-admin"]', FAKE_REPORT: JSON.stringify(report([FIXABLE_MEDIUM])) },
      box,
    );
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(box.args, "utf8").trim().split("\n");
    assert.equal(calls.length, 2);
    assert.match(calls[0], new RegExp(`ghcr.io/sebelapetr/sebela-api:${SHA}$`));
    assert.match(calls[1], new RegExp(`ghcr.io/sebelapetr/sebela-mcp-admin:${SHA}$`));
    for (const call of calls) {
      assert.match(call, /--image-src docker/);
      assert.match(call, /--severity CRITICAL,HIGH/);
      assert.match(call, /--format json/);
    }
  });

  it("fails on a fixable high finding and says which", () => {
    const box = sandbox();
    const result = run(
      "gate",
      { SHA, BUILD: '["web"]', FAKE_REPORT: JSON.stringify(report([FIXABLE_HIGH])) },
      box,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /web.*CVE-2030-0001/s);
  });

  it("passes the same finding when an unexpired exception in the given file excuses it", () => {
    const box = sandbox();
    const file = path.join(box.dir, "exceptions.json");
    const expires = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    fs.writeFileSync(file, exceptionsText(entry({ expires })));
    const result = run(
      "gate",
      {
        SHA,
        BUILD: '["web"]',
        EXCEPTIONS: file,
        FAKE_REPORT: JSON.stringify(report([FIXABLE_HIGH])),
      },
      box,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /excepted/i);
  });

  it("fails on an expired exception", () => {
    const box = sandbox();
    const file = path.join(box.dir, "exceptions.json");
    fs.writeFileSync(file, exceptionsText(entry({ expires: "2020-01-01" })));
    const result = run(
      "gate",
      { SHA, BUILD: '["web"]', EXCEPTIONS: file, FAKE_REPORT: JSON.stringify(report(null)) },
      box,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expired/);
  });

  it("fails rather than pass when the scan produces no report", () => {
    const box = sandbox();
    const result = run("gate", { SHA, BUILD: '["web"]', FAKE_REPORT: "not json" }, box);
    assert.notEqual(result.status, 0);
  });

  it("refuses a malformed commit and an unknown or empty list of services", () => {
    const box = sandbox();
    const ok = { FAKE_REPORT: JSON.stringify(report(null)) };
    assert.notEqual(run("gate", { ...ok, SHA: "main", BUILD: '["web"]' }, box).status, 0);
    assert.notEqual(run("gate", { ...ok, SHA, BUILD: '["database"]' }, box).status, 0);
    assert.notEqual(run("gate", { ...ok, SHA, BUILD: "[]" }, box).status, 0);
  });
});

describe("report command", () => {
  it("scans the current image of every service into SARIF files and never fails on findings", () => {
    const box = sandbox();
    const out = path.join(box.dir, "sarif");
    const result = run(
      "report",
      { OUT_DIR: out, FAKE_REPORT: '{"version":"2.1.0","runs":[]}' },
      box,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(out).sort(), ["api.sarif", "mcp-admin.sarif", "web.sarif"]);
    const calls = fs.readFileSync(box.args, "utf8").trim().split("\n");
    assert.equal(calls.length, 3);
    assert.match(calls[0], /ghcr.io\/sebelapetr\/sebela-api:current$/);
    for (const call of calls) {
      assert.match(call, /--image-src remote/);
      assert.match(call, /--format sarif/);
      assert.match(call, /--exit-code 0/);
      assert.match(call, /--platform linux\/arm64/);
    }
  });
});

describe("workflows", () => {
  const workflows = path.join(import.meta.dirname, "..", "..", ".github", "workflows");
  const release = fs.readFileSync(path.join(workflows, "release.yml"), "utf8");
  const weekly = fs.readFileSync(path.join(workflows, "image-scan.yml"), "utf8");

  it("the release gates the built images after the stack verification and before publishing", () => {
    const verify = release.indexOf("scripts/checks/production-stack.e2e.mjs --images");
    const gate = release.indexOf("node scripts/release/image-scan.mjs gate");
    const publish = release.indexOf("node scripts/release/images.mjs publish");
    assert.ok(verify > 0 && gate > verify && publish > gate);
  });

  it("the weekly scan reports on a schedule, needs no secret and runs Trivy from the pinned CLI", () => {
    assert.match(weekly, /schedule:\s+- cron:/);
    assert.doesNotMatch(weekly, /secrets\./);
    assert.doesNotMatch(weekly, /aquasecurity\//);
    assert.match(weekly, /node scripts\/release\/image-scan\.mjs install/);
    assert.match(weekly, /node scripts\/release\/image-scan\.mjs report/);
    assert.match(weekly, /security-events: write/);
  });

  it("no workflow uses the Trivy or setup-trivy action", () => {
    for (const name of fs.readdirSync(workflows)) {
      const text = fs.readFileSync(path.join(workflows, name), "utf8");
      assert.doesNotMatch(text, /uses:\s*aquasecurity\//, name);
    }
  });
});

describe("committed exceptions against the published images (2026-11-22)", () => {
  const dir = import.meta.dirname;
  const text = fs.readFileSync(path.join(dir, "image-scan-exceptions.json"), "utf8");
  const real = JSON.parse(
    fs.readFileSync(path.join(dir, "fixtures", "image-scan", "published-api.json"), "utf8"),
  );
  const reports = { api: real, web: real, "mcp-admin": real };

  it("excuse exactly the fixable high findings of the published images", () => {
    const verdict = evaluateGate({ reports, exceptionsText: text, today: "2026-11-22" });
    assert.deepEqual(verdict.problems, []);
    assert.deepEqual(verdict.blocking, []);
    assert.equal(verdict.excepted.length, 21);
  });

  it("do not hide a new fixable finding, even in an excepted package", () => {
    const fresh = structuredClone(real);
    fresh.Results[0].Vulnerabilities.push(
      vulnerability({ id: "CVE-2030-9999", pkg: "zlib1g", severity: "HIGH", fixed: "9" }),
      vulnerability({ id: "CVE-2030-9998", pkg: "libnew", severity: "CRITICAL", fixed: "9" }),
    );
    const verdict = evaluateGate({
      reports: { api: fresh },
      exceptionsText: text,
      today: "2026-11-22",
    });
    assert.deepEqual(verdict.blocking.map(({ id }) => id).sort(), [
      "CVE-2030-9998",
      "CVE-2030-9999",
    ]);
  });

  it("expire within 60 days, and then the gate fails", () => {
    const { exceptions } = parseExceptions(text, { today: "2026-11-22" });
    assert.equal(exceptions.length, 7);
    assert.ok(exceptions.every(({ expires }) => expires === "2027-01-21"));
    const verdict = evaluateGate({ reports, exceptionsText: text, today: "2027-01-22" });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join("\n"), /expired/);
  });
});
