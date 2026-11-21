// Behaviour of the release files (docs/release-workflow.md, "Release files"): which files a GitHub
// release attaches for the images its run built, how they are named, and the checks that refuse an
// incomplete or mismatched set, on fictional SBOMs and Sigstore bundles (fixtures/release-files.mjs).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  bundleLine,
  provenanceBundle,
  sbomBundle,
  sbomDocument,
  sbomText,
  statement,
} from "./fixtures/release-files.mjs";
import { imageFiles, releaseFileNames, releaseFiles } from "./release-files.mjs";

const script = path.join(import.meta.dirname, "release-files.mjs");
const digest = (character) => `sha256:${character.repeat(64)}`;
const name = (service) => `ghcr.io/sebelapetr/sebela-${service}`;

/** The three files the release workflow has for a pushed image. */
function attested(service, imageDigest) {
  const sbom = sbomDocument(service);
  const subject = { name: name(service), digest: imageDigest };
  return {
    sbom: sbomText(service),
    provenance: provenanceBundle(subject),
    sbomAttestation: sbomBundle({ ...subject, sbom }),
  };
}

describe("release file names", () => {
  it("name the image and the release version", () => {
    assert.deepEqual(releaseFileNames("api", "v1.3.0"), {
      sbom: "sebela-api-v1.3.0.spdx.json",
      attestations: "sebela-api-v1.3.0.intoto.jsonl",
    });
    assert.deepEqual(releaseFileNames("mcp-admin", "v0.4.0"), {
      sbom: "sebela-mcp-admin-v0.4.0.spdx.json",
      attestations: "sebela-mcp-admin-v0.4.0.intoto.jsonl",
    });
  });

  it("end in the provenance extension Scorecard's Signed-Releases check gives full credit", () => {
    assert.match(releaseFileNames("web", "v1.0.0").attestations, /\.intoto\.jsonl$/);
  });

  it("refuse an unknown service and a version that is not vX.Y.Z", () => {
    assert.throws(() => releaseFileNames("worker", "v1.0.0"), /unknown service/i);
    assert.throws(() => releaseFileNames("api", "1.0.0"), /version/i);
    assert.throws(() => releaseFileNames("api", "v1.0.0/../x"), /version/i);
  });
});

describe("release files", () => {
  it("are the SBOM and attestations of every image the release built, in the order of the services", () => {
    assert.deepEqual(releaseFiles({ version: "v1.3.0", built: ["mcp-admin", "api"] }), [
      "sebela-api-v1.3.0.spdx.json",
      "sebela-api-v1.3.0.intoto.jsonl",
      "sebela-mcp-admin-v1.3.0.spdx.json",
      "sebela-mcp-admin-v1.3.0.intoto.jsonl",
    ]);
  });

  it("leave out the reused images, whose files belong to the run that built them", () => {
    const files = releaseFiles({ version: "v1.3.0", built: ["web"] });
    assert.ok(files.every((file) => file.startsWith("sebela-web-")));
  });

  it("refuse a release that built nothing, an unknown service and a list that is not one", () => {
    assert.throws(() => releaseFiles({ version: "v1.3.0", built: [] }), /no image/i);
    assert.throws(() => releaseFiles({ version: "v1.3.0", built: ["api", "x"] }), /unknown/i);
    assert.throws(() => releaseFiles({ version: "v1.3.0", built: "api" }), /list/i);
    assert.throws(() => releaseFiles({ version: "v1.3.0", built: ["api", "api"] }), /twice/i);
  });
});

describe("image files", () => {
  const pushed = digest("a");

  it("are the SBOM unchanged and both attestation bundles, provenance first, one per line", () => {
    const files = attested("api", pushed);
    const result = imageFiles({ service: "api", digest: pushed, ...files });
    assert.equal(result.sbom, files.sbom);
    assert.equal(result.attestations, `${files.provenance}${files.sbomAttestation}`);
    assert.equal(result.attestations.split("\n").filter(Boolean).length, 2);
  });

  it("refuse bundles of another digest or another image", () => {
    const other = attested("api", digest("b"));
    assert.throws(
      () => imageFiles({ service: "api", digest: pushed, ...other }),
      /does not attest .*sebela-api@sha256:a{64}/,
    );
    const web = attested("web", pushed);
    assert.throws(
      () => imageFiles({ service: "api", digest: pushed, ...web }),
      /does not attest .*sebela-api/,
    );
  });

  it("refuse swapped bundles: the provenance must be SLSA provenance, the SBOM attestation SPDX", () => {
    const files = attested("api", pushed);
    assert.throws(
      () =>
        imageFiles({
          service: "api",
          digest: pushed,
          ...files,
          provenance: files.sbomAttestation,
          sbomAttestation: files.provenance,
        }),
      /predicate type/i,
    );
  });

  it("refuse an SBOM that is not the one the attestation signed", () => {
    const files = attested("api", pushed);
    const changed = { ...sbomDocument("api"), name: "something else" };
    assert.throws(
      () =>
        imageFiles({
          service: "api",
          digest: pushed,
          ...files,
          sbom: JSON.stringify(changed),
        }),
      /not the SBOM its attestation signed/i,
    );
  });

  it("accept the attested SBOM however its JSON is laid out", () => {
    const files = attested("api", pushed);
    const compact = JSON.stringify(sbomDocument("api"));
    assert.equal(
      imageFiles({ service: "api", digest: pushed, ...files, sbom: compact }).sbom,
      compact,
    );
  });

  const broken = {
    "an empty bundle": "",
    "a bundle that is not JSON": "{not json\n",
    "two bundles where one is written": () =>
      `${provenanceBundle({ name: name("api"), digest: pushed })}${provenanceBundle({ name: name("api"), digest: pushed })}`,
    "a bundle without a DSSE envelope": `${JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" })}\n`,
    "a bundle whose payload is not in-toto": () =>
      bundleLine(
        statement({
          subjects: [{ name: name("api"), digest: pushed }],
          predicateType: "https://slsa.dev/provenance/v1",
          predicate: {},
        }),
        { payloadType: "text/plain" },
      ),
    "a bundle without signatures": () => {
      const bundle = JSON.parse(provenanceBundle({ name: name("api"), digest: pushed }));
      bundle.dsseEnvelope.signatures = [];
      return `${JSON.stringify(bundle)}\n`;
    },
  };
  for (const [label, value] of Object.entries(broken)) {
    it(`refuse ${label}`, () => {
      const provenance = typeof value === "function" ? value() : value;
      assert.throws(() =>
        imageFiles({ service: "api", digest: pushed, ...attested("api", pushed), provenance }),
      );
    });
  }

  it("refuse an SBOM that is not SPDX JSON and a digest that is not SHA-256", () => {
    const files = attested("api", pushed);
    assert.throws(() =>
      imageFiles({ service: "api", digest: pushed, ...files, sbom: '{"bomFormat":"CycloneDX"}' }),
    );
    assert.throws(() => imageFiles({ service: "api", digest: "sha256:abc", ...files }), /digest/i);
  });
});

// The command line, as the release workflow runs it.

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "release-files-"));
}

function run(command, env, input) {
  const result = spawnSync(process.execPath, [script, command], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
    input,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Writes the files of a pushed image where the workflow's steps leave them; their env. */
function writeAttested(directory, service, imageDigest) {
  const files = attested(service, imageDigest);
  const key = service.toUpperCase().replace("-", "_");
  const env = {};
  for (const [kind, text] of Object.entries(files)) {
    const file = path.join(directory, `${service}-${kind}`);
    fs.writeFileSync(file, text);
    const prefix = { sbom: "SBOM", provenance: "PROVENANCE", sbomAttestation: "SBOM_ATTESTATION" };
    env[`${prefix[kind]}_${key}`] = file;
  }
  return { files, env };
}

describe("collect", () => {
  it("copies the files of every pushed image under the service's name, and nothing else", () => {
    const directory = temporary();
    const out = path.join(directory, "release-files");
    const api = writeAttested(directory, "api", digest("a"));
    const admin = writeAttested(directory, "mcp-admin", digest("c"));
    const result = run("collect", {
      DIGESTS: JSON.stringify({ api: digest("a"), "mcp-admin": digest("c") }),
      FILES_DIR: out,
      ...api.env,
      ...admin.env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(out).sort(), [
      "api.provenance.json",
      "api.sbom-attestation.json",
      "api.spdx.json",
      "mcp-admin.provenance.json",
      "mcp-admin.sbom-attestation.json",
      "mcp-admin.spdx.json",
    ]);
    assert.equal(fs.readFileSync(path.join(out, "api.spdx.json"), "utf8"), api.files.sbom);
    assert.equal(
      fs.readFileSync(path.join(out, "mcp-admin.provenance.json"), "utf8"),
      admin.files.provenance,
    );
  });

  it("fails when a pushed image has no attestation bundle", () => {
    const directory = temporary();
    const api = writeAttested(directory, "api", digest("a"));
    delete api.env.PROVENANCE_API;
    const result = run("collect", {
      DIGESTS: JSON.stringify({ api: digest("a") }),
      FILES_DIR: path.join(directory, "release-files"),
      ...api.env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PROVENANCE_API/);
  });

  it("fails when nothing was pushed", () => {
    const directory = temporary();
    const result = run("collect", {
      DIGESTS: "{}",
      FILES_DIR: path.join(directory, "release-files"),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no image/i);
  });
});

describe("prepare", () => {
  /** The release files folder as `collect` leaves it, for images pushed at `digests`. */
  function collected(digests) {
    const directory = temporary();
    const files = path.join(directory, "release-files");
    fs.mkdirSync(files);
    for (const [service, imageDigest] of Object.entries(digests)) {
      const { sbom, provenance, sbomAttestation } = attested(service, imageDigest);
      fs.writeFileSync(path.join(files, `${service}.spdx.json`), sbom);
      fs.writeFileSync(path.join(files, `${service}.provenance.json`), provenance);
      fs.writeFileSync(path.join(files, `${service}.sbom-attestation.json`), sbomAttestation);
    }
    return { directory, files, out: path.join(directory, "release-assets") };
  }

  const prepare = ({ files, out }, built, digests) =>
    run("prepare", {
      VERSION: "v1.3.0",
      BUILT: JSON.stringify(built),
      DIGESTS: JSON.stringify(digests),
      FILES_DIR: files,
      OUT_DIR: out,
    });

  const pushed = { api: digest("a"), web: digest("b") };

  it("names the files of the built images for the version and prints their paths", () => {
    const folder = collected(pushed);
    const result = prepare(folder, ["api", "web"], pushed);
    assert.equal(result.status, 0, result.stderr);
    const printed = result.stdout.split("\n").filter(Boolean);
    assert.deepEqual(
      printed,
      [
        "sebela-api-v1.3.0.spdx.json",
        "sebela-api-v1.3.0.intoto.jsonl",
        "sebela-web-v1.3.0.spdx.json",
        "sebela-web-v1.3.0.intoto.jsonl",
      ].map((file) => path.join(folder.out, file)),
    );
    const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
    assert.equal(
      read(folder.out, "sebela-web-v1.3.0.spdx.json"),
      read(folder.files, "web.spdx.json"),
    );
    assert.equal(
      read(folder.out, "sebela-api-v1.3.0.intoto.jsonl"),
      read(folder.files, "api.provenance.json") + read(folder.files, "api.sbom-attestation.json"),
    );
  });

  it("fails, printing nothing, when a built image's file is missing", () => {
    const folder = collected({ api: pushed.api });
    const result = prepare(folder, ["api", "web"], pushed);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /web\.spdx\.json/);
  });

  it("fails when the files name an image the release did not build", () => {
    const folder = collected(pushed);
    const result = prepare(folder, ["api"], { api: pushed.api });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /web\.provenance\.json/);
  });

  it("fails when the built images and the pushed digests disagree", () => {
    const folder = collected({ api: pushed.api });
    const result = prepare(folder, ["api"], pushed);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /digests/i);
  });

  it("fails, printing nothing, when a bundle attests another digest than the one pushed", () => {
    const folder = collected({ api: digest("e") });
    const result = prepare(folder, ["api"], { api: pushed.api });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /does not attest/);
  });

  it("fails on an empty file", () => {
    const folder = collected({ api: pushed.api });
    fs.writeFileSync(path.join(folder.files, "api.spdx.json"), "");
    const result = prepare(folder, ["api"], { api: pushed.api });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  });
});

describe("check", () => {
  const env = { VERSION: "v1.3.0", BUILT: '["api"]' };

  it("passes when the release has exactly the files of its built images", () => {
    const result = run(
      "check",
      env,
      "sebela-api-v1.3.0.intoto.jsonl\nsebela-api-v1.3.0.spdx.json\n",
    );
    assert.equal(result.status, 0, result.stderr);
  });

  it("fails when a file is missing or another one is attached", () => {
    const missing = run("check", env, "sebela-api-v1.3.0.spdx.json\n");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing: sebela-api-v1\.3\.0\.intoto\.jsonl/);
    const extra = run(
      "check",
      env,
      "sebela-api-v1.3.0.spdx.json\nsebela-api-v1.3.0.intoto.jsonl\nnotes.txt\n",
    );
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /unexpected: notes\.txt/);
  });

  it("fails when the release has no files at all", () => {
    const result = run("check", env, "");
    assert.equal(result.status, 1);
  });
});
