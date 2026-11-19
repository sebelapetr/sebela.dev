export interface RatePolicy {
  readonly max: number;
  readonly windowMs: number;
}

export interface McpAdminConfig {
  readonly host: string;
  readonly port: number;
  readonly apiUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly trustedProxies: readonly string[];
  readonly bodyLimitBytes: number;
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
  readonly rateLimits: {
    readonly preAuth: RatePolicy;
    readonly key: RatePolicy;
    readonly maxTracked: number;
  };
}

export function readMcpAdminConfig(env: Record<string, string | undefined>): McpAdminConfig {
  throw new Error(`Not implemented: ${String(Object.keys(env).length)} settings`);
}
