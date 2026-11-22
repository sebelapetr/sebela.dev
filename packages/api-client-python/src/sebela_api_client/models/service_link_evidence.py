from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

T = TypeVar("T", bound="ServiceLinkEvidence")


@_attrs_define
class ServiceLinkEvidence:
    """A link to another part of the site.

    Attributes:
        kind (Literal['link']):
        label (str): The text of the link, for example `AI Roadmap`.
        path (str): A path within the site, for example `/roadmap` or `/contact?topic=automation`. It starts with a
            single `/`; schemes, hosts, whitespace and backslashes are rejected.
    """

    kind: Literal["link"]
    label: str
    path: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        label = self.label

        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "label": label,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        kind = cast(Literal["link"], d.pop("kind"))
        if kind != "link":
            raise ValueError(f"kind must match const 'link', got '{kind}'")

        label = d.pop("label")

        path = d.pop("path")

        service_link_evidence = cls(
            kind=kind,
            label=label,
            path=path,
        )

        return service_link_evidence
