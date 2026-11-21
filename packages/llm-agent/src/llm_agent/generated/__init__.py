"""Code generated from the committed API contract (`pnpm --filter @sebela/llm-agent generate`).

Never edit it by hand. Inside the package only `llm_agent.tools.content` imports it: that module
is the handwritten allowlist of the public reads the agent may use. Outside it, only the eval
harness reads `GET /v1/person` through it to check the fixture. The generated client also describes
private routes; the package holds no credential for them and never calls them.
"""
