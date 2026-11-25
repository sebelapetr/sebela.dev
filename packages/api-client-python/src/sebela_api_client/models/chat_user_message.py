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
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatUserMessage")


@_attrs_define
class ChatUserMessage:
    """
    Attributes:
        id (UUID):
        role (Literal['user']):
        request_id (UUID):
        text (str):
        created_at (datetime.datetime):
    """

    id: UUID
    role: Literal["user"]
    request_id: UUID
    text: str
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        role = self.role

        request_id = str(self.request_id)

        text = self.text

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "role": role,
                "requestId": request_id,
                "text": text,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        role = cast(Literal["user"], d.pop("role"))
        if role != "user":
            raise ValueError(f"role must match const 'user', got '{role}'")

        request_id = UUID(d.pop("requestId"))

        text = d.pop("text")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        chat_user_message = cls(
            id=id,
            role=role,
            request_id=request_id,
            text=text,
            created_at=created_at,
        )

        return chat_user_message
