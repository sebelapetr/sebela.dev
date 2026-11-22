from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.current_focus import CurrentFocus
from ...models.current_focus_create import CurrentFocusCreate
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: CurrentFocusCreate,
    sebela_provenance: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(sebela_provenance, Unset):
        headers["sebela-provenance"] = sebela_provenance

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/current-focus",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> CurrentFocus | ErrorResponse | None:
    if response.status_code == 201:
        response_201 = CurrentFocus.from_dict(response.json())

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
) -> Response[CurrentFocus | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: CurrentFocusCreate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[CurrentFocus | ErrorResponse]:
    """Create a current-focus entry

     Creates the entry with its optional `project` and its `topics`, named by the slugs of existing
    records; an unknown or repeated target is refused with that field and nothing is stored. An omitted
    link or project means none. The slug is unique and stable; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (CurrentFocusCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CurrentFocus | ErrorResponse]
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
    body: CurrentFocusCreate,
    sebela_provenance: str | Unset = UNSET,
) -> CurrentFocus | ErrorResponse | None:
    """Create a current-focus entry

     Creates the entry with its optional `project` and its `topics`, named by the slugs of existing
    records; an unknown or repeated target is refused with that field and nothing is stored. An omitted
    link or project means none. The slug is unique and stable; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (CurrentFocusCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CurrentFocus | ErrorResponse
    """

    return sync_detailed(
        client=client,
        body=body,
        sebela_provenance=sebela_provenance,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CurrentFocusCreate,
    sebela_provenance: str | Unset = UNSET,
) -> Response[CurrentFocus | ErrorResponse]:
    """Create a current-focus entry

     Creates the entry with its optional `project` and its `topics`, named by the slugs of existing
    records; an unknown or repeated target is refused with that field and nothing is stored. An omitted
    link or project means none. The slug is unique and stable; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (CurrentFocusCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CurrentFocus | ErrorResponse]
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
    body: CurrentFocusCreate,
    sebela_provenance: str | Unset = UNSET,
) -> CurrentFocus | ErrorResponse | None:
    """Create a current-focus entry

     Creates the entry with its optional `project` and its `topics`, named by the slugs of existing
    records; an unknown or repeated target is refused with that field and nothing is stored. An omitted
    link or project means none. The slug is unique and stable; a taken slug is a conflict.

    Args:
        sebela_provenance (str | Unset): A short label of the tool or client making the write,
            such as `mcp-admin/update_content`, stored with its audit. Stated by the caller: never
            proof of who acted or that a human approved. A label outside the pattern is refused with
            `validation_failed` on `provenance`.
        body (CurrentFocusCreate):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CurrentFocus | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            sebela_provenance=sebela_provenance,
        )
    ).parsed
