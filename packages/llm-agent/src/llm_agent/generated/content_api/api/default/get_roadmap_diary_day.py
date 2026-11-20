import datetime
from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.diary_day import DiaryDay
from ...models.error_response import ErrorResponse
from ...types import Response


def _get_kwargs(
    date: datetime.date,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/roadmap/diary/{date}".format(
            date=quote(str(date), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> DiaryDay | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = DiaryDay.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())

        return response_404

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
) -> Response[DiaryDay | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    date: datetime.date,
    *,
    client: AuthenticatedClient | Client,
) -> Response[DiaryDay | ErrorResponse]:
    """Read one day of the learning diary

     The day's notes, its time entries, their derived total and the events covering it, as in the whole
    diary. A day without notes, time entries or a covering event is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DiaryDay | ErrorResponse]
    """

    kwargs = _get_kwargs(
        date=date,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    date: datetime.date,
    *,
    client: AuthenticatedClient | Client,
) -> DiaryDay | ErrorResponse | None:
    """Read one day of the learning diary

     The day's notes, its time entries, their derived total and the events covering it, as in the whole
    diary. A day without notes, time entries or a covering event is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DiaryDay | ErrorResponse
    """

    return sync_detailed(
        date=date,
        client=client,
    ).parsed


async def asyncio_detailed(
    date: datetime.date,
    *,
    client: AuthenticatedClient | Client,
) -> Response[DiaryDay | ErrorResponse]:
    """Read one day of the learning diary

     The day's notes, its time entries, their derived total and the events covering it, as in the whole
    diary. A day without notes, time entries or a covering event is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DiaryDay | ErrorResponse]
    """

    kwargs = _get_kwargs(
        date=date,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    date: datetime.date,
    *,
    client: AuthenticatedClient | Client,
) -> DiaryDay | ErrorResponse | None:
    """Read one day of the learning diary

     The day's notes, its time entries, their derived total and the events covering it, as in the whole
    diary. A day without notes, time entries or a covering event is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DiaryDay | ErrorResponse
    """

    return (
        await asyncio_detailed(
            date=date,
            client=client,
        )
    ).parsed
