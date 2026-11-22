from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatGrantClaimed")


@_attrs_define
class ChatGrantClaimed:
    """
    Attributes:
        claimed (bool):
        deadline_at (datetime.datetime):
        allowance_usd (float):
        model (str):
        pricing_version (str):
        context_revision (int):
    """

    claimed: bool
    deadline_at: datetime.datetime
    allowance_usd: float
    model: str
    pricing_version: str
    context_revision: int

    def to_dict(self) -> dict[str, Any]:
        claimed = self.claimed

        deadline_at = self.deadline_at.isoformat()

        allowance_usd = self.allowance_usd

        model = self.model

        pricing_version = self.pricing_version

        context_revision = self.context_revision

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "claimed": claimed,
                "deadlineAt": deadline_at,
                "allowanceUsd": allowance_usd,
                "model": model,
                "pricingVersion": pricing_version,
                "contextRevision": context_revision,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        claimed = d.pop("claimed")

        deadline_at = datetime.datetime.fromisoformat(d.pop("deadlineAt"))

        allowance_usd = d.pop("allowanceUsd")

        model = d.pop("model")

        pricing_version = d.pop("pricingVersion")

        context_revision = d.pop("contextRevision")

        chat_grant_claimed = cls(
            claimed=claimed,
            deadline_at=deadline_at,
            allowance_usd=allowance_usd,
            model=model,
            pricing_version=pricing_version,
            context_revision=context_revision,
        )

        return chat_grant_claimed
