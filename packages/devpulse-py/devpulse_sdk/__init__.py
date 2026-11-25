from typing import Any, Dict, Optional
from .client import DevPulseClient

__version__ = "1.0.0"

_active_client: Optional[DevPulseClient] = None


def init(**kwargs: Any) -> DevPulseClient:
    global _active_client
    _active_client = DevPulseClient(**kwargs)
    return _active_client


def add_breadcrumb(
    category: str = "custom",
    level: str = "info",
    message: str = "",
    data: Optional[Dict[str, Any]] = None,
) -> None:
    if _active_client:
        _active_client.add_breadcrumb(category=category, level=level, message=message, data=data)


def capture_exception(exc_info: Any = None) -> bool:
    if not _active_client:
        return False
    return _active_client.capture_exception(exc_info)


def track_event(event_name: str, path: str = "/", source_type: str = "app") -> bool:
    if not _active_client:
        return False
    return _active_client.track_event(event_name=event_name, path=path, source_type=source_type)


def flush() -> int:
    if not _active_client:
        return 0
    return _active_client.flush()


__all__ = [
    "DevPulseClient",
    "init",
    "add_breadcrumb",
    "capture_exception",
    "track_event",
    "flush",
]
