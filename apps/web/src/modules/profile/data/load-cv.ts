import type { ApiClient, Cv } from "@sebela/api-client";

import type { CvPdf } from "./cv-pdf";

export interface CvContent {
  readonly name: string;
  readonly headline: string;
  readonly location: string | null;
  readonly shortBio: string;
  readonly contact: {
    readonly email: { readonly address: string; readonly href: string } | null;
    readonly links: readonly { readonly label: string; readonly url: string }[];
  };
  readonly experiences: Cv["experiences"];
  readonly technologies: Cv["technologies"];
  readonly education: Cv["education"];
  readonly explorations: Cv["explorations"];
  readonly cvPdf: CvPdf | null;
}

export type CvResult =
  | { readonly status: "ready"; readonly content: CvContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export const loadCv: (
  client: ApiClient,
  options?: { timeoutMs?: number },
) => Promise<CvResult> = () => {
  throw new Error("Not implemented.");
};
