from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...models.time_entry_update import TimeEntryUpdate
from ...models.time_entry_write import TimeEntryWrite
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    body: TimeEntryUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(sebela_provenance, Unset):
        headers["sebela-provenance"] = sebela_provenance

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/v1/roadmap/time-entries/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ErrorResponse | TimeEntryWrite | None:
    if response.status_code == 200:
        response_200 = TimeEntryWrite.from_dict(response.json())

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
) -> Response[ErrorResponse | TimeEntryWrite]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: TimeEntryUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[ErrorResponse | TimeEntryWrite]:
    """Update a time entry

     Changes only the fields sent and judges the merged interval by the same rules. Give both endpoints
    as absolute instants with an offset, in whole seconds, the end after the start; an offset tells a
    repeated local hour apart. The target is exactly one `resource` (study time) or `event`
    (attendance), and attendance must fall on the event's days. The session is split at each
    Europe/Prague midnight into one entry per diary day without changing its elapsed time. It must not
    overlap any logged interval on any resource or event, also one written at the same time (`409`);
    adjacent intervals are allowed. An unknown `resource` or `event`, or attendance outside the event,
    is refused naming the field. The first entry keeps the identifier; the result names the old and the
    new days, whose notes stay.

    Args:
        id (UUID):
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (TimeEntryUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | TimeEntryWrite]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
        sebela_provenance=sebela_provenance,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: TimeEntryUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> ErrorResponse | TimeEntryWrite | None:
    """Update a time entry

     Changes only the fields sent and judges the merged interval by the same rules. Give both endpoints
    as absolute instants with an offset, in whole seconds, the end after the start; an offset tells a
    repeated local hour apart. The target is exactly one `resource` (study time) or `event`
    (attendance), and attendance must fall on the event's days. The session is split at each
    Europe/Prague midnight into one entry per diary day without changing its elapsed time. It must not
    overlap any logged interval on any resource or event, also one written at the same time (`409`);
    adjacent intervals are allowed. An unknown `resource` or `event`, or attendance outside the event,
    is refused naming the field. The first entry keeps the identifier; the result names the old and the
    new days, whose notes stay.

    Args:
        id (UUID):
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (TimeEntryUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | TimeEntryWrite
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
        sebela_provenance=sebela_provenance,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: TimeEntryUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[ErrorResponse | TimeEntryWrite]:
    """Update a time entry

     Changes only the fields sent and judges the merged interval by the same rules. Give both endpoints
    as absolute instants with an offset, in whole seconds, the end after the start; an offset tells a
    repeated local hour apart. The target is exactly one `resource` (study time) or `event`
    (attendance), and attendance must fall on the event's days. The session is split at each
    Europe/Prague midnight into one entry per diary day without changing its elapsed time. It must not
    overlap any logged interval on any resource or event, also one written at the same time (`409`);
    adjacent intervals are allowed. An unknown `resource` or `event`, or attendance outside the event,
    is refused naming the field. The first entry keeps the identifier; the result names the old and the
    new days, whose notes stay.

    Args:
        id (UUID):
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (TimeEntryUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | TimeEntryWrite]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
        sebela_provenance=sebela_provenance,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: TimeEntryUpdate,
    sebela_provenance: str | Unset = UNSET,
) -> ErrorResponse | TimeEntryWrite | None:
    """Update a time entry

     Changes only the fields sent and judges the merged interval by the same rules. Give both endpoints
    as absolute instants with an offset, in whole seconds, the end after the start; an offset tells a
    repeated local hour apart. The target is exactly one `resource` (study time) or `event`
    (attendance), and attendance must fall on the event's days. The session is split at each
    Europe/Prague midnight into one entry per diary day without changing its elapsed time. It must not
    overlap any logged interval on any resource or event, also one written at the same time (`409`);
    adjacent intervals are allowed. An unknown `resource` or `event`, or attendance outside the event,
    is refused naming the field. The first entry keeps the identifier; the result names the old and the
    new days, whose notes stay.

    Args:
        id (UUID):
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (TimeEntryUpdate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | TimeEntryWrite
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
            sebela_provenance=sebela_provenance,
        )
    ).parsed
