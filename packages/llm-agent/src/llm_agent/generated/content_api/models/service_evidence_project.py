from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ServiceEvidenceProject")


@_attrs_define
class ServiceEvidenceProject:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        summary (str): Markdown.
        experience (str): The slug of the experience it belongs to.
    """

    slug: str
    name: str
    summary: str
    experience: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        summary = self.summary

        experience = self.experience

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "summary": summary,
                "experience": experience,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        experience = d.pop("experience")

        service_evidence_project = cls(
            slug=slug,
            name=name,
            summary=summary,
            experience=experience,
        )

        return service_evidence_project
