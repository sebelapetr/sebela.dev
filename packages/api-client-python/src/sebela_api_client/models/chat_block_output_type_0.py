from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.chat_contact_link_output import ChatContactLinkOutput


T = TypeVar("T", bound="ChatBlockOutputType0")


@_attrs_define
class ChatBlockOutputType0:
    """
    Attributes:
        type_ (Literal['ContactCard']):
        email (None | str):
        links (list[ChatContactLinkOutput]):
    """

    type_: Literal["ContactCard"]
    email: None | str
    links: list[ChatContactLinkOutput]

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        email: None | str
        email = self.email

        links = []
        for links_item_data in self.links:
            links_item = links_item_data.to_dict()
            links.append(links_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "email": email,
                "links": links,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_contact_link_output import ChatContactLinkOutput

        d = dict(src_dict)
        type_ = cast(Literal["ContactCard"], d.pop("type"))
        if type_ != "ContactCard":
            raise ValueError(f"type must match const 'ContactCard', got '{type_}'")

        def _parse_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        email = _parse_email(d.pop("email"))

        links = []
        _links = d.pop("links")
        for links_item_data in _links:
            links_item = ChatContactLinkOutput.from_dict(links_item_data)

            links.append(links_item)

        chat_block_output_type_0 = cls(
            type_=type_,
            email=email,
            links=links,
        )

        return chat_block_output_type_0
