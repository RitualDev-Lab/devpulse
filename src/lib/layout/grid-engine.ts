/**
 * DevPulse 2D Responsive Grid Engine
 * Handles 12-col (Desktop), 8-col (Tablet), and 4-col (Mobile) layout coordinates,
 * AABB collision detection, live corner resize snapping, and automatic vertical reflow.
 */

export interface GridWidgetItem {
  id: string; // widgetType identifier, e.g. 'github_stats'
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isVisible: boolean;
}

export type SizePresetKey = "1x1" | "2x1" | "2x2" | "3x2" | "4x2";

export const SIZE_PRESETS: Record<SizePresetKey, { w: number; h: number; label: string }> = {
  "1x1": { w: 3, h: 1, label: "1x1 (Quarter)" },
  "2x1": { w: 6, h: 1, label: "2x1 (Half)" },
  "2x2": { w: 6, h: 2, label: "2x2 (Large)" },
  "3x2": { w: 9, h: 2, label: "3x2 (Wide)" },
  "4x2": { w: 12, h: 2, label: "4x2 (Full)" },
};

export function detectPresetKey(w: number, h: number): SizePresetKey | null {
  if (w <= 4 && h === 1) return "1x1";
  if (w === 6 && h === 1) return "2x1";
  if (w === 6 && h >= 2) return "2x2";
  if (w >= 8 && w <= 9 && h >= 2) return "3x2";
  if (w >= 10 && h >= 2) return "4x2";
  return null;
}

export function rectsCollide(
  a: Pick<GridWidgetItem, "x" | "y" | "w" | "h">,
  b: Pick<GridWidgetItem, "x" | "y" | "w" | "h">
): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Compacts visible widgets upward to eliminate empty vertical gaps while preserving relative order.
 */
export function compactLayout(items: GridWidgetItem[], cols = 12): GridWidgetItem[] {
  const visible = items
    .filter((it) => it.isVisible)
    .map((it) => {
      const clampedW = Math.min(Math.max(1, it.w), cols);
      const clampedX = Math.min(Math.max(0, it.x), cols - clampedW);
      return {
        ...it,
        w: clampedW,
        h: Math.max(1, it.h),
        x: clampedX,
        y: Math.max(0, it.y),
      };
    })
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  const placed: GridWidgetItem[] = [];

  for (const item of visible) {
    let candidateY = 0;
    // Move downward only if candidate collides with an already-placed widget
    // Start searching from 0 upward-compact, or preserve desired y if checking collisions
    while (candidateY < item.y) {
      const testRect = { ...item, y: candidateY };
      const hits = placed.some((p) => rectsCollide(testRect, p));
      if (!hits) break;
      candidateY++;
    }
    // If no free slot found above item.y, check from item.y downwards
    let finalY = candidateY;
    while (placed.some((p) => rectsCollide({ ...item, y: finalY }, p))) {
      finalY++;
    }
    placed.push({ ...item, y: finalY });
  }

  const hidden = items.filter((it) => !it.isVisible);
  return [...placed, ...hidden];
}

/**
 * Moves or resizes a single widget (`targetId`) to `nextRect`, resolves all overlapping widgets
 * by pushing them down, and runs vertical compaction for a clean 2D matrix.
 */
export function resolveCollisionAndReflow(
  items: GridWidgetItem[],
  targetId: string,
  nextRect: Partial<Pick<GridWidgetItem, "x" | "y" | "w" | "h">>,
  cols = 12
): GridWidgetItem[] {
  const target = items.find((i) => i.id === targetId);
  if (!target) return items;

  const w = Math.min(Math.max(2, nextRect.w ?? target.w), cols);
  const h = Math.min(Math.max(1, nextRect.h ?? target.h), 4);
  const x = Math.min(Math.max(0, nextRect.x ?? target.x), cols - w);
  const y = Math.max(0, nextRect.y ?? target.y);

  const updatedTarget: GridWidgetItem = { ...target, x, y, w, h, isVisible: true };

  // Keep target locked at (x, y, w, h) while pushing colliding items below it
  const others = items
    .filter((i) => i.id !== targetId)
    .map((i) => ({ ...i }));

  const visibleOthers = others
    .filter((i) => i.isVisible)
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  const placed: GridWidgetItem[] = [updatedTarget];

  for (const other of visibleOthers) {
    const clampedW = Math.min(Math.max(1, other.w), cols);
    const clampedX = Math.min(Math.max(0, other.x), cols - clampedW);
    let candidateY = Math.max(0, other.y);

    while (placed.some((p) => rectsCollide({ ...other, x: clampedX, y: candidateY, w: clampedW }, p))) {
      candidateY++;
    }

    placed.push({
      ...other,
      x: clampedX,
      y: candidateY,
      w: clampedW,
    });
  }

  // Now gently compact everything upward except keeping target's priority
  const hidden = others.filter((i) => !i.isVisible);
  return compactLayoutWithAnchor(placed, targetId, cols).concat(hidden);
}

function compactLayoutWithAnchor(
  visibleItems: GridWidgetItem[],
  anchorId: string,
  cols: number
): GridWidgetItem[] {
  const anchor = visibleItems.find((i) => i.id === anchorId);
  const sorted = [...visibleItems].sort((a, b) => {
    if (a.id === anchorId && b.y >= a.y) return -1;
    if (b.id === anchorId && a.y >= b.y) return 1;
    return a.y !== b.y ? a.y - b.y : a.x - b.x;
  });

  const placed: GridWidgetItem[] = [];
  if (anchor) {
    // Allow anchor to float up only if space above it is truly empty
    let ay = 0;
    while (ay < anchor.y) {
      const collidesWithBefore = visibleItems
        .filter((v) => v.id !== anchorId && v.y + v.h <= anchor.y)
        .some((v) => rectsCollide({ ...anchor, y: ay }, v));
      if (!collidesWithBefore) break;
      ay++;
    }
    placed.push({ ...anchor, y: Math.min(anchor.y, ay) });
  }

  for (const item of sorted) {
    if (item.id === anchorId) continue;
    let cy = 0;
    while (placed.some((p) => rectsCollide({ ...item, y: cy }, p))) {
      cy++;
    }
    placed.push({ ...item, y: cy });
  }

  return placed.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
}

/**
 * Adapts canonical 12-column desktop items to 8-column Tablet or 4-column Mobile grids.
 */
export function adaptLayoutForColumns(
  desktopItems: GridWidgetItem[],
  targetCols: 12 | 8 | 4
): GridWidgetItem[] {
  if (targetCols === 12) {
    return compactLayout(desktopItems, 12);
  }

  if (targetCols === 8) {
    const mapped = desktopItems.map((it) => {
      const w = it.w >= 6 ? 8 : 4;
      const scaledX = w === 8 ? 0 : it.x >= 6 ? 4 : 0;
      return { ...it, w, x: scaledX };
    });
    return compactLayout(mapped, 8);
  }

  // Mobile (4 columns): clean full-width stacked layout preserving order
  const sorted = [...desktopItems]
    .filter((i) => i.isVisible)
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x))
    .map((it, idx) => ({
      ...it,
      x: 0,
      y: idx,
      w: 4,
      h: 1,
    }));

  const hidden = desktopItems.filter((i) => !i.isVisible);
  return [...sorted, ...hidden];
}

/**
 * Generates clean initial 12-column coordinates when a project has no saved layout yet.
 */
export function buildDefaultLayout(
  widgetDefs: Array<{ id: string; title: string; defaultW?: number; defaultH?: number }>
): GridWidgetItem[] {
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 1;
  const result: GridWidgetItem[] = [];

  for (const def of widgetDefs) {
    const w = Math.min(12, Math.max(3, def.defaultW ?? 4));
    const h = Math.max(1, def.defaultH ?? 1);

    if (cursorX + w > 12) {
      cursorX = 0;
      cursorY += rowMaxH;
      rowMaxH = h;
    } else {
      rowMaxH = Math.max(rowMaxH, h);
    }

    result.push({
      id: def.id,
      title: def.title,
      x: cursorX,
      y: cursorY,
      w,
      h,
      isVisible: true,
    });

    cursorX += w;
    if (cursorX >= 12) {
      cursorX = 0;
      cursorY += rowMaxH;
      rowMaxH = 1;
    }
  }

  return compactLayout(result, 12);
}
