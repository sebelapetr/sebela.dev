# Configuration read from the environment; a comment may mention localhost:3003.
import os

PORT = int(os.environ["LLM_AGENT_PORT"])
DATABASE_URL = os.environ["DATABASE_URL"]
AGENT_HOST = os.environ.get("AGENT_HOST")
WORKER_PORT: int = int(os.environ["WORKER_PORT"])
