from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.chat_grant_claimed_kind import ChatGrantClaimedKind

T = TypeVar("T", bound="ChatGrantClaimed")


@_attrs_define
class ChatGrantClaimed:
    """
    Attributes:
        claimed (bool):
        kind (ChatGrantClaimedKind): Whether the grant is for an answer or a compaction; the other is refused.
        deadline_at (datetime.datetime):
        allowance_usd (float):
        model (str):
        effort (None | str): The reasoning effort bound at admission; `null` for an operation admitted without one.
        pricing_version (str):
        context_revision (int):
    """

    claimed: bool
    kind: ChatGrantClaimedKind
    deadline_at: datetime.datetime
    allowance_usd: float
    model: str
    effort: None | str
    pricing_version: str
    context_revision: int

    def to_dict(self) -> dict[str, Any]:
        claimed = self.claimed

        kind = self.kind.value

        deadline_at = self.deadline_at.isoformat()

        allowance_usd = self.allowance_usd

        model = self.model

        effort: None | str
        effort = self.effort

        pricing_version = self.pricing_version

        context_revision = self.context_revision

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "claimed": claimed,
                "kind": kind,
                "deadlineAt": deadline_at,
                "allowanceUsd": allowance_usd,
                "model": model,
                "effort": effort,
                "pricingVersion": pricing_version,
                "contextRevision": context_revision,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        claimed = d.pop("claimed")

        kind = ChatGrantClaimedKind(d.pop("kind"))

        deadline_at = datetime.datetime.fromisoformat(d.pop("deadlineAt"))

        allowance_usd = d.pop("allowanceUsd")

        model = d.pop("model")

        def _parse_effort(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        effort = _parse_effort(d.pop("effort"))

        pricing_version = d.pop("pricingVersion")

        context_revision = d.pop("contextRevision")

        chat_grant_claimed = cls(
            claimed=claimed,
            kind=kind,
            deadline_at=deadline_at,
            allowance_usd=allowance_usd,
            model=model,
            effort=effort,
            pricing_version=pricing_version,
            context_revision=context_revision,
        )

        return chat_grant_claimed
