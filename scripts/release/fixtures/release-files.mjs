// Fixtures of the release files (scripts/release/release-files.test.mjs): fictional SPDX SBOMs and
// Sigstore bundles in the shape `actions/attest` and `actions/attest-build-provenance` write to
// their `bundle-path` (one bundle as one JSON line), with an in-toto statement for an image digest.
// The signatures and certificates are placeholders: the release files only check what a bundle
// claims; `gh attestation verify` checks the signature.

export const PROVENANCE_TYPE = "https://slsa.dev/provenance/v1";

/** A fictional SPDX 2.3 SBOM of an image, as `anchore/sbom-action` writes it. */
export function sbomDocument(service) {
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `ghcr.io/sebelapetr/sebela-${service}`,
    documentNamespace: `https://anchore.com/syft/image/sebela-${service}-fixture`,
    creationInfo: { created: "2026-11-21T12:00:00Z", creators: ["Tool: syft-1.0.0"] },
    packages: [
      {
        name: "example-package",
        SPDXID: "SPDXRef-Package-npm-example-package",
        versionInfo: "1.0.0",
        downloadLocation: "NOASSERTION",
      },
    ],
  };
}

/** The SBOM file's text: pretty-printed, as the action writes it. */
export const sbomText = (service) => `${JSON.stringify(sbomDocument(service), null, 2)}\n`;

/** An in-toto statement about `subjects` ({ name, digest: "sha256:..." }). */
export function statement({ subjects, predicateType, predicate }) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: subjects.map(({ name, digest }) => ({
      name,
      digest: { sha256: digest.replace(/^sha256:/, "") },
    })),
    predicateType,
    predicate,
  };
}

/** A Sigstore bundle of `content` (an in-toto statement) as one JSON line with its end of line. */
export function bundleLine(content, { payloadType = "application/vnd.in-toto+json" } = {}) {
  const bundle = {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {
      certificate: { rawBytes: "ZmljdGlvbmFsLWNlcnRpZmljYXRl" },
      tlogEntries: [],
    },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(content)).toString("base64"),
      payloadType,
      signatures: [{ sig: "ZmljdGlvbmFsLXNpZ25hdHVyZQ==" }],
    },
  };
  return `${JSON.stringify(bundle)}\n`;
}

/** The build provenance bundle of an image digest. */
export function provenanceBundle({ name, digest }) {
  return bundleLine(
    statement({
      subjects: [{ name, digest }],
      predicateType: PROVENANCE_TYPE,
      predicate: {
        buildDefinition: {
          buildType: "https://actions.github.io/buildtypes/workflow/v1",
          externalParameters: {
            workflow: {
              ref: "refs/heads/master",
              repository: "https://github.com/sebelapetr/sebela.dev",
              path: ".github/workflows/release.yml",
            },
          },
        },
        runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" } },
      },
    }),
  );
}

/** The SBOM attestation bundle of an image digest, whose predicate is `sbom`. */
export function sbomBundle({ name, digest, sbom }) {
  return bundleLine(
    statement({
      subjects: [{ name, digest }],
      predicateType: `https://spdx.dev/Document/v${sbom.spdxVersion.split("-")[1]}`,
      predicate: sbom,
    }),
  );
}
