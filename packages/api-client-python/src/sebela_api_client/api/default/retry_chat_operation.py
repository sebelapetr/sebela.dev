from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_operation import ChatOperation
from ...models.chat_retry_submission import ChatRetrySubmission
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    operation_id: UUID,
    *,
    body: ChatRetrySubmission,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/chat/operations/{operation_id}/retry".format(
            operation_id=quote(str(operation_id), safe=""),
        ),
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

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())

        return response_404

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
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: ChatRetrySubmission,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatOperation | ErrorResponse]:
    """Retry a failed chat answer

     Asks the question of one of the caller's failed attempts again as a new attempt of the same request,
    keyed by its own retry ID, and replaces only the failed answer. The same retry ID again, or an
    attempt of that request that is active or answered, is recovered before any challenge, quota or
    spend. Otherwise the bot challenge, the quotas and the spend budget apply as to a question.

    Args:
        operation_id (UUID):
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatRetrySubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatOperation | ErrorResponse]
    """

    kwargs = _get_kwargs(
        operation_id=operation_id,
        body=body,
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
    body: ChatRetrySubmission,
    sebela_chat: str | Unset = UNSET,
) -> ChatOperation | ErrorResponse | None:
    """Retry a failed chat answer

     Asks the question of one of the caller's failed attempts again as a new attempt of the same request,
    keyed by its own retry ID, and replaces only the failed answer. The same retry ID again, or an
    attempt of that request that is active or answered, is recovered before any challenge, quota or
    spend. Otherwise the bot challenge, the quotas and the spend budget apply as to a question.

    Args:
        operation_id (UUID):
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatRetrySubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatOperation | ErrorResponse
    """

    return sync_detailed(
        operation_id=operation_id,
        client=client,
        body=body,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: ChatRetrySubmission,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatOperation | ErrorResponse]:
    """Retry a failed chat answer

     Asks the question of one of the caller's failed attempts again as a new attempt of the same request,
    keyed by its own retry ID, and replaces only the failed answer. The same retry ID again, or an
    attempt of that request that is active or answered, is recovered before any challenge, quota or
    spend. Otherwise the bot challenge, the quotas and the spend budget apply as to a question.

    Args:
        operation_id (UUID):
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatRetrySubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatOperation | ErrorResponse]
    """

    kwargs = _get_kwargs(
        operation_id=operation_id,
        body=body,
        sebela_chat=sebela_chat,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    operation_id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: ChatRetrySubmission,
    sebela_chat: str | Unset = UNSET,
) -> ChatOperation | ErrorResponse | None:
    """Retry a failed chat answer

     Asks the question of one of the caller's failed attempts again as a new attempt of the same request,
    keyed by its own retry ID, and replaces only the failed answer. The same retry ID again, or an
    attempt of that request that is active or answered, is recovered before any challenge, quota or
    spend. Otherwise the bot challenge, the quotas and the spend budget apply as to a question.

    Args:
        operation_id (UUID):
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatRetrySubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatOperation | ErrorResponse
    """

    return (
        await asyncio_detailed(
            operation_id=operation_id,
            client=client,
            body=body,
            sebela_chat=sebela_chat,
        )
    ).parsed
