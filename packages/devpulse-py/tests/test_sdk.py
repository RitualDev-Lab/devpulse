import json
import os
import tempfile
import unittest
from unittest.mock import patch

from devpulse_sdk import DevPulseClient


class _FakeResp:
    status = 201
    def __enter__(self): return self
    def __exit__(self, *args): pass


class TestDevPulseSDK(unittest.TestCase):
    def test_breadcrumbs_and_offline_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            qfile = os.path.join(tmp, "queue.json")
            with patch("urllib.request.urlopen", side_effect=OSError("offline")):
                client = DevPulseClient(
                    api_key="dp_live_py_test",
                    release="v2.0.0",
                    commit_sha="deadbeef",
                    queue_path=qfile,
                    auto_hook=False,
                )
                client.add_breadcrumb(category="http", message="GET /api/data -> 500")
                try:
                    raise RuntimeError("Boom offline")
                except RuntimeError as e:
                    ok = client.capture_exception(e)
                    self.assertFalse(ok)
                self.assertGreaterEqual(client.pending_queue_size(), 1)

            # Force queue readiness & restore network
            for item in client._queue:
                item["next_attempt_at"] = 0
            sent = []

            def _fake_open(req, timeout=3):
                sent.append(json.loads(req.data.decode("utf-8")))
                return _FakeResp()

            with patch("urllib.request.urlopen", side_effect=_fake_open):
                flushed = client.flush()
                self.assertGreaterEqual(flushed, 1)
                self.assertEqual(client.pending_queue_size(), 0)
                crash_payloads = [p for p in sent if "errorName" in p]
                self.assertEqual(crash_payloads[0]["version"], "v2.0.0")
                self.assertEqual(crash_payloads[0]["commitSha"], "deadbeef")
                self.assertEqual(len(crash_payloads[0]["breadcrumbs"]), 1)


if __name__ == "__main__":
    unittest.main()
