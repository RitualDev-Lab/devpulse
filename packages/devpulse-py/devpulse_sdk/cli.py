import argparse
import json
import os
from pathlib import Path
import urllib.request

from .client import DEFAULT_ENDPOINT


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload source maps / artifacts to DevPulse")
    parser.add_argument("--key", required=True, help="DevPulse telemetry API key")
    parser.add_argument("--release", required=True, help="Release tag (e.g. v1.2.0)")
    parser.add_argument("--dir", default="./dist", help="Directory containing .map files")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="DevPulse base URL")
    args = parser.parse_args()

    root = Path(args.dir)
    if not root.exists():
        print(f"Directory not found: {root}")
        return 1

    uploaded = 0
    for path in root.rglob("*.map"):
        rel = path.relative_to(root).as_posix()
        payload = {
            "apiKey": args.key,
            "action": "upload_sourcemap",
            "version": args.release,
            "filePath": rel,
            "content": path.read_text(encoding="utf-8", errors="ignore"),
        }
        req = urllib.request.Request(
            f"{args.endpoint.rstrip('/')}/api/v1/releases",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if 200 <= resp.status < 300:
                uploaded += 1
                print(f"Uploaded {rel}")
    print(f"Done: {uploaded} map file(s) uploaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
