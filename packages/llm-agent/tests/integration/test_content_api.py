"""The generated client and the allowlisted reads against the real API on a temporary database.

The API is the e2e server of `apps/api` (built with `pnpm --filter "@sebela/api..." build`),
serving the fictional eval fixture on a database of its own that it drops when it stops. Python
reaches it over HTTP only; it never touches Postgres.
"""

from __future__ import annotations

import datetime
import os
import shutil
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio

from evals.datasets.cases import FIXTURE, FIXTURE_PERSON
from evals.graders.code import expected_block, fixture_contact
from evals.run import REPORT_ROOT, start_api
from llm_agent import (
    ApiContentReader,
    ChatAgent,
    ChatRequest,
    ContentNotFoundError,
    ContentUnavailableError,
)
from tests.unit.fakes import ScriptedModels, calls, draft, spans, tools, verdict

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


def _seed(file: str) -> list[dict[str, Any]]:
    records = FIXTURE[file]
    assert isinstance(records, list)
    return records


def _names(file: str) -> dict[str, str]:
    return {item["slug"]: item["name"] for item in _seed(file)}


def _day(value: object) -> datetime.date | None:
    return datetime.date.fromisoformat(str(value)) if value else None


@pytest.mark.asyncio(loop_scope="module")
async def test_the_experiences_keep_their_identity_dates_and_projects(api_url: str) -> None:
    async with ApiContentReader(api_url) as content:
        experiences = await content.read_experiences()
    organizations = _names("organizations")
    technologies = _names("technologies")
    seeded = {item["slug"]: item for item in _seed("experiences")}
    assert {item.slug for item in experiences} == set(seeded)
    for item in experiences:
        record = seeded[item.slug]
        assert item.title == record["title"]
        assert item.organization == organizations[record["organization"]]
        assert item.started_on == _day(record["startedOn"])
        assert item.ended_on == _day(record.get("endedOn"))
        assert sorted(item.technologies) == sorted(technologies[t] for t in record["technologies"])
        owned = {p["slug"] for p in _seed("projects") if p["experience"] == item.slug}
        assert {project.slug for project in item.projects} == owned


@pytest.mark.asyncio(loop_scope="module")
async def test_the_projects_keep_their_parent_experience_and_case_study(api_url: str) -> None:
    async with ApiContentReader(api_url) as content:
        projects = await content.read_projects()
        detail = await content.read_project("support-answer-engine")
        with pytest.raises(ContentNotFoundError):
            await content.read_project("orbital-launcher")
    seeded = {item["slug"]: item for item in _seed("projects")}
    assert {item.slug for item in projects} == set(seeded)
    for item in projects:
        record = seeded[item.slug]
        assert item.experience == record["experience"]
        assert item.started_on == _day(record["startedOn"])
        assert item.ended_on == _day(record.get("endedOn"))
    case_study = seeded["support-answer-engine"]["caseStudy"]
    assert detail.case_study is not None
    assert (detail.case_study.role, detail.case_study.body) == (
        case_study["role"],
        case_study["body"],
    )


@pytest.mark.asyncio(loop_scope="module")
async def test_services_explorations_and_education_keep_their_stored_facts(api_url: str) -> None:
    async with ApiContentReader(api_url) as content:
        services = await content.read_services()
        explorations = await content.read_explorations()
        education = await content.read_education()
    statuses = {item["slug"]: item["status"] for item in _seed("explorations")}
    assert {item.slug: item.status for item in explorations} == statuses
    for service in services:
        record = next(item for item in _seed("services") if item["slug"] == service.slug)
        stored = [(e["kind"], e.get("project") or e.get("exploration")) for e in record["evidence"]]
        assert [(e.kind, e.slug) for e in service.evidence] == stored
        for evidence in service.evidence:
            expected = statuses.get(evidence.slug) if evidence.kind == "exploration" else None
            assert evidence.status == expected
    seeded = {item["slug"]: item for item in _seed("education")}
    assert {item.slug for item in education} == set(seeded)
    for item in education:
        assert item.started_on == _day(seeded[item.slug]["startedOn"])
        assert item.ended_on == _day(seeded[item.slug].get("endedOn"))


@pytest.mark.asyncio(loop_scope="module")
async def test_every_career_read_fits_one_answer_and_builds_exact_blocks(api_url: str) -> None:
    every_read = calls(
        ("list_experiences", {}),
        ("list_projects", {}),
        ("list_services", {}),
        ("list_explorations", {}),
        ("list_education", {}),
        ("get_project", {"slug": "support-answer-engine"}),
    )
    models = ScriptedModels(
        security=[verdict()], main=[every_read, draft(refs=("src-1", "src-6", "src-8"))]
    )
    async with ApiContentReader(api_url) as content:
        result = await ChatAgent(content=content, models=models).run(
            ChatRequest(question="What has she worked on?")
        )
    assert [status for name, status in spans(result) if name.startswith("tool.")] == ["ok"] * 6
    # Two experiences (src-1, src-2), three projects, two services (src-6, src-7), then the
    # explorations (src-8 on); the project detail reuses its list ref.
    assert len(result.evidence) == sum(
        len(_seed(file))
        for file in ("experiences", "projects", "services", "explorations", "education")
    )
    by_ref = {item.ref: item for item in result.evidence}
    cited = [by_ref[ref] for ref in ("src-1", "src-6", "src-8")]
    assert [item.kind for item in cited] == ["experience", "service", "exploration"]
    blocks = [block.model_dump(mode="json") for block in result.blocks]
    assert [block["href"] for block in blocks] == [item.href for item in cited]
    for block, item in zip(blocks, cited, strict=True):
        if isinstance(block.get("technologies"), list):
            block["technologies"] = sorted(block["technologies"])
        assert block == expected_block(block["type"], item.record_id)
