import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { grade } from "./graders/index.js";
import {
  aggregate,
  caseMetrics,
  caseVerdict,
  ndcgAtK,
  percentile,
  precisionAtK,
  provenanceAccuracy,
  recallAtPool,
  reciprocalRank,
} from "./graders/metrics.js";
import { SEARCHABLE, loadDataset, planCases } from "./plan.js";
import { RUN_CEILING_USD, parseOptions, pendingSummary } from "./run.js";

const dataset = loadDataset();

describe("the question set", () => {
  it("holds about forty EN and CS questions with unique IDs", () => {
    const ids = dataset.questions.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(40);
    const languages = new Set(dataset.questions.map((question) => question.language));
    expect(languages).toEqual(new Set(["en", "cs"]));
  });

  it("covers every required category", () => {
    const categories = new Set(dataset.questions.map((question) => question.category));
    for (const category of [
      "exact-name",
      "paraphrase",
      "cross-record",
      "roadmap",
      "diary",
      "supplemental",
      "conflict",
      "injection",
      "no-answer",
    ]) {
      expect(categories, category).toContain(category);
    }
  });

  it("knows the canonical path of every judged source", () => {
    for (const question of dataset.questions) {
      for (const sourceId of Object.keys(question.relevance)) {
        expect(dataset.sources[sourceId], `${question.id}: ${sourceId}`).toBeDefined();
      }
    }
  });

  it("gives portfolio sources a site path and supplemental sources none", () => {
    for (const [sourceId, { path }] of Object.entries(dataset.sources)) {
      if (sourceId.startsWith("portfolio:")) expect(path, sourceId).toMatch(/^\//);
      else expect(path, sourceId).toBeNull();
    }
  });

  it("gives every answerable question an answering source, and no-answer questions none", () => {
    for (const question of dataset.questions) {
      const grades = Object.values(question.relevance);
      if (question.category === "no-answer") expect(grades, question.id).toEqual([]);
      else expect(grades, question.id).toContain(2);
    }
  });

  it("has a file for every supplemental document, and only fictional ones are judged", () => {
    for (const document of dataset.documents) {
      const file = fileURLToPath(new URL(`datasets/${document.file}`, import.meta.url));
      expect(existsSync(file), document.file).toBe(true);
    }
    const judged = Object.keys(dataset.sources).filter((id) => id.startsWith("document:"));
    const known = new Set(dataset.documents.map((document) => document.sourceId));
    for (const id of judged) expect(known, id).toContain(id);
  });

  it("asks supplemental questions only of supplemental search", () => {
    for (const question of dataset.questions) {
      const needsDocument = Object.keys(question.relevance).some((id) =>
        id.startsWith("document:"),
      );
      expect(question.requires === "supplemental", question.id).toBe(needsDocument);
    }
  });
});

describe("the case plan", () => {
  it("reports every case pending while nothing is searchable", () => {
    const plan = planCases(dataset, [], new Set());
    expect(plan.run).toEqual([]);
    expect(plan.pending).toHaveLength(dataset.questions.length);
  });

  it("measures portfolio questions and keeps supplemental ones pending", () => {
    const plan = planCases(dataset, [], new Set(["portfolio"]));
    expect(plan.run.every((question) => question.requires === "portfolio")).toBe(true);
    expect(plan.pending.map((entry) => entry.id).sort()).toEqual(
      dataset.questions
        .filter((question) => question.requires === "supplemental")
        .map((question) => question.id)
        .sort(),
    );
  });

  it("selects named cases and refuses unknown or repeated ones", () => {
    const plan = planCases(dataset, ["portfolio-lumen-role"], new Set(["portfolio"]));
    expect(plan.run.map((question) => question.id)).toEqual(["portfolio-lumen-role"]);
    expect(() => planCases(dataset, ["no-such-case"])).toThrow(/Unknown case/);
    expect(() => planCases(dataset, ["portfolio-lumen-role", "portfolio-lumen-role"])).toThrow(
      /Repeated case/,
    );
  });

  it("uses the searchable capabilities of the current slice", () => {
    expect([...SEARCHABLE].every((capability) => capability !== "supplemental")).toBe(true);
  });
});

describe("the runner's options", () => {
  it("caps a run at USD 1", () => {
    expect(parseOptions([]).ceilingUsd).toBe(RUN_CEILING_USD);
    expect(parseOptions(["--max-cost-usd", "0.25"]).ceilingUsd).toBe(0.25);
    expect(() => parseOptions(["--max-cost-usd", "1.5"])).toThrow(/at most/);
    expect(() => parseOptions(["--max-cost-usd", "0"])).toThrow();
  });

  it("refuses unknown options and unsafe result names", () => {
    expect(() => parseOptions(["--repeat", "3"])).toThrow();
    expect(() => parseOptions(["--publish", "../escape"])).toThrow(/lowercase/);
    expect(parseOptions(["--publish", "vector-baseline", "--case", "a"]).publish).toBe(
      "vector-baseline",
    );
  });

  it("reports a run without measurable cases as pending, not passed", () => {
    const summary = pendingSummary({ cases: [] }, [{ id: "x", reason: "not yet" }]);
    expect(summary.status).toBe("pending");
    expect(summary.measured).toBe(0);
    expect(summary).not.toHaveProperty("passed");
  });
});

describe("the metrics", () => {
  const relevance = { a: 2, b: 2, c: 1 } as const;

  it("measures recall over the candidate pool against answering sources", () => {
    expect(recallAtPool(["x", "a", "c"], relevance)).toBe(0.5);
    expect(recallAtPool(["a", "b"], relevance)).toBe(1);
    expect(recallAtPool(["a"], {})).toBeNull();
  });

  it("computes nDCG over distinct sources", () => {
    expect(ndcgAtK(["a", "b", "c"], relevance, 8)).toBeCloseTo(1);
    expect(ndcgAtK(["a", "a", "b", "c"], relevance, 8)).toBeCloseTo(1);
    const swapped = ndcgAtK(["c", "a", "b"], relevance, 8) ?? 0;
    expect(swapped).toBeGreaterThan(0);
    expect(swapped).toBeLessThan(1);
    expect(ndcgAtK(["x"], relevance, 8)).toBe(0);
    expect(ndcgAtK(["x"], {}, 8)).toBeNull();
  });

  it("computes precision over what is shown and reciprocal rank of the first answer", () => {
    expect(precisionAtK(["a", "x", "c", "y"], relevance, 8)).toBe(0.5);
    expect(precisionAtK([], relevance, 8)).toBeNull();
    expect(reciprocalRank(["c", "x", "b"], relevance)).toBeCloseTo(1 / 3);
    expect(reciprocalRank(["x"], relevance)).toBe(0);
    expect(reciprocalRank(["x"], {})).toBeNull();
  });

  it("checks provenance against the dataset's canonical paths", () => {
    const sources = { a: { path: "/a" }, d: { path: null } };
    expect(
      provenanceAccuracy(
        [{ sourceId: "a", path: "/a" }, { sourceId: "d" }, { sourceId: "unknown", path: "/u" }],
        sources,
      ),
    ).toBe(1);
    expect(provenanceAccuracy([{ sourceId: "a", path: "/b" }], sources)).toBe(0);
    expect(provenanceAccuracy([{ sourceId: "d", path: "/leak" }], sources)).toBe(0);
    expect(provenanceAccuracy([], sources)).toBeNull();
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([30, 10, 20, 40], 50)).toBe(20);
    expect(percentile([30, 10, 20, 40], 95)).toBe(40);
    expect(percentile([], 50)).toBeNull();
  });

  it("passes a no-answer question only on no evidence, and never a failed search", () => {
    const empty = { status: "no_evidence", passages: [], pool: [], latencyMs: 5 } as const;
    expect(caseVerdict(caseMetrics({ relevance: {} }, empty, {}, 8), empty).pass).toBe(true);
    const found = {
      status: "found",
      passages: [{ sourceId: "x" }],
      pool: ["x"],
      latencyMs: 5,
    } as const;
    expect(caseVerdict(caseMetrics({ relevance: {} }, found, {}, 8), found).pass).toBe(false);
    const failed = {
      status: "error",
      passages: [],
      pool: [],
      latencyMs: 5,
      error: "503 provider_unavailable",
    } as const;
    const metrics = caseMetrics({ relevance: {} }, failed, {}, 8);
    expect(caseVerdict(metrics, failed)).toEqual({
      pass: false,
      reason: "search failed: 503 provider_unavailable",
    });
  });

  it("passes an answerable question when an answering source is shown with its path", () => {
    const sources = { a: { path: "/a" } };
    const right = {
      status: "found",
      passages: [{ sourceId: "a", path: "/a" }],
      pool: ["a"],
      latencyMs: 5,
    } as const;
    expect(caseVerdict(caseMetrics({ relevance }, right, sources, 8), right).pass).toBe(true);
    const wrongPath = { ...right, passages: [{ sourceId: "a", path: "/elsewhere" }] };
    expect(caseVerdict(caseMetrics({ relevance }, wrongPath, sources, 8), wrongPath).pass).toBe(
      false,
    );
    const empty = { status: "no_evidence", passages: [], pool: [], latencyMs: 5 } as const;
    const metrics = caseMetrics({ relevance }, empty, sources, 8);
    expect(metrics.falseEmpty).toBe(true);
    expect(caseVerdict(metrics, empty).pass).toBe(false);
  });

  it("aggregates rates over the questions they apply to", () => {
    const answered = caseMetrics(
      { relevance },
      { status: "found", passages: [{ sourceId: "a" }], pool: ["a", "b"], latencyMs: 10 },
      {},
      8,
    );
    const missed = caseMetrics(
      { relevance },
      { status: "no_evidence", passages: [], pool: ["x"], latencyMs: 30 },
      {},
      8,
    );
    const correctEmpty = caseMetrics(
      { relevance: {} },
      { status: "no_evidence", passages: [], pool: [], latencyMs: 20 },
      {},
      8,
    );
    const result = aggregate([answered, missed, correctEmpty], { queryCostUsd: 0.003 });
    expect(result.questions).toBe(3);
    expect(result.recallAtPool).toBe(0.5);
    expect(result.mrr).toBe(0.5);
    expect(result.hitRate).toBe(0.5);
    expect(result.falseEmptyRate).toBe(0.5);
    expect(result.correctEmptyRate).toBe(1);
    expect(result.latencyMs).toEqual({ p50: 20, p95: 30 });
    expect(result.costPerQueryUsd).toBeCloseTo(0.001);
  });
});

describe("the Promptfoo grader", () => {
  it("grades a provider observation against the dataset", () => {
    const observation = {
      status: "found",
      passages: [
        {
          sourceId: "portfolio:experience:lumen-press-staff-engineer",
          path: "/experience#experience-lumen-press-staff-engineer",
        },
      ],
      pool: ["portfolio:experience:lumen-press-staff-engineer"],
      latencyMs: 12,
    };
    const result = grade(JSON.stringify(observation), {
      vars: { caseId: "portfolio-lumen-role" },
    });
    expect(result.pass).toBe(true);
    expect(result.namedScores).toMatchObject({ recallAtPool: 1, reciprocalRank: 1, provenance: 1 });
  });

  it("fails an unknown case", () => {
    expect(grade("{}", { vars: { caseId: "nope" } }).pass).toBe(false);
  });
});
