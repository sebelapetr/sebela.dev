from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_compaction_noop import ChatCompactionNoop
from ...models.chat_compaction_started import ChatCompactionStarted
from ...models.chat_compaction_submission import ChatCompactionSubmission
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: ChatCompactionSubmission,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/chat/conversation/compact",
        "cookies": cookies,
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ChatCompactionNoop | ChatCompactionStarted | ErrorResponse | None:
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> ChatCompactionNoop | ChatCompactionStarted:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_chat_compaction_response_type_0 = (
                    ChatCompactionStarted.from_dict(data)
                )

                return componentsschemas_chat_compaction_response_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_chat_compaction_response_type_1 = (
                ChatCompactionNoop.from_dict(data)
            )

            return componentsschemas_chat_compaction_response_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 202:

        def _parse_response_202(
            data: object,
        ) -> ChatCompactionNoop | ChatCompactionStarted:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_chat_compaction_response_type_0 = (
                    ChatCompactionStarted.from_dict(data)
                )

                return componentsschemas_chat_compaction_response_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_chat_compaction_response_type_1 = (
                ChatCompactionNoop.from_dict(data)
            )

            return componentsschemas_chat_compaction_response_type_1

        response_202 = _parse_response_202(response.json())

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
) -> Response[ChatCompactionNoop | ChatCompactionStarted | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ChatCompactionSubmission,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatCompactionNoop | ChatCompactionStarted | ErrorResponse]:
    """Compact the visitor's working context

     The visitor's `/compact`: summarizes the caller's current working context (the previous summary and
    the exchanges since it) so later questions carry less history. It is no message, appends nothing and
    changes no visible history. A context of fewer than three exchanges is a local no-op before any
    challenge, quota or spend. Otherwise the bot challenge, the quotas and the spend budget apply as to
    a question, and it holds the conversation as a question does; its progress is read from the
    operation, from any tab. The same request ID again is recovered before any challenge. Never retried
    automatically.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatCompactionSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatCompactionNoop | ChatCompactionStarted | ErrorResponse]
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
    body: ChatCompactionSubmission,
    sebela_chat: str | Unset = UNSET,
) -> ChatCompactionNoop | ChatCompactionStarted | ErrorResponse | None:
    """Compact the visitor's working context

     The visitor's `/compact`: summarizes the caller's current working context (the previous summary and
    the exchanges since it) so later questions carry less history. It is no message, appends nothing and
    changes no visible history. A context of fewer than three exchanges is a local no-op before any
    challenge, quota or spend. Otherwise the bot challenge, the quotas and the spend budget apply as to
    a question, and it holds the conversation as a question does; its progress is read from the
    operation, from any tab. The same request ID again is recovered before any challenge. Never retried
    automatically.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatCompactionSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatCompactionNoop | ChatCompactionStarted | ErrorResponse
    """

    return sync_detailed(
        client=client,
        body=body,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ChatCompactionSubmission,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatCompactionNoop | ChatCompactionStarted | ErrorResponse]:
    """Compact the visitor's working context

     The visitor's `/compact`: summarizes the caller's current working context (the previous summary and
    the exchanges since it) so later questions carry less history. It is no message, appends nothing and
    changes no visible history. A context of fewer than three exchanges is a local no-op before any
    challenge, quota or spend. Otherwise the bot challenge, the quotas and the spend budget apply as to
    a question, and it holds the conversation as a question does; its progress is read from the
    operation, from any tab. The same request ID again is recovered before any challenge. Never retried
    automatically.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatCompactionSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatCompactionNoop | ChatCompactionStarted | ErrorResponse]
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
    body: ChatCompactionSubmission,
    sebela_chat: str | Unset = UNSET,
) -> ChatCompactionNoop | ChatCompactionStarted | ErrorResponse | None:
    """Compact the visitor's working context

     The visitor's `/compact`: summarizes the caller's current working context (the previous summary and
    the exchanges since it) so later questions carry less history. It is no message, appends nothing and
    changes no visible history. A context of fewer than three exchanges is a local no-op before any
    challenge, quota or spend. Otherwise the bot challenge, the quotas and the spend budget apply as to
    a question, and it holds the conversation as a question does; its progress is read from the
    operation, from any tab. The same request ID again is recovered before any challenge. Never retried
    automatically.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.
        body (ChatCompactionSubmission):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatCompactionNoop | ChatCompactionStarted | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            sebela_chat=sebela_chat,
        )
    ).parsed
