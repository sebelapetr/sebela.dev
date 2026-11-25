from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_conversation_clear import ChatConversationClear
from ...models.chat_conversation_cleared import ChatConversationCleared
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: ChatConversationClear,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/v1/chat/conversation",
        "cookies": cookies,
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ChatConversationCleared | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ChatConversationCleared.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())

        return response_403

    if response.status_code == 413:
        response_413 = ErrorResponse.from_dict(response.json())

        return response_413

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
) -> Response[ChatConversationCleared | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ChatConversationClear,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatConversationCleared | ErrorResponse]:
    """Clear the visitor's chat conversation

     Deletes the caller's conversation when the body names it, as the visitor confirmed: active work is
    cancelled, messages are deleted, late results are refused and a fresh empty conversation of the same
    identity starts. Quotas and spend stay. Any other conversation ID clears nothing and returns the
    caller's conversation unchanged; a URL is never a delete credential. `telemetryDeletion` is
    `pending` while exported telemetry still awaits deletion.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatConversationClear):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatConversationCleared | ErrorResponse]
    """

    kwargs = _get_kwargs(
        body=body,
        sebela_chat=sebela_chat,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: ChatConversationClear,
    sebela_chat: str | Unset = UNSET,
) -> ChatConversationCleared | ErrorResponse | None:
    """Clear the visitor's chat conversation

     Deletes the caller's conversation when the body names it, as the visitor confirmed: active work is
    cancelled, messages are deleted, late results are refused and a fresh empty conversation of the same
    identity starts. Quotas and spend stay. Any other conversation ID clears nothing and returns the
    caller's conversation unchanged; a URL is never a delete credential. `telemetryDeletion` is
    `pending` while exported telemetry still awaits deletion.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatConversationClear):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatConversationCleared | ErrorResponse
    """

    return sync_detailed(
        client=client,
        body=body,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ChatConversationClear,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatConversationCleared | ErrorResponse]:
    """Clear the visitor's chat conversation

     Deletes the caller's conversation when the body names it, as the visitor confirmed: active work is
    cancelled, messages are deleted, late results are refused and a fresh empty conversation of the same
    identity starts. Quotas and spend stay. Any other conversation ID clears nothing and returns the
    caller's conversation unchanged; a URL is never a delete credential. `telemetryDeletion` is
    `pending` while exported telemetry still awaits deletion.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatConversationClear):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatConversationCleared | ErrorResponse]
    """

    kwargs = _get_kwargs(
        body=body,
        sebela_chat=sebela_chat,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: ChatConversationClear,
    sebela_chat: str | Unset = UNSET,
) -> ChatConversationCleared | ErrorResponse | None:
    """Clear the visitor's chat conversation

     Deletes the caller's conversation when the body names it, as the visitor confirmed: active work is
    cancelled, messages are deleted, late results are refused and a fresh empty conversation of the same
    identity starts. Quotas and spend stay. Any other conversation ID clears nothing and returns the
    caller's conversation unchanged; a URL is never a delete credential. `telemetryDeletion` is
    `pending` while exported telemetry still awaits deletion.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatConversationClear):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatConversationCleared | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            sebela_chat=sebela_chat,
        )
    ).parsed
