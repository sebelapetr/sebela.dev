from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...models.recent_changes import RecentChanges
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/audit/changes",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ErrorResponse | RecentChanges | None:
    if response.status_code == 200:
        response_200 = RecentChanges.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

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
) -> Response[ErrorResponse | RecentChanges]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorResponse | RecentChanges]:
    """Read the newest content changes

     The newest 20 audited content changes, newest first: one per record a committed write changed, with
    the verified API key that made it, the operation and route, the provenance label the caller stated,
    and the record's public read before and after. A refused or failed write records nothing. A caller
    that lost the response to a write reads this to learn whether the write committed before it tries
    again. The provenance label is what a caller stated, never proof of who acted or that a human
    approved.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RecentChanges]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ErrorResponse | RecentChanges | None:
    """Read the newest content changes

     The newest 20 audited content changes, newest first: one per record a committed write changed, with
    the verified API key that made it, the operation and route, the provenance label the caller stated,
    and the record's public read before and after. A refused or failed write records nothing. A caller
    that lost the response to a write reads this to learn whether the write committed before it tries
    again. The provenance label is what a caller stated, never proof of who acted or that a human
    approved.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RecentChanges
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ErrorResponse | RecentChanges]:
    """Read the newest content changes

     The newest 20 audited content changes, newest first: one per record a committed write changed, with
    the verified API key that made it, the operation and route, the provenance label the caller stated,
    and the record's public read before and after. A refused or failed write records nothing. A caller
    that lost the response to a write reads this to learn whether the write committed before it tries
    again. The provenance label is what a caller stated, never proof of who acted or that a human
    approved.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RecentChanges]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ErrorResponse | RecentChanges | None:
    """Read the newest content changes

     The newest 20 audited content changes, newest first: one per record a committed write changed, with
    the verified API key that made it, the operation and route, the provenance label the caller stated,
    and the record's public read before and after. A refused or failed write records nothing. A caller
    that lost the response to a write reads this to learn whether the write committed before it tries
    again. The provenance label is what a caller stated, never proof of who acted or that a human
    approved.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RecentChanges
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
