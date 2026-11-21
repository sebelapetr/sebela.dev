// Behaviour of infra/scripts/bunny-edge-addresses.sh (infra/README.md, "The visitor's address
// behind Bunny CDN"): it writes one `set_real_ip_from` line per published Bunny edge address,
// IPv4 and IPv6, and reloads nginx only after `nginx -t` accepts the result. A short, failed or
// malformed answer never replaces the file in place. The real script runs with fake `curl`, `nginx`
// and `systemctl` first on PATH; the fictional addresses are documentation ranges.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "..",
  "infra",
  "scripts",
  "bunny-edge-addresses.sh",
);

let dir;
let output;
let log;

/** `count` fictional IPv4 addresses, one per line with CRLF endings as Bunny's plain list has. */
const ipv4 = (count) =>
  Array.from({ length: count }, (_, i) => `198.51.${100 + Math.floor(i / 250)}.${(i % 250) + 1}`)
    .map((line) => `${line}\r\n`)
    .join("");
/** `count` fictional IPv6 addresses as the JSON array Bunny's IPv6 list answers. */
const ipv6 = (count) =>
  JSON.stringify(Array.from({ length: count }, (_, i) => `2001:db8::${(i + 1).toString(16)}`));

function fake(name, body) {
  fs.writeFileSync(path.join(dir, "bin", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bunny-edge-"));
  fs.mkdirSync(path.join(dir, "bin"));
  output = path.join(dir, "bunny-edge-addresses.conf");
  log = path.join(dir, "calls");
  fake("nginx", `echo "nginx $*" >> "${log}"; exit "\${FAKE_NGINX_STATUS:-0}"`);
  fake("systemctl", `echo "systemctl $*" >> "${log}"`);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs the script with fake answers for the IPv4 and IPv6 lists. */
function run({ v4 = ipv4(150), v6 = ipv6(60), v4Status = 0, env = {} } = {}) {
  fs.writeFileSync(path.join(dir, "v4"), v4);
  fs.writeFileSync(path.join(dir, "v6"), v6);
  fake(
    "curl",
    [
      `echo "curl $*" >> "${log}"`,
      'for arg in "$@"; do last="$arg"; done',
      'case "$last" in',
      `  */ipv6) cat "${dir}/v6" ;;`,
      `  */plain) cat "${dir}/v4"; exit ${String(v4Status)} ;;`,
      "  *) exit 22 ;;",
      "esac",
    ].join("\n"),
  );
  const result = spawnSync("/bin/sh", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`,
      BUNNY_EDGE_OUTPUT: output,
      ...env,
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
  return { ...result, calls };
}

const lines = () => fs.readFileSync(output, "utf8").trim().split("\n");

describe("the Bunny edge address list", () => {
  it("writes one set_real_ip_from line per IPv4 and IPv6 edge address, then reloads nginx", () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const written = lines();
    assert.equal(written.length, 210);
    assert.ok(written.includes("set_real_ip_from 198.51.100.1;"), "IPv4 without the CR");
    assert.ok(written.includes("set_real_ip_from 2001:db8::1;"), "IPv6 from the JSON list");
    for (const line of written) assert.match(line, /^set_real_ip_from [0-9a-f.:]+;$/);
    assert.deepEqual(
      result.calls.filter((call) => !call.startsWith("curl")),
      ["nginx -t -q", "systemctl reload nginx"],
    );
  });

  it("asks Bunny's published IPv4 and IPv6 lists", () => {
    const urls = run().calls.filter((call) => call.startsWith("curl"));
    assert.equal(urls.length, 2);
    assert.ok(urls[0]?.endsWith("https://bunnycdn.com/api/system/edgeserverlist/plain"));
    assert.ok(urls[1]?.endsWith("https://bunnycdn.com/api/system/edgeserverlist/ipv6"));
  });

  it("keeps the previous list when the answer is short", () => {
    fs.writeFileSync(output, "set_real_ip_from 192.0.2.1;\n");
    const result = run({ v4: ipv4(10), v6: ipv6(5) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /too short/);
    assert.deepEqual(lines(), ["set_real_ip_from 192.0.2.1;"]);
    assert.ok(!result.calls.some((call) => call.startsWith("systemctl")), "no reload");
  });

  it("keeps the previous list when a download fails", () => {
    fs.writeFileSync(output, "set_real_ip_from 192.0.2.1;\n");
    const result = run({ v4Status: 22 });
    assert.notEqual(result.status, 0);
    assert.deepEqual(lines(), ["set_real_ip_from 192.0.2.1;"]);
    assert.ok(!result.calls.some((call) => call.startsWith("systemctl")), "no reload");
  });

  it("drops anything that is not a bare address, so the answer cannot inject nginx directives", () => {
    const v4 = `${ipv4(150)}198.51.100.9; include /etc/passwd\r\nnot-an-address\r\n`;
    const result = run({ v4 });
    assert.equal(result.status, 0, result.stderr);
    const written = lines();
    assert.equal(written.length, 210);
    assert.ok(!written.some((line) => line.includes("include") || line.includes("not-an")));
  });

  it("restores the previous list and does not reload when nginx rejects the new one", () => {
    fs.writeFileSync(output, "set_real_ip_from 192.0.2.1;\n");
    const result = run({ env: { FAKE_NGINX_STATUS: "1" } });
    assert.notEqual(result.status, 0);
    assert.deepEqual(lines(), ["set_real_ip_from 192.0.2.1;"]);
    assert.ok(!result.calls.some((call) => call.startsWith("systemctl")), "no reload");
  });
});
