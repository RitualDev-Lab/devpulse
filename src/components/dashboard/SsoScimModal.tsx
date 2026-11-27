"use client";

import React from "react";
import { KeyRound, X } from "lucide-react";
import { SsoScimPanel } from "./SsoScimPanel";
import { ModalShell } from "./ModalShell";

interface SsoScimModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDemo?: boolean;
}

export function SsoScimModal({ isOpen, onClose, isDemo = false }: SsoScimModalProps) {
  return (
    <ModalShell isOpen={isOpen} onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-700/60 flex items-center justify-center text-cyan-400 shrink-0">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-white text-base truncate">
              Enterprise SSO (SAML 2.0) &amp; SCIM 2.0 Provisioning
            </h3>
            <p className="text-xs text-zinc-400 truncate">
              Okta • Microsoft Entra ID (Azure AD) • Google Workspace • Automatic Provisioning
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition shrink-0"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <SsoScimPanel isDemo={isDemo} />
      </div>
    </ModalShell>
  );
}
