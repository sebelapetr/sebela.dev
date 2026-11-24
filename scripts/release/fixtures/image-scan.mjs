// Fixtures of the image scan (scripts/release/image-scan.test.mjs): Trivy JSON reports in the shape
// `trivy image --format json` writes (schema version 2), built from the few fields the gate reads.
// `fixtures/image-scan/published-api.json` is a real report of a published image, reduced to the
// fields the gate reads and to a handful of its findings.

/** One finding of a report. `fixed` is the fixed version, or undefined when none exists. */
export function vulnerability({ id, pkg, severity, fixed, installed = "1.0.0", path }) {
  return {
    VulnerabilityID: id,
    PkgName: pkg,
    ...(path ? { PkgPath: path } : {}),
    InstalledVersion: installed,
    ...(fixed ? { FixedVersion: fixed, Status: "fixed" } : { Status: "affected" }),
    Severity: severity,
    Title: `Fictional finding ${id}`,
  };
}

/** A report of one image with the given findings, in one operating-system result. */
export function report(vulnerabilities, name = "ghcr.io/sebelapetr/sebela-api:fixture") {
  return {
    SchemaVersion: 2,
    ArtifactName: name,
    ArtifactType: "container_image",
    // Trivy leaves `Results` out when it found nothing to report.
    ...(vulnerabilities === null
      ? {}
      : {
          Results: [
            {
              Target: `${name} (debian 13.7)`,
              Class: "os-pkgs",
              Type: "debian",
              Vulnerabilities: vulnerabilities,
            },
          ],
        }),
  };
}

export const FIXABLE_HIGH = vulnerability({
  id: "CVE-2030-0001",
  pkg: "libexample",
  severity: "HIGH",
  fixed: "1.0.1",
});
export const FIXABLE_CRITICAL = vulnerability({
  id: "CVE-2030-0002",
  pkg: "libexample",
  severity: "CRITICAL",
  fixed: "1.0.2",
});
export const UNFIXED_CRITICAL = vulnerability({
  id: "CVE-2030-0003",
  pkg: "libother",
  severity: "CRITICAL",
});
export const FIXABLE_MEDIUM = vulnerability({
  id: "CVE-2030-0004",
  pkg: "libother",
  severity: "MEDIUM",
  fixed: "2.0.0",
});
export const FIXABLE_LOW = vulnerability({
  id: "CVE-2030-0005",
  pkg: "libother",
  severity: "LOW",
  fixed: "2.0.1",
});
