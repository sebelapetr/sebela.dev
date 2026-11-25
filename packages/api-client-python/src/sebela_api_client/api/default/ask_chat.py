from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_message_submission import ChatMessageSubmission
from ...models.chat_operation import ChatOperation
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: ChatMessageSubmission,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/chat/conversation/messages",
        "cookies": cookies,
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ChatOperation | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ChatOperation.from_dict(response.json())

        return response_200

    if response.status_code == 202:
        response_202 = ChatOperation.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())

        return response_409

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
) -> Response[ChatOperation | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ChatMessageSubmission,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatOperation | ErrorResponse]:
    """Ask the chat a question

     The one public write: the caller asks one question of their own conversation behind the bot
    challenge, the per-visitor quotas and the global spend budget. The request is sent by the website's
    server from an allowed origin; the visitor's address for the quotas and the challenge is the one the
    website's relay names, if any. Admission returns at once; the answer is generated detached from the
    request and read from the operation's events.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatMessageSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatOperation | ErrorResponse]
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
    body: ChatMessageSubmission,
    sebela_chat: str | Unset = UNSET,
) -> ChatOperation | ErrorResponse | None:
    """Ask the chat a question

     The one public write: the caller asks one question of their own conversation behind the bot
    challenge, the per-visitor quotas and the global spend budget. The request is sent by the website's
    server from an allowed origin; the visitor's address for the quotas and the challenge is the one the
    website's relay names, if any. Admission returns at once; the answer is generated detached from the
    request and read from the operation's events.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatMessageSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatOperation | ErrorResponse
    """

    return sync_detailed(
        client=client,
        body=body,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ChatMessageSubmission,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatOperation | ErrorResponse]:
    """Ask the chat a question

     The one public write: the caller asks one question of their own conversation behind the bot
    challenge, the per-visitor quotas and the global spend budget. The request is sent by the website's
    server from an allowed origin; the visitor's address for the quotas and the challenge is the one the
    website's relay names, if any. Admission returns at once; the answer is generated detached from the
    request and read from the operation's events.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatMessageSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatOperation | ErrorResponse]
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
    body: ChatMessageSubmission,
    sebela_chat: str | Unset = UNSET,
) -> ChatOperation | ErrorResponse | None:
    """Ask the chat a question

     The one public write: the caller asks one question of their own conversation behind the bot
    challenge, the per-visitor quotas and the global spend budget. The request is sent by the website's
    server from an allowed origin; the visitor's address for the quotas and the challenge is the one the
    website's relay names, if any. Admission returns at once; the answer is generated detached from the
    request and read from the operation's events.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatMessageSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatOperation | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            sebela_chat=sebela_chat,
        )
    ).parsed
