import { describe, expect, it } from "vitest";

import {
  ServiceCreateSchema,
  ServiceEvidenceInputSchema,
  ServiceListSchema,
  ServiceSchema,
  ServiceUpdateSchema,
  serviceEvidenceKinds,
} from "./index.js";

const stored = {
  id: "5d2a8c41-7e3b-4f9a-8c1d-2b6e4f7a9c30",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const evidence = [
  { kind: "project", project: "harbor-portal" },
  { kind: "link", label: "Roadmap", path: "/roadmap" },
  { kind: "exploration", exploration: "agent-lab" },
];

const automation = {
  slug: "process-automation",
  name: "Process automation",
  summary: "A **fictional** service that connects existing tools.",
  audience: "Fictional teams that copy data between systems by hand.",
  deliverable: "A working integration with its documentation.",
  position: 1,
  evidence,
};

describe("serviceEvidenceKinds", () => {
  it("lists projects, explorations and links", () => {
    expect(serviceEvidenceKinds).toEqual(["project", "exploration", "link"]);
  });
});

describe("ServiceCreateSchema", () => {
  it("accepts a service with every field and keeps the evidence in its order", () => {
    expect(ServiceCreateSchema.parse(automation)).toEqual(automation);
  });

  it("fills unset evidence with an empty list", () => {
    const minimal = { ...automation, evidence: undefined };
    expect(ServiceCreateSchema.parse(minimal)).toEqual({ ...minimal, evidence: [] });
  });

  it("trims the text fields and the link label", () => {
    expect(
      ServiceCreateSchema.parse({
        ...automation,
        name: " Automation ",
        audience: " Teams ",
        deliverable: " An integration ",
        evidence: [{ kind: "link", label: " Contact ", path: "/contact" }],
      }),
    ).toMatchObject({
      name: "Automation",
      audience: "Teams",
      deliverable: "An integration",
      evidence: [{ kind: "link", label: "Contact", path: "/contact" }],
    });
  });

  it.each([
    "/",
    "/experience",
    "/projects/harbor-portal",
    "/roadmap#rag",
    "/contact?topic=automation",
  ])("accepts the site path %s", (path) => {
    const link = { kind: "link", label: "Somewhere", path };
    expect(ServiceEvidenceInputSchema.parse(link)).toEqual(link);
  });

  it.each([
    ["a missing slug", { ...automation, slug: undefined }],
    ["an invalid slug", { ...automation, slug: "Process Automation" }],
    ["a missing name", { ...automation, name: undefined }],
    ["an empty name", { ...automation, name: " " }],
    ["a name that is too long", { ...automation, name: "x".repeat(201) }],
    ["a missing summary", { ...automation, summary: undefined }],
    ["a summary that is too long", { ...automation, summary: "x".repeat(5001) }],
    ["a missing audience", { ...automation, audience: undefined }],
    ["an empty audience", { ...automation, audience: " " }],
    ["a missing deliverable", { ...automation, deliverable: undefined }],
    ["a deliverable that is too long", { ...automation, deliverable: "x".repeat(5001) }],
    ["a missing position", { ...automation, position: undefined }],
    ["a negative position", { ...automation, position: -1 }],
    ["evidence that is not a list", { ...automation, evidence: evidence[0] }],
    ["too many pieces of evidence", { ...automation, evidence: Array(31).fill(evidence[1]) }],
    ["a repeated project", { ...automation, evidence: [evidence[0], evidence[0]] }],
    ["a repeated exploration", { ...automation, evidence: [evidence[2], evidence[2]] }],
    ["a visibility flag", { ...automation, visible: true }],
  ])("rejects %s", (_, input) => {
    expect(ServiceCreateSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["an unknown kind", { kind: "testimonial", testimonial: "kind-words" }],
    ["a missing kind", { project: "harbor-portal" }],
    ["a project that is not a slug", { kind: "project", project: "Harbor Portal" }],
    ["an embedded project", { kind: "project", project: { slug: "harbor-portal" } }],
    ["a project with a link path", { kind: "project", project: "harbor-portal", path: "/x" }],
    ["an exploration that is not a slug", { kind: "exploration", exploration: "Agent Lab" }],
    ["an exploration under the project key", { kind: "exploration", project: "agent-lab" }],
    ["a link without a label", { kind: "link", path: "/roadmap" }],
    ["a link with an empty label", { kind: "link", label: " ", path: "/roadmap" }],
    ["a link without a path", { kind: "link", label: "Roadmap" }],
    ["a javascript link", { kind: "link", label: "x", path: "javascript:alert(1)" }],
    ["a data link", { kind: "link", label: "x", path: "data:text/html,hi" }],
    ["an outside link", { kind: "link", label: "x", path: "https://example.com/" }],
    ["a scheme-relative link", { kind: "link", label: "x", path: "//example.com/" }],
    ["a relative path", { kind: "link", label: "x", path: "roadmap" }],
    ["a path with a backslash", { kind: "link", label: "x", path: "/\\example.com" }],
    ["a path with a space", { kind: "link", label: "x", path: "/road map" }],
    ["a path with a control character", { kind: "link", label: "x", path: "/road\nmap" }],
    ["a path that is too long", { kind: "link", label: "x", path: `/${"x".repeat(500)}` }],
    ["a link with a URL field", { kind: "link", label: "x", path: "/x", url: "https://x.test" }],
  ])("rejects evidence with %s", (_, piece) => {
    expect(ServiceCreateSchema.safeParse({ ...automation, evidence: [piece] }).success).toBe(false);
  });

  it("names the evidence when a project or an exploration is repeated", () => {
    for (const repeated of [evidence[0], evidence[2]]) {
      const result = ServiceCreateSchema.safeParse({
        ...automation,
        evidence: [repeated, evidence[1], repeated],
      });
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([["evidence"]]);
    }
  });

  it("allows the same site path twice", () => {
    const twice = [evidence[1], { ...evidence[1], label: "Again" }];
    expect(ServiceCreateSchema.parse({ ...automation, evidence: twice }).evidence).toEqual(twice);
  });
});

describe("ServiceUpdateSchema", () => {
  it("accepts a partial change without filling other fields", () => {
    const parsed = ServiceUpdateSchema.parse({ name: "Renamed" });
    expect(parsed).toEqual({ name: "Renamed" });
    expect(parsed).not.toHaveProperty("evidence");
  });

  it("accepts replacing the evidence, including with an empty list", () => {
    expect(ServiceUpdateSchema.parse({ evidence: [evidence[2]] })).toEqual({
      evidence: [evidence[2]],
    });
    expect(ServiceUpdateSchema.parse({ evidence: [] })).toEqual({ evidence: [] });
  });

  it.each([
    ["an empty change", {}],
    ["a change of the slug", { slug: "renamed" }],
    ["clearing the audience", { audience: null }],
    ["clearing the evidence", { evidence: null }],
    ["a repeated project", { evidence: [evidence[0], evidence[0]] }],
    ["an outside link", { evidence: [{ kind: "link", label: "x", path: "https://x.test" }] }],
  ])("rejects %s", (_, input) => {
    expect(ServiceUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("ServiceSchema and ServiceListSchema", () => {
  const project = {
    slug: "harbor-portal",
    name: "Harbor portal",
    summary: "A fictional customer portal.",
    experience: "northwind-lead",
  };
  const exploration = {
    slug: "agent-lab",
    name: "Agent lab",
    summary: "A fictional agent playground.",
    status: "designed",
  };
  const service = {
    ...stored,
    ...automation,
    evidence: [
      { kind: "project", project },
      { kind: "link", label: "Roadmap", path: "/roadmap" },
      { kind: "exploration", exploration },
    ],
  };

  it("describe stored services with their evidence resolved in its order", () => {
    expect(ServiceSchema.parse(service)).toEqual(service);
    expect(ServiceListSchema.parse([service])).toEqual([service]);
  });

  it("describe a service without evidence", () => {
    expect(ServiceSchema.parse({ ...service, evidence: [] })).toMatchObject({ evidence: [] });
  });

  it("rejects evidence that names a project by its slug alone", () => {
    expect(
      ServiceSchema.safeParse({ ...service, evidence: [{ kind: "project", project: "x" }] })
        .success,
    ).toBe(false);
  });

  it("rejects an exploration without its status", () => {
    const withoutStatus = { ...exploration, status: undefined };
    expect(
      ServiceSchema.safeParse({
        ...service,
        evidence: [{ kind: "exploration", exploration: withoutStatus }],
      }).success,
    ).toBe(false);
  });
});
