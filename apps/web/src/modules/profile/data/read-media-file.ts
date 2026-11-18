export interface ReadMediaFileOptions {
  readonly mediaReadBaseUrl: string;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export function readMediaFile(name: string, options: ReadMediaFileOptions): Promise<Response> {
  return Promise.reject(new Error(`not implemented: ${name} ${options.mediaReadBaseUrl}`));
}
