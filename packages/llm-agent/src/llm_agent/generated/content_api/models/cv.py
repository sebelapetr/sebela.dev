from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.cv_exploration import CvExploration
    from ..models.cv_technologies import CvTechnologies
    from ..models.education import Education
    from ..models.experience import Experience
    from ..models.media import Media
    from ..models.person import Person


T = TypeVar("T", bound="Cv")


@_attrs_define
class Cv:
    """`person` holds the contacts, links and summary (`shortBio`, `longBio`); the other fields are the CV's sections.

    Attributes:
        person (Person):
        experiences (list[Experience]): The experiences selected for the CV (`inCv`), current roles first, then by
            start, latest first, then by end, latest first, then by slug.
        technologies (CvTechnologies): The technology catalog in its tiers and groups.
        education (list[Education]): Every education record, by position, then slug.
        explorations (list[CvExploration]): Every exploration with its actual status, by position, then slug; a section
            of its own.
        cv_pdf (Media | None): The current, manually uploaded CV PDF the person names (`cvPdfId`), or `null` when there
            is none. It is never generated or updated from this data.
    """

    person: Person
    experiences: list[Experience]
    technologies: CvTechnologies
    education: list[Education]
    explorations: list[CvExploration]
    cv_pdf: Media | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.media import Media

        person = self.person.to_dict()

        experiences = []
        for experiences_item_data in self.experiences:
            experiences_item = experiences_item_data.to_dict()
            experiences.append(experiences_item)

        technologies = self.technologies.to_dict()

        education = []
        for education_item_data in self.education:
            education_item = education_item_data.to_dict()
            education.append(education_item)

        explorations = []
        for explorations_item_data in self.explorations:
            explorations_item = explorations_item_data.to_dict()
            explorations.append(explorations_item)

        cv_pdf: dict[str, Any] | None
        if isinstance(self.cv_pdf, Media):
            cv_pdf = self.cv_pdf.to_dict()
        else:
            cv_pdf = self.cv_pdf

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "person": person,
                "experiences": experiences,
                "technologies": technologies,
                "education": education,
                "explorations": explorations,
                "cvPdf": cv_pdf,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.cv_exploration import CvExploration
        from ..models.cv_technologies import CvTechnologies
        from ..models.education import Education
        from ..models.experience import Experience
        from ..models.media import Media
        from ..models.person import Person

        d = dict(src_dict)
        person = Person.from_dict(d.pop("person"))

        experiences = []
        _experiences = d.pop("experiences")
        for experiences_item_data in _experiences:
            experiences_item = Experience.from_dict(experiences_item_data)

            experiences.append(experiences_item)

        technologies = CvTechnologies.from_dict(d.pop("technologies"))

        education = []
        _education = d.pop("education")
        for education_item_data in _education:
            education_item = Education.from_dict(education_item_data)

            education.append(education_item)

        explorations = []
        _explorations = d.pop("explorations")
        for explorations_item_data in _explorations:
            explorations_item = CvExploration.from_dict(explorations_item_data)

            explorations.append(explorations_item)

        def _parse_cv_pdf(data: object) -> Media | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                cv_pdf_type_0 = Media.from_dict(data)

                return cv_pdf_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(Media | None, data)

        cv_pdf = _parse_cv_pdf(d.pop("cvPdf"))

        cv = cls(
            person=person,
            experiences=experiences,
            technologies=technologies,
            education=education,
            explorations=explorations,
            cv_pdf=cv_pdf,
        )

        return cv
