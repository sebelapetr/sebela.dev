"""C01: the visitor chat end to end through the real API and AI service, without a provider.

The built API runs as its e2e server on a temporary database filled from the fictional profile
fixture; this service runs as its own process with the fictional model; a fake Siteverify stands in
for Cloudflare. The test talks to the API only, as the website's server does, and counts the model
calls through the fictional model's test-only calls file. Hosts come from the checkout's
environment files; every port is free and chosen at run time. It needs the running Postgres.
"""

from __future__ import annotations

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

ROOT = Path(__file__).resolve().parents[4]
API_FOLDER = ROOT / "apps" / "api"
SERVICE_FOLDER = ROOT / "apps" / "ai-service"
SEED_FOLDER = ROOT / "packages" / "llm-agent" / "evals" / "datasets" / "fixtures" / "profile"

ORIGIN = "https://chat.example.test"
EXPECTED_HOSTNAME = "chat.example.test"
COOKIE = "sebela_chat"
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

    def calls(self) -> list[dict[str, Any]]:
        if not self.calls_file.exists():
            return []
        return [json.loads(line) for line in self.calls_file.read_text().splitlines() if line]


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


@pytest.fixture(scope="module")
def stack() -> Iterator[Stack]:
    scratch = ROOT / ".tmp" / f"chat-stack-{secrets.token_hex(4)}"
    scratch.mkdir(parents=True)
    api_host = setting("API_HOST")
    service_host = setting("AI_SERVICE_HOST")
    service_port = free_port(service_host)
    service_url = address(service_host, service_port)
    token = secrets.token_urlsafe(32)
    control_token = secrets.token_urlsafe(32)
    calls_file = scratch / "calls.jsonl"
    gate_file = scratch / "gate"

    siteverify = ThreadingHTTPServer((api_host, 0), _Siteverify)
    threading.Thread(target=siteverify.serve_forever, daemon=True).start()
    chat = {
        "API_CHAT_ALLOWED_ORIGINS": ORIGIN,
        "API_CHAT_COOKIE_SECURE": "false",
        "API_AI_SERVICE_URL": service_url,
        "API_AI_SERVICE_TOKEN": token,
        "API_AI_CONTROL_TOKEN": control_token,
        "API_CHAT_FINGERPRINT_KEY": secrets.token_urlsafe(32),
        "API_CHAT_RETENTION_DAYS": "",
        "API_CHAT_MODEL": "fake",
        "API_CHAT_PRICING_VERSION": "fake-1",
        # Not a Turnstile test secret, so the hostname and action checks run as in production.
        "API_TURNSTILE_SECRET_KEY": secrets.token_urlsafe(24),
        "API_TURNSTILE_EXPECTED_HOSTNAME": EXPECTED_HOSTNAME,
        "API_TURNSTILE_VERIFY_URL": address(api_host, siteverify.server_address[1]) + "/siteverify",
    }
    started: list[Process] = []
    try:
        api, api_url = _start_api(_api_env("0", chat, scratch))
        started.append(api)
        spent, spent_url = _start_api(
            _api_env(
                "0",
                chat,
                scratch,
                API_E2E_CHAT_DAILY_SPEND_LIMIT_MICRO_USD=SPENT_DAILY_LIMIT,
            )
        )
        started.append(spent)
        hidden = ("AI_SERVICE_", "LLM_AGENT_", "ANTHROPIC_")
        service_env = {
            **{k: v for k, v in os.environ.items() if not k.startswith(hidden)},
            "AI_SERVICE_HOST": service_host,
            "LLM_AGENT_PORT": str(service_port),
            "AI_SERVICE_API_URL": api_url,
            "AI_SERVICE_TOKEN": token,
            "AI_SERVICE_CONTROL_TOKEN": control_token,
            "AI_SERVICE_MODEL": "fake",
            "AI_SERVICE_FAKE_SCENARIO": "slow",
            "AI_SERVICE_FAKE_CALLS_FILE": str(calls_file),
            "AI_SERVICE_FAKE_GATE_FILE": str(gate_file),
        }
        service = Process([sys.executable, "-m", "ai_service"], SERVICE_FOLDER, service_env)
        started.append(service)
        _wait_healthy(service, service_url)
        yield Stack(api_url, spent_url, calls_file, gate_file)
    finally:
        for process in reversed(started):
            process.stop()
        siteverify.shutdown()
        siteverify.server_close()
        shutil.rmtree(scratch, ignore_errors=True)


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
        headers = dict(extra)
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


def wait_for_calls(stack: Stack, count: int, timeout_s: float = 30.0) -> list[dict[str, Any]]:
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
    assert assistants[0]["status"] == "complete"
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
