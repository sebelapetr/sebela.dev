from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.cv import Cv
from ...models.error_response import ErrorResponse
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/cv",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> Cv | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = Cv.from_dict(response.json())

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
) -> Response[Cv | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Cv | ErrorResponse]:
    """Read the assembled CV

     The person with contacts and summary, the experiences selected for the CV, the technologies in their
    tiers and groups, the education records, the explorations in a section of their own with their
    status exactly as stored (`built`, `tested` or `designed`) and the current, manually uploaded CV PDF
    or `null`. Absent sections are empty lists. While there is no person this answers 404 `not_found`
    and creates nothing.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Cv | ErrorResponse]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> Cv | ErrorResponse | None:
    """Read the assembled CV

     The person with contacts and summary, the experiences selected for the CV, the technologies in their
    tiers and groups, the education records, the explorations in a section of their own with their
    status exactly as stored (`built`, `tested` or `designed`) and the current, manually uploaded CV PDF
    or `null`. Absent sections are empty lists. While there is no person this answers 404 `not_found`
    and creates nothing.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Cv | ErrorResponse
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Cv | ErrorResponse]:
    """Read the assembled CV

     The person with contacts and summary, the experiences selected for the CV, the technologies in their
    tiers and groups, the education records, the explorations in a section of their own with their
    status exactly as stored (`built`, `tested` or `designed`) and the current, manually uploaded CV PDF
    or `null`. Absent sections are empty lists. While there is no person this answers 404 `not_found`
    and creates nothing.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Cv | ErrorResponse]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> Cv | ErrorResponse | None:
    """Read the assembled CV

     The person with contacts and summary, the experiences selected for the CV, the technologies in their
    tiers and groups, the education records, the explorations in a section of their own with their
    status exactly as stored (`built`, `tested` or `designed`) and the current, manually uploaded CV PDF
    or `null`. Absent sections are empty lists. While there is no person this answers 404 `not_found`
    and creates nothing.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Cv | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
