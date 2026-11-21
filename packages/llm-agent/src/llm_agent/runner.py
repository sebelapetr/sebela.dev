"""Local runner: one question through the real agent, printed as the JSON result. No HTTP server.

    LLM_AGENT_API_URL=<public API base URL> python -m llm_agent.runner "Who is ...?"

It calls the paid model provider, so run it through the repository's secret wrapper
(`node harness/with-secrets.mjs -- uv run --locked python -m llm_agent.runner ...`). The API URL
comes from the environment; nothing about the environment is hard-coded.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

from llm_agent import ApiContentReader, ChatAgent, ChatRequest, anthropic_model_factory

API_URL_VARIABLE = "LLM_AGENT_API_URL"


async def ask(question: str, api_url: str) -> str:
    async with ApiContentReader(api_url) as content:
        agent = ChatAgent(content=content, models=anthropic_model_factory())
        result = await agent.run(ChatRequest(question=question))
    return json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m llm_agent.runner", description=__doc__)
    parser.add_argument("question", help="the visitor question, in English or Czech")
    arguments = parser.parse_args(argv)
    api_url = os.environ.get(API_URL_VARIABLE)
    if not api_url:
        print(
            f"{API_URL_VARIABLE} is not set: point it at the public content API.", file=sys.stderr
        )
        return 2
    print(asyncio.run(ask(arguments.question, api_url)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
