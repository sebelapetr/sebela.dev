import type { NextConfig } from "next";

const config: NextConfig = {
  // `@sebela/ui` ships TypeScript and CSS sources without a build step; Next compiles them.
  transpilePackages: ["@sebela/ui"],
  // No `X-Powered-By` header: it tells visitors nothing useful.
  poweredByHeader: false,
};

export default config;
