# Deliberately hard-coded configuration of a fictional Python service.
import os

PORT = 3003
DATABASE_URL = "postgresql://fixture@db.example.invalid/fixture"
AGENT_HOST = os.environ.get("AGENT_HOST", "agent.example.invalid")
WORKER_PORT: int = 3005
API_PORT = os.getenv("API_PORT", default="3001")
os.environ.setdefault("DB_HOST", "db.example.invalid")
