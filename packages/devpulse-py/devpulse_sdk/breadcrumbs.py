from collections import deque
from datetime import datetime, timezone
import logging
import threading
from typing import Any, Deque, Dict, List, Optional


class BreadcrumbBuffer:
    def __init__(self, max_len: int = 40):
        self._lock = threading.Lock()
        self._items: Deque[Dict[str, Any]] = deque(maxlen=max_len)

    def add(
        self,
        category: str = "custom",
        level: str = "info",
        message: str = "",
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        entry: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "category": category,
            "level": level,
            "message": str(message)[:300],
        }
        if data:
            entry["data"] = data
        with self._lock:
            self._items.append(entry)

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._items)


class DevPulseLoggingHandler(logging.Handler):
    def __init__(self, buffer: BreadcrumbBuffer, level: int = logging.INFO):
        super().__init__(level=level)
        self._buffer = buffer

    def emit(self, record: logging.LogRecord) -> None:
        try:
            lvl = "error" if record.levelno >= logging.ERROR else (
                "warning" if record.levelno >= logging.WARNING else "info"
            )
            self._buffer.add(
                category="console",
                level=lvl,
                message=self.format(record),
            )
        except Exception:
            pass
