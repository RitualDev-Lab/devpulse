# devpulse-sdk

Official zero-dependency Python SDK for **DevPulse**:

- Global `sys.excepthook` + `threading.excepthook` crash capture
- Thread-safe **Breadcrumbs** ring buffer (`logging.Handler` + manual API)
- **Offline Retry Queue** persisted on disk with exponential backoff
- **Release Health & Commit Attribution** (`release="v1.2.0"`, `commit_sha="..."`)
- CLI source-map / artifact uploader (`devpulse-upload`)

```python
import devpulse_sdk

devpulse_sdk.init(
    api_key="dp_live_...",
    release="v1.2.0",
    commit_sha="abcdef1",
)
devpulse_sdk.add_breadcrumb(category="custom", message="Worker booted")
```
