#!/usr/bin/env node
// End-to-end run of the worktree backend setup — see docs/repository-structure.md ("Ports and
// worktree isolation"): two real worktrees of a temporary clone of this checkout, each installed,
// migrated, given its own local storage folder and seeded, then served by its own API.
//
//   node harness/worktree-backend.e2e.mjs
//
// Needs Docker with Compose and pnpm. Like worktree-databases.e2e.mjs it starts its own disposable
// Compose project on a free host port, so the shared stack is never touched, and it clones the
// committed HEAD of this checkout into a temporary folder, so this checkout and its worktrees are
// never touched either. Everything is removed at the end, also when a step fails. Exits with 1 when
// a step fails. No cloud keys: storage is the local driver.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { worktreeEnv } from "./lib/backend.mjs";
import { PORT_STEP, PORT_VARIABLES } from "./lib/slots.mjs";
import { createWorktree, listWorktrees, loadSettings, removeWorktree } from "./worktree.mjs";

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..");
const ENV_FILE = ".env.local";
const ENV_FLAGS = [".env.example", ".env", ".env.local"].map(
  (file) => `--env-file-if-exists=../../${file}`,
);

function freePort(host, port = 0) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on("error", () => resolve(null));
    server.listen(port, host, () => {
      const { port: bound } = server.address();
      server.close(() => resolve(bound));
    });
  });
}

// Base ports whose API ports in slots 1 and 2 are free, so no running server is in the way.
async function freeBasePorts(host) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const start = 20_000 + Math.floor(Math.random() * 30_000);
    const apiPorts = [1, 2].map((slot) => start + 1 + slot * PORT_STEP);
    if ((await Promise.all(apiPorts.map((port) => freePort(host, port)))).every(Boolean)) {
      return Object.fromEntries(PORT_VARIABLES.map((name, i) => [name, String(start + i)]));
    }
  }
  throw new Error("no free ports for the worktree APIs");
}

const base = loadSettings(process.env);
const env = {
  ...base,
  ...(await freeBasePorts(base.API_HOST)),
  COMPOSE_PROJECT_NAME: `sebela-e2e-backend-${process.pid}`,
  POSTGRES_PORT: String(await freePort(base.POSTGRES_HOST)),
};

function compose(...args) {
  return execFileSync("docker", ["compose", "--project-directory", CHECKOUT_ROOT, ...args], {
    env,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function temporaryClone() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-e2e-backend-"));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", CHECKOUT_ROOT, root], {
    stdio: "ignore",
  });
  return root;
}

// A tree listing of the clone's tracked and untracked files, to show removal leaves it alone.
const snapshot = (root) =>
  execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });

const settingsOf = (worktree) =>
  parseEnv(fs.readFileSync(path.join(worktree.path, ENV_FILE), "utf8"));

// Runs a command of the worktree's API package the way its package scripts do: with its own
// environment files, none of the caller's settings.
function apiCli(worktree, ...args) {
  return execFileSync(process.execPath, [...ENV_FLAGS, ...args], {
    cwd: path.join(worktree.path, "apps", "api"),
    env: worktreeEnv(env, worktree.path),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Starts the worktree's built API on its own port; `stop` ends it.
async function startApi(worktree) {
  const settings = settingsOf(worktree);
  const address = `http://${env.API_HOST}:${settings.API_PORT}`;
  const child = spawn(process.execPath, [...ENV_FLAGS, "dist/server.js"], {
    cwd: path.join(worktree.path, "apps", "api"),
    env: worktreeEnv(env, worktree.path),
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the API of ${worktree.name} ended: ${log}`);
    try {
      if ((await fetch(`${address}/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`the API of ${worktree.name} did not start`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    address,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
      }),
  };
}

async function step(description, fn) {
  try {
    await fn();
  } catch (error) {
    error.message = `${description}: ${error.stderr?.toString().trim() || error.message}`;
    throw error;
  }
  console.log(`ok - ${description}`);
}

const mainRoot = temporaryClone();
const create = (branch) => createWorktree({ mainRoot, branch, base: "HEAD", env });
const remove = (target) => removeWorktree({ mainRoot, target, env });
const sample = fs.readFileSync(
  path.join(CHECKOUT_ROOT, "packages/db/seed/demo/files/logo-harbor.png"),
);
const apis = [];
let failed = false;

try {
  await step("the Postgres service starts and reports healthy", () => {
    compose("up", "--detach", "--wait", "--wait-timeout", "120");
  });

  let first;
  let second;
  const before = snapshot(mainRoot);
  await step("two worktrees are installed, migrated, given storage and seeded", () => {
    first = create("feat/1-first");
    second = create("fix/2-second");
    assert.notEqual(settingsOf(first).STORAGE_WORKTREE, settingsOf(second).STORAGE_WORKTREE);
  });

  const storageFolder = (worktree) => {
    const settings = { ...parseEnv(fs.readFileSync(path.join(mainRoot, ".env.example"), "utf8")) };
    return path.resolve(
      worktree.path,
      "apps",
      "api",
      settings.STORAGE_LOCAL_ROOT,
      settings.STORAGE_ENVIRONMENT,
      settingsOf(worktree).STORAGE_WORKTREE,
    );
  };

  await step("each worktree's storage folder carries its owner marker", () => {
    for (const worktree of [first, second]) {
      assert.equal(
        fs.readFileSync(path.join(storageFolder(worktree), ".owner"), "utf8"),
        `sebela worktree:${worktree.name}\n`,
      );
    }
  });

  const uploads = new Map();
  const keys = new Map();
  await step("each API serves its seeded profile and accepts an upload of its own", async () => {
    for (const worktree of [first, second]) {
      const api = await startApi(worktree);
      apis.push(api);
      const person = await fetch(`${api.address}/v1/person`);
      assert.equal(person.status, 200);
      const created = apiCli(worktree, "dist/cli/api-keys.js", "create", "e2e");
      const key = /^sebela_\S+$/m.exec(created)?.[0];
      assert.ok(key, "the command prints the new key");
      keys.set(worktree.name, key);
      const form = new FormData();
      form.append("file", new Blob([sample], { type: "image/png" }), "e2e.png");
      form.append("altText", `Upload of ${worktree.name}`);
      const uploaded = await fetch(`${api.address}/v1/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      assert.equal(uploaded.status, 201);
      const media = await uploaded.json();
      assert.ok(media.url.startsWith(`${api.address}/v1/media/files/`), media.url);
      const downloaded = await fetch(media.url);
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), sample);
      uploads.set(worktree.name, media.url);
    }
    await Promise.all(apis.splice(0).map((api) => api.stop()));
  });

  await step("setup again keeps edited content and does not seed it again", async () => {
    const edited = "Edited by an agent";
    const settings = fs.readFileSync(path.join(first.path, ENV_FILE), "utf8");
    const topicNames = async (api) =>
      (await (await fetch(`${api.address}/v1/topics`)).json()).map(({ name }) => name);

    let api = await startApi(first);
    apis.push(api);
    const [topic] = await (await fetch(`${api.address}/v1/topics`)).json();
    const patched = await fetch(`${api.address}/v1/topics/${topic.slug}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${keys.get(first.name)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: edited }),
    });
    assert.equal(patched.status, 200);
    await Promise.all(apis.splice(0).map((running) => running.stop()));

    assert.deepEqual(create("feat/1-first"), first);
    assert.equal(fs.readFileSync(path.join(first.path, ENV_FILE), "utf8"), settings);

    api = await startApi(first);
    apis.push(api);
    assert.ok((await topicNames(api)).includes(edited));
    await Promise.all(apis.splice(0).map((running) => running.stop()));
  });

  await step(
    "removing one worktree keeps the other's data and files and the main checkout",
    async () => {
      const firstStorage = storageFolder(first);
      remove("feat/1-first");
      assert.equal(fs.existsSync(first.path), false);
      assert.equal(fs.existsSync(firstStorage), false);
      assert.deepEqual(listWorktrees({ mainRoot }), [{ slot: second.slot, name: second.name }]);
      assert.equal(snapshot(mainRoot), before);

      const api = await startApi(second);
      apis.push(api);
      assert.equal((await fetch(`${api.address}/v1/person`)).status, 200);
      const kept = await fetch(uploads.get(second.name));
      assert.equal(kept.status, 200);
      assert.deepEqual(Buffer.from(await kept.arrayBuffer()), sample);
      await Promise.all(apis.splice(0).map((running) => running.stop()));
    },
  );

  await step("removing the other leaves no worktree, storage folder or slot", () => {
    const secondStorage = storageFolder(second);
    remove(second.path);
    assert.equal(fs.existsSync(secondStorage), false);
    assert.deepEqual(listWorktrees({ mainRoot }), []);
    assert.equal(snapshot(mainRoot), before);
  });
} catch (error) {
  failed = true;
  console.error(`not ok - ${error.message}`);
} finally {
  await Promise.all(apis.map((api) => api.stop()));
  try {
    compose("down", "--volumes", "--remove-orphans");
    console.log("ok - the disposable project and its volume are removed");
  } catch (error) {
    failed = true;
    console.error(
      `not ok - removing project ${env.COMPOSE_PROJECT_NAME}: ${error.stderr?.toString().trim() || error.message}`,
    );
  }
  fs.rmSync(mainRoot, { recursive: true, force: true });
}

process.exitCode = failed ? 1 : 0;
