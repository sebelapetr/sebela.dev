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
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.chat_contact_link import ChatContactLink


T = TypeVar("T", bound="ChatBlockType0")


@_attrs_define
class ChatBlockType0:
    """
    Attributes:
        type_ (Literal['ContactCard']):
        email (None | str):
        links (list[ChatContactLink]):
    """

    type_: Literal["ContactCard"]
    email: None | str
    links: list[ChatContactLink]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        email: None | str
        email = self.email

        links = []
        for links_item_data in self.links:
            links_item = links_item_data.to_dict()
            links.append(links_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.chat_contact_link import ChatContactLink

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
            links_item = ChatContactLink.from_dict(links_item_data)

            links.append(links_item)

        chat_block_type_0 = cls(
            type_=type_,
            email=email,
            links=links,
        )

        chat_block_type_0.additional_properties = d
        return chat_block_type_0

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
