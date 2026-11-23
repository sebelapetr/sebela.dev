from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.chat_operation import ChatOperation
    from ..models.chat_usage_context_type_0 import ChatUsageContextType0
    from ..models.chat_usage_context_type_1 import ChatUsageContextType1
    from ..models.chat_usage_model import ChatUsageModel
    from ..models.chat_usage_next_request_type_0 import ChatUsageNextRequestType0
    from ..models.chat_usage_next_request_type_1 import ChatUsageNextRequestType1
    from ..models.chat_usage_restriction_type_0 import ChatUsageRestrictionType0
    from ..models.chat_usage_rolling_two_hours import ChatUsageRollingTwoHours
    from ..models.chat_usage_utc_day import ChatUsageUtcDay


T = TypeVar("T", bound="ChatUsage")


@_attrs_define
class ChatUsage:
    """
    Attributes:
        server_time (datetime.datetime): The server's time the snapshot was read at.
        model (ChatUsageModel): The server-configured main model and effort; read-only.
        rolling_two_hours (ChatUsageRollingTwoHours):
        utc_day (ChatUsageUtcDay):
        active_operation (ChatOperation | None):
        restriction (ChatUsageRestrictionType0 | None): Why a new question would be refused now and when it may pass
            again; `null` when it would pass these limits.
        context (ChatUsageContextType0 | ChatUsageContextType1): The conversation's last main model call: its serialized
            input against the effective cap.
        next_request (ChatUsageNextRequestType0 | ChatUsageNextRequestType1): A post-compaction estimate of the history
            the next request carries; future tool tokens are unknown and never claimed. `unavailable` unless the latest
            measured operation was a compaction.
    """

    server_time: datetime.datetime
    model: ChatUsageModel
    rolling_two_hours: ChatUsageRollingTwoHours
    utc_day: ChatUsageUtcDay
    active_operation: ChatOperation | None
    restriction: ChatUsageRestrictionType0 | None
    context: ChatUsageContextType0 | ChatUsageContextType1
    next_request: ChatUsageNextRequestType0 | ChatUsageNextRequestType1

    def to_dict(self) -> dict[str, Any]:
        from ..models.chat_operation import ChatOperation
        from ..models.chat_usage_context_type_0 import ChatUsageContextType0
        from ..models.chat_usage_next_request_type_0 import ChatUsageNextRequestType0
        from ..models.chat_usage_restriction_type_0 import ChatUsageRestrictionType0

        server_time = self.server_time.isoformat()

        model = self.model.to_dict()

        rolling_two_hours = self.rolling_two_hours.to_dict()

        utc_day = self.utc_day.to_dict()

        active_operation: dict[str, Any] | None
        if isinstance(self.active_operation, ChatOperation):
            active_operation = self.active_operation.to_dict()
        else:
            active_operation = self.active_operation

        restriction: dict[str, Any] | None
        if isinstance(self.restriction, ChatUsageRestrictionType0):
            restriction = self.restriction.to_dict()
        else:
            restriction = self.restriction

        context: dict[str, Any]
        if isinstance(self.context, ChatUsageContextType0):
            context = self.context.to_dict()
        else:
            context = self.context.to_dict()

        next_request: dict[str, Any]
        if isinstance(self.next_request, ChatUsageNextRequestType0):
            next_request = self.next_request.to_dict()
        else:
            next_request = self.next_request.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "serverTime": server_time,
                "model": model,
                "rollingTwoHours": rolling_two_hours,
                "utcDay": utc_day,
                "activeOperation": active_operation,
                "restriction": restriction,
                "context": context,
                "nextRequest": next_request,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_operation import ChatOperation
        from ..models.chat_usage_context_type_0 import ChatUsageContextType0
        from ..models.chat_usage_context_type_1 import ChatUsageContextType1
        from ..models.chat_usage_model import ChatUsageModel
        from ..models.chat_usage_next_request_type_0 import ChatUsageNextRequestType0
        from ..models.chat_usage_next_request_type_1 import ChatUsageNextRequestType1
        from ..models.chat_usage_restriction_type_0 import ChatUsageRestrictionType0
        from ..models.chat_usage_rolling_two_hours import ChatUsageRollingTwoHours
        from ..models.chat_usage_utc_day import ChatUsageUtcDay

        d = dict(src_dict)
        server_time = datetime.datetime.fromisoformat(d.pop("serverTime"))

        model = ChatUsageModel.from_dict(d.pop("model"))

        rolling_two_hours = ChatUsageRollingTwoHours.from_dict(d.pop("rollingTwoHours"))

        utc_day = ChatUsageUtcDay.from_dict(d.pop("utcDay"))

        def _parse_active_operation(data: object) -> ChatOperation | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                active_operation_type_0 = ChatOperation.from_dict(data)

                return active_operation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatOperation | None, data)

        active_operation = _parse_active_operation(d.pop("activeOperation"))

        def _parse_restriction(data: object) -> ChatUsageRestrictionType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                restriction_type_0 = ChatUsageRestrictionType0.from_dict(data)

                return restriction_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatUsageRestrictionType0 | None, data)

        restriction = _parse_restriction(d.pop("restriction"))

        def _parse_context(
            data: object,
        ) -> ChatUsageContextType0 | ChatUsageContextType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                context_type_0 = ChatUsageContextType0.from_dict(data)

                return context_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            context_type_1 = ChatUsageContextType1.from_dict(data)

            return context_type_1

        context = _parse_context(d.pop("context"))

        def _parse_next_request(
            data: object,
        ) -> ChatUsageNextRequestType0 | ChatUsageNextRequestType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                next_request_type_0 = ChatUsageNextRequestType0.from_dict(data)

                return next_request_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            next_request_type_1 = ChatUsageNextRequestType1.from_dict(data)

            return next_request_type_1

        next_request = _parse_next_request(d.pop("nextRequest"))

        chat_usage = cls(
            server_time=server_time,
            model=model,
            rolling_two_hours=rolling_two_hours,
            utc_day=utc_day,
            active_operation=active_operation,
            restriction=restriction,
            context=context,
            next_request=next_request,
        )

        return chat_usage
