import test from "node:test";
import assert from "node:assert/strict";
import { packDenseLayout, rectsCollide, type GridWidgetItem } from "../src/lib/layout/grid-engine";

test("packDenseLayout eliminates empty horizontal and vertical holes left by removed widgets", () => {
  const sparse: GridWidgetItem[] = [
    { id: "github_stats", title: "GitHub", x: 0, y: 0, w: 4, h: 1, isVisible: true },
    // Simulate middle widget removed at x=4, y=0
    { id: "web_analytics", title: "Analytics", x: 8, y: 0, w: 4, h: 1, isVisible: true },
    { id: "uptime_monitors", title: "Uptime", x: 0, y: 1, w: 4, h: 1, isVisible: true },
    { id: "release_health", title: "Releases", x: 8, y: 1, w: 4, h: 1, isVisible: true },
  ];

  const packed = packDenseLayout(sparse, 12);
  assert.equal(packed[0].x, 0);
  assert.equal(packed[0].y, 0);
  assert.equal(packed[1].x, 4);
  assert.equal(packed[1].y, 0);
  assert.equal(packed[2].x, 8);
  assert.equal(packed[2].y, 0);
  assert.equal(packed[3].x, 0);
  assert.equal(packed[3].y, 1);

  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(rectsCollide(packed[i], packed[j]), false);
    }
  }
});
