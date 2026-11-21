#!/usr/bin/env node
// The files of a GitHub release (docs/release-workflow.md, "Release files"): for every image the
// release's run built and pushed, its SPDX SBOM and the Sigstore bundles of its two attestations
// (the SLSA build provenance and the SBOM attestation), named with the image and the version. A
// reused image gets no files: they belong to the run that built it, and its attestations stay
// beside it in GHCR. The release workflow (.github/workflows/release.yml) runs
//
//   DIGESTS='{"api":"sha256:..."}' FILES_DIR=<dir> SBOM_API=<file> PROVENANCE_API=<file> \
//     SBOM_ATTESTATION_API=<file> ... node scripts/release/release-files.mjs collect
//   VERSION=<tag> BUILT='["api"]' DIGESTS='{...}' FILES_DIR=<dir> OUT_DIR=<dir> \
//     node scripts/release/release-files.mjs prepare
//   <asset names, one per line> | VERSION=<tag> BUILT='["api"]' \
//     node scripts/release/release-files.mjs check
//
// - collect (images job, after the attestations): copies, for each pushed image (DIGESTS, the
//   `publish` output), its SBOM and its two bundles to FILES_DIR as `<service>.spdx.json`,
//   `<service>.provenance.json` and `<service>.sbom-attestation.json`, for the artifact the
//   release job reads. The per-service variables are SBOM_<SERVICE>, PROVENANCE_<SERVICE> and
//   SBOM_ATTESTATION_<SERVICE>, the service in upper case with `_` for `-`. It checks only that
//   the files exist, so it cannot hold up a deployment the attestations did not.
// - prepare (release job, after the deployment): checks that the folder holds exactly the files
//   of the built images (BUILT, which must be the services of DIGESTS), that both bundles attest
//   exactly the pushed digest with the expected predicate type and that the SBOM is the one its
//   attestation signed; then writes the release files to OUT_DIR, the bundles joined into the
//   `.intoto.jsonl` file (provenance first, one per line), and prints their paths, one per line.
//   It prints nothing and writes nothing when any check fails.
// - check (release job, after publishing): fails unless the release's asset names on standard input
//   are exactly the release files of the built images.
//
// Plain Node with no dependencies. The signatures are not checked here; `gh attestation verify`
// checks them (docs/release-workflow.md).

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { SERVICES, imageName } from "./images.mjs";

const VERSION = /^v\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const BUNDLE_MEDIA_TYPE = /^application\/vnd\.dev\.sigstore\.bundle(\.v0\.\d+)?\+json/;
const IN_TOTO_PAYLOAD = "application/vnd.in-toto+json";
const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
const PROVENANCE_TYPE = "https://slsa.dev/provenance/v1";

function knownService(service) {
  if (!SERVICES.includes(service)) throw new Error(`An unknown service: ${String(service)}`);
  return service;
}

/**
 * The names a release `version` (vX.Y.Z) gives the files of `service`'s image: its SPDX SBOM and
 * its attestation bundles, whose `.intoto.jsonl` ending is the provenance file Scorecard's
 * Signed-Releases check gives full credit for.
 */
export function releaseFileNames(service, version) {
  knownService(service);
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw new Error(`The release version is not a vX.Y.Z tag: ${String(version)}`);
  }
  const base = `${path.basename(imageName(service))}-${version}`;
  return { sbom: `${base}.spdx.json`, attestations: `${base}.intoto.jsonl` };
}

function builtServices(built) {
  if (!Array.isArray(built)) throw new Error("The built images are not a list of services.");
  if (built.length === 0) throw new Error("The release built no image, so it has no files.");
  for (const service of built) knownService(service);
  if (new Set(built).size !== built.length) throw new Error("A built image is named twice.");
  return SERVICES.filter((service) => built.includes(service));
}

/**
 * The files a release `version` attaches: for every service in `built`, the images its run built,
 * in the order of SERVICES, the SBOM and then the attestations. Reused images have none here.
 */
export function releaseFiles({ version, built }) {
  return builtServices(built).flatMap((service) => {
    const { sbom, attestations } = releaseFileNames(service, version);
    return [sbom, attestations];
  });
}

/** The one bundle in `text` (one JSON line, as `actions/attest` writes it) and its statement. */
function readBundle(text, label) {
  const lines = (text ?? "").split("\n").filter((line) => line.trim() !== "");
  if (lines.length !== 1) {
    throw new Error(`The ${label} holds ${lines.length} bundles; the action writes one.`);
  }
  const [line] = lines;
  let bundle;
  try {
    bundle = JSON.parse(line);
  } catch {
    throw new Error(`The ${label} is not JSON.`);
  }
  if (!BUNDLE_MEDIA_TYPE.test(String(bundle?.mediaType))) {
    throw new Error(`The ${label} is not a Sigstore bundle.`);
  }
  const envelope = bundle.dsseEnvelope;
  if (envelope?.payloadType !== IN_TOTO_PAYLOAD || typeof envelope.payload !== "string") {
    throw new Error(`The ${label} holds no DSSE envelope of an in-toto statement.`);
  }
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0) {
    throw new Error(`The ${label} is not signed.`);
  }
  let statement;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  } catch {
    throw new Error(`The statement of the ${label} is not JSON.`);
  }
  if (statement?._type !== STATEMENT_TYPE) {
    throw new Error(`The ${label} holds no in-toto statement.`);
  }
  return { line: `${line}\n`, statement };
}

/** Throws unless `statement` is about exactly the image `name@digest`, with `predicateType`. */
function checkStatement(statement, { name, digest, predicateType, label }) {
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  const hex = digest.slice("sha256:".length);
  const matches =
    subjects.length === 1 && subjects[0]?.name === name && subjects[0]?.digest?.sha256 === hex;
  if (!matches) throw new Error(`The ${label} does not attest ${name}@${digest}.`);
  if (statement.predicateType !== predicateType) {
    throw new Error(
      `The ${label} has the predicate type ${String(statement.predicateType)}, not ${predicateType}.`,
    );
  }
}

/**
 * The release files of one pushed image of `service` at `digest`, from the texts of its SBOM file,
 * its build provenance bundle and its SBOM attestation bundle: the SBOM unchanged, and the two
 * bundles as `attestations`, provenance first, one per line. Throws when a bundle attests another
 * image or digest or has another predicate type, or the SBOM is not the one its attestation signed.
 */
export function imageFiles({ service, digest, sbom, provenance, sbomAttestation }) {
  knownService(service);
  if (typeof digest !== "string" || !DIGEST.test(digest)) {
    throw new Error(`The pushed digest of ${service} is not a SHA-256 digest: ${String(digest)}`);
  }
  const name = imageName(service);
  let document;
  try {
    document = JSON.parse(sbom ?? "");
  } catch {
    throw new Error(`The SBOM of ${service} is not JSON.`);
  }
  const spdxVersion = document?.spdxVersion;
  if (typeof spdxVersion !== "string" || !/^SPDX-\d+\.\d+$/.test(spdxVersion)) {
    throw new Error(`The SBOM of ${service} is not an SPDX document.`);
  }
  const built = readBundle(provenance, `provenance bundle of ${service}`);
  checkStatement(built.statement, {
    name,
    digest,
    predicateType: PROVENANCE_TYPE,
    label: `provenance bundle of ${service}`,
  });
  const attested = readBundle(sbomAttestation, `SBOM attestation bundle of ${service}`);
  checkStatement(attested.statement, {
    name,
    digest,
    predicateType: `https://spdx.dev/Document/v${spdxVersion.slice("SPDX-".length)}`,
    label: `SBOM attestation bundle of ${service}`,
  });
  if (!isDeepStrictEqual(attested.statement.predicate, document)) {
    throw new Error(`The SBOM file of ${service} is not the SBOM its attestation signed.`);
  }
  return { sbom, attestations: `${built.line}${attested.line}` };
}

// The command line.

const log = (text) => process.stderr.write(`${text}\n`);

const envKey = (service) => service.toUpperCase().replaceAll("-", "_");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

function jsonFromEnvironment(name) {
  try {
    return JSON.parse(process.env[name] ?? "null");
  } catch {
    throw new Error(`${name} is not JSON.`);
  }
}

const builtFromEnvironment = () => jsonFromEnvironment("BUILT");

/** DIGESTS, the `publish` output: an object of each pushed service and its digest. */
function digestsFromEnvironment() {
  const digests = jsonFromEnvironment("DIGESTS");
  if (digests === null || typeof digests !== "object" || Array.isArray(digests)) {
    throw new Error("DIGESTS is not an object of services and digests.");
  }
  return digests;
}

/** The files `collect` leaves for a service: its release file name stem to the file name. */
const collectedFiles = (service) => ({
  sbom: `${service}.spdx.json`,
  provenance: `${service}.provenance.json`,
  sbomAttestation: `${service}.sbom-attestation.json`,
});

function collectCommand() {
  const services = builtServices(Object.keys(digestsFromEnvironment()));
  const filesDir = required("FILES_DIR");
  const copies = services.flatMap((service) => {
    const key = envKey(service);
    const names = collectedFiles(service);
    return [
      { from: `SBOM_${key}`, to: names.sbom },
      { from: `PROVENANCE_${key}`, to: names.provenance },
      { from: `SBOM_ATTESTATION_${key}`, to: names.sbomAttestation },
    ].map(({ from, to }) => ({ from: required(from), name: from, to }));
  });
  for (const { from, name } of copies) {
    if (!fs.existsSync(from)) throw new Error(`${name} names no file: ${from}`);
  }
  fs.mkdirSync(filesDir, { recursive: true });
  for (const { from, to } of copies) fs.copyFileSync(from, path.join(filesDir, to));
  log(`Collected the SBOMs and attestation bundles of ${services.join(", ")}.`);
}

function prepareCommand() {
  const version = required("VERSION");
  const services = builtServices(builtFromEnvironment());
  const digests = digestsFromEnvironment();
  const pushed = Object.keys(digests).sort();
  if (pushed.join(",") !== [...services].sort().join(",")) {
    throw new Error(
      `The built images (${services.join(", ")}) are not the pushed digests (${pushed.join(", ") || "none"}).`,
    );
  }
  const filesDir = path.resolve(required("FILES_DIR"));
  const outDir = path.resolve(required("OUT_DIR"));
  const expected = services.flatMap((service) => Object.values(collectedFiles(service)));
  const present = fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : [];
  const missing = expected.filter((file) => !present.includes(file));
  const unexpected = present.filter((file) => !expected.includes(file));
  if (missing.length > 0 || unexpected.length > 0) {
    const problems = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
      unexpected.length > 0 ? `not of an image this release built: ${unexpected.join(", ")}` : null,
    ].filter(Boolean);
    throw new Error(`The release files in ${filesDir} are not complete; ${problems.join("; ")}.`);
  }
  const read = (file) => fs.readFileSync(path.join(filesDir, file), "utf8");
  // Every image is checked before anything is written, so a failure prints no path.
  const prepared = services.flatMap((service) => {
    const names = collectedFiles(service);
    const files = imageFiles({
      service,
      digest: digests[service],
      sbom: read(names.sbom),
      provenance: read(names.provenance),
      sbomAttestation: read(names.sbomAttestation),
    });
    const target = releaseFileNames(service, version);
    return [
      { to: path.join(outDir, target.sbom), text: files.sbom },
      { to: path.join(outDir, target.attestations), text: files.attestations },
    ];
  });
  fs.mkdirSync(outDir, { recursive: true });
  for (const { to, text } of prepared) fs.writeFileSync(to, text);
  process.stdout.write(prepared.map(({ to }) => `${to}\n`).join(""));
}

function checkCommand() {
  const version = required("VERSION");
  const expected = releaseFiles({ version, built: builtFromEnvironment() });
  const attached = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const missing = expected.filter((file) => !attached.includes(file));
  const unexpected = attached.filter((file) => !expected.includes(file));
  if (missing.length > 0 || unexpected.length > 0) {
    const problems = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
      unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : null,
    ].filter(Boolean);
    throw new Error(`The release ${version} has not exactly its files; ${problems.join("; ")}.`);
  }
  log(`The release ${version} has its files: ${expected.join(", ")}.`);
}

const COMMANDS = { collect: collectCommand, prepare: prepareCommand, check: checkCommand };

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    log(`Usage: node scripts/release/release-files.mjs ${Object.keys(COMMANDS).join("|")}`);
    process.exitCode = 2;
  } else {
    try {
      command();
    } catch (error) {
      log(
        `release-files ${process.argv[2]}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
