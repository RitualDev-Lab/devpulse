import json
import logging
import os
from pathlib import Path
import platform
import sys
import threading
import time
import traceback
from typing import Any, Dict, Optional
import urllib.request

from .breadcrumbs import BreadcrumbBuffer, DevPulseLoggingHandler


DEFAULT_ENDPOINT = "https://devpulse.ritualdev.in"


class DevPulseClient:
    def __init__(
        self,
        api_key: str,
        endpoint: str = DEFAULT_ENDPOINT,
        release: Optional[str] = None,
        commit_sha: Optional[str] = None,
        environment: str = "production",
        max_breadcrumbs: int = 40,
        max_retries: int = 4,
        queue_path: Optional[str] = None,
        auto_hook: bool = True,
        attach_logging: bool = False,
    ):
        if not api_key:
            raise ValueError("devpulse-sdk: api_key is required")

        self.api_key = api_key
        self.endpoint = endpoint.rstrip("/")
        self.release = release
        self.commit_sha = commit_sha
        self.environment = environment
        self.max_retries = max_retries
        self.breadcrumbs = BreadcrumbBuffer(max_len=max_breadcrumbs)
        self.queue_path = Path(
            queue_path or os.path.join(Path.home(), ".devpulse_offline_queue.json")
        )
        self._lock = threading.Lock()
        self._queue = self._load_queue()

        if attach_logging:
            logging.getLogger().addHandler(DevPulseLoggingHandler(self.breadcrumbs))

        if auto_hook:
            self._install_hooks()

        if self.release:
            self.track_release_session(self.release, self.commit_sha)

        self.flush()

    def _install_hooks(self) -> None:
        orig_hook = sys.excepthook

        def _hook(exc_type, exc_val, exc_tb):
            self.capture_exception((exc_type, exc_val, exc_tb))
            return orig_hook(exc_type, exc_val, exc_tb)

        sys.excepthook = _hook

        if hasattr(threading, "excepthook"):
            orig_thread_hook = threading.excepthook

            def _thread_hook(args):
                self.capture_exception((args.exc_type, args.exc_value, args.exc_traceback))
                return orig_thread_hook(args)

            threading.excepthook = _thread_hook

    def add_breadcrumb(
        self,
        category: str = "custom",
        level: str = "info",
        message: str = "",
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.breadcrumbs.add(category=category, level=level, message=message, data=data)

    def track_release_session(
        self, version: str, commit_sha: Optional[str] = None, sessions: int = 1
    ) -> bool:
        return self._send_or_queue(
            f"{self.endpoint}/api/v1/releases",
            {
                "apiKey": self.api_key,
                "action": "session",
                "version": version,
                "commitSha": commit_sha or self.commit_sha,
                "sessions": sessions,
            },
        )

    def track_event(
        self, event_name: str, path: str = "/", source_type: str = "app"
    ) -> bool:
        return self._send_or_queue(
            f"{self.endpoint}/api/v1/analytics",
            {
                "project": self.api_key,
                "eventName": event_name,
                "path": path,
                "sourceType": source_type,
                "os": f"{platform.system()} {platform.release()}",
                "appVersion": self.release,
            },
        )

    def capture_exception(self, exc_info=None) -> bool:
        if exc_info is None:
            exc_info = sys.exc_info()
        if isinstance(exc_info, BaseException):
            exc_type = type(exc_info)
            exc_val = exc_info
            exc_tb = exc_info.__traceback__
        else:
            exc_type, exc_val, exc_tb = exc_info

        tb_lines = traceback.format_exception(exc_type, exc_val, exc_tb)
        payload = {
            "apiKey": self.api_key,
            "errorName": getattr(exc_type, "__name__", "PythonException"),
            "message": str(exc_val),
            "stackTrace": "".join(tb_lines),
            "runtime": f"python {platform.python_version()}",
            "os": f"{platform.system()} {platform.release()}",
            "version": self.release,
            "commitSha": self.commit_sha,
            "environment": self.environment,
            "breadcrumbs": self.breadcrumbs.snapshot(),
        }
        return self._send_or_queue(f"{self.endpoint}/api/v1/event", payload)

    def flush(self) -> int:
        with self._lock:
            if not self._queue:
                return 0
            now = time.time()
            delivered = 0
            remaining = []
            for item in self._queue:
                if item.get("next_attempt_at", 0) > now:
                    remaining.append(item)
                    continue
                if self._post_json(item["url"], item["payload"]):
                    delivered += 1
                elif item.get("attempts", 1) < self.max_retries:
                    attempts = item.get("attempts", 1)
                    backoff = min(60, 2 ** attempts)
                    remaining.append(
                        {
                            "url": item["url"],
                            "payload": item["payload"],
                            "attempts": attempts + 1,
                            "next_attempt_at": time.time() + backoff,
                        }
                    )
            self._queue = remaining
            self._save_queue()
            return delivered

    def pending_queue_size(self) -> int:
        with self._lock:
            return len(self._queue)

    def _send_or_queue(self, url: str, payload: Dict[str, Any]) -> bool:
        if self._post_json(url, payload):
            if self._queue:
                self.flush()
            return True
        with self._lock:
            self._queue.append(
                {
                    "url": url,
                    "payload": payload,
                    "attempts": 1,
                    "next_attempt_at": time.time() + 1.5,
                }
            )
            if len(self._queue) > 100:
                self._queue = self._queue[-100:]
            self._save_queue()
        return False

    def _post_json(self, url: str, payload: Dict[str, Any]) -> bool:
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "devpulse-sdk-python/1.0.0",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False

    def _load_queue(self):
        try:
            if self.queue_path.exists():
                data = json.loads(self.queue_path.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    return data
        except Exception:
            pass
        return []

    def _save_queue(self) -> None:
        try:
            self.queue_path.parent.mkdir(parents=True, exist_ok=True)
            self.queue_path.write_text(json.dumps(self._queue), encoding="utf-8")
        except Exception:
            pass
