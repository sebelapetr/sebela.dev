from http import HTTPStatus
from typing import Any
from uuid import UUID

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_conversation import ChatConversation
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    before: UUID | Unset = UNSET,
    limit: int | Unset = 20,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    params: dict[str, Any] = {}

    json_before: str | Unset = UNSET
    if not isinstance(before, Unset):
        json_before = str(before)
    params["before"] = json_before

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/chat/conversation",
        "params": params,
        "cookies": cookies,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ChatConversation | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ChatConversation.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())

        return response_403

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
) -> Response[ChatConversation | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    before: UUID | Unset = UNSET,
    limit: int | Unset = 20,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatConversation | ErrorResponse]:
    """Read the visitor's chat conversation

     The caller's one conversation, newest messages first in pages, with its active operation. The caller
    is the chat cookie; a request without one gets a new identity. Never cached.

    Args:
        before (UUID | Unset): Read the messages before this message of the caller's conversation.
        limit (int | Unset):  Default: 20.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatConversation | ErrorResponse]
    """

    kwargs = _get_kwargs(
        before=before,
        limit=limit,
        sebela_chat=sebela_chat,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    before: UUID | Unset = UNSET,
    limit: int | Unset = 20,
    sebela_chat: str | Unset = UNSET,
) -> ChatConversation | ErrorResponse | None:
    """Read the visitor's chat conversation

     The caller's one conversation, newest messages first in pages, with its active operation. The caller
    is the chat cookie; a request without one gets a new identity. Never cached.

    Args:
        before (UUID | Unset): Read the messages before this message of the caller's conversation.
        limit (int | Unset):  Default: 20.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatConversation | ErrorResponse
    """

    return sync_detailed(
        client=client,
        before=before,
        limit=limit,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    before: UUID | Unset = UNSET,
    limit: int | Unset = 20,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatConversation | ErrorResponse]:
    """Read the visitor's chat conversation

     The caller's one conversation, newest messages first in pages, with its active operation. The caller
    is the chat cookie; a request without one gets a new identity. Never cached.

    Args:
        before (UUID | Unset): Read the messages before this message of the caller's conversation.
        limit (int | Unset):  Default: 20.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatConversation | ErrorResponse]
    """

    kwargs = _get_kwargs(
        before=before,
        limit=limit,
        sebela_chat=sebela_chat,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    before: UUID | Unset = UNSET,
    limit: int | Unset = 20,
    sebela_chat: str | Unset = UNSET,
) -> ChatConversation | ErrorResponse | None:
    """Read the visitor's chat conversation

     The caller's one conversation, newest messages first in pages, with its active operation. The caller
    is the chat cookie; a request without one gets a new identity. Never cached.

    Args:
        before (UUID | Unset): Read the messages before this message of the caller's conversation.
        limit (int | Unset):  Default: 20.
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatConversation | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            before=before,
            limit=limit,
            sebela_chat=sebela_chat,
        )
    ).parsed
