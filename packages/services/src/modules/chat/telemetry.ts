import type { ChatTraceDeleter } from "./types.js";

export interface LangfuseDeletionOptions {
  readonly baseUrl: string;
  readonly publicKey: string;
  readonly secretKey: string;
}

export interface LangfuseTraceDeleterOptions extends LangfuseDeletionOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

export const readTelemetryDeletionOptions: (
  env: Readonly<Record<string, string | undefined>>,
) => LangfuseDeletionOptions | null = () => {
  throw new Error("Not implemented.");
};

export const createLangfuseTraceDeleter: (
  options: LangfuseTraceDeleterOptions,
) => ChatTraceDeleter = () => {
  throw new Error("Not implemented.");
};
