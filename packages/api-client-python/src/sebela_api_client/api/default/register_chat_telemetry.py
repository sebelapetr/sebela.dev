from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.chat_telemetry_registered import ChatTelemetryRegistered
from ...models.chat_telemetry_registration import ChatTelemetryRegistration
from ...models.error_response import ErrorResponse
from ...types import Response


def _get_kwargs(
    operation_id: UUID,
    *,
    body: ChatTelemetryRegistration,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/internal/chat/operations/{operation_id}/telemetry".format(
            operation_id=quote(str(operation_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ChatTelemetryRegistered | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ChatTelemetryRegistered.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())

        return response_403

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
) -> Response[ChatTelemetryRegistered | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    operation_id: UUID,
    *,
    client: AuthenticatedClient,
    body: ChatTelemetryRegistration,
) -> Response[ChatTelemetryRegistered | ErrorResponse]:
    """Register a chat trace before its export

     Internal: the AI service registers each trace of a claimed operation before it exports it, and
    exports it only on `allowed`, within 10 minutes of the registration. The API deletes the remote copy
    at `expiresAt`, 30 days later, or when the conversation is deleted. `refused` means the trace must
    not be exported, because its conversation or operation is gone or it is already owed a deletion;
    `expiresAt` is then when its remote copy, should one exist, is deleted. A repeat answers alike.

    Args:
        operation_id (UUID):
        body (ChatTelemetryRegistration):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatTelemetryRegistered | ErrorResponse]
    """

    kwargs = _get_kwargs(
        operation_id=operation_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    operation_id: UUID,
    *,
    client: AuthenticatedClient,
    body: ChatTelemetryRegistration,
) -> ChatTelemetryRegistered | ErrorResponse | None:
    """Register a chat trace before its export

     Internal: the AI service registers each trace of a claimed operation before it exports it, and
    exports it only on `allowed`, within 10 minutes of the registration. The API deletes the remote copy
    at `expiresAt`, 30 days later, or when the conversation is deleted. `refused` means the trace must
    not be exported, because its conversation or operation is gone or it is already owed a deletion;
    `expiresAt` is then when its remote copy, should one exist, is deleted. A repeat answers alike.

    Args:
        operation_id (UUID):
        body (ChatTelemetryRegistration):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatTelemetryRegistered | ErrorResponse
    """

    return sync_detailed(
        operation_id=operation_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    operation_id: UUID,
    *,
    client: AuthenticatedClient,
    body: ChatTelemetryRegistration,
) -> Response[ChatTelemetryRegistered | ErrorResponse]:
    """Register a chat trace before its export

     Internal: the AI service registers each trace of a claimed operation before it exports it, and
    exports it only on `allowed`, within 10 minutes of the registration. The API deletes the remote copy
    at `expiresAt`, 30 days later, or when the conversation is deleted. `refused` means the trace must
    not be exported, because its conversation or operation is gone or it is already owed a deletion;
    `expiresAt` is then when its remote copy, should one exist, is deleted. A repeat answers alike.

    Args:
        operation_id (UUID):
        body (ChatTelemetryRegistration):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ChatTelemetryRegistered | ErrorResponse]
    """

    kwargs = _get_kwargs(
        operation_id=operation_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    operation_id: UUID,
    *,
    client: AuthenticatedClient,
    body: ChatTelemetryRegistration,
) -> ChatTelemetryRegistered | ErrorResponse | None:
    """Register a chat trace before its export

     Internal: the AI service registers each trace of a claimed operation before it exports it, and
    exports it only on `allowed`, within 10 minutes of the registration. The API deletes the remote copy
    at `expiresAt`, 30 days later, or when the conversation is deleted. `refused` means the trace must
    not be exported, because its conversation or operation is gone or it is already owed a deletion;
    `expiresAt` is then when its remote copy, should one exist, is deleted. A repeat answers alike.

    Args:
        operation_id (UUID):
        body (ChatTelemetryRegistration):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ChatTelemetryRegistered | ErrorResponse
    """

    return (
        await asyncio_detailed(
            operation_id=operation_id,
            client=client,
            body=body,
        )
    ).parsed
