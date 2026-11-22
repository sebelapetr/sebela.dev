from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...models.roadmap_area_detail import RoadmapAreaDetail
from ...types import Response


def _get_kwargs(
    area: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/roadmap/tree/{area}".format(
            area=quote(str(area), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ErrorResponse | RoadmapAreaDetail | None:
    if response.status_code == 200:
        response_200 = RoadmapAreaDetail.from_dict(response.json())

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
) -> Response[ErrorResponse | RoadmapAreaDetail]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    area: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[ErrorResponse | RoadmapAreaDetail]:
    """Read one area of the roadmap tree

     The area exactly as it appears in the whole roadmap: its modules and their resources in position
    order, with the same derived progress. A missing area is not found.

    Args:
        area (str): The slug of the area.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RoadmapAreaDetail]
    """

    kwargs = _get_kwargs(
        area=area,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    area: str,
    *,
    client: AuthenticatedClient | Client,
) -> ErrorResponse | RoadmapAreaDetail | None:
    """Read one area of the roadmap tree

     The area exactly as it appears in the whole roadmap: its modules and their resources in position
    order, with the same derived progress. A missing area is not found.

    Args:
        area (str): The slug of the area.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RoadmapAreaDetail
    """

    return sync_detailed(
        area=area,
        client=client,
    ).parsed


async def asyncio_detailed(
    area: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[ErrorResponse | RoadmapAreaDetail]:
    """Read one area of the roadmap tree

     The area exactly as it appears in the whole roadmap: its modules and their resources in position
    order, with the same derived progress. A missing area is not found.

    Args:
        area (str): The slug of the area.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RoadmapAreaDetail]
    """

    kwargs = _get_kwargs(
        area=area,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    area: str,
    *,
    client: AuthenticatedClient | Client,
) -> ErrorResponse | RoadmapAreaDetail | None:
    """Read one area of the roadmap tree

     The area exactly as it appears in the whole roadmap: its modules and their resources in position
    order, with the same derived progress. A missing area is not found.

    Args:
        area (str): The slug of the area.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RoadmapAreaDetail
    """

    return (
        await asyncio_detailed(
            area=area,
            client=client,
        )
    ).parsed
