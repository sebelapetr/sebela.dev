import datetime
from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    date: datetime.date,
    *,
    sebela_provenance: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(sebela_provenance, Unset):
        headers["sebela-provenance"] = sebela_provenance

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/v1/roadmap/diary/{date}".format(
            date=quote(str(date), safe=""),
        ),
    }

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> Any | ErrorResponse | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

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
) -> Response[Any | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    date: datetime.date,
    *,
    client: AuthenticatedClient,
    sebela_provenance: str | Unset = UNSET,
) -> Response[Any | ErrorResponse]:
    """Delete a diary day's notes

     Clears the notes and keeps the day's time entries; a day without notes is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
    """

    kwargs = _get_kwargs(
        date=date,
        sebela_provenance=sebela_provenance,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    date: datetime.date,
    *,
    client: AuthenticatedClient,
    sebela_provenance: str | Unset = UNSET,
) -> Any | ErrorResponse | None:
    """Delete a diary day's notes

     Clears the notes and keeps the day's time entries; a day without notes is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
    """

    return sync_detailed(
        date=date,
        client=client,
        sebela_provenance=sebela_provenance,
    ).parsed


async def asyncio_detailed(
    date: datetime.date,
    *,
    client: AuthenticatedClient,
    sebela_provenance: str | Unset = UNSET,
) -> Response[Any | ErrorResponse]:
    """Delete a diary day's notes

     Clears the notes and keeps the day's time entries; a day without notes is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
    """

    kwargs = _get_kwargs(
        date=date,
        sebela_provenance=sebela_provenance,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    date: datetime.date,
    *,
    client: AuthenticatedClient,
    sebela_provenance: str | Unset = UNSET,
) -> Any | ErrorResponse | None:
    """Delete a diary day's notes

     Clears the notes and keeps the day's time entries; a day without notes is not found.

    Args:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
    """

    return (
        await asyncio_detailed(
            date=date,
            client=client,
            sebela_provenance=sebela_provenance,
        )
    ).parsed
