from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...models.roadmap_event import RoadmapEvent
from ...models.roadmap_event_update import RoadmapEventUpdate
from ...types import UNSET, Response, Unset


def _get_kwargs(
    slug: str,
    *,
    body: RoadmapEventUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(sebela_provenance, Unset):
        headers["sebela-provenance"] = sebela_provenance

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/v1/roadmap/events/{slug}".format(
            slug=quote(str(slug), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ErrorResponse | RoadmapEvent | None:
    if response.status_code == 200:
        response_200 = RoadmapEvent.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())

        return response_409

    if response.status_code == 413:
        response_413 = ErrorResponse.from_dict(response.json())

        return response_413

    if response.status_code == 415:
        response_415 = ErrorResponse.from_dict(response.json())

        return response_415

    if response.status_code == 429:
        response_429 = ErrorResponse.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = ErrorResponse.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> Response[ErrorResponse | RoadmapEvent]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: RoadmapEventUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[ErrorResponse | RoadmapEvent]:
    """Update an event

     Changes only the fields sent; `null` clears an optional field, given `topics` replace every link and
    the slug cannot change. The dates are inclusive Europe/Prague calendar days; the end cannot be
    before the start (`validation_failed` on `endsOn`) and equals it for a single-day event. Every slug
    in `topics` names an existing topic, each once (`validation_failed` on `topics`). The event shows on
    every diary day of its range without adding time. The period is judged with the stored dates. New
    dates that would leave logged attendance outside the event are refused (`409`, naming those days)
    and nothing changes.

    Args:
        slug (str): The stable, unique address of the record, for example `paldock`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapEventUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RoadmapEvent]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
        sebela_provenance=sebela_provenance,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: RoadmapEventUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> ErrorResponse | RoadmapEvent | None:
    """Update an event

     Changes only the fields sent; `null` clears an optional field, given `topics` replace every link and
    the slug cannot change. The dates are inclusive Europe/Prague calendar days; the end cannot be
    before the start (`validation_failed` on `endsOn`) and equals it for a single-day event. Every slug
    in `topics` names an existing topic, each once (`validation_failed` on `topics`). The event shows on
    every diary day of its range without adding time. The period is judged with the stored dates. New
    dates that would leave logged attendance outside the event are refused (`409`, naming those days)
    and nothing changes.

    Args:
        slug (str): The stable, unique address of the record, for example `paldock`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapEventUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RoadmapEvent
    """

    return sync_detailed(
        slug=slug,
        client=client,
        body=body,
        sebela_provenance=sebela_provenance,
    ).parsed


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: RoadmapEventUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[ErrorResponse | RoadmapEvent]:
    """Update an event

     Changes only the fields sent; `null` clears an optional field, given `topics` replace every link and
    the slug cannot change. The dates are inclusive Europe/Prague calendar days; the end cannot be
    before the start (`validation_failed` on `endsOn`) and equals it for a single-day event. Every slug
    in `topics` names an existing topic, each once (`validation_failed` on `topics`). The event shows on
    every diary day of its range without adding time. The period is judged with the stored dates. New
    dates that would leave logged attendance outside the event are refused (`409`, naming those days)
    and nothing changes.

    Args:
        slug (str): The stable, unique address of the record, for example `paldock`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapEventUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RoadmapEvent]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
        sebela_provenance=sebela_provenance,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: RoadmapEventUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> ErrorResponse | RoadmapEvent | None:
    """Update an event

     Changes only the fields sent; `null` clears an optional field, given `topics` replace every link and
    the slug cannot change. The dates are inclusive Europe/Prague calendar days; the end cannot be
    before the start (`validation_failed` on `endsOn`) and equals it for a single-day event. Every slug
    in `topics` names an existing topic, each once (`validation_failed` on `topics`). The event shows on
    every diary day of its range without adding time. The period is judged with the stored dates. New
    dates that would leave logged attendance outside the event are refused (`409`, naming those days)
    and nothing changes.

    Args:
        slug (str): The stable, unique address of the record, for example `paldock`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapEventUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RoadmapEvent
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
            body=body,
            sebela_provenance=sebela_provenance,
        )
    ).parsed
