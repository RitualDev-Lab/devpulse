import test from "node:test";
import assert from "node:assert/strict";
import { classifyGitHubWebhookEvent } from "../src/lib/github/webhook-events";

test("classifyGitHubWebhookEvent separates branch commits from tags and formal releases", () => {
  const pushCommit = classifyGitHubWebhookEvent("push", {
    ref: "refs/heads/main",
    head_commit: {
      id: "abcdef1234567890",
      message: "fix: typo in readme\n\nbody",
      author: { username: "alice" },
      timestamp: "2026-11-27T12:00:00Z",
    },
  });
  assert.equal(pushCommit.kind, "branch_commit");

  const tagPush = classifyGitHubWebhookEvent("push", {
    ref: "refs/tags/v2.4.0",
    head_commit: {
      id: "1122334455667788",
      message: "release v2.4.0",
      author: { username: "alice" },
      timestamp: "2026-11-27T12:10:00Z",
    },
  });
  assert.equal(tagPush.kind, "tag_release");
  if (tagPush.kind === "tag_release") {
    assert.equal(tagPush.version, "v2.4.0");
  }

  const release = classifyGitHubWebhookEvent("release", {
    release: {
      tag_name: "v2.4.0",
      target_commitish: "1122334455667788",
      name: "Release 2.4.0",
      published_at: "2026-11-27T12:15:00Z",
      author: { login: "alice" },
    },
  });
  assert.equal(release.kind, "formal_release");
});
