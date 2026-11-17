import type { ApiClient } from "@sebela/api-client";

export type CvPdfFile =
  | {
      readonly status: "ready";
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly personName: string;
    }
  | { readonly status: "none" }
  | { readonly status: "unavailable" };

export interface ReadCvPdfFileOptions {
  readonly timeoutMs?: number;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export const readCvPdfFile: (
  client: ApiClient,
  options?: ReadCvPdfFileOptions,
) => Promise<CvPdfFile> = () => {
  throw new Error("Not implemented.");
};
