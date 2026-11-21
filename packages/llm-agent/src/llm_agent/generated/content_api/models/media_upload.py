from __future__ import annotations

from collections.abc import Mapping
from io import BytesIO
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from .. import types
from ..types import UNSET, File, Unset

T = TypeVar("T", bound="MediaUpload")


@_attrs_define
class MediaUpload:
    """
    Attributes:
        file (File): A PNG, JPEG or WebP image or a PDF. Its declared type and extension must match its content.
        alt_text (str | Unset): Text that describes an image for people who cannot see it.
    """

    file: File
    alt_text: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        file = self.file.to_tuple()

        alt_text = self.alt_text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
            }
        )
        if alt_text is not UNSET:
            field_dict["altText"] = alt_text

        return field_dict

    def to_multipart(self) -> types.RequestFiles:
        files: types.RequestFiles = []

        files.append(("file", self.file.to_tuple()))

        if not isinstance(self.alt_text, Unset):
            files.append(("altText", (None, str(self.alt_text).encode(), "text/plain")))

        return files

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        file = File(payload=BytesIO(d.pop("file")))

        alt_text = d.pop("altText", UNSET)

        media_upload = cls(
            file=file,
            alt_text=alt_text,
        )

        return media_upload
