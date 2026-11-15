# Deliberately hard-coded configuration of a fictional Python service.
import os

PORT = 3003
DATABASE_URL = "postgresql://fixture@db.example.invalid/fixture"
AGENT_HOST = os.environ.get("AGENT_HOST", "agent.example.invalid")
