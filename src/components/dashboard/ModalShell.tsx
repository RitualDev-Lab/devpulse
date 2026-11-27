"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export function ModalShell({
  isOpen,
  onClose,
  maxWidthClass = "max-w-2xl",
  children,
}: ModalShellProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted || typeof document === "undefined") return null;

  const activeTheme = document.documentElement.getAttribute("data-theme") || "obsidian";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      data-theme={activeTheme}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`devpulse-modal-panel w-full ${maxWidthClass} bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-4 sm:p-6 text-left relative max-h-[92vh] overflow-hidden flex flex-col`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
