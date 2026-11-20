"""The generated client and the allowlisted reads against the real API on a temporary database.

The API is the e2e server of `apps/api` (built with `pnpm --filter "@sebela/api..." build`),
serving the fictional eval fixture on a database of its own that it drops when it stops. Python
reaches it over HTTP only; it never touches Postgres.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from evals.datasets.cases import FIXTURE_PERSON
from evals.graders.code import fixture_contact
from evals.run import REPORT_ROOT, start_api
from llm_agent import ApiContentReader, ChatAgent, ChatRequest, ContentUnavailableError
from tests.unit.fakes import ScriptedModels, draft, tools, verdict

pytestmark = pytest.mark.integration


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def api_url() -> AsyncIterator[str]:
    scratch = REPORT_ROOT / f"integration-{os.getpid()}"
    try:
        async with start_api(scratch) as api:
            yield api.url
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@pytest.mark.asyncio(loop_scope="module")
async def test_the_public_person_read_matches_the_served_fixture(api_url: str) -> None:
    async with ApiContentReader(api_url) as content:
        person = await content.read_person()
    assert person.name == FIXTURE_PERSON["name"]
    assert person.headline == FIXTURE_PERSON["headline"]
    contact = fixture_contact()
    assert person.email == contact["email"]
    assert [link.model_dump() for link in person.links] == contact["links"]


@pytest.mark.asyncio(loop_scope="module")
async def test_a_route_the_reader_does_not_know_is_unavailable(api_url: str) -> None:
    async with ApiContentReader(f"{api_url}/missing") as content:
        with pytest.raises(ContentUnavailableError):
            await content.read_person()


@pytest.mark.asyncio(loop_scope="module")
async def test_a_grounded_answer_cites_the_served_record(api_url: str) -> None:
    models = ScriptedModels(security=[verdict()], main=[tools("get_profile"), draft()])
    async with ApiContentReader(api_url) as content:
        result = await ChatAgent(content=content, models=models).run(
            ChatRequest(question="Who is she?")
        )
        person = await content.read_person()
    assert result.outcome == "answered"
    assert [(s.kind, s.record_id, s.href) for s in result.sources] == [("profile", person.id, "/")]
    assert result.evidence[0].data["headline"] == person.headline
