from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatBlockOutputType1")


@_attrs_define
class ChatBlockOutputType1:
    """
    Attributes:
        type_ (Literal['ExperienceCard']):
        title (str):
        organization (None | str):
        started_on (datetime.date):
        ended_on (datetime.date | None):
        summary (None | str):
        technologies (list[str]):
        href (str): A path on this site with an optional anchor, such as `/experience#…`.
    """

    type_: Literal["ExperienceCard"]
    title: str
    organization: None | str
    started_on: datetime.date
    ended_on: datetime.date | None
    summary: None | str
    technologies: list[str]
    href: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        organization: None | str
        organization = self.organization

        started_on = self.started_on.isoformat()

        ended_on: None | str
        if isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        summary: None | str
        summary = self.summary

        technologies = self.technologies

        href = self.href

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "title": title,
                "organization": organization,
                "startedOn": started_on,
                "endedOn": ended_on,
                "summary": summary,
                "technologies": technologies,
                "href": href,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        type_ = cast(Literal["ExperienceCard"], d.pop("type"))
        if type_ != "ExperienceCard":
            raise ValueError(f"type must match const 'ExperienceCard', got '{type_}'")

        title = d.pop("title")

        def _parse_organization(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        organization = _parse_organization(d.pop("organization"))

        started_on = datetime.date.fromisoformat(d.pop("startedOn"))

        def _parse_ended_on(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ended_on_type_0 = datetime.date.fromisoformat(data)

                return ended_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        ended_on = _parse_ended_on(d.pop("endedOn"))

        def _parse_summary(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        summary = _parse_summary(d.pop("summary"))

        technologies = cast(list[str], d.pop("technologies"))

        href = d.pop("href")

        chat_block_output_type_1 = cls(
            type_=type_,
            title=title,
            organization=organization,
            started_on=started_on,
            ended_on=ended_on,
            summary=summary,
            technologies=technologies,
            href=href,
        )

        return chat_block_output_type_1
