"use client";

import React, { useState, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff, Scaling, ArrowLeft, ArrowRight } from "lucide-react";
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
  onMoveStep?: (id: string, direction: -1 | 1) => void;
  gridContainerRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}

const SNAP_WIDTHS = [4, 6, 8, 12];

function snapWidth(rawCols: number, maxCols: number): number {
  const clamped = Math.min(Math.max(3, rawCols), maxCols);
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

const COMPACT_WIDTH_OPTIONS: Array<{ w: number; h: number; label: string }> = [
  { w: 4, h: 1, label: "1/3" },
  { w: 6, h: 1, label: "1/2" },
  { w: 8, h: 1, label: "2/3" },
  { w: 12, h: 1, label: "Full" },
  { w: 12, h: 2, label: "Tall" },
];

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
  onMoveStep,
  gridContainerRef,
  children,
}: GridCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id, disabled: !isCustomizing || activeCols <= 4 });

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
      className={`devpulse-card relative group h-full min-h-[340px] flex flex-col ${
        !isDragging && !isResizing
          ? "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          : "scale-[1.015] shadow-2xl shadow-indigo-500/25"
      } ${
        isCustomizing
          ? "ring-2 ring-indigo-500/60 rounded-2xl shadow-xl shadow-indigo-500/10 bg-zinc-950/60"
          : ""
      } ${isResizing ? "ring-cyan-400 ring-2 select-none" : ""}`}
    >
      {/* Dedicated Customization Bar ABOVE card body (never overlaps card headers/buttons) */}
      {isCustomizing && (
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-t-2xl bg-zinc-900/95 border-b border-indigo-500/30 text-xs shrink-0">
          <div className="flex items-center gap-1 min-w-0 shrink-0">
            {/* Drag Handle */}
            <div
              {...attributes}
              {...listeners}
              className="hidden md:flex cursor-grab active:cursor-grabbing text-indigo-300 hover:text-white p-1 rounded hover:bg-zinc-800 transition touch-none shrink-0"
              title="Drag card anywhere on 2D grid"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] font-mono text-zinc-400 whitespace-nowrap shrink-0">
              {w}c &times; {h}r
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-auto">
            {onResize && activeCols >= 8 && (
              <div className="hidden sm:flex items-center gap-0.5 bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 mr-0.5">
                {COMPACT_WIDTH_OPTIONS.map((opt) => {
                  const isSelected = w === opt.w && h === opt.h;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => onResize(id, opt.w, opt.h, true)}
                      title={`Resize card to ${opt.w} cols × ${opt.h} row(s)`}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                        isSelected
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {onMoveStep && (
              <div className="flex items-center gap-0.5 bg-zinc-950 border border-zinc-800 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => onMoveStep(id, -1)}
                  aria-label="Move card earlier"
                  title="Move card earlier"
                  className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMoveStep(id, 1)}
                  aria-label="Move card later"
                  title="Move card later"
                  className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

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
        </div>
      )}

      {/* Card Body (stretches cleanly inside remaining cell height) */}
      <div className={`flex-1 min-h-0 [&>*]:h-full ${isCustomizing ? "[&>*]:rounded-t-none" : ""}`}>
        {children}
      </div>

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
