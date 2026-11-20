"""The portfolio chat agent: a guarded, bounded, bilingual answer over public content reads.

This is the package's public interface; every other module is private to the package.
`ChatAgent.run` is the one operation. Content arrives only through a `ContentReader` (the public
API in production) and models only through a `ModelFactory` (Anthropic in production, scripted
fakes in tests).
"""

from llm_agent.models.gateway import ChatModel, ModelCall, ModelFactory, anthropic_model_factory
from llm_agent.pipelines.chat import ChatAgent
from llm_agent.pipelines.chat.versions import versions
from llm_agent.schemas import (
    ChatRequest,
    ChatResult,
    ContactCard,
    ContactLink,
    Evidence,
    ExecutionLimits,
    Source,
    Span,
    Usage,
    Versions,
)
from llm_agent.tools.content import (
    ApiContentReader,
    ContentReader,
    ContentUnavailableError,
    PublicLink,
    PublicPerson,
    PublicStep,
)

__all__ = [
    "ApiContentReader",
    "ChatAgent",
    "ChatModel",
    "ChatRequest",
    "ChatResult",
    "ContactCard",
    "ContactLink",
    "ContentReader",
    "ContentUnavailableError",
    "Evidence",
    "ExecutionLimits",
    "ModelCall",
    "ModelFactory",
    "PublicLink",
    "PublicPerson",
    "PublicStep",
    "Source",
    "Span",
    "Usage",
    "Versions",
    "anthropic_model_factory",
    "versions",
]
