"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff, Maximize2 } from "lucide-react";

interface SortableCardProps {
  id: string;
  isCustomizing: boolean;
  onHide?: (id: string) => void;
  colSpan?: 1 | 2 | 3;
  onResize?: (id: string, newColSpan: 1 | 2 | 3) => void;
  children: React.ReactNode;
}

export function SortableCard({
  id,
  isCustomizing,
  onHide,
  colSpan = 1,
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
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : "auto",
    opacity: isDragging ? 0.75 : 1,
  };

  const colSpanClass =
    colSpan === 3
      ? "lg:col-span-3 md:col-span-2 col-span-1"
      : colSpan === 2
      ? "md:col-span-2 col-span-1"
      : "col-span-1";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group transition-all duration-200 ${colSpanClass} ${
        isCustomizing ? "ring-2 ring-indigo-500/50 rounded-2xl" : ""
      }`}
    >
      {/* Customization Toolbar & Resize Handles */}
      {isCustomizing && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5 bg-zinc-950/95 border border-zinc-700/80 px-2 py-1 rounded-xl shadow-xl backdrop-blur-md text-xs">
          {/* Resize Buttons */}
          {onResize && (
            <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 mr-1">
              <button
                type="button"
                onClick={() => onResize(id, 1)}
                title="Resize to 1 Column"
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                  colSpan === 1
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                1x
              </button>
              <button
                type="button"
                onClick={() => onResize(id, 2)}
                title="Resize to 2 Columns"
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                  colSpan === 2
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                2x
              </button>
              <button
                type="button"
                onClick={() => onResize(id, 3)}
                title="Resize to Full Width (3 Columns)"
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                  colSpan === 3
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                3x
              </button>
            </div>
          )}

          {/* Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition"
            title="Drag to reposition widget"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Hide Card */}
          {onHide && (
            <button
              onClick={() => onHide(id)}
              className="text-zinc-400 hover:text-red-400 p-1 rounded hover:bg-zinc-800 transition"
              title="Hide this widget"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
