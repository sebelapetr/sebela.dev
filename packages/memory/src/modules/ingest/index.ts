// Turns the public portfolio into indexable sources: one source per record with its canonical site
// path, split into sections by field and into bounded chunks, each with its text hash, and a
// version hash over the whole source. Nothing private (the contact email) is indexed.
import type { PortfolioContentKind } from "@sebela/contracts";

import type { PortfolioSnapshot } from "../ports/index.js";

/** A chunk of a section, before it is embedded. */
export interface SourceChunk {
  readonly sectionOrdinal: number;
  readonly ordinal: number;
  readonly text: string;
  readonly textHash: string;
}

/** A section of a source: where it sits in the record and its span in the source text. */
export interface SourceSection {
  readonly ordinal: number;
  readonly headingPath: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** One portfolio record as an indexable source. */
export interface PortfolioSource {
  readonly sourceId: string;
  readonly contentKind: PortfolioContentKind;
  readonly title: string;
  readonly path: string;
  readonly version: string;
  readonly sections: readonly SourceSection[];
  readonly chunks: readonly SourceChunk[];
}

/** The most characters in one chunk. */
export const chunkMaxLength = 1200;

/** Every indexable source of the portfolio, in a stable order. */
export function portfolioSources(snapshot: PortfolioSnapshot): PortfolioSource[] {
  throw new Error(`Not implemented: ${String(snapshot.experiences.length)}`);
}
