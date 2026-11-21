// Behaviour of the image-content check's decision: which paths of an image's file system it refuses
// and why. The command line (`docker export` of a container of the image, listed with `tar`) is
// exercised on the real images and a fixture image by the production stack's smoke check
// (`production-stack.e2e.mjs`, the `production-stack` CI job), which needs Docker.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forbiddenEntries } from "./image-content.mjs";

const reasons = (paths) => forbiddenEntries(paths).map(({ path, reason }) => `${path} ${reason}`);

describe("image-content check", () => {
  it("accepts an image of code, dependencies, the example environment and the demo seed", () => {
    assert.deepEqual(
      forbiddenEntries([
        "app/",
        "app/package.json",
        "app/apps/api/dist/server.js",
        "app/node_modules/.pnpm/zod@4.0.0/node_modules/zod/index.js",
        "app/.env.example",
        "app/apps/web/.env.example",
        "app/packages/db/seed/",
        "app/packages/db/seed/README.md",
        "app/packages/db/seed/demo/",
        "app/packages/db/seed/demo/person.json",
        "app/packages/db/seed/demo/media/photo.webp",
        "app/packages/db/dist/seed/load.js",
        "etc/environment",
        "usr/lib/node_modules/npm/lib/utils/env.js",
        "app/apps/web/.envrc-notes",
      ]),
      [],
    );
  });

  it("refuses every environment file but the example, wherever it is", () => {
    assert.deepEqual(
      reasons([
        "app/.env",
        "app/.env.local",
        "app/apps/api/.env.production",
        "app/.env.secrets.example",
        "root/.env",
      ]),
      [
        "app/.env environment file",
        "app/.env.local environment file",
        "app/apps/api/.env.production environment file",
        "app/.env.secrets.example environment file",
        "root/.env environment file",
      ],
    );
  });

  it("names the secrets file as such", () => {
    assert.deepEqual(reasons(["app/.env.secrets"]), ["app/.env.secrets secrets file"]);
  });

  it("refuses anything from the private notes folder, the folder included", () => {
    assert.deepEqual(reasons(["app/.context/", "app/.context/notes.md", "srv/a/.context/b/c"]), [
      "app/.context/ private notes",
      "app/.context/notes.md private notes",
      "srv/a/.context/b/c private notes",
    ]);
  });

  it("refuses a seed other than the fictional demo", () => {
    assert.deepEqual(
      reasons([
        "app/packages/db/seed/owner/",
        "app/packages/db/seed/owner/person.json",
        "app/packages/db/seed/demo-copy/person.json",
        "app/packages/db/seed/README.md",
      ]),
      [
        "app/packages/db/seed/owner/ seed other than the demo",
        "app/packages/db/seed/owner/person.json seed other than the demo",
        "app/packages/db/seed/demo-copy/person.json seed other than the demo",
      ],
    );
  });

  it("reads a listing with leading ./ and blank lines", () => {
    assert.deepEqual(reasons(["./app/.env.local", "", "./app/ok.js"]), [
      "app/.env.local environment file",
    ]);
  });
});
