from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.collaboration_step import CollaborationStep
    from ..models.person_link import PersonLink


T = TypeVar("T", bound="PersonCreate")


@_attrs_define
class PersonCreate:
    """
    Attributes:
        name (str):
        headline (str):
        short_bio (str): Markdown.
        long_bio (None | str | Unset): Markdown.
        location (None | str | Unset):
        email (None | str | Unset):
        links (list[PersonLink] | Unset):
        availability (None | str | Unset):
        career_started_on (datetime.date | None | Unset): The date the career started.
        services_intro (None | str | Unset): Markdown: the introduction of the services page, before the services.
        collaboration_steps (list[CollaborationStep] | Unset): How the person works with a client, as steps in their
            intended order.
        services_note (None | str | Unset): Markdown: the note before the services page's closing action, for example
            what is long-standing practice and what is a newer focus.
        photo_id (None | Unset | UUID): The identifier of the person's photo, an uploaded image.
        cv_pdf_id (None | Unset | UUID): The identifier of the current CV PDF, an uploaded, manually prepared PDF. It is
            never generated.
    """

    name: str
    headline: str
    short_bio: str
    long_bio: None | str | Unset = UNSET
    location: None | str | Unset = UNSET
    email: None | str | Unset = UNSET
    links: list[PersonLink] | Unset = UNSET
    availability: None | str | Unset = UNSET
    career_started_on: datetime.date | None | Unset = UNSET
    services_intro: None | str | Unset = UNSET
    collaboration_steps: list[CollaborationStep] | Unset = UNSET
    services_note: None | str | Unset = UNSET
    photo_id: None | Unset | UUID = UNSET
    cv_pdf_id: None | Unset | UUID = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        headline = self.headline

        short_bio = self.short_bio

        long_bio: None | str | Unset
        if isinstance(self.long_bio, Unset):
            long_bio = UNSET
        else:
            long_bio = self.long_bio

        location: None | str | Unset
        if isinstance(self.location, Unset):
            location = UNSET
        else:
            location = self.location

        email: None | str | Unset
        if isinstance(self.email, Unset):
            email = UNSET
        else:
            email = self.email

        links: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.links, Unset):
            links = []
            for links_item_data in self.links:
                links_item = links_item_data.to_dict()
                links.append(links_item)

        availability: None | str | Unset
        if isinstance(self.availability, Unset):
            availability = UNSET
        else:
            availability = self.availability

        career_started_on: None | str | Unset
        if isinstance(self.career_started_on, Unset):
            career_started_on = UNSET
        elif isinstance(self.career_started_on, datetime.date):
            career_started_on = self.career_started_on.isoformat()
        else:
            career_started_on = self.career_started_on

        services_intro: None | str | Unset
        if isinstance(self.services_intro, Unset):
            services_intro = UNSET
        else:
            services_intro = self.services_intro

        collaboration_steps: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.collaboration_steps, Unset):
            collaboration_steps = []
            for collaboration_steps_item_data in self.collaboration_steps:
                collaboration_steps_item = collaboration_steps_item_data.to_dict()
                collaboration_steps.append(collaboration_steps_item)

        services_note: None | str | Unset
        if isinstance(self.services_note, Unset):
            services_note = UNSET
        else:
            services_note = self.services_note

        photo_id: None | str | Unset
        if isinstance(self.photo_id, Unset):
            photo_id = UNSET
        elif isinstance(self.photo_id, UUID):
            photo_id = str(self.photo_id)
        else:
            photo_id = self.photo_id

        cv_pdf_id: None | str | Unset
        if isinstance(self.cv_pdf_id, Unset):
            cv_pdf_id = UNSET
        elif isinstance(self.cv_pdf_id, UUID):
            cv_pdf_id = str(self.cv_pdf_id)
        else:
            cv_pdf_id = self.cv_pdf_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "headline": headline,
                "shortBio": short_bio,
            }
        )
        if long_bio is not UNSET:
            field_dict["longBio"] = long_bio
        if location is not UNSET:
            field_dict["location"] = location
        if email is not UNSET:
            field_dict["email"] = email
        if links is not UNSET:
            field_dict["links"] = links
        if availability is not UNSET:
            field_dict["availability"] = availability
        if career_started_on is not UNSET:
            field_dict["careerStartedOn"] = career_started_on
        if services_intro is not UNSET:
            field_dict["servicesIntro"] = services_intro
        if collaboration_steps is not UNSET:
            field_dict["collaborationSteps"] = collaboration_steps
        if services_note is not UNSET:
            field_dict["servicesNote"] = services_note
        if photo_id is not UNSET:
            field_dict["photoId"] = photo_id
        if cv_pdf_id is not UNSET:
            field_dict["cvPdfId"] = cv_pdf_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.collaboration_step import CollaborationStep
        from ..models.person_link import PersonLink

        d = dict(src_dict)
        name = d.pop("name")

        headline = d.pop("headline")

        short_bio = d.pop("shortBio")

        def _parse_long_bio(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        long_bio = _parse_long_bio(d.pop("longBio", UNSET))

        def _parse_location(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        location = _parse_location(d.pop("location", UNSET))

        def _parse_email(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        email = _parse_email(d.pop("email", UNSET))

        _links = d.pop("links", UNSET)
        links: list[PersonLink] | Unset = UNSET
        if _links is not UNSET:
            links = []
            for links_item_data in _links:
                links_item = PersonLink.from_dict(links_item_data)

                links.append(links_item)

        def _parse_availability(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        availability = _parse_availability(d.pop("availability", UNSET))

        def _parse_career_started_on(data: object) -> datetime.date | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                career_started_on_type_0 = datetime.date.fromisoformat(data)

                return career_started_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None | Unset, data)

        career_started_on = _parse_career_started_on(d.pop("careerStartedOn", UNSET))

        def _parse_services_intro(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        services_intro = _parse_services_intro(d.pop("servicesIntro", UNSET))

        _collaboration_steps = d.pop("collaborationSteps", UNSET)
        collaboration_steps: list[CollaborationStep] | Unset = UNSET
        if _collaboration_steps is not UNSET:
            collaboration_steps = []
            for collaboration_steps_item_data in _collaboration_steps:
                collaboration_steps_item = CollaborationStep.from_dict(
                    collaboration_steps_item_data
                )

                collaboration_steps.append(collaboration_steps_item)

        def _parse_services_note(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        services_note = _parse_services_note(d.pop("servicesNote", UNSET))

        def _parse_photo_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                photo_id_type_0 = UUID(data)

                return photo_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        photo_id = _parse_photo_id(d.pop("photoId", UNSET))

        def _parse_cv_pdf_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                cv_pdf_id_type_0 = UUID(data)

                return cv_pdf_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        cv_pdf_id = _parse_cv_pdf_id(d.pop("cvPdfId", UNSET))

        person_create = cls(
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
        )

        return person_create
