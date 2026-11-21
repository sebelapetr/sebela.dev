from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...models.roadmap_module import RoadmapModule
from ...models.roadmap_module_create import RoadmapModuleCreate
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: RoadmapModuleCreate,
    sebela_provenance: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(sebela_provenance, Unset):
        headers["sebela-provenance"] = sebela_provenance

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/roadmap/modules",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ErrorResponse | RoadmapModule | None:
    if response.status_code == 201:
        response_201 = RoadmapModule.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

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
) -> Response[ErrorResponse | RoadmapModule]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: RoadmapModuleCreate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[ErrorResponse | RoadmapModule]:
    """Create a roadmap module

     The module belongs to the area named by `area`, which must exist. The slug is unique across all
    modules; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapModuleCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RoadmapModule]
    """

    kwargs = _get_kwargs(
        body=body,
        sebela_provenance=sebela_provenance,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: RoadmapModuleCreate,
    sebela_provenance: str | Unset = UNSET,
) -> ErrorResponse | RoadmapModule | None:
    """Create a roadmap module

     The module belongs to the area named by `area`, which must exist. The slug is unique across all
    modules; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapModuleCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RoadmapModule
    """

    return sync_detailed(
        client=client,
        body=body,
        sebela_provenance=sebela_provenance,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: RoadmapModuleCreate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[ErrorResponse | RoadmapModule]:
    """Create a roadmap module

     The module belongs to the area named by `area`, which must exist. The slug is unique across all
    modules; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapModuleCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RoadmapModule]
    """

    kwargs = _get_kwargs(
        body=body,
        sebela_provenance=sebela_provenance,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: RoadmapModuleCreate,
    sebela_provenance: str | Unset = UNSET,
) -> ErrorResponse | RoadmapModule | None:
    """Create a roadmap module

     The module belongs to the area named by `area`, which must exist. The slug is unique across all
    modules; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (RoadmapModuleCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RoadmapModule
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            sebela_provenance=sebela_provenance,
        )
    ).parsed
