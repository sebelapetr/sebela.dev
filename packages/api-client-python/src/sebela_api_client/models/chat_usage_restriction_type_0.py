from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.chat_usage_restriction_type_0_reason import (
    ChatUsageRestrictionType0Reason,
)

T = TypeVar("T", bound="ChatUsageRestrictionType0")


@_attrs_define
class ChatUsageRestrictionType0:
    """
    Attributes:
        reason (ChatUsageRestrictionType0Reason):
        retry_at (datetime.datetime):
    """

    reason: ChatUsageRestrictionType0Reason
    retry_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason.value

        retry_at = self.retry_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "reason": reason,
                "retryAt": retry_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        reason = ChatUsageRestrictionType0Reason(d.pop("reason"))

        retry_at = datetime.datetime.fromisoformat(d.pop("retryAt"))

        chat_usage_restriction_type_0 = cls(
            reason=reason,
            retry_at=retry_at,
        )

        return chat_usage_restriction_type_0
