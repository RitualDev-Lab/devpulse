"use client";

import React, { useState, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff, ArrowDownRight } from "lucide-react";

export interface GridSpan {
  w: number; // 4 | 6 | 8 | 12 columns out of 12
  h: number; // 1 | 2 | 3 grid rows
}

interface SortableCardProps {
  id: string;
  isCustomizing: boolean;
  readOnly?: boolean;
  onHide?: (id: string) => void;
  w?: number;
  h?: number;
  onResize?: (id: string, nextSpan: GridSpan) => void;
  children: React.ReactNode;
}

const WIDTH_SNAPS = [4, 6, 8, 12];

function snapWidth(rawW: number): number {
  return WIDTH_SNAPS.reduce((best, candidate) =>
    Math.abs(candidate - rawW) < Math.abs(best - rawW) ? candidate : best
  );
}

export function SortableCard({
  id,
  isCustomizing,
  readOnly = false,
  onHide,
  w = 4,
  h = 1,
  onResize,
  children,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: readOnly || !isCustomizing });

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [livePreview, setLivePreview] = useState<GridSpan | null>(null);

  const effectiveW = livePreview?.w ?? w;
  const effectiveH = livePreview?.h ?? h;

  const colSpanClass =
    effectiveW >= 12
      ? "md:col-span-12"
      : effectiveW >= 8
        ? "md:col-span-8"
        : effectiveW >= 6
          ? "md:col-span-6"
          : "md:col-span-4";

  const rowSpanClass =
    effectiveH >= 3
      ? "md:row-span-3"
      : effectiveH === 2
        ? "md:row-span-2"
        : "row-span-1";

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: livePreview ? "none" : transition,
    zIndex: isDragging ? 40 : livePreview ? 35 : "auto",
    opacity: isDragging ? 0.78 : 1,
  };

  const handleCornerResizeStart = (e: React.PointerEvent) => {
    if (!onResize || readOnly) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const baseW = w;
    const baseH = h;
    const cardRect = cardRef.current?.getBoundingClientRect();
    const pxPerCol = cardRect && baseW > 0 ? Math.max(48, cardRect.width / baseW) : 90;
    const pxPerRow = 180;

    let latestSpan: GridSpan = { w: baseW, h: baseH };
    setLivePreview(latestSpan);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const nextW = snapWidth(baseW + dx / pxPerCol);
      const nextH = Math.max(1, Math.min(3, Math.round(baseH + dy / pxPerRow)));
      latestSpan = { w: nextW, h: nextH };
      setLivePreview(latestSpan);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setLivePreview(null);
      if (latestSpan.w !== baseW || latestSpan.h !== baseH) {
        onResize(id, latestSpan);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const setCombinedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    cardRef.current = node;
  };

  return (
    <div
      ref={setCombinedRef}
      style={style}
      className={`dashboard-card relative group col-span-1 ${colSpanClass} ${rowSpanClass} ${
        isCustomizing && !readOnly ? "ring-2 ring-indigo-500/50 rounded-2xl" : ""
      } ${livePreview ? "ring-2 ring-cyan-400 shadow-2xl shadow-cyan-500/20" : ""}`}
    >
      {/* Live Drag Resize Dimension Indicator */}
      {livePreview && (
        <div className="absolute -top-3 left-3 z-40 px-2.5 py-0.5 rounded-full bg-cyan-500 text-zinc-950 font-mono text-[10px] font-bold shadow-lg">
          {livePreview.w}/12 cols &times; {livePreview.h} row{livePreview.h > 1 ? "s" : ""}
        </div>
      )}

      {/* Customization Toolbar */}
      {isCustomizing && !readOnly && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-1 bg-zinc-950/95 border border-zinc-700/80 px-2 py-1 rounded-xl shadow-xl backdrop-blur-md text-xs">
          {onResize && (
            <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 mr-1">
              {[
                { label: "1x", cols: 4 },
                { label: "1/2", cols: 6 },
                { label: "2x", cols: 8 },
                { label: "3x", cols: 12 },
              ].map((preset) => (
                <button
                  key={preset.cols}
                  type="button"
                  onClick={() => onResize(id, { w: preset.cols, h: effectiveH })}
                  title={`Width ${preset.cols}/12 columns`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                    effectiveW === preset.cols
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onResize(id, { w: effectiveW, h: effectiveH >= 2 ? 1 : 2 })}
                title="Toggle double row height"
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition border-l border-zinc-800 ml-0.5 pl-1.5 ${
                  effectiveH >= 2
                    ? "text-cyan-400"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {effectiveH}h
              </button>
            </div>
          )}

          {/* Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition"
            title="Drag to reorder widget in 2D grid"
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

      {/* Corner Drag-Resize Handle */}
      {isCustomizing && !readOnly && onResize && (
        <button
          type="button"
          onPointerDown={handleCornerResizeStart}
          title="Drag corner to resize width & height"
          className="absolute bottom-1.5 right-1.5 z-30 w-6 h-6 rounded-lg bg-zinc-900/90 hover:bg-indigo-600 border border-zinc-700 hover:border-indigo-400 text-zinc-400 hover:text-white flex items-center justify-center cursor-nwse-resize shadow-md transition"
        >
          <ArrowDownRight className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="h-full">{children}</div>
    </div>
  );
}
