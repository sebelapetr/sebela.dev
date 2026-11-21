from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.diary import Diary
from ...models.error_response import ErrorResponse
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/roadmap/diary",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> Diary | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = Diary.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

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
) -> Response[Diary | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Diary | ErrorResponse]:
    """Read the learning diary

     Every Europe/Prague calendar day with notes, time entries or an event covering it, newest first,
    each with its entries in time order and their resource or event, and the events whose dates cover
    it. An event's days add no time. Durations and day totals are derived from the stored endpoints on
    every read, in actual elapsed seconds and before any rounding. An empty diary is the valid empty
    `days` list.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Diary | ErrorResponse]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> Diary | ErrorResponse | None:
    """Read the learning diary

     Every Europe/Prague calendar day with notes, time entries or an event covering it, newest first,
    each with its entries in time order and their resource or event, and the events whose dates cover
    it. An event's days add no time. Durations and day totals are derived from the stored endpoints on
    every read, in actual elapsed seconds and before any rounding. An empty diary is the valid empty
    `days` list.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Diary | ErrorResponse
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Diary | ErrorResponse]:
    """Read the learning diary

     Every Europe/Prague calendar day with notes, time entries or an event covering it, newest first,
    each with its entries in time order and their resource or event, and the events whose dates cover
    it. An event's days add no time. Durations and day totals are derived from the stored endpoints on
    every read, in actual elapsed seconds and before any rounding. An empty diary is the valid empty
    `days` list.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Diary | ErrorResponse]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> Diary | ErrorResponse | None:
    """Read the learning diary

     Every Europe/Prague calendar day with notes, time entries or an event covering it, newest first,
    each with its entries in time order and their resource or event, and the events whose dates cover
    it. An event's days add no time. Durations and day totals are derived from the stored endpoints on
    every read, in actual elapsed seconds and before any rounding. An empty diary is the valid empty
    `days` list.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Diary | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
