from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.collaboration_step import CollaborationStep
    from ..models.person_link import PersonLink


T = TypeVar("T", bound="Person")


@_attrs_define
class Person:
    """
    Attributes:
        id (UUID):
        name (str):
        headline (str):
        short_bio (str): Markdown.
        long_bio (None | str): Markdown.
        location (None | str):
        email (None | str):
        links (list[PersonLink]):
        availability (None | str):
        career_started_on (datetime.date | None): The date the career started.
        services_intro (None | str): Markdown: the introduction of the services page, before the services.
        collaboration_steps (list[CollaborationStep]): How the person works with a client, as steps in their intended
            order.
        services_note (None | str): Markdown: the note before the services page's closing action, for example what is
            long-standing practice and what is a newer focus.
        photo_id (None | UUID): The identifier of the person's photo, an uploaded image.
        cv_pdf_id (None | UUID): The identifier of the current CV PDF, an uploaded, manually prepared PDF. It is never
            generated.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    name: str
    headline: str
    short_bio: str
    long_bio: None | str
    location: None | str
    email: None | str
    links: list[PersonLink]
    availability: None | str
    career_started_on: datetime.date | None
    services_intro: None | str
    collaboration_steps: list[CollaborationStep]
    services_note: None | str
    photo_id: None | UUID
    cv_pdf_id: None | UUID
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        name = self.name

        headline = self.headline

        short_bio = self.short_bio

        long_bio: None | str
        long_bio = self.long_bio

        location: None | str
        location = self.location

        email: None | str
        email = self.email

        links = []
        for links_item_data in self.links:
            links_item = links_item_data.to_dict()
            links.append(links_item)

        availability: None | str
        availability = self.availability

        career_started_on: None | str
        if isinstance(self.career_started_on, datetime.date):
            career_started_on = self.career_started_on.isoformat()
        else:
            career_started_on = self.career_started_on

        services_intro: None | str
        services_intro = self.services_intro

        collaboration_steps = []
        for collaboration_steps_item_data in self.collaboration_steps:
            collaboration_steps_item = collaboration_steps_item_data.to_dict()
            collaboration_steps.append(collaboration_steps_item)

        services_note: None | str
        services_note = self.services_note

        photo_id: None | str
        if isinstance(self.photo_id, UUID):
            photo_id = str(self.photo_id)
        else:
            photo_id = self.photo_id

        cv_pdf_id: None | str
        if isinstance(self.cv_pdf_id, UUID):
            cv_pdf_id = str(self.cv_pdf_id)
        else:
            cv_pdf_id = self.cv_pdf_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "headline": headline,
                "shortBio": short_bio,
                "longBio": long_bio,
                "location": location,
                "email": email,
                "links": links,
                "availability": availability,
                "careerStartedOn": career_started_on,
                "servicesIntro": services_intro,
                "collaborationSteps": collaboration_steps,
                "servicesNote": services_note,
                "photoId": photo_id,
                "cvPdfId": cv_pdf_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.collaboration_step import CollaborationStep
        from ..models.person_link import PersonLink

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        name = d.pop("name")

        headline = d.pop("headline")

        short_bio = d.pop("shortBio")

        def _parse_long_bio(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        long_bio = _parse_long_bio(d.pop("longBio"))

        def _parse_location(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        location = _parse_location(d.pop("location"))

        def _parse_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        email = _parse_email(d.pop("email"))

        links = []
        _links = d.pop("links")
        for links_item_data in _links:
            links_item = PersonLink.from_dict(links_item_data)

            links.append(links_item)

        def _parse_availability(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        availability = _parse_availability(d.pop("availability"))

        def _parse_career_started_on(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                career_started_on_type_0 = datetime.date.fromisoformat(data)

                return career_started_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        career_started_on = _parse_career_started_on(d.pop("careerStartedOn"))

        def _parse_services_intro(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        services_intro = _parse_services_intro(d.pop("servicesIntro"))

        collaboration_steps = []
        _collaboration_steps = d.pop("collaborationSteps")
        for collaboration_steps_item_data in _collaboration_steps:
            collaboration_steps_item = CollaborationStep.from_dict(
                collaboration_steps_item_data
            )

            collaboration_steps.append(collaboration_steps_item)

        def _parse_services_note(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        services_note = _parse_services_note(d.pop("servicesNote"))

        def _parse_photo_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                photo_id_type_0 = UUID(data)

                return photo_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        photo_id = _parse_photo_id(d.pop("photoId"))

        def _parse_cv_pdf_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                cv_pdf_id_type_0 = UUID(data)

                return cv_pdf_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        cv_pdf_id = _parse_cv_pdf_id(d.pop("cvPdfId"))

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        person = cls(
            id=id,
            name=name,
            headline=headline,
            short_bio=short_bio,
            long_bio=long_bio,
            location=location,
            email=email,
            links=links,
            availability=availability,
            career_started_on=career_started_on,
            services_intro=services_intro,
            collaboration_steps=collaboration_steps,
            services_note=services_note,
            photo_id=photo_id,
            cv_pdf_id=cv_pdf_id,
            created_at=created_at,
            updated_at=updated_at,
        )

        return person
