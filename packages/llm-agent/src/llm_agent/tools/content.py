"""The public content the agent may read, over the generated client of the content API.

This module is the handwritten allowlist: it calls only public read routes, sends no credential
and maps the generated models to the package's own read models. Every failure (connection, status,
malformed body) becomes `ContentUnavailableError`, so callers never see transport details.
"""

from __future__ import annotations

import datetime
from types import TracebackType
from typing import Protocol, Self
from urllib.parse import urlsplit

import httpx2
from pydantic import BaseModel, ConfigDict, ValidationError

from llm_agent.generated.content_api import Client
from llm_agent.generated.content_api.api.default import get_person
from llm_agent.generated.content_api.models.person import Person

#: Transport timeout of one content read; the tool call timeout bounds it further.
READ_TIMEOUT_S = 5.0


class ContentUnavailableError(Exception):
    """The content API could not return the requested public record."""


class _Read(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublicLink(_Read):
    label: str
    url: str


class PublicStep(_Read):
    title: str
    description: str


class PublicPerson(_Read):
    """The public profile of the person the site is about."""

    id: str
    name: str
    headline: str
    short_bio: str
    long_bio: str | None
    location: str | None
    email: str | None
    links: list[PublicLink]
    availability: str | None
    career_started_on: datetime.date | None
    services_intro: str | None
    collaboration_steps: list[PublicStep]
    services_note: str | None


class ContentReader(Protocol):
    """The public reads the agent's tools use."""

    async def read_person(self) -> PublicPerson: ...


def _person(person: Person) -> PublicPerson:
    return PublicPerson(
        id=str(person.id),
        name=person.name,
        headline=person.headline,
        short_bio=person.short_bio,
        long_bio=person.long_bio,
        location=person.location,
        email=person.email,
        links=[PublicLink(label=link.label, url=link.url) for link in person.links],
        availability=person.availability,
        career_started_on=person.career_started_on,
        services_intro=person.services_intro,
        collaboration_steps=[
            PublicStep(title=step.title, description=step.description)
            for step in person.collaboration_steps
        ],
        services_note=person.services_note,
    )


class ApiContentReader:
    """Reads public content from the API at `base_url`. Use it as an async context manager."""

    def __init__(
        self, base_url: str, *, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        if urlsplit(base_url).scheme not in ("http", "https"):
            raise ValueError("the content API URL must be an http or https URL")
        self._http = httpx2.AsyncClient(
            base_url=base_url, timeout=READ_TIMEOUT_S, transport=transport, follow_redirects=False
        )
        self._client = Client(base_url=base_url).set_async_httpx_client(self._http)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._http.aclose()

    async def read_person(self) -> PublicPerson:
        try:
            response = await get_person.asyncio_detailed(client=self._client)
        except (httpx2.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ContentUnavailableError("the public profile could not be read") from error
        if response.status_code != 200 or not isinstance(response.parsed, Person):
            raise ContentUnavailableError("the public profile could not be read")
        try:
            return _person(response.parsed)
        except ValidationError as error:
            raise ContentUnavailableError("the public profile is malformed") from error
