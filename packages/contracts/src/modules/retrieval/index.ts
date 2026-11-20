// The retrieval contract (stub): the private search route's request and result.
import { z } from "zod";

export const retrievalContentKinds = [
  "profile",
  "experience",
  "project",
  "case_study",
  "exploration",
  "service",
  "education",
  "roadmap_area",
  "roadmap_module",
  "roadmap_resource",
  "diary_day",
  "book",
  "event",
  "glossary_term",
  "document",
] as const;
export type RetrievalContentKind = (typeof retrievalContentKinds)[number];
export type PortfolioContentKind = Exclude<RetrievalContentKind, "document">;

export const retrievalQueryMaxLength = 500;
export const retrievalMaxPassages = 8;
export const retrievalPassageMaxLength = 4000;

export interface SearchRequest {
  query: string;
  kinds?: RetrievalContentKind[];
  limit?: number;
}
export interface PassageProvenance<Kind extends RetrievalContentKind = RetrievalContentKind> {
  contentKind: Kind;
  sectionPath: string[];
  indexedAt: string;
}
export interface PortfolioPassage {
  sourceKind: "portfolio";
  sourceId: string;
  title: string;
  version: string;
  text: string;
  score: number;
  path: string;
  provenance: PassageProvenance<PortfolioContentKind>;
}
export interface SupplementalPassage {
  sourceKind: "supplemental";
  sourceId: string;
  title: string;
  version: string;
  text: string;
  score: number;
  provenance: PassageProvenance<"document">;
}
export type Passage = PortfolioPassage | SupplementalPassage;
export type SearchResult =
  { status: "found"; passages: Passage[] } | { status: "no_evidence"; passages: [] };

export interface PortfolioSourceAddress {
  kind: PortfolioContentKind;
  key: string;
  area?: string;
  module?: string;
}

const stub = <T>() => z.custom<T>(() => false);

export const SearchRequestSchema = stub<SearchRequest>();
export const PortfolioPassageSchema = stub<PortfolioPassage>();
export const SupplementalPassageSchema = stub<SupplementalPassage>();
export const PassageSchema = stub<Passage>();
export const SearchResultSchema = stub<SearchResult>();

export function portfolioSourceId(kind: PortfolioContentKind, key: string): string {
  throw new Error(`Not implemented: ${kind}:${key}`);
}

export function portfolioSourcePath(address: PortfolioSourceAddress): string {
  throw new Error(`Not implemented: ${address.kind}`);
}
