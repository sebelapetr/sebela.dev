from http import HTTPStatus
from typing import Any

import httpx2

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error_response import ErrorResponse
from ...models.search_request import SearchRequest
from ...models.search_result_type_0 import SearchResultType0
from ...models.search_result_type_1 import SearchResultType1
from ...types import Response


def _get_kwargs(
    *,
    body: SearchRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/retrieval/search",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> ErrorResponse | SearchResultType0 | SearchResultType1 | None:
    if response.status_code == 200:

        def _parse_response_200(data: object) -> SearchResultType0 | SearchResultType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_search_result_type_0 = SearchResultType0.from_dict(
                    data
                )

                return componentsschemas_search_result_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_search_result_type_1 = SearchResultType1.from_dict(data)

            return componentsschemas_search_result_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

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

    if response.status_code == 503:
        response_503 = ErrorResponse.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx2.Response
) -> Response[ErrorResponse | SearchResultType0 | SearchResultType1]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: SearchRequest,
) -> Response[ErrorResponse | SearchResultType0 | SearchResultType1]:
    """Search the indexed knowledge

     Embeds a query of at most 500 characters and returns up to 8 passages of the indexed public
    portfolio, best first, each with its source, version, canonical site path and provenance, optionally
    only of the given content kinds. When no passage reaches the configured relevance floor the result
    is `no_evidence`. A provider that is not configured, fails or times out, or a month's spend at its
    ceiling, is a 503 and never no evidence. It reads only and changes no content.

    Args:
        body (SearchRequest): A search of the indexed knowledge.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SearchResultType0 | SearchResultType1]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: SearchRequest,
) -> ErrorResponse | SearchResultType0 | SearchResultType1 | None:
    """Search the indexed knowledge

     Embeds a query of at most 500 characters and returns up to 8 passages of the indexed public
    portfolio, best first, each with its source, version, canonical site path and provenance, optionally
    only of the given content kinds. When no passage reaches the configured relevance floor the result
    is `no_evidence`. A provider that is not configured, fails or times out, or a month's spend at its
    ceiling, is a 503 and never no evidence. It reads only and changes no content.

    Args:
        body (SearchRequest): A search of the indexed knowledge.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SearchResultType0 | SearchResultType1
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: SearchRequest,
) -> Response[ErrorResponse | SearchResultType0 | SearchResultType1]:
    """Search the indexed knowledge

     Embeds a query of at most 500 characters and returns up to 8 passages of the indexed public
    portfolio, best first, each with its source, version, canonical site path and provenance, optionally
    only of the given content kinds. When no passage reaches the configured relevance floor the result
    is `no_evidence`. A provider that is not configured, fails or times out, or a month's spend at its
    ceiling, is a 503 and never no evidence. It reads only and changes no content.

    Args:
        body (SearchRequest): A search of the indexed knowledge.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SearchResultType0 | SearchResultType1]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: SearchRequest,
) -> ErrorResponse | SearchResultType0 | SearchResultType1 | None:
    """Search the indexed knowledge

     Embeds a query of at most 500 characters and returns up to 8 passages of the indexed public
    portfolio, best first, each with its source, version, canonical site path and provenance, optionally
    only of the given content kinds. When no passage reaches the configured relevance floor the result
    is `no_evidence`. A provider that is not configured, fails or times out, or a month's spend at its
    ceiling, is a 503 and never no evidence. It reads only and changes no content.

    Args:
        body (SearchRequest): A search of the indexed knowledge.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx2.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SearchResultType0 | SearchResultType1
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
