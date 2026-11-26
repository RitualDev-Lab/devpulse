import test from "node:test";
import assert from "node:assert/strict";
import { clampProvisionedRole } from "../src/lib/security/org-roles";

test("provisioning never grants owner", () => {
  assert.equal(clampProvisionedRole("owner"), "admin");
  assert.equal(clampProvisionedRole("OWNER"), "admin");
});

test("provisioning keeps lower roles and normalizes legacy names", () => {
  assert.equal(clampProvisionedRole("admin"), "admin");
  assert.equal(clampProvisionedRole("maintainer"), "developer");
  assert.equal(clampProvisionedRole("developer"), "developer");
  assert.equal(clampProvisionedRole("billing"), "billing");
  assert.equal(clampProvisionedRole("viewer"), "viewer");
});

test("missing or unknown provisioned roles fall back to viewer", () => {
  assert.equal(clampProvisionedRole(undefined), "viewer");
  assert.equal(clampProvisionedRole(""), "viewer");
  assert.equal(clampProvisionedRole("superuser"), "viewer");
});
