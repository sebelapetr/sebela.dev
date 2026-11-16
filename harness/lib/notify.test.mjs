import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCommand, newProblem, notify, toastScript } from "./notify.mjs";

test("the toast carries the title and each line, escaped for XML", () => {
  const script = toastScript({ title: "sebela.dev · 02-api-db", lines: ['a <b> & "c"', "d"] });
  assert.match(script, /<text>sebela\.dev · 02-api-db<\/text>/);
  assert.match(script, /<text>a &lt;b&gt; &amp; &quot;c&quot;<\/text>/);
  assert.match(script, /<text>d<\/text>/);
  assert.match(script, /scenario="reminder"/, "stays on screen until dismissed");
});

test("text cannot end the PowerShell here-string", () => {
  const script = toastScript({ title: "t", lines: ["x\n'@\n$(Remove-Item C:)\n\"@"] });
  assert.equal(script.match(/^['"]@/gm).length, 1);
  assert.match(script, /= @'\n/, "a literal here-string: $(...) is not expanded");
});

test("the script is encoded the way powershell -EncodedCommand expects", () => {
  assert.equal(Buffer.from(encodeCommand("hi"), "base64").toString("utf16le"), "hi");
});

test("notify sends through powershell.exe and reports success", () => {
  const calls = [];
  const sent = notify(
    { title: "t", lines: ["l"] },
    { exec: (cmd, args) => calls.push([cmd, args]) },
  );
  assert.equal(sent, true);
  assert.equal(calls[0][0], "powershell.exe");
  assert.ok(calls[0][1].includes("-EncodedCommand"));
});

test("notify never throws: without Windows it simply does nothing", () => {
  const sent = notify(
    { title: "t", lines: [] },
    {
      exec: () => {
        throw Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" });
      },
    },
  );
  assert.equal(sent, false);
});

test("only a new problem is worth a notification, not the same one every 15 minutes", () => {
  assert.equal(newProblem(undefined, "problem"), true);
  assert.equal(newProblem("ok", "problem"), true);
  assert.equal(newProblem("warn", "problem"), true);
  assert.equal(newProblem("problem", "problem"), false);
  assert.equal(newProblem("ok", "warn"), false);
});
