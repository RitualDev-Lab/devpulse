"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff } from "lucide-react";

interface SortableCardProps {
  id: string;
  isCustomizing: boolean;
  onHide?: (id: string) => void;
  colSpan?: 1 | 2 | 3;
  children: React.ReactNode;
}

export function SortableCard({
  id,
  isCustomizing,
  onHide,
  colSpan = 1,
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
      ? "md:col-span-3 col-span-1"
      : colSpan === 2
      ? "md:col-span-2 col-span-1"
      : "col-span-1";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group transition-all duration-150 ${colSpanClass} ${
        isCustomizing ? "ring-2 ring-indigo-500/50 rounded-2xl" : ""
      }`}
    >
      {isCustomizing && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-1 bg-zinc-950/90 border border-zinc-700/80 px-2 py-1 rounded-xl shadow-lg backdrop-blur-md">
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition"
            title="Drag to reposition widget"
          >
            <GripVertical className="w-4 h-4" />
          </div>
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
