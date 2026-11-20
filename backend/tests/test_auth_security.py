"""Security regression tests: anonymous access, identity verification, and session ownership.

Run: python -m unittest discover -s backend/tests -v
Mocks only the external Supabase user-info endpoint; document indexing is real.
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

TEMP = tempfile.TemporaryDirectory()
os.environ["DATABASE_PATH"] = str(Path(TEMP.name) / "sessions.sqlite3")
os.environ["SUPABASE_PUBLISHABLE_KEY"] = "test_publishable_key"
os.environ["GEMINI_API_KEY"] = ""
os.environ["SEMANTIC_SEARCH"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402


def fake_supabase_get(url, headers, timeout):
    from types import SimpleNamespace
    token = headers["Authorization"].removeprefix("Bearer ")
    identities = {"alice-token": "alice-id", "bob-token": "bob-id"}
    owner = identities.get(token)
    return SimpleNamespace(status_code=200 if owner else 401, json=lambda: {"id": owner} if owner else {})


class AuthSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mock = patch.object(main.requests, "get", side_effect=fake_supabase_get)
        cls.mock.start()
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.mock.stop()
        TEMP.cleanup()

    def auth(self, token):
        return {"Authorization": "Bearer " + token}

    def test_health_public_but_session_private(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(self.client.get("/api/insights", params={"session_id": "unknown"}).status_code, 401)
        self.assertEqual(self.client.get("/api/insights", params={"session_id": "unknown"}, headers=self.auth("bad-token")).status_code, 401)

    def test_user_cannot_read_or_mutate_other_users_session(self):
        text = b"AstraDoc security: the policy states all internal documents are strictly confidential and access is restricted."
        response = self.client.post("/api/upload", files=[("files", ("policy.txt", text, "text/plain"))], headers=self.auth("alice-token"))
        self.assertEqual(response.status_code, 200, response.text)
        sid = response.json()["session_id"]
        self.assertEqual(self.client.get("/api/session/" + sid, headers=self.auth("alice-token")).status_code, 200)
        self.assertEqual(self.client.get("/api/session/" + sid, headers=self.auth("bob-token")).status_code, 404)
        self.assertEqual(self.client.get("/api/export", params={"session_id": sid}, headers=self.auth("bob-token")).status_code, 404)
        self.assertEqual(self.client.delete("/api/chat", params={"session_id": sid}, headers=self.auth("bob-token")).status_code, 404)
        self.assertEqual(self.client.post("/api/upload", data={"session_id": sid}, files=[("files", ("intrusion.txt", text, "text/plain"))], headers=self.auth("bob-token")).status_code, 404)
        # Persistent SQLite restores only for the original account after clearing RAM cache.
        main.sessions.clear()
        self.assertEqual(self.client.get("/api/session/" + sid, headers=self.auth("alice-token")).status_code, 200)
        self.assertEqual(self.client.get("/api/session/" + sid, headers=self.auth("bob-token")).status_code, 404)

    def test_invalid_authorization_rejected(self):
        self.assertEqual(self.client.get("/api/large-uploads/config").status_code, 401)
        self.assertEqual(self.client.get("/api/large-uploads/config", headers=self.auth("bad-token")).status_code, 401)
        self.assertEqual(self.client.get("/api/large-uploads/config", headers=self.auth("alice-token")).status_code, 200)


if __name__ == "__main__":
    unittest.main()
