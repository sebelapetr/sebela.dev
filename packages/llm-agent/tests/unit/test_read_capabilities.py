"""The fixed read capabilities: the in-process tools' own projections, paged and bounded.

`read_tool` is what the AI service exposes to read callers (and the next phase's public MCP): the
same allowlist minus the contact read, the same argument validation and the same projections, so
a capability and the model's tool can never disagree about a record.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from llm_agent import (
    READ_CAPABILITIES,
    ContentNotFoundError,
    ContentUnavailableError,
    InvalidToolArgumentsError,
    ToolNotAvailableError,
    ToolResultTooLargeError,
    read_tool,
)
from llm_agent.observability.tracing import Tracer
from llm_agent.reliability.timeouts import Deadline
from llm_agent.tools.registry import TOOLS, Tools
from tests.unit.fakes import AGENT_AREA, BOOKS, PROJECTS, FakeContent

#: The arguments each capability is read with in the parity test.
ARGUMENTS: dict[str, dict[str, str]] = {
    "get_project": {"slug": PROJECTS[0].slug},
    "get_roadmap_area": {"area": AGENT_AREA.slug},
}


def tools(content: FakeContent) -> Tools:
    return Tools(content, tracer=Tracer(), deadline=Deadline(60), call_s=5.0, result_tokens=5000)


def test_every_read_tool_but_the_contact_is_a_capability() -> None:
    assert set(READ_CAPABILITIES) == set(TOOLS) - {"get_contact"}
    assert "get_contact" not in READ_CAPABILITIES


@pytest.mark.parametrize("name", READ_CAPABILITIES)
async def test_a_capability_returns_what_the_in_process_tool_gives_the_model(name: str) -> None:
    content = FakeContent()
    arguments = ARGUMENTS.get(name, {})
    page = await read_tool(content, name, arguments, page=1, page_records=100)
    in_process = json.loads(await tools(FakeContent()).call(name, arguments))
    expected: list[dict[str, Any]] = in_process.get("records", [in_process])
    assert page.capability == name
    assert page.page == 1
    assert page.page_count == 1
    assert [(record.kind, record.data) for record in page.records] == [
        (item["kind"], item["data"]) for item in expected
    ]
    for record in page.records:
        assert record.href.startswith("/")
        assert record.record_id
        assert record.title


async def test_the_profile_capability_carries_no_contact_fields() -> None:
    page = await read_tool(FakeContent(), "get_profile", {})
    (record,) = page.records
    assert record.kind == "profile"
    assert record.href == "/"
    assert {"id", "email", "links"}.isdisjoint(record.data)


async def test_a_long_list_is_split_into_pages_in_order() -> None:
    books = [BOOKS[0].model_copy(update={"slug": f"book-{index:02}"}) for index in range(25)]
    content = FakeContent(books=books)
    pages = [await read_tool(content, "list_books", {}, page=n, page_records=10) for n in (1, 2, 3)]
    assert [page.page_count for page in pages] == [3, 3, 3]
    assert [len(page.records) for page in pages] == [10, 10, 5]
    slugs = [record.record_id for page in pages for record in page.records]
    assert slugs == [book.slug for book in books]
    with pytest.raises(InvalidToolArgumentsError):
        await read_tool(content, "list_books", {}, page=4, page_records=10)
    with pytest.raises(InvalidToolArgumentsError):
        await read_tool(content, "list_books", {}, page=0)


@pytest.mark.parametrize(
    "name", ["get_contact", "delete_project", "../v1/internal/chat", "http://x.test/", "", "LIST"]
)
async def test_an_unknown_capability_reads_nothing(name: str) -> None:
    content = FakeContent()
    with pytest.raises(ToolNotAvailableError):
        await read_tool(content, name, {})
    assert content.reads == 0


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("get_profile", {"slug": "x"}),
        ("list_projects", {"url": "http://x.test/"}),
        ("get_project", {}),
        ("get_project", {"slug": "../../v1/internal/chat"}),
        ("get_project", {"slug": "a; DROP TABLE projects"}),
        ("get_project", {"slug": "a", "path": "/etc/passwd"}),
        ("get_roadmap_area", {"area": "x" * 500}),
        ("get_roadmap_area", {"slug": "agents"}),
    ],
)
async def test_invalid_arguments_read_nothing(name: str, arguments: dict[str, Any]) -> None:
    content = FakeContent()
    with pytest.raises(InvalidToolArgumentsError):
        await read_tool(content, name, arguments)
    assert content.reads == 0


async def test_a_page_over_the_token_cap_is_refused_never_truncated() -> None:
    long = " ".join(f"fictional{index}" for index in range(6000))
    books = [BOOKS[0].model_copy(update={"summary": long})]
    with pytest.raises(ToolResultTooLargeError):
        await read_tool(FakeContent(books=books), "list_books", {})


async def test_missing_and_unavailable_content_keep_their_types() -> None:
    with pytest.raises(ContentNotFoundError):
        await read_tool(FakeContent(), "get_project", {"slug": "no-such-project"})
    with pytest.raises(ContentUnavailableError):
        await read_tool(FakeContent(fail=True), "list_projects", {})
