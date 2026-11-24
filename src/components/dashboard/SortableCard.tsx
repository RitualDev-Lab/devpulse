"use client";

import React, { useState, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff, Scaling } from "lucide-react";
import {
  SIZE_PRESETS,
  detectPresetKey,
  type SizePresetKey,
} from "@/lib/layout/grid-engine";

interface GridCardProps {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  activeCols: number;
  isCustomizing: boolean;
  onHide?: (id: string) => void;
  onResize?: (id: string, nextW: number, nextH: number, commit?: boolean) => void;
  gridContainerRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}

const SNAP_WIDTHS = [3, 6, 9, 12];

function snapWidth(rawCols: number, maxCols: number): number {
  const clamped = Math.min(Math.max(2, rawCols), maxCols);
  if (maxCols <= 4) return 4;
  if (maxCols <= 8) return clamped <= 5 ? 4 : 8;
  let best = SNAP_WIDTHS[0];
  let bestDist = Math.abs(clamped - best);
  for (const cand of SNAP_WIDTHS) {
    const d = Math.abs(clamped - cand);
    if (d < bestDist) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}

export function SortableCard({
  id,
  x,
  y,
  w,
  h,
  activeCols,
  isCustomizing,
  onHide,
  onResize,
  gridContainerRef,
  children,
}: GridCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id, disabled: !isCustomizing });

  const [isResizing, setIsResizing] = useState(false);
  const startStateRef = useRef<{
    pointerX: number;
    pointerY: number;
    startW: number;
    startH: number;
    colWidth: number;
    rowHeight: number;
  } | null>(null);

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onResize) return;
    e.stopPropagation();
    e.preventDefault();

    const gridEl = gridContainerRef?.current;
    const gridRect = gridEl?.getBoundingClientRect();
    const colWidth = gridRect ? gridRect.width / activeCols : 95;
    const rowHeight = 364; // 340px row height + 24px gap

    setIsResizing(true);
    startStateRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startW: w,
      startH: h,
      colWidth,
      rowHeight,
    };

    const handlePointerMove = (moveEvt: PointerEvent) => {
      if (!startStateRef.current) return;
      const dx = moveEvt.clientX - startStateRef.current.pointerX;
      const dy = moveEvt.clientY - startStateRef.current.pointerY;

      const deltaCols = Math.round(dx / startStateRef.current.colWidth);
      const deltaRows = Math.round(dy / startStateRef.current.rowHeight);

      const nextW = snapWidth(startStateRef.current.startW + deltaCols, activeCols);
      const nextH = Math.min(2, Math.max(1, startStateRef.current.startH + deltaRows));

      onResize(id, nextW, nextH, false);
    };

    const handlePointerUp = (upEvt: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (startStateRef.current) {
        const dx = upEvt.clientX - startStateRef.current.pointerX;
        const dy = upEvt.clientY - startStateRef.current.pointerY;
        const deltaCols = Math.round(dx / startStateRef.current.colWidth);
        const deltaRows = Math.round(dy / startStateRef.current.rowHeight);
        const nextW = snapWidth(startStateRef.current.startW + deltaCols, activeCols);
        const nextH = Math.min(2, Math.max(1, startStateRef.current.startH + deltaRows));
        onResize(id, nextW, nextH, true);
      }
      startStateRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const style: React.CSSProperties = {
    gridColumn: `${x + 1} / span ${Math.min(w, activeCols)}`,
    gridRow: `${y + 1} / span ${h}`,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : isResizing ? 45 : "auto",
    opacity: isDragging ? 0.85 : 1,
  };

  const activePreset = detectPresetKey(w, h);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-widget-id={id}
      data-grid-rect={`${x},${y},${w},${h}`}
      className={`devpulse-card relative group transition-shadow duration-200 h-full min-h-[340px] ${
        isCustomizing
          ? "ring-2 ring-indigo-500/60 rounded-2xl shadow-xl shadow-indigo-500/10"
          : ""
      } ${isResizing ? "ring-cyan-400 ring-2 select-none" : ""}`}
    >
      {/* Customization Toolbar & Size Presets */}
      {isCustomizing && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-1 bg-zinc-950/95 border border-zinc-700/80 px-2 py-1 rounded-xl shadow-xl backdrop-blur-md text-xs">
          {/* 2D Preset Sizes: 1x1, 2x1, 2x2, 3x2, 4x2 */}
          {onResize && activeCols >= 8 && (
            <div className="hidden sm:flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 mr-1">
              {(Object.keys(SIZE_PRESETS) as SizePresetKey[]).map((key) => {
                const preset = SIZE_PRESETS[key];
                const isSelected = activePreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onResize(id, preset.w, preset.h, true)}
                    title={`Resize to ${preset.label}`}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                      isSelected
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          )}

          {/* Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-zinc-300 hover:text-white p-1 rounded hover:bg-zinc-800 transition touch-none"
            title="Drag card anywhere on 2D grid"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Hide Card */}
          {onHide && (
            <button
              type="button"
              onClick={() => onHide(id)}
              className="text-zinc-400 hover:text-red-400 p-1 rounded hover:bg-zinc-800 transition"
              title="Hide this widget"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Live Dimension Badge during resize/customize */}
      {isCustomizing && (
        <div className="absolute bottom-2 left-3 z-20 px-2 py-0.5 rounded-md bg-zinc-950/90 border border-zinc-800 text-[10px] font-mono text-zinc-400 pointer-events-none">
          {w}c &times; {h}r {activePreset ? `(${activePreset})` : ""}
        </div>
      )}

      {/* Card Body (stretches to fill 2D cell height cleanly) */}
      <div className="h-full [&>*]:h-full">{children}</div>

      {/* Live Corner Resize Handle (Bottom-Right) */}
      {isCustomizing && onResize && (
        <div
          onPointerDown={handleResizePointerDown}
          title="Drag corner to resize widget"
          data-resize-handle={id}
          className="absolute bottom-1.5 right-1.5 z-30 w-6 h-6 rounded-lg bg-zinc-900/95 hover:bg-indigo-600 border border-zinc-700 hover:border-indigo-400 flex items-center justify-center cursor-nwse-resize text-zinc-400 hover:text-white shadow-lg transition touch-none"
        >
          <Scaling className="w-3.5 h-3.5" />
        </div>
      )}
    </div>
  );
}
