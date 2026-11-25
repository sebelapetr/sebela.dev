from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_usage import ChatUsage
from ...models.error_response import ErrorResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    sebela_chat: str | Unset = UNSET,
) -> dict[str, Any]:

    cookies = {}
    if sebela_chat is not UNSET:
        cookies["sebela_chat"] = sebela_chat

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/chat/usage",
        "cookies": cookies,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ChatUsage | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ChatUsage.from_dict(response.json())

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
) -> Response[ChatUsage | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatUsage | ErrorResponse]:
    """Read the visitor's chat usage and limits

     The caller's own meters (questions in the rolling two hours and the UTC day), the restriction a new
    question would meet now and when it may pass again, the effective main model and effort, the active
    operation and the conversation's last measured main-call input against its cap. Reading consumes
    nothing and admits nothing; the meters are informative, admission decides alone. Never another
    visitor's counts or the site's spend. Never cached.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatUsage | ErrorResponse]
    """

    kwargs = _get_kwargs(
        sebela_chat=sebela_chat,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    sebela_chat: str | Unset = UNSET,
) -> ChatUsage | ErrorResponse | None:
    """Read the visitor's chat usage and limits

     The caller's own meters (questions in the rolling two hours and the UTC day), the restriction a new
    question would meet now and when it may pass again, the effective main model and effort, the active
    operation and the conversation's last measured main-call input against its cap. Reading consumes
    nothing and admits nothing; the meters are informative, admission decides alone. Never another
    visitor's counts or the site's spend. Never cached.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatUsage | ErrorResponse
    """

    return sync_detailed(
        client=client,
        sebela_chat=sebela_chat,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    sebela_chat: str | Unset = UNSET,
) -> Response[ChatUsage | ErrorResponse]:
    """Read the visitor's chat usage and limits

     The caller's own meters (questions in the rolling two hours and the UTC day), the restriction a new
    question would meet now and when it may pass again, the effective main model and effort, the active
    operation and the conversation's last measured main-call input against its cap. Reading consumes
    nothing and admits nothing; the meters are informative, admission decides alone. Never another
    visitor's counts or the site's spend. Never cached.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatUsage | ErrorResponse]
    """

    kwargs = _get_kwargs(
        sebela_chat=sebela_chat,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    sebela_chat: str | Unset = UNSET,
) -> ChatUsage | ErrorResponse | None:
    """Read the visitor's chat usage and limits

     The caller's own meters (questions in the rolling two hours and the UTC day), the restriction a new
    question would meet now and when it may pass again, the effective main model and effort, the active
    operation and the conversation's last measured main-call input against its cap. Reading consumes
    nothing and admits nothing; the meters are informative, admission decides alone. Never another
    visitor's counts or the site's spend. Never cached.

    Args:
        sebela_chat (str | Unset): The visitor's opaque chat identity. A missing, unknown or
            forged value gets a fresh identity.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatUsage | ErrorResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            sebela_chat=sebela_chat,
        )
    ).parsed
