from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote
from uuid import UUID

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    operation_id: UUID,
    *,
    last_event_id: str | Unset = UNSET,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(last_event_id, Unset):
        headers["last-event-id"] = last_event_id

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/chat/operations/{operation_id}/events".format(
            operation_id=quote(str(operation_id), safe=""),
        ),
        "cookies": cookies,
    }

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> Any | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
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

    if response.status_code == 503:
        response_503 = ErrorResponse.from_dict(response.json())

        return response_503

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
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    last_event_id: str | Unset = UNSET,
    sebela_chat: str | Unset = UNSET,
) -> Response[Any | ErrorResponse]:
    """Stream a chat operation's events

     Server-sent events of one of the caller's operations. Each `chat` event carries a `ChatStreamEvent`
    with its event ID; a reconnect with `Last-Event-ID` continues after it with the same IDs. While the
    operation runs, a `progress` event without an ID carries a `ChatProgress` at least every five
    seconds. The stream ends at the terminal event, or after the deadline and a short grace with a
    retryable `timeout` error.

    Args:
        operation_id (UUID):
        last_event_id (str | Unset): The last chat event ID the client received; later events
            follow.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
    """

    kwargs = _get_kwargs(
        operation_id=operation_id,
        last_event_id=last_event_id,
        sebela_chat=sebela_chat,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    last_event_id: str | Unset = UNSET,
    sebela_chat: str | Unset = UNSET,
) -> Any | ErrorResponse | None:
    """Stream a chat operation's events

     Server-sent events of one of the caller's operations. Each `chat` event carries a `ChatStreamEvent`
    with its event ID; a reconnect with `Last-Event-ID` continues after it with the same IDs. While the
    operation runs, a `progress` event without an ID carries a `ChatProgress` at least every five
    seconds. The stream ends at the terminal event, or after the deadline and a short grace with a
    retryable `timeout` error.

    Args:
        operation_id (UUID):
        last_event_id (str | Unset): The last chat event ID the client received; later events
            follow.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
    """

    return sync_detailed(
        operation_id=operation_id,
        client=client,
        last_event_id=last_event_id,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    last_event_id: str | Unset = UNSET,
    sebela_chat: str | Unset = UNSET,
) -> Response[Any | ErrorResponse]:
    """Stream a chat operation's events

     Server-sent events of one of the caller's operations. Each `chat` event carries a `ChatStreamEvent`
    with its event ID; a reconnect with `Last-Event-ID` continues after it with the same IDs. While the
    operation runs, a `progress` event without an ID carries a `ChatProgress` at least every five
    seconds. The stream ends at the terminal event, or after the deadline and a short grace with a
    retryable `timeout` error.

    Args:
        operation_id (UUID):
        last_event_id (str | Unset): The last chat event ID the client received; later events
            follow.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
    """

    kwargs = _get_kwargs(
        operation_id=operation_id,
        last_event_id=last_event_id,
        sebela_chat=sebela_chat,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    last_event_id: str | Unset = UNSET,
    sebela_chat: str | Unset = UNSET,
) -> Any | ErrorResponse | None:
    """Stream a chat operation's events

     Server-sent events of one of the caller's operations. Each `chat` event carries a `ChatStreamEvent`
    with its event ID; a reconnect with `Last-Event-ID` continues after it with the same IDs. While the
    operation runs, a `progress` event without an ID carries a `ChatProgress` at least every five
    seconds. The stream ends at the terminal event, or after the deadline and a short grace with a
    retryable `timeout` error.

    Args:
        operation_id (UUID):
        last_event_id (str | Unset): The last chat event ID the client received; later events
            follow.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
    """

    return (
        await asyncio_detailed(
            operation_id=operation_id,
            client=client,
            last_event_id=last_event_id,
            sebela_chat=sebela_chat,
        )
    ).parsed
