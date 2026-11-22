"""C01: the visitor chat end to end through the real API and AI service, without a provider.

The built API runs as its e2e server on a temporary database filled from the fictional profile
fixture; this service runs as its own process with the fictional model; a fake Siteverify stands in
for Cloudflare. The test talks to the API only, as the website's server does, and counts the model
calls through the fictional model's test-only calls file. Hosts come from the checkout's
environment files; every port is free and chosen at run time. It needs the running Postgres.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import httpx2
import pytest
from llm_agent import READ_CAPABILITIES, ApiContentReader, read_tool, versions
from llm_agent.observability.tracing import Tracer
from llm_agent.reliability.timeouts import Deadline
from llm_agent.tools.registry import TOOLS, Tools

ROOT = Path(__file__).resolve().parents[4]
API_FOLDER = ROOT / "apps" / "api"
SERVICE_FOLDER = ROOT / "apps" / "ai-service"
SEED_FOLDER = ROOT / "packages" / "llm-agent" / "evals" / "datasets" / "fixtures" / "profile"

ORIGIN = "https://chat.example.test"
EXPECTED_HOSTNAME = "chat.example.test"
COOKIE = "sebela_chat"
# The website's relay token: the API answers visitor chat routes only to its holder.
RELAY_TOKEN = secrets.token_urlsafe(32)
#: The fields a `chat` event may carry (`ChatStreamEvent`); anything else is unapproved output.
EVENT_FIELDS = {
    "start": set(),
    "text_delta": {"text"},
    "block": {"block"},
    "sources": {"sources"},
    "related": {"links"},
    "complete": {"outcome"},
    "error": {"code", "retryable"},
}
EVENT_BASE = {"type", "requestId", "messageId", "eventId"}
#: Words that would mean the agent's internals left the service.
HIDDEN = ("draft", "reasoning", "evidence", "trace", "usage", "source_refs", "grant")
#: Below one question's allowance (`chatPolicy.allowanceMicroUsd`), so every admission is refused.
SPENT_DAILY_LIMIT = "10000"


def _environment_files() -> list[dict[str, str]]:
    """The checkout's `.env.local`, `.env` and `.env.example`, in the order they take precedence."""
    files = []
    for name in (".env.local", ".env", ".env.example"):
        path = ROOT / name
        values: dict[str, str] = {}
        if path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                match = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$", line)
                if match and not line.lstrip().startswith("#"):
                    values[match[1]] = match[2].strip("'\"")
        files.append(values)
    return files


def setting(name: str) -> str:
    """A setting from the process environment, then the checkout's files; never a default."""
    for source in (os.environ, *_environment_files()):
        value = source.get(name, "").strip()
        if value:
            return value
    raise RuntimeError(f"{name} is not set; it is documented in .env.example")


def free_port(host: str) -> int:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as probe:
        probe.bind((host, 0))
        return int(probe.getsockname()[1])


def address(host: str, port: int) -> str:
    shown = f"[{host}]" if ":" in host else host
    return f"http://{shown}:{port}"


class Process:
    """A child process whose output is drained into a log, ready once a line matches."""

    def __init__(self, args: list[str], cwd: Path, env: Mapping[str, str]) -> None:
        self.lines: list[str] = []
        self._ready = threading.Event()
        self._pattern: re.Pattern[str] | None = None
        self.match: re.Match[str] | None = None
        self.process = subprocess.Popen(
            args,
            cwd=cwd,
            env=dict(env),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.lines.append(line.rstrip())
            if self._pattern is not None and self.match is None:
                self.match = self._pattern.search(line)
                if self.match is not None:
                    self._ready.set()
        self._ready.set()

    def wait_for(self, pattern: str, timeout_s: float = 120.0) -> re.Match[str]:
        self._pattern = re.compile(pattern)
        for line in list(self.lines):
            self.match = self.match or self._pattern.search(line)
        if self.match is None:
            self._ready.wait(timeout_s)
        if self.match is None:
            self.stop()
            raise RuntimeError("the process did not start:\n" + "\n".join(self.lines[-40:]))
        return self.match

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)


class _Siteverify(BaseHTTPRequestHandler):
    """Cloudflare's Siteverify for the configured hostname: a token starting `fail` is refused."""

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        form = parse_qs(self.rfile.read(length).decode())
        token = form.get("response", [""])[0]
        answer: dict[str, object] = (
            {"success": False, "error-codes": ["invalid-input-response"]}
            if token.startswith("fail")
            else {
                "success": True,
                "hostname": EXPECTED_HOSTNAME,
                "action": "chat",
                "challenge_ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            }
        )
        body = json.dumps(answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        return


@dataclass
class Stack:
    api_url: str
    #: An API whose daily spend limit is below one question's allowance.
    spent_api_url: str
    calls_file: Path
    gate_file: Path
    #: The AI service itself, as a read caller (the next phase's public MCP) reaches it.
    service_url: str
    #: The service's own credentials; no read caller may ever see them.
    secrets: tuple[str, ...]

    def calls(self) -> list[dict[str, Any]]:
        return read_calls(self.calls_file)


def read_calls(calls_file: Path) -> list[dict[str, Any]]:
    """The fictional model's calls, in order, from its test-only calls file."""
    if not calls_file.exists():
        return []
    return [json.loads(line) for line in calls_file.read_text().splitlines() if line]


def _api_env(port: str, chat: Mapping[str, str], scratch: Path, **extra: str) -> dict[str, str]:
    return {
        **os.environ,
        **chat,
        "API_PORT": port,
        "API_WEB_INVALIDATION_URL": "",
        "API_WEB_INVALIDATION_SECRET": "",
        "API_E2E_KEY_FILE": "",
        "API_E2E_KEYS_FILE": "",
        "API_E2E_STORAGE_ROOT": str(scratch / f"storage-{secrets.token_hex(4)}"),
        **extra,
    }


def _start_api(env: Mapping[str, str]) -> tuple[Process, str]:
    api = Process(
        [
            "node",
            "--env-file-if-exists=../../.env.example",
            "--env-file-if-exists=../../.env",
            "--env-file-if-exists=../../.env.local",
            "--import",
            "tsx",
            "src/cli/e2e-server.ts",
            str(SEED_FOLDER),
        ],
        API_FOLDER,
        env,
    )
    return api, api.wait_for(r"e2e API listening on (http://\S+)")[1]


#: Inherited settings the AI service never receives: its own (given explicitly), the provider's
#: and every database setting, since Python has no database access.
_NOT_INHERITED = ("AI_SERVICE_", "LLM_AGENT_", "ANTHROPIC_", "DATABASE_", "POSTGRES_")


def service_environment(
    inherited: Mapping[str, str], settings: Mapping[str, str]
) -> dict[str, str]:
    """The AI service's environment: the inherited one without hidden keys, then `settings`."""
    kept = {k: v for k, v in inherited.items() if not k.startswith(_NOT_INHERITED)}
    return {**kept, **settings}


@dataclass
class _Pair:
    """The settings one API and its AI service share: the service's address and both bearers."""

    scratch: Path
    service_host: str
    service_port: int
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    control_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))

    @property
    def service_url(self) -> str:
        return address(self.service_host, self.service_port)

    @property
    def calls_file(self) -> Path:
        return self.scratch / "calls.jsonl"

    @property
    def gate_file(self) -> Path:
        return self.scratch / "gate"

    def chat(self, siteverify_url: str) -> dict[str, str]:
        """The API's chat settings for this pair."""
        return {
            "API_CHAT_ALLOWED_ORIGINS": ORIGIN,
            "API_CHAT_COOKIE_SECURE": "false",
            "API_AI_SERVICE_URL": self.service_url,
            "API_AI_SERVICE_TOKEN": self.token,
            "API_AI_CONTROL_TOKEN": self.control_token,
            "API_CHAT_RELAY_TOKEN": RELAY_TOKEN,
            "API_CHAT_FINGERPRINT_KEY": secrets.token_urlsafe(32),
            "API_CHAT_RETENTION_DAYS": "",
            # The versions this agent generates with; the service refuses any other.
            "API_CHAT_MODEL": versions().main_model,
            "API_CHAT_EFFORT": versions().main_effort,
            "API_CHAT_PRICING_VERSION": versions().pricing,
            # Not a Turnstile test secret, so the hostname and action checks run as in production.
            "API_TURNSTILE_SECRET_KEY": secrets.token_urlsafe(24),
            "API_TURNSTILE_EXPECTED_HOSTNAME": EXPECTED_HOSTNAME,
            "API_TURNSTILE_VERIFY_URL": siteverify_url,
        }

    def start_service(self, api_url: str, **extra: str) -> Process:
        """This pair's AI service with the fictional `slow` model, healthy."""
        service_env = service_environment(
            os.environ,
            {
                "AI_SERVICE_HOST": self.service_host,
                "LLM_AGENT_PORT": str(self.service_port),
                "AI_SERVICE_API_URL": api_url,
                "AI_SERVICE_TOKEN": self.token,
                "AI_SERVICE_CONTROL_TOKEN": self.control_token,
                "AI_SERVICE_MODEL": "fake",
                "AI_SERVICE_FAKE_SCENARIO": "slow",
                "AI_SERVICE_FAKE_CALLS_FILE": str(self.calls_file),
                "AI_SERVICE_FAKE_GATE_FILE": str(self.gate_file),
                **extra,
            },
        )
        assert not [k for k in service_env if k.startswith(("DATABASE_", "POSTGRES_"))]
        service = Process([sys.executable, "-m", "ai_service"], SERVICE_FOLDER, service_env)
        _wait_healthy(service, self.service_url)
        return service


def _pair(name: str) -> _Pair:
    scratch = ROOT / ".tmp" / f"{name}-{secrets.token_hex(4)}"
    scratch.mkdir(parents=True)
    service_host = setting("AI_SERVICE_HOST")
    return _Pair(scratch, service_host, free_port(service_host))


@pytest.fixture(scope="module")
def siteverify_url() -> Iterator[str]:
    """The fake Siteverify, shared by every API of the module."""
    api_host = setting("API_HOST")
    siteverify = ThreadingHTTPServer((api_host, 0), _Siteverify)
    threading.Thread(target=siteverify.serve_forever, daemon=True).start()
    try:
        yield address(api_host, siteverify.server_address[1]) + "/siteverify"
    finally:
        siteverify.shutdown()
        siteverify.server_close()


@pytest.fixture(scope="module")
def stack(siteverify_url: str) -> Iterator[Stack]:
    pair = _pair("chat-stack")
    chat = pair.chat(siteverify_url)
    started: list[Process] = []
    try:
        api, api_url = _start_api(_api_env("0", chat, pair.scratch))
        started.append(api)
        spent, spent_url = _start_api(
            _api_env(
                "0",
                chat,
                pair.scratch,
                API_E2E_CHAT_DAILY_SPEND_LIMIT_MICRO_USD=SPENT_DAILY_LIMIT,
            )
        )
        started.append(spent)
        started.append(pair.start_service(api_url))
        yield Stack(
            api_url,
            spent_url,
            pair.calls_file,
            pair.gate_file,
            pair.service_url,
            (pair.token, pair.control_token),
        )
    finally:
        for process in reversed(started):
            process.stop()
        shutil.rmtree(pair.scratch, ignore_errors=True)


def _wait_healthy(service: Process, url: str) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if service.process.poll() is not None:
            break
        try:
            if httpx2.get(f"{url}/health", timeout=2).status_code == 200:
                return
        except httpx2.TransportError:
            pass
        time.sleep(0.2)
    service.stop()
    raise RuntimeError("the AI service did not start:\n" + "\n".join(service.lines[-40:]))


@dataclass
class Frame:
    event: str
    id: str | None
    data: dict[str, Any]


@dataclass
class Visitor:
    """One browser of the website: its own chat cookie, sent by the website's server."""

    api_url: str
    cookie: str | None = None
    client: httpx2.Client = field(default_factory=lambda: httpx2.Client(timeout=30))

    def _headers(self, **extra: str) -> dict[str, str]:
        headers = {"x-sebela-chat-relay": RELAY_TOKEN, **extra}
        if self.cookie is not None:
            headers["Cookie"] = f"{COOKIE}={self.cookie}"
        return headers

    def _remember(self, response: httpx2.Response) -> None:
        for value in response.headers.get_list("set-cookie"):
            name, _, rest = value.partition("=")
            if name.strip() == COOKIE:
                self.cookie = rest.split(";", 1)[0]

    def ask(self, question: str, request_id: str | None = None, token: str = "") -> httpx2.Response:
        self.client.cookies.clear()
        response = self.client.post(
            f"{self.api_url}/v1/chat/conversation/messages",
            headers=self._headers(Origin=ORIGIN),
            json={
                "requestId": request_id or str(uuid.uuid4()),
                "question": question,
                "challengeToken": token or f"pass-{secrets.token_hex(8)}",
            },
        )
        self._remember(response)
        return response

    def send(self, method: str, path: str, body: object | None = None) -> httpx2.Response:
        """A same-origin write of the visitor's own (Stop, retry, clear)."""
        self.client.cookies.clear()
        response = self.client.request(
            method, f"{self.api_url}{path}", headers=self._headers(Origin=ORIGIN), json=body
        )
        self._remember(response)
        return response

    def tab(self) -> Visitor:
        """Another tab of the same browser: the same cookie, its own connection."""
        return Visitor(self.api_url, cookie=self.cookie)

    def get(self, path: str) -> httpx2.Response:
        self.client.cookies.clear()
        response = self.client.get(f"{self.api_url}{path}", headers=self._headers())
        self._remember(response)
        return response

    def conversation(self) -> dict[str, Any]:
        response = self.get("/v1/chat/conversation")
        assert response.status_code == 200
        body: dict[str, Any] = response.json()
        return body

    def events(
        self, operation_id: str, last_event_id: str | None = None, *, first_only: bool = False
    ) -> list[Frame]:
        """The operation's frames up to its terminal event, or only the first frame."""
        self.client.cookies.clear()
        headers = self._headers(Accept="text/event-stream")
        if last_event_id is not None:
            headers["Last-Event-ID"] = last_event_id
        frames: list[Frame] = []
        url = f"{self.api_url}/v1/chat/operations/{operation_id}/events"
        with self.client.stream("GET", url, headers=headers) as response:
            assert response.status_code == 200, response.read()
            self._remember(response)
            event, event_id, data = "message", None, ""
            for line in response.iter_lines():
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("id:"):
                    event_id = line[3:].strip()
                elif line.startswith("data:"):
                    data += line[5:].strip()
                elif line == "" and data:
                    frame = Frame(event, event_id, json.loads(data))
                    frames.append(frame)
                    event, event_id, data = "message", None, ""
                    if first_only:
                        break
                    if frame.event == "chat" and frame.data["type"] in ("complete", "error"):
                        break
        return frames


def chat_events(frames: list[Frame]) -> list[dict[str, Any]]:
    return [frame.data for frame in frames if frame.event == "chat"]


def wait_for_calls(
    stack: Stack | BusyStack, count: int, timeout_s: float = 30.0
) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        calls = stack.calls()
        if len(calls) >= count:
            return calls
        time.sleep(0.05)
    return stack.calls()


def settle() -> None:
    """Time for a wrongly dispatched generation to reach the model, so its call would show."""
    time.sleep(1.5)


def assert_only_approved_output(events: list[dict[str, Any]]) -> None:
    for event in events:
        assert set(event) == EVENT_BASE | EVENT_FIELDS[event["type"]], event
    text = json.dumps(events)
    for word in HIDDEN:
        assert f'"{word}' not in text


def answered(stack: Stack, visitor: Visitor, question: str) -> list[dict[str, Any]]:
    response = visitor.ask(question)
    assert response.status_code == 202, response.text
    return chat_events(visitor.events(response.json()["operationId"]))


def test_an_answer_survives_a_disconnect_and_is_generated_once(stack: Stack) -> None:
    stack.gate_file.unlink(missing_ok=True)
    before = len(stack.calls())
    visitor = Visitor(stack.api_url)
    request_id = str(uuid.uuid4())
    question = "How can I contact Ilsa Marrow?"

    admitted = visitor.ask(question, request_id)
    assert admitted.status_code == 202, admitted.text
    operation = admitted.json()
    operation_id = operation["operationId"]

    # The generation is under way in the AI service and waits in its Security call.
    assert len(wait_for_calls(stack, before + 1)) == before + 1
    visitor.events(operation_id, first_only=True)  # the browser goes away mid-generation
    active = visitor.conversation()["activeOperation"]
    assert active is not None
    assert active["operationId"] == operation_id

    # A retry of the same request recovers its operation without a new dispatch.
    again = visitor.ask(question, request_id)
    assert again.status_code == 200, again.text
    assert again.json()["operationId"] == operation_id

    stack.gate_file.touch()
    frames = visitor.events(operation_id)
    events = chat_events(frames)
    types = [event["type"] for event in events]
    assert types[0] == "start"
    assert types[-1] == "complete"
    assert events[-1]["outcome"] == "answered"
    assert "text_delta" in types
    assert "sources" in types
    blocks = [event["block"] for event in events if event["type"] == "block"]
    assert [block["type"] for block in blocks] == ["ContactCard"]
    text = "".join(event["text"] for event in events if event["type"] == "text_delta")
    assert "Ilsa Marrow" in text
    assert_only_approved_output(events)
    assert [frame.id for frame in frames if frame.event == "chat"] == [
        str(event["eventId"]) for event in events
    ]

    # A reconnect replays the same events; with Last-Event-ID it continues after that one.
    assert chat_events(visitor.events(operation_id)) == events
    middle = str(events[1]["eventId"])
    assert chat_events(visitor.events(operation_id, last_event_id=middle)) == events[2:]

    settle()
    assert [call["stage"] for call in stack.calls()[before:]] == ["security", "main", "main"]
    assistants = [
        message
        for message in visitor.conversation()["messages"]
        if message["role"] == "assistant" and message["requestId"] == request_id
    ]
    assert len(assistants) == 1
    assert assistants[0]["status"] == "completed"
    assert visitor.conversation()["activeOperation"] is None

    # The same request after its answer is still its one operation.
    late = visitor.ask(question, request_id)
    assert late.status_code == 200, late.text
    assert late.json()["operationId"] == operation_id
    settle()
    assert len(stack.calls()) == before + 3

    # A follow-up carries the stored exchange as bounded context.
    follow = answered(stack, visitor, "What does she build?")
    assert follow[-1]["type"] == "complete"
    assert follow[-1]["outcome"] == "answered"
    follow_calls = stack.calls()[before + 3 :]
    assert [call["stage"] for call in follow_calls] == ["security", "main", "main"]
    assert {call["history"] for call in follow_calls} == {1}

    # Another visitor sees nothing of it.
    stranger = Visitor(stack.api_url)
    assert stranger.get(f"/v1/chat/operations/{operation_id}").status_code == 404
    assert stranger.get(f"/v1/chat/operations/{operation_id}/events").status_code == 404
    assert stranger.conversation()["messages"] == []


def stages(stack: Stack, before: int) -> list[str]:
    return [call["stage"] for call in stack.calls()[before:]]


def test_two_tabs_share_one_generation_and_no_one_else_sees_it(stack: Stack) -> None:
    """C02: two tabs observe one active operation; neither queues another; a stranger sees none."""
    stack.gate_file.unlink(missing_ok=True)
    before = len(stack.calls())
    first = Visitor(stack.api_url)
    admitted = first.ask("Which projects has Ilsa Marrow built?")
    assert admitted.status_code == 202, admitted.text
    operation_id = admitted.json()["operationId"]
    second = first.tab()
    assert len(wait_for_calls(stack, before + 1)) == before + 1

    seen = [tab.conversation() for tab in (first, second)]
    assert seen[0]["conversationId"] == seen[1]["conversationId"]
    assert [view["activeOperation"]["operationId"] for view in seen] == [operation_id] * 2

    # Neither tab can queue another generation behind the active one.
    for tab in (second, first):
        busy = tab.ask("And which services does she offer?")
        assert busy.status_code == 409, busy.text
        assert busy.json()["error"]["code"] == "chat_busy"

    # A stranger can neither read, stop, retry nor clear any of it.
    stranger = Visitor(stack.api_url)
    for path in (
        f"/v1/chat/operations/{operation_id}",
        f"/v1/chat/operations/{operation_id}/events",
    ):
        assert stranger.get(path).status_code == 404
    assert stranger.send("POST", f"/v1/chat/operations/{operation_id}/stop").status_code == 404
    retry = {"retryId": str(uuid.uuid4()), "challengeToken": f"pass-{secrets.token_hex(8)}"}
    retried = stranger.send("POST", f"/v1/chat/operations/{operation_id}/retry", retry)
    assert retried.status_code == 404
    cleared = stranger.send(
        "DELETE", "/v1/chat/conversation", {"conversationId": seen[0]["conversationId"]}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["cleared"] is False
    assert cleared.json()["conversation"]["messages"] == []
    assert cleared.json()["conversation"]["conversationId"] != seen[0]["conversationId"]

    # Both tabs observe the same canonical events of the one generation.
    stack.gate_file.touch()
    events = [chat_events(tab.events(operation_id)) for tab in (first, second)]
    assert events[0] == events[1]
    assert events[0][-1] == {**events[0][-1], "type": "complete", "outcome": "answered"}
    assert_only_approved_output(events[0])
    settle()
    assert stages(stack, before) == ["security", "main", "main"]
    assert first.conversation()["messages"] == second.conversation()["messages"]
    assert first.conversation()["activeOperation"] is None


def test_a_stop_from_another_tab_ends_the_generation_and_a_retry_answers(stack: Stack) -> None:
    stack.gate_file.unlink(missing_ok=True)
    before = len(stack.calls())
    first = Visitor(stack.api_url)
    admitted = first.ask("What does Ilsa Marrow work on now?")
    assert admitted.status_code == 202, admitted.text
    operation_id = admitted.json()["operationId"]
    assert len(wait_for_calls(stack, before + 1)) == before + 1

    stopped = first.tab().send("POST", f"/v1/chat/operations/{operation_id}/stop")
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["status"] == "cancelled"
    events = chat_events(first.events(operation_id))
    assert events[-1] == {**events[-1], "type": "error", "code": "cancelled", "retryable": True}

    # The AI service stopped too: opening the gate starts no Main call for the stopped question.
    stack.gate_file.touch()
    settle()
    assert stages(stack, before) == ["security"]
    again = first.send("POST", f"/v1/chat/operations/{operation_id}/stop")
    assert again.status_code == 200
    assert again.json()["status"] == "cancelled"

    retry = {"retryId": str(uuid.uuid4()), "challengeToken": f"pass-{secrets.token_hex(8)}"}
    retried = first.send("POST", f"/v1/chat/operations/{operation_id}/retry", retry)
    assert retried.status_code == 202, retried.text
    retry_id = retried.json()["operationId"]
    assert retry_id != operation_id
    answer = chat_events(first.events(retry_id))
    assert answer[-1] == {**answer[-1], "type": "complete", "outcome": "answered"}
    settle()
    assert stages(stack, before) == ["security", "security", "main", "main"]
    finished = first.send("POST", f"/v1/chat/operations/{retry_id}/stop")
    assert finished.status_code == 200
    assert finished.json()["status"] == "completed"
    settle()
    assert len(stack.calls()) == before + 4


def test_clearing_stops_the_active_generation_and_starts_empty(stack: Stack) -> None:
    stack.gate_file.unlink(missing_ok=True)
    before = len(stack.calls())
    first = Visitor(stack.api_url)
    admitted = first.ask("Which services does Ilsa Marrow offer?")
    assert admitted.status_code == 202, admitted.text
    operation_id = admitted.json()["operationId"]
    assert len(wait_for_calls(stack, before + 1)) == before + 1
    conversation_id = first.conversation()["conversationId"]

    cleared = first.tab().send(
        "DELETE", "/v1/chat/conversation", {"conversationId": conversation_id}
    )
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["cleared"] is True
    assert body["conversation"]["messages"] == []
    assert body["conversation"]["activeOperation"] is None
    assert body["conversation"]["conversationId"] != conversation_id

    stack.gate_file.touch()
    settle()
    assert stages(stack, before) == ["security"]
    assert first.get(f"/v1/chat/operations/{operation_id}").status_code == 404
    assert first.conversation()["messages"] == []


def try_again(visitor: Visitor, operation_id: str, retry_id: str | None = None) -> httpx2.Response:
    """The website's "Try again" on an answer: a retry of its request with its own retry ID."""
    body = {
        "retryId": retry_id or str(uuid.uuid4()),
        "challengeToken": f"pass-{secrets.token_hex(8)}",
    }
    return visitor.send("POST", f"/v1/chat/operations/{operation_id}/retry", body)


def answers_of(visitor: Visitor, request_id: str) -> list[dict[str, Any]]:
    return [
        message
        for message in visitor.conversation()["messages"]
        if message["role"] == "assistant" and message["requestId"] == request_id
    ]


def test_try_again_while_the_attempt_is_open_recovers_it_without_a_new_call(
    stack: Stack,
) -> None:
    """C01: a browser that went away and presses Try again joins its open attempt."""
    stack.gate_file.unlink(missing_ok=True)
    before = len(stack.calls())
    visitor = Visitor(stack.api_url)
    request_id = str(uuid.uuid4())
    admitted = visitor.ask("Which services does Ilsa Marrow offer?", request_id)
    assert admitted.status_code == 202, admitted.text
    operation_id = admitted.json()["operationId"]
    assert len(wait_for_calls(stack, before + 1)) == before + 1
    visitor.events(operation_id, first_only=True)  # the browser goes away mid-generation

    # Try again from a reloaded page, with a fresh retry ID each press: the open attempt answers.
    for _ in range(2):
        recovered = try_again(Visitor(stack.api_url, cookie=visitor.cookie), operation_id)
        assert recovered.status_code == 200, recovered.text
        assert recovered.json()["operationId"] == operation_id
    settle()
    assert stages(stack, before) == ["security"]

    stack.gate_file.touch()
    events = chat_events(visitor.events(operation_id))
    assert events[-1] == {**events[-1], "type": "complete", "outcome": "answered"}
    assert_only_approved_output(events)
    settle()
    assert stages(stack, before) == ["security", "main", "main"]
    answers = answers_of(visitor, request_id)
    assert [answer["status"] for answer in answers] == ["completed"]
    assert visitor.conversation()["activeOperation"] is None

    # Try again on the answered attempt is the same answer, not another generation.
    late = try_again(visitor, operation_id)
    assert late.status_code == 200, late.text
    assert late.json()["operationId"] == operation_id
    settle()
    assert len(stack.calls()) == before + 3


def test_a_stop_while_the_browser_is_away_holds_and_a_retry_survives_a_reload(
    stack: Stack,
) -> None:
    """C01: a Stop around a disconnect ends the attempt once; a retry survives a reload."""
    stack.gate_file.unlink(missing_ok=True)
    before = len(stack.calls())
    visitor = Visitor(stack.api_url)
    request_id = str(uuid.uuid4())
    question = "What does Ilsa Marrow work on now?"
    admitted = visitor.ask(question, request_id)
    assert admitted.status_code == 202, admitted.text
    operation_id = admitted.json()["operationId"]
    assert len(wait_for_calls(stack, before + 1)) == before + 1

    # The browser goes away, the visitor stops it from another tab, then the browser comes back.
    visitor.events(operation_id, first_only=True)
    stopped = visitor.tab().send("POST", f"/v1/chat/operations/{operation_id}/stop")
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["status"] == "cancelled"
    events = chat_events(visitor.events(operation_id))
    assert events[-1] == {**events[-1], "type": "error", "code": "cancelled", "retryable": True}
    assert chat_events(visitor.tab().events(operation_id)) == events
    assert visitor.conversation()["activeOperation"] is None
    stack.gate_file.touch()
    settle()
    assert stages(stack, before) == ["security"]

    # The stopped request, asked again by a browser that missed the Stop, is not regenerated.
    again = visitor.ask(question, request_id)
    assert again.status_code == 200, again.text
    assert again.json()["operationId"] == operation_id
    settle()
    assert stages(stack, before) == ["security"]

    # Try again; the browser goes away during the retry and presses Try again with the same ID.
    stack.gate_file.unlink(missing_ok=True)
    retry_id = str(uuid.uuid4())
    retried = try_again(visitor, operation_id, retry_id)
    assert retried.status_code == 202, retried.text
    attempt_id = retried.json()["operationId"]
    assert attempt_id != operation_id
    assert len(wait_for_calls(stack, before + 2)) == before + 2
    visitor.events(attempt_id, first_only=True)
    reloaded = Visitor(stack.api_url, cookie=visitor.cookie)
    active = reloaded.conversation()["activeOperation"]
    assert active is not None
    assert active["operationId"] == attempt_id
    recovered = try_again(reloaded, operation_id, retry_id)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["operationId"] == attempt_id

    stack.gate_file.touch()
    answer = chat_events(reloaded.events(attempt_id))
    assert answer[-1] == {**answer[-1], "type": "complete", "outcome": "answered"}
    assert_only_approved_output(answer)
    settle()
    assert stages(stack, before) == ["security", "security", "main", "main"]

    # A reload after the retry shows the one question with its one answer and nothing running.
    view = Visitor(stack.api_url, cookie=visitor.cookie).conversation()
    assert view["activeOperation"] is None
    questions = [m for m in view["messages"] if m["role"] == "user"]
    assert [m["requestId"] for m in questions] == [request_id]
    assert [answer["status"] for answer in answers_of(reloaded, request_id)] == ["completed"]
    assert chat_events(reloaded.events(attempt_id)) == answer
    replay = try_again(reloaded, operation_id, retry_id)
    assert replay.status_code == 200, replay.text
    assert replay.json()["operationId"] == attempt_id
    settle()
    assert len(stack.calls()) == before + 4


#: The busy stack's daily spend limit: exactly five questions' allowances
#: (`chatPolicy.allowanceMicroUsd`), so a sixth reservation is refused while five are held.
FIVE_ALLOWANCES = str(5 * 20_000)
#: The busy stack's AI service: four operations at once, a dispatch waits at most two seconds.
MAX_OPERATIONS = 4
ADMISSION_WAIT_S = 2.0


@dataclass
class BusyStack:
    api_url: str
    calls_file: Path
    gate_file: Path

    def calls(self) -> list[dict[str, Any]]:
        return read_calls(self.calls_file)

    def main_calls(self) -> int:
        """Main calls: two per generated answer (the profile read, then the draft).

        Security calls are not counted per operation: a held operation's Security attempt ends
        after `security_attempt_s` and is retried once, so their number depends on the hold.
        """
        return sum(call["stage"] == "main" for call in self.calls())


@pytest.fixture(scope="module")
def busy_stack(siteverify_url: str) -> Iterator[BusyStack]:
    """Its own API (own temporary database, five allowances a day) and its own AI service."""
    pair = _pair("chat-busy")
    started: list[Process] = []
    try:
        api, api_url = _start_api(
            _api_env(
                "0",
                pair.chat(siteverify_url),
                pair.scratch,
                API_E2E_CHAT_DAILY_SPEND_LIMIT_MICRO_USD=FIVE_ALLOWANCES,
            )
        )
        started.append(api)
        started.append(
            pair.start_service(
                api_url,
                AI_SERVICE_MAX_OPERATIONS=str(MAX_OPERATIONS),
                AI_SERVICE_ADMISSION_WAIT_S=str(ADMISSION_WAIT_S),
            )
        )
        yield BusyStack(api_url, pair.calls_file, pair.gate_file)
    finally:
        for process in reversed(started):
            process.stop()
        shutil.rmtree(pair.scratch, ignore_errors=True)


def ends_unavailable(visitor: Visitor, operation_id: str) -> list[dict[str, Any]]:
    events = chat_events(visitor.events(operation_id))
    assert events[-1] == {**events[-1], "type": "error", "code": "unavailable", "retryable": True}
    assert_only_approved_output(events)
    return events


def test_four_operations_run_and_a_fifth_is_busy_within_two_seconds(
    busy_stack: BusyStack,
) -> None:
    """Four held operations, their browsers gone; a fifth is busy, its reservation released."""
    busy_stack.gate_file.unlink(missing_ok=True)
    visitors = [Visitor(busy_stack.api_url) for _ in range(MAX_OPERATIONS)]
    held = []
    for number, visitor in enumerate(visitors):
        admitted = visitor.ask(f"Question {number + 1} about Ilsa Marrow?")
        assert admitted.status_code == 202, admitted.text
        held.append(admitted.json()["operationId"])
    calls = wait_for_calls(busy_stack, MAX_OPERATIONS)
    assert [call["stage"] for call in calls] == ["security"] * MAX_OPERATIONS
    for visitor, operation_id in zip(visitors, held, strict=True):
        visitor.events(operation_id, first_only=True)  # every browser goes away

    # A fifth question finds every slot held: it fails as unavailable within the admission wait.
    fifth = Visitor(busy_stack.api_url)
    started = time.monotonic()
    admitted = fifth.ask("Which services does Ilsa Marrow offer?")
    assert admitted.status_code == 202, admitted.text
    fifth_id = admitted.json()["operationId"]
    ends_unavailable(fifth, fifth_id)
    assert time.monotonic() - started < ADMISSION_WAIT_S + 1.0
    assert fifth.conversation()["activeOperation"] is None

    # Its reservation was released: a sixth question reserves the fifth allowance, and while
    # that one waits for a slot, a seventh finds the day's spend limit taken.
    sixth = Visitor(busy_stack.api_url)
    admitted = sixth.ask("Which projects has Ilsa Marrow built?")
    assert admitted.status_code == 202, admitted.text
    sixth_id = admitted.json()["operationId"]
    seventh = Visitor(busy_stack.api_url)
    refused = seventh.ask("What does Ilsa Marrow work on now?")
    assert refused.status_code == 503, refused.text
    assert refused.json()["error"]["code"] == "chat_budget_exhausted"
    ends_unavailable(sixth, sixth_id)
    admitted = seventh.ask("What does Ilsa Marrow work on now?")
    assert admitted.status_code == 202, admitted.text
    ends_unavailable(seventh, admitted.json()["operationId"])
    settle()
    assert busy_stack.main_calls() == 0

    # The four held operations finish for their returning browsers, each generated once; a
    # refused operation that had reached the model would add its own two Main calls here.
    busy_stack.gate_file.touch()
    for visitor, operation_id in zip(visitors, held, strict=True):
        events = chat_events(visitor.events(operation_id))
        assert events[-1] == {**events[-1], "type": "complete", "outcome": "answered"}
        assert_only_approved_output(events)
    settle()
    assert busy_stack.main_calls() == 2 * MAX_OPERATIONS

    # With the slots free, Try again on the busy answer is generated.
    retried = try_again(fifth, fifth_id)
    assert retried.status_code == 202, retried.text
    answer = chat_events(fifth.events(retried.json()["operationId"]))
    assert answer[-1] == {**answer[-1], "type": "complete", "outcome": "answered"}
    settle()
    assert busy_stack.main_calls() == 2 * MAX_OPERATIONS + 2


def test_a_failed_challenge_dispatches_nothing(stack: Stack) -> None:
    stack.gate_file.touch()
    before = len(stack.calls())
    visitor = Visitor(stack.api_url)
    response = visitor.ask("Who is Ilsa Marrow?", token="fail-challenge")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "chat_challenge_failed"
    settle()
    assert len(stack.calls()) == before
    assert visitor.conversation()["messages"] == []


def test_a_spent_quota_dispatches_nothing(stack: Stack) -> None:
    stack.gate_file.touch()
    visitor = Visitor(stack.api_url)
    for number in range(5):
        events = answered(stack, visitor, f"Question {number + 1} about Ilsa Marrow?")
        assert events[-1]["type"] == "complete"
    settle()
    before = len(stack.calls())
    response = visitor.ask("One question too many?")
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "chat_quota_exceeded"
    assert int(response.headers["retry-after"]) >= 1
    settle()
    assert len(stack.calls()) == before


def test_a_spent_budget_dispatches_nothing(stack: Stack) -> None:
    stack.gate_file.touch()
    before = len(stack.calls())
    visitor = Visitor(stack.spent_api_url)
    response = visitor.ask("Who is Ilsa Marrow?")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "chat_budget_exhausted"
    settle()
    assert len(stack.calls()) == before
    assert visitor.conversation()["messages"] == []


def test_the_service_environment_holds_no_database_setting() -> None:
    inherited = {
        "PATH": "/usr/bin",
        "DATABASE_URL": "postgres://fictional",
        "DATABASE_USER": "fictional",
        "DATABASE_PASSWORD": "fictional",
        "POSTGRES_PASSWORD": "fictional",
        "POSTGRES_HOST": "db.example.test",
        "AI_SERVICE_MODEL": "anthropic",
        "ANTHROPIC_API_KEY": "fictional",
    }
    env = service_environment(inherited, {"AI_SERVICE_MODEL": "fake"})
    assert env == {"PATH": "/usr/bin", "AI_SERVICE_MODEL": "fake"}


#: Each capability's route and arguments over the fictional profile fixture.
CAPABILITY_READS: dict[str, tuple[str, dict[str, str]]] = {
    "get_profile": ("profile", {}),
    "list_experiences": ("experiences", {}),
    "list_projects": ("projects", {}),
    "get_project": ("project", {"slug": "support-answer-engine"}),
    "list_services": ("services", {}),
    "list_explorations": ("explorations", {}),
    "list_education": ("education", {}),
    "list_current_focus": ("current-focus", {}),
    "get_roadmap": ("roadmap", {}),
    "get_roadmap_area": ("roadmap-area", {"area": "agent-systems"}),
    "get_learning_diary": ("learning-diary", {}),
    "get_learning_statistics": ("learning-statistics", {}),
    "list_books": ("books", {}),
    "list_events": ("events", {}),
    "list_technologies": ("technologies", {}),
}


def capability_records(stack: Stack, route: str, arguments: dict[str, str]) -> list[Any]:
    """Every record of one capability, page by page, as a read caller receives them."""
    records: list[Any] = []
    page, page_count = 1, 1
    with httpx2.Client(timeout=10.0) as client:
        while page <= page_count:
            response = client.get(
                f"{stack.service_url}/v1/capabilities/{route}", params={**arguments, "page": page}
            )
            assert response.status_code == 200, (route, response.text)
            body = response.json()
            assert body["page"] == page
            page_count = body["pageCount"]
            records.extend(body["records"])
            page += 1
    return records


async def in_process(stack: Stack, name: str, arguments: dict[str, str]) -> tuple[Any, Any]:
    """The same read through `read_tool` and through the model's own tool, over the real API."""
    async with ApiContentReader(stack.api_url) as content:
        pages = [await read_tool(content, name, arguments, page=1)]
        while pages[-1].page < pages[-1].page_count:
            pages.append(await read_tool(content, name, arguments, page=pages[-1].page + 1))
        tools = Tools(
            content, tracer=Tracer(), deadline=Deadline(60), call_s=5.0, result_tokens=50000
        )
        try:
            model = json.loads(await tools.call(name, arguments))
        finally:
            await tools.close()
    records = [
        {
            "kind": record.kind,
            "id": record.record_id,
            "title": record.title,
            "href": record.href,
            "data": record.data,
        }
        for page in pages
        for record in page.records
    ]
    return records, model.get("records", [model])


def test_the_capability_table_covers_every_read_capability() -> None:
    assert set(CAPABILITY_READS) == set(READ_CAPABILITIES)


@pytest.mark.parametrize("name", [name for name in CAPABILITY_READS if name in TOOLS])
async def test_a_capability_equals_the_in_process_tool_over_the_real_api(
    stack: Stack, name: str
) -> None:
    route, arguments = CAPABILITY_READS[name]
    served = await asyncio.to_thread(capability_records, stack, route, arguments)
    expected, model = await in_process(stack, name, arguments)
    assert served == expected
    assert served, name
    assert [(r["kind"], r["data"]) for r in served] == [(r["kind"], r["data"]) for r in model]
    text = json.dumps(served)
    for secret in stack.secrets:
        assert secret not in text


async def test_the_technology_capability_is_the_published_catalogue_over_the_real_api(
    stack: Stack,
) -> None:
    served = await asyncio.to_thread(capability_records, stack, "technologies", {})
    async with ApiContentReader(stack.api_url) as content:
        page = await read_tool(content, "list_technologies", {}, page=1, page_records=300)
    with httpx2.Client(timeout=10.0) as client:
        catalogue = client.get(f"{stack.api_url}/v1/technologies").json()
    assert catalogue, "the demo seed publishes technologies"
    assert [(r["kind"], r["id"], r["title"], r["href"], r["data"]) for r in served] == [
        (r.kind, r.record_id, r.title, r.href, r.data) for r in page.records
    ]
    assert [r["data"] for r in served] == [
        {"slug": t["slug"], "name": t["name"], "tier": t["tier"], "group": t["group"]}
        for t in catalogue
    ]
    text = json.dumps(served)
    for technology in catalogue:
        assert technology["id"] not in text
    for secret in stack.secrets:
        assert secret not in text


def test_a_read_caller_reaches_no_generation_conversation_or_private_route(stack: Stack) -> None:
    before = len(stack.calls())
    operation = str(uuid.uuid4())
    with httpx2.Client(timeout=10.0) as client:
        refused = [
            client.post(f"{stack.service_url}/internal/v1/generations", json={}),
            client.post(f"{stack.service_url}/internal/v1/generations/{operation}/cancel"),
            client.post(
                f"{stack.service_url}/internal/v1/generations/{operation}/cancel",
                headers={"authorization": "Bearer " + RELAY_TOKEN},
            ),
        ]
        missing = [
            client.get(f"{stack.service_url}{path}")
            for path in (
                "/v1/capabilities/contact",
                "/v1/capabilities/conversations",
                "/v1/capabilities/ledger",
                "/v1/capabilities/audit",
                "/v1/capabilities/compaction",
                "/v1/capabilities/media/originals",
                "/v1/chat/conversation",
                "/v1/internal/chat/grants/claim",
                "/v1/person",
            )
        ]
        written = [
            client.request(method, f"{stack.service_url}/v1/capabilities/projects", json={})
            for method in ("POST", "PUT", "PATCH", "DELETE")
        ]
        invalid = [
            client.get(f"{stack.service_url}/v1/capabilities/project", params=params)
            for params in (
                {"slug": f"{stack.api_url}/v1/internal/chat"},
                {"slug": "x'; SELECT * FROM chat_messages; --"},
                {"slug": "../../../../etc/passwd"},
                {"slug": "support-answer-engine", "command": "cat secrets.txt"},
                {"slug": "support-answer-engine", "url": stack.api_url},
            )
        ]
    assert [r.status_code for r in refused] == [401, 401, 401]
    assert [r.status_code for r in missing] == [404] * len(missing)
    assert [r.status_code for r in written] == [405] * len(written)
    assert [r.status_code for r in invalid] == [422] * len(invalid)
    text = "".join(r.text for r in [*refused, *missing, *written, *invalid])
    for secret in stack.secrets:
        assert secret not in text
    settle()
    assert len(stack.calls()) == before
